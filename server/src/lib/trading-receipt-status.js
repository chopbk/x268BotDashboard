/** Trạng thái durable receipt — phải khớp enum model TradingReceipt. */
const RECEIPT_STATUSES = Object.freeze([
    "claimed",
    "submitted",
    "succeeded",
    "partial",
    "failed",
    "unknown",
]);

const RECEIPT_STATUS_SET = new Set(RECEIPT_STATUSES);

/**
 * Map kết quả adapter → status receipt.
 * partial: reverse/saga đã có phần thành công (vd closeOk) dù open-leg bị chặn.
 */
function receiptStatusFromResult(result) {
    if (result == null) return "unknown";
    if (result.success === true) return "succeeded";
    if (result.partial === true || result.closeOk === true) return "partial";
    if (result.success === false) return "failed";
    return "unknown";
}

function assertReceiptStatus(status) {
    const s = String(status || "");
    if (!RECEIPT_STATUS_SET.has(s)) {
        throw new Error(`Invalid receipt status: ${s}`);
    }
    return s;
}

function isTerminalReceiptStatus(status) {
    return ["succeeded", "partial", "failed"].includes(String(status || ""));
}

module.exports = {
    RECEIPT_STATUSES,
    RECEIPT_STATUS_SET,
    receiptStatusFromResult,
    assertReceiptStatus,
    isTerminalReceiptStatus,
};
