/**
 * Phân loại kết quả mutation cho Terminal UI.
 * Không coi mọi HTTP 2xx body là "accepted".
 */
export function classifyMutationResult(result, { timedOut = false } = {}) {
  if (timedOut) {
    return {
      phase: "unknown",
      message: "Mất kết nối sau khi gửi — trạng thái chưa xác định",
    };
  }
  if (!result) return { phase: "rejected", message: "Không có phản hồi" };
  if (result.duplicate) {
    const dupStatus = result.command?.status;
    if (result.inFlight || dupStatus === "claimed" || dupStatus === "submitted") {
      return {
        phase: "unknown",
        message: "Ý định đang xử lý — đối chiếu receipt, không gửi key mới",
        requestId: result.command?.requestId,
        exchangeStatus: dupStatus || null,
      };
    }
    if (dupStatus === "partial") {
      return {
        phase: "partial",
        message: "Trùng ý định — receipt gốc là thành công một phần",
        requestId: result.command?.requestId,
        exchangeStatus: dupStatus,
        closeOk: Boolean(result.command?.result?.closeOk),
        openBlocked: Boolean(result.command?.result?.openBlocked),
      };
    }
    if (dupStatus === "failed") {
      return {
        phase: "failed",
        message: "Trùng ý định — receipt gốc thất bại",
        requestId: result.command?.requestId,
        exchangeStatus: dupStatus,
      };
    }
    if (dupStatus === "unknown") {
      return {
        phase: "unknown",
        message: "Trùng ý định — trạng thái gốc chưa xác định",
        requestId: result.command?.requestId,
        exchangeStatus: "unknown",
      };
    }
    return {
      phase: "duplicate",
      message: "Trùng ý định đã gửi trước đó",
      requestId: result.command?.requestId,
      exchangeStatus: dupStatus || null,
    };
  }

  const cmd = result.command || {};
  const exec = cmd.result || {};
  const cmdStatus = cmd.status;
  const requestId = cmd.requestId;

  if (cmdStatus === "partial" || exec.partial === true || exec.closeOk === true) {
    let message = "Thực hiện một phần";
    if (exec.closeOk && exec.openBlocked) {
      message = exec.gateError
        ? "Đã đóng vị thế; mở chiều ngược bị lỗi gate — kiểm tra receipt"
        : "Đã đóng vị thế; không mở chiều ngược (risk/gate)";
    } else if (exec.closeOk) {
      message = "Đã đóng; phần còn lại chưa hoàn tất";
    }
    return {
      phase: "partial",
      message,
      requestId,
      exchangeStatus: cmdStatus || "partial",
      closeOk: Boolean(exec.closeOk),
      openBlocked: Boolean(exec.openBlocked),
      gateError: Boolean(exec.gateError),
    };
  }

  if (cmdStatus === "failed" || exec.success === false) {
    return {
      phase: "failed",
      message: exec.error || exec.reason || cmd.error || "Lệnh thất bại",
      requestId,
      exchangeStatus: cmdStatus || "failed",
    };
  }

  if (cmdStatus === "unknown") {
    return {
      phase: "unknown",
      message: "Trạng thái chưa xác định — đối chiếu receipt",
      requestId,
      exchangeStatus: "unknown",
    };
  }

  const orderId = exec.orderId || result?.command?.exchangeResult?.orderId;
  const status = exec.status || result?.command?.exchangeResult?.status;
  return {
    phase: "accepted",
    message: orderId ? `Order ${orderId}` : "Server đã nhận lệnh",
    requestId,
    exchangeStatus: status || cmdStatus || null,
  };
}
