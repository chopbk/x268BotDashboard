import { classifyMutationResult } from "./mutation.js";

const LABELS = {
  idle: "",
  draft: "Nháp",
  preview: "Chờ xác nhận",
  submitting: "Đang gửi…",
  accepted: "Đã nhận lệnh",
  partial: "Thành công một phần",
  failed: "Thất bại",
  rejected: "Bị từ chối",
  unknown: "Chưa xác định",
  duplicate: "Trùng request",
};

/**
 * Trạng thái mutation: gửi thành công ≠ đã khớp.
 * partial = saga/child một phần (vd reverse đã close, open bị chặn).
 * unknown = timeout/disconnect sau khi gửi — không tự báo thất bại.
 */
export default function MutationStatus({ phase, message, requestId, exchangeStatus }) {
  if (!phase || phase === "idle") {
    if (!message) return null;
    return <p className="term-mutation-note muted">{message}</p>;
  }
  const tone = phase === "rejected" || phase === "failed"
    ? "term-mutation-bad"
    : phase === "unknown" || phase === "partial"
      ? "term-mutation-warn"
      : phase === "accepted" || phase === "duplicate"
        ? "term-mutation-ok"
        : "muted";
  return (
    <div className={`term-mutation ${tone}`} role="status">
      <strong>{LABELS[phase] || phase}</strong>
      {message ? <span>{message}</span> : null}
      {requestId ? <span className="muted">request {requestId}</span> : null}
      {exchangeStatus ? <span className="muted">sàn: {exchangeStatus}</span> : null}
      {phase === "accepted" ? <span className="muted">Chưa đồng nghĩa đã khớp / đóng hết.</span> : null}
      {phase === "partial" ? (
        <span className="muted">Một phần đã thực hiện — đối chiếu receipt/vị thế, không coi như thất bại toàn bộ.</span>
      ) : null}
      {phase === "unknown" ? (
        <span className="muted">Giữ requestId, đối chiếu receipt — không tự retry bằng key mới.</span>
      ) : null}
    </div>
  );
}

export { classifyMutationResult };
