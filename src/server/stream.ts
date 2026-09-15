import { createHash } from "node:crypto";

/** Relay fresh authorized snapshots; read() repeats access checks on every tick. */
export function snapshotStream<T>(initial: T, read: () => Promise<T>, signal: AbortSignal, options: { intervalMs?: number; durationMs?: number; heartbeatMs?: number; validate?: () => void; subscribe?: (receive: (value: T) => void, failed: () => void) => { close: () => void; connected: () => boolean } } = {}): ReadableStream<Uint8Array> {
  const intervalMs = options.intervalMs ?? 1000;
  const durationMs = options.durationMs ?? 55_000;
  const heartbeatMs = options.heartbeatMs ?? 5000;
  const encoder = new TextEncoder();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  let cleanup: () => void = () => {};
  return new ReadableStream({
    start(controller) {
      const began = Date.now();
      let lastDigest = "";
      let lastSentAt = began;
      let subscription: { close: () => void; connected: () => boolean } | undefined;
      cleanup = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        subscription?.close();
      };
      stop = () => { if (stopped) return; cleanup(); controller.close(); };
      const send = (event: string, data: unknown, id?: string) => {
        if (stopped) return;
        controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        lastSentAt = Date.now();
      };
      const publish = (value: T) => {
        const serialized = JSON.stringify(value);
        const digest = createHash("sha256").update(serialized).digest("hex");
        if (digest !== lastDigest) {
          lastDigest = digest;
          send("snapshot", { snapshot: value, receivedAt: Date.now() }, digest);
        } else if (Date.now() - lastSentAt >= heartbeatMs) {
          send("heartbeat", { receivedAt: Date.now() });
        }
      };
      const tick = async () => {
        if (stopped) return;
        if (Date.now() - began >= durationMs) { stop(); return; }
        try {
          options.validate?.();
          if (!options.subscribe) publish(await read());
          else if (subscription?.connected()) {
            if (Date.now() - lastSentAt >= heartbeatMs) send("heartbeat", { receivedAt: Date.now() });
          } else if (Date.now() - began > heartbeatMs) throw new Error("subscription_disconnected");
        }
        catch {
          // Do not expose provider errors, credentials, or serialized function arguments.
          send("unavailable", { error: "stream_unavailable" });
          stop();
          return;
        }
        if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
      };
      if (signal.aborted) { stop(); return; }
      signal.addEventListener("abort", stop, { once: true });
      controller.enqueue(encoder.encode("retry: 1500\n\n"));
      publish(initial);
      try {
        subscription = options.subscribe?.(publish, () => { send("unavailable", { error: "stream_unavailable" }); stop(); });
        if (stopped) { subscription?.close(); return; }
      } catch { send("unavailable", { error: "stream_unavailable" }); stop(); return; }
      timer = setTimeout(() => void tick(), intervalMs);
    },
    cancel() { cleanup(); },
  });
}
