"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, Snapshot } from "./types";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";
export interface CaseTransition { caseId: string; title: string; from: string; to: string; at: number }

export function useControl() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const current = useRef<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [recentTransitions, setRecentTransitions] = useState<CaseTransition[]>([]);
  const alive = useRef(true);
  const receivedAt = useRef(0);
  const streamHealthy = useRef(false);

  const receive = useCallback((next: Snapshot) => {
    if (!alive.current) return;
    const previous = current.current;
    // A delayed command response or fallback poll cannot undo a newer stream event.
    if (previous && (next.revision ?? 0) < (previous.revision ?? 0)) return;
    const now = Date.now();
    if (previous) {
      const changes = next.cases.flatMap(item => {
        const old = previous.cases.find(candidate => candidate.id === item.id);
        return old && old.phase !== item.phase ? [{ caseId: item.id, title: item.title, from: old.phase, to: item.phase, at: now }] : [];
      });
      if (changes.length) setRecentTransitions(events => [...changes, ...events].slice(0, 24));
    }
    current.current = next;
    setSnapshot(next);
    receivedAt.current = now;
    setLastSyncedAt(now);
    setLoadError("");
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/control", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "unauthorized" ? "Workspace access expired. Enter the access code again." : data.error || "Could not load the workspace.");
      receive(data as Snapshot);
      return true;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return false;
      if (alive.current) setLoadError(cause instanceof Error ? cause.message : "Could not load the workspace.");
      return false;
    }
  }, [receive]);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let source: EventSource | undefined;
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectDelay = 1000;
    let lastStreamEvent = Date.now();
    let fallbackPending = false;
    const initial = setTimeout(() => void refresh(controller.signal), 0);
    function reconnect(status: ConnectionState = "reconnecting") {
      if (!active) return;
      source?.close();
      source = undefined;
      streamHealthy.current = false;
      setConnection(status);
      if (reconnectTimer !== undefined || typeof EventSource === "undefined") return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
    }
    function connect() {
      if (!active || typeof EventSource === "undefined") return;
      const stream = new EventSource("/api/control/stream");
      source = stream;
      lastStreamEvent = Date.now();
      const isCurrent = () => active && source === stream;
      const onHeartbeat = () => {
        if (!isCurrent()) return;
        lastStreamEvent = Date.now();
        receivedAt.current = lastStreamEvent;
        setLastSyncedAt(lastStreamEvent);
        reconnectDelay = 1000;
        streamHealthy.current = true;
        setConnection("live");
      };
      stream.addEventListener("snapshot", event => {
        if (!isCurrent()) return;
        try { receive(JSON.parse((event as MessageEvent<string>).data).snapshot as Snapshot); onHeartbeat(); }
        catch { reconnect(); }
      });
      stream.addEventListener("heartbeat", onHeartbeat);
      stream.addEventListener("unavailable", () => { if (isCurrent()) reconnect(); });
      // HTTP failures can leave EventSource CLOSED; native reconnect is not
      // guaranteed. Keep one explicit retry, with bounded exponential delay.
      stream.onerror = () => { if (isCurrent()) reconnect(); };
    }
    connect();
    const fallback = setInterval(() => {
      if (source && Date.now() - lastStreamEvent > 8000) reconnect("offline");
      if (!streamHealthy.current && !fallbackPending) {
        fallbackPending = true;
        void refresh(controller.signal).finally(() => { fallbackPending = false; });
      }
      if (receivedAt.current && Date.now() - receivedAt.current > 8000) {
        streamHealthy.current = false;
        setConnection("offline");
      }
    }, 3000);
    const visible = () => { if (!document.hidden) void refresh(controller.signal); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      alive.current = false;
      controller.abort();
      source?.close();
      streamHealthy.current = false;
      clearTimeout(initial);
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [receive, refresh]);

  const act: Action = useCallback(async (action, payload = {}, success = "Saved.") => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The action could not be completed.");
      if (data.cases && data.workspace) receive(data as Snapshot);
      else await refresh();
      if (alive.current) setMessage(success);
      return true;
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "The action could not be completed.");
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }, [receive, refresh]);

  return { snapshot, act, busy, error, loadError, message, refresh, connection, lastSyncedAt, recentTransitions };
}
