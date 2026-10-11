import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { positionAlerts } from "../../position-alerts";
import { bookForApi } from "./matches.js";

/**
 * Feed vị thế dùng chung bảng + panel: REST mode=fast + WS + poll fallback.
 * Không tăng cadence so với PositionsPage.
 */
export function usePositionsFeed({ account, audience, book, enabled, onAlerts }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const watchKeyRef = useRef("");
  const onAlertsRef = useRef(onAlerts);
  onAlertsRef.current = onAlerts;

  const acceptView = useCallback((prev, view) => {
    if (!view) return prev;
    const versions = new Map((prev?.sources || []).map((item) => [item.account, item.version]));
    if ((view.sources || []).some((item) => item.version != null && versions.get(item.account) != null && item.version < versions.get(item.account))) {
      return prev;
    }
    const apiBook = bookForApi(book);
    const key = `${account}|${audience}|${apiBook}`;
    if (watchKeyRef.current === key && prev) {
      const alerts = positionAlerts(prev, view);
      if (alerts.length) queueMicrotask(() => onAlertsRef.current?.(alerts));
    } else {
      watchKeyRef.current = key;
    }
    return view;
  }, [account, audience, book]);

  useEffect(() => {
    if (!enabled) return undefined;
    let socket = null;
    let poll = null;
    let retry = null;
    let gone = false;
    let attempt = 0;
    let lastPush = 0;
    let pushRevision = 0;
    const apiBook = bookForApi(book);

    function apply(view) {
      if (gone || !view) return;
      setPayload((prev) => acceptView(prev, view));
    }

    async function load() {
      try {
        const query = new URLSearchParams();
        query.set("audience", audience);
        query.set("mode", "fast");
        if (apiBook) query.set("book", apiBook);
        if (account) query.set("account", account);
        const before = pushRevision;
        const view = await api(`/api/positions?${query}`);
        if (before === pushRevision) apply(view);
        setError("");
      } catch (err) {
        console.error("[terminal]", err);
        setError(err.message || "Không tải được vị thế");
        setPayload((prev) => (prev ? { ...prev, stale: true, connection: "stale" } : prev));
      }
    }

    function startPoll() {
      if (poll) return;
      poll = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        if (socket?.readyState === WebSocket.OPEN && Date.now() - lastPush < 30_000) return;
        load();
      }, 15000);
    }

    function send(type) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type, account, audience, book: apiBook }));
    }

    function openSocket() {
      if (document.visibilityState === "hidden") return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const current = new WebSocket(`${proto}//${window.location.host}/api/positions/ws`);
      socket = current;
      current.onopen = () => {
        if (socket !== current) return;
        attempt = 0;
        send("watch");
      };
      current.onmessage = (event) => {
        if (socket !== current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "error") {
            setError(message.error || "Không xem được vị thế");
            return;
          }
          if (message.type === "snapshot") {
            lastPush = Date.now();
            pushRevision += 1;
            apply(message);
            setError("");
          }
        } catch (err) {
          console.error("[terminal]", err);
        }
      };
      current.onclose = () => {
        if (socket !== current) return;
        socket = null;
        setPayload((prev) => {
          if (!prev || prev.connection === "monitor" || prev.connection === "idle") return prev;
          return { ...prev, stale: true, connection: "stale" };
        });
        if (gone || document.visibilityState === "hidden") return;
        const wait = Math.min(10000, 1000 * (2 ** attempt));
        attempt += 1;
        retry = window.setTimeout(openSocket, wait);
      };
    }

    function onVisible() {
      if (document.visibilityState === "hidden") {
        send("pause");
        if (poll) window.clearInterval(poll);
        poll = null;
        return;
      }
      startPoll();
      if (socket?.readyState === WebSocket.OPEN) send("resume");
      else openSocket();
    }

    load();
    openSocket();
    startPoll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      send("pause");
      socket?.close();
      if (poll) window.clearInterval(poll);
      if (retry) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account, audience, book, enabled, acceptView]);

  async function refreshExchange() {
    setRefreshing(true);
    try {
      const apiBook = bookForApi(book);
      const view = await api("/api/positions/refresh", {
        method: "POST",
        body: { account, audience, book: apiBook },
        timeoutMs: 60000,
      });
      setPayload((prev) => acceptView(prev, view));
      setError("");
      return view;
    } catch (err) {
      console.error("[terminal]", err);
      setError(err.message || "Không cập nhật được sổ sàn");
      throw err;
    } finally {
      setRefreshing(false);
    }
  }

  function patchPayload(updater) {
    setPayload((prev) => (prev ? updater(prev) : prev));
  }

  return {
    payload,
    setPayload,
    patchPayload,
    error,
    setError,
    refreshing,
    refreshExchange,
    acceptView,
  };
}
