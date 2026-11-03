/**
 * Nhãn tiếng Việt cho economy UI / API hints (server + shared semantics).
 */

const IMPACT_VI = Object.freeze({
    high: "Cao",
    medium: "Trung bình",
    low: "Thấp",
    holiday: "Nghỉ lễ",
    unknown: "Chưa rõ",
});

const STATUS_VI = Object.freeze({
    scheduled: "Sắp tới",
    due: "Đến giờ — chờ số liệu",
    released: "Đã có số liệu",
    postponed: "Hoãn",
    cancelled: "Hủy",
    unknown: "Chưa rõ",
});

const QUALITY_VI = Object.freeze({
    fresh: "mới",
    stale: "cũ / giữ bản trước",
    missing: "thiếu",
    error: "lỗi nguồn",
    warming: "đang thu thập",
});

const COVERAGE_REASON_VI = Object.freeze({
    calendar_this_week_only: "Lịch nguồn chỉ có tuần hiện tại",
    calendar_next_week_unavailable: "Chưa có lịch tuần tới từ nguồn",
    actual_not_provided_by_feed: "Nguồn lịch chưa cung cấp số Actual đã xác minh",
    terms_unverified_redistributor: "Cần xác nhận điều khoản sử dụng nguồn lịch",
    calendar_fetch_failed: "Lỗi tải lịch",
    calendar_unavailable: "Chưa xác nhận lịch",
    calendar_not_collected: "Collector lịch chưa chạy",
    calendar_fetch_unhealthy: "Collector lịch đang lỗi",
    fred_partial_errors: "Một phần chuỗi FRED lỗi",
    yield_curve_no_common_date: "Chưa cùng ngày quan sát cho đường cong",
    insufficient_metrics_for_brief: "Chưa đủ số liệu cho bản tin",
});

/** Gợi ý ngắn tiếng Việt theo tiêu đề sự kiện (không dịch cứng toàn bộ title nguồn). */
function eventHintVi(title) {
    const t = String(title || "").toLowerCase();
    if (/cpi|consumer price|inflation/.test(t)) {
        return "CPI / lạm phát Mỹ — thường làm BTC biến động mạnh quanh giờ công bố (đêm VN hoặc sáng sớm).";
    }
    if (/core\s*cpi|pce|personal consumption/.test(t)) {
        return "Lạm phát lõi (Fed theo dõi sát) — ưu tiên xem cùng lợi suất và DXY proxy nếu có.";
    }
    if (/nonfarm|non-farm|nfp|payroll|employment/.test(t)) {
        return "Việc làm Mỹ (NFP/payroll) — ảnh hưởng kỳ vọng lãi suất; canh giờ đêm VN.";
    }
    if (/unemployment|jobless|claims/.test(t)) {
        return "Thất nghiệp / đơn xin trợ cấp thất nghiệp — tín hiệu thị trường lao động.";
    }
    if (/fomc|federal funds|interest rate decision|fed\b|rate decision/.test(t)) {
        return "Fed / FOMC — sự kiện lãi suất; biến động crypto thường tăng trước và sau họp.";
    }
    if (/gdp/.test(t)) return "GDP Mỹ — tăng trưởng kinh tế; ít “sốc” tức thì hơn CPI/NFP nhưng vẫn đáng theo.";
    if (/ism|pmi/.test(t)) return "ISM/PMI — sức khỏe sản xuất/dịch vụ; ảnh hưởng vừa.";
    if (/retail sales/.test(t)) return "Doanh số bán lẻ — cầu tiêu dùng Mỹ.";
    if (/jolts/.test(t)) return "JOLTS — vị trí tuyển dụng; liên quan thị trường lao động.";
    if (/daylight saving|holiday/.test(t)) return "Ngày nghỉ / đổi giờ — thanh khoản có thể mỏng, không phải số liệu kinh tế.";
    return null;
}

function impactLabelVi(impact) {
    return IMPACT_VI[impact] || IMPACT_VI.unknown;
}

function statusLabelVi(status) {
    return STATUS_VI[status] || STATUS_VI.unknown;
}

function qualityLabelVi(quality) {
    return QUALITY_VI[quality] || quality || "—";
}

function coverageReasonsVi(reasons = []) {
    return reasons.map((r) => COVERAGE_REASON_VI[r] || r);
}

/** Checklist trước phiên cho operator VN (giờ mặc định Asia/Ho_Chi_Minh). */
function sessionGuideVi() {
    return {
        title: "Trước phiên (giờ Việt Nam)",
        bullets: [
            "Xem sự kiện Cao/Trung USD trong 24 giờ tới và countdown theo giờ VN.",
            "Đối chiếu lợi suất Mỹ (2Y/10Y) và VIX close — đây là đóng cửa ngày, không phải giá realtime.",
            "BTC.D / F&G lấy từ snapshot crypto hiện có; đừng cộng với volume Futures Binance.",
            "Chưa có Actual đã xác minh: đến giờ chỉ hiện “chờ số liệu”, không lấy Previous làm Actual.",
            "Không tự đặt lệnh từ màn này — chỉ chuẩn bị nhận định và kiểm chứng.",
        ],
    };
}

module.exports = {
    IMPACT_VI,
    STATUS_VI,
    QUALITY_VI,
    eventHintVi,
    impactLabelVi,
    statusLabelVi,
    qualityLabelVi,
    coverageReasonsVi,
    sessionGuideVi,
};
