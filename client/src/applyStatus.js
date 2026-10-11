import { api } from "./api";

export function applyStatusLabel(apply) {
  if (!apply?.requestId && apply?.status === "failed") {
    return "Đã lưu DB — chờ đồng bộ bot (không gửi được MQTT)";
  }
  if (!apply) return "Đã lưu DB";
  if (apply.status === "succeeded" && apply.terminal) return "Đã đồng bộ lên bot";
  if (apply.status === "failed" && apply.terminal) {
    return `Đã lưu DB — chờ đồng bộ (${apply.error?.message || "bot báo lỗi"})`;
  }
  if (apply.status === "expired" && apply.terminal) {
    return "Đã lưu DB — chờ đồng bộ (bot không ACK kịp / trader offline)";
  }
  if (["queued", "published", "received", "running"].includes(apply.status)) {
    return `Đã lưu DB — đang đồng bộ (${apply.status})`;
  }
  return `Đã lưu DB — ${apply.status || "chờ đồng bộ"}`;
}

export function summarizeApplies(applies) {
  const list = Array.isArray(applies) ? applies.filter(Boolean) : [];
  if (!list.length) return "";
  const ok = list.filter((a) => a.status === "succeeded" && a.terminal).length;
  const pending = list.filter((a) => a.requestId && !a.terminal).length;
  const bad = list.filter((a) => a.terminal && a.status !== "succeeded").length;
  const parts = [];
  if (ok) parts.push(`${ok} đã đồng bộ`);
  if (pending) parts.push(`${pending} đang đồng bộ`);
  if (bad) parts.push(`${bad} chờ đồng bộ`);
  return parts.join(", ");
}

/**
 * Chờ ACK terminal trên Mongo outbox (bot ghi trực tiếp; MQTT chỉ phụ).
 * Lần đầu dùng waitMs phía server để giảm round-trip khi bot online.
 */
export async function waitForApply(username, requestId, { signal, timeoutMs = 35_000 } = {}) {
  if (!requestId) return null;
  const started = Date.now();
  let last = null;
  let first = true;
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) break;
    const remain = Math.max(0, timeoutMs - (Date.now() - started));
    const waitMs = first ? Math.min(3_000, remain) : 0;
    first = false;
    const qs = waitMs > 0 ? `?waitMs=${waitMs}` : "";
    const data = await api(
      `/api/bots/${encodeURIComponent(username)}/commands/${encodeURIComponent(requestId)}${qs}`,
      { signal, timeoutMs: Math.max(10_000, waitMs + 5_000) }
    );
    last = data.command || null;
    if (last?.terminal) return last;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return last;
}

export async function waitForApplies(username, applies, options) {
  const list = Array.isArray(applies) ? applies.filter((a) => a?.requestId) : [];
  const out = [];
  for (const apply of list) {
    if (apply.terminal) {
      out.push(apply);
      continue;
    }
    out.push((await waitForApply(username, apply.requestId, options)) || apply);
  }
  return out;
}
