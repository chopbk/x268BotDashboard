/**
 * Quyết định có phát toast mở/đóng vị thế hay không.
 * Tránh báo giả khi vào trang: REST mode=fast → WS/live snapshot đầu.
 */
export function nextAlertGate({ watchKey, currentKey, prev, view, armed }) {
  if (watchKey !== currentKey) {
    return { watchKey: currentKey, armed: false, emit: false };
  }
  if (!prev || !view) {
    return { watchKey, armed: false, emit: false };
  }
  // Paint nhanh không phải baseline ổn định — mọi khác biệt so với live đều giả.
  if (prev.mode === "fast") {
    return { watchKey, armed: view.mode !== "fast", emit: false };
  }
  // Snapshot đầu sau khi gắn watch: dùng làm mốc, chưa toast.
  if (!armed) {
    return { watchKey, armed: true, emit: false };
  }
  return { watchKey, armed: true, emit: true };
}
