export function classifyMutationResult(result, { timedOut = false } = {}) {
  if (timedOut) return { phase: "unknown", message: "Mất kết nối sau khi gửi — trạng thái chưa xác định" };
  if (!result) return { phase: "rejected", message: "Không có phản hồi" };
  if (result.duplicate) return { phase: "duplicate", message: "Trùng ý định đã gửi trước đó", requestId: result.command?.requestId };
  const orderId = result?.command?.result?.orderId || result?.command?.exchangeResult?.orderId;
  const status = result?.command?.result?.status || result?.command?.exchangeResult?.status;
  return {
    phase: "accepted",
    message: orderId ? `Order ${orderId}` : "Server đã nhận lệnh",
    requestId: result.command?.requestId,
    exchangeStatus: status || null,
  };
}
