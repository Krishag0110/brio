import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotStream } from "../../src/server/stream";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function capture(stream: ReadableStream<Uint8Array>) {
  const chunks: string[] = [];
  const reader = stream.getReader();
  const done = (async () => {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      chunks.push(new TextDecoder().decode(result.value));
    }
  })();
  return { chunks, done, cancel: () => reader.cancel(), events: () => chunks.join("") };
}

describe("authorized snapshot stream", () => {
  it("sends an initial identified snapshot and forwards committed native updates without polling", async () => {
    const abort = new AbortController();
    const read = vi.fn(async () => ({ revision: 0 }));
    const close = vi.fn();
    let deliver!: (value: { revision: number }) => void;
    const result = capture(snapshotStream({ revision: 7 }, read, abort.signal, {
      subscribe(receive) { deliver = receive; return { close, connected: () => true }; },
    }));
    await vi.advanceTimersByTimeAsync(1000);
    deliver({ revision: 8 });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).not.toHaveBeenCalled();
    expect(result.events()).toContain("retry: 1500");
    expect(result.events()).toMatch(/id: [a-f0-9]{64}/);
    expect(result.events()).toContain('"snapshot":{"revision":7}');
    expect(result.events()).toContain('"snapshot":{"revision":8}');
    abort.abort(); await result.done;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("polls demo snapshots, suppresses unchanged payloads and gives a fresh heartbeat", async () => {
    const abort = new AbortController();
    const read = vi.fn(async () => ({ revision: 1 }));
    const result = capture(snapshotStream({ revision: 1 }, read, abort.signal, { heartbeatMs: 2000 }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.chunks.filter(value => value.includes("event: snapshot"))).toHaveLength(1);
    expect(result.chunks.filter(value => value.includes("event: heartbeat"))).toHaveLength(1);
    read.mockResolvedValue({ revision: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(result.events()).toContain('"revision":2');
    abort.abort(); await result.done;
  });

  it("closes a native stream when access expires and never exposes the underlying error", async () => {
    const abort = new AbortController();
    const close = vi.fn();
    const validate = vi.fn(() => { throw new Error("secret-fixture-session-token"); });
    const read = vi.fn(async () => 2);
    const result = capture(snapshotStream(1, read, abort.signal, {
      validate, subscribe: () => ({ close, connected: () => true }),
    }));
    await vi.advanceTimersByTimeAsync(1000); await result.done;
    expect(validate).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(result.events()).toContain('"error":"stream_unavailable"');
    expect(result.events()).not.toContain("secret-fixture");
    expect(result.events()).not.toContain("event: heartbeat");
  });

  it("reports a failed demo read without falsely reporting a healthy heartbeat", async () => {
    const read = vi.fn(async () => { throw new Error("provider-token-fixture"); });
    const result = capture(snapshotStream(1, read, new AbortController().signal, { heartbeatMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1000); await result.done;
    expect(result.events()).toContain("event: unavailable");
    expect(result.events()).not.toContain("provider-token-fixture");
    expect(result.events()).not.toContain("event: heartbeat");
  });

  it("terminates a disconnected native source and releases its subscription", async () => {
    const close = vi.fn();
    const result = capture(snapshotStream(1, vi.fn(), new AbortController().signal, {
      heartbeatMs: 2000, subscribe: () => ({ close, connected: () => false }),
    }));
    await vi.advanceTimersByTimeAsync(3000); await result.done;
    expect(result.events()).toContain("event: unavailable");
    expect(result.events()).not.toContain("event: heartbeat");
    expect(close).toHaveBeenCalledOnce();
  });

  it("handles synchronous subscription failure and closes the returned handle once", async () => {
    const close = vi.fn();
    const result = capture(snapshotStream(1, vi.fn(), new AbortController().signal, {
      subscribe(_receive, failed) { failed(); return { close, connected: () => true }; },
    }));
    await result.done;
    expect(close).toHaveBeenCalledOnce();
    expect(result.events()).toContain("event: unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases native subscriptions on consumer cancellation", async () => {
    const close = vi.fn();
    const abort = new AbortController();
    const result = capture(snapshotStream(1, vi.fn(), abort.signal, {
      subscribe: () => ({ close, connected: () => true }),
    }));
    await result.cancel(); await result.done; abort.abort();
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an in-flight read after cancellation", async () => {
    let complete!: (value: number) => void;
    const read = vi.fn(() => new Promise<number>(resolve => { complete = resolve; }));
    const result = capture(snapshotStream(1, read, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledOnce();
    await result.cancel(); await result.done;
    complete(2); await vi.advanceTimersByTimeAsync(5000);
    expect(result.events()).not.toContain('"snapshot":2');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends at the renewal deadline even when the backend remains healthy", async () => {
    const close = vi.fn();
    const result = capture(snapshotStream(1, vi.fn(), new AbortController().signal, {
      durationMs: 3000, subscribe: () => ({ close, connected: () => true }),
    }));
    await vi.advanceTimersByTimeAsync(3000); await result.done;
    expect(close).toHaveBeenCalledOnce();
    expect(result.events()).not.toContain("event: unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not subscribe or deliver snapshots to an already aborted request", async () => {
    const abort = new AbortController(); abort.abort();
    const subscribe = vi.fn(() => ({ close: vi.fn(), connected: () => true }));
    const result = capture(snapshotStream(1, vi.fn(), abort.signal, { subscribe }));
    await result.done;
    expect(subscribe).not.toHaveBeenCalled();
    expect(result.events()).toBe("");
  });
});
