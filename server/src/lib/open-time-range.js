const { httpError } = require("./http");

const DEFAULT_RANGE_MS = 3 * 24 * 60 * 60 * 1000;

function parseDate(value, label) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw httpError(400, `${label} không hợp lệ`);
    return date;
}

function openTimeRange(input = {}, now = new Date()) {
    let from = parseDate(input.from, "Ngày bắt đầu");
    const to = parseDate(input.to, "Ngày kết thúc");
    if (!from && !to) from = new Date(now.getTime() - DEFAULT_RANGE_MS);
    if (from && to && from > to) throw httpError(400, "Ngày bắt đầu phải trước ngày kết thúc");
    return { from, to };
}

function openTimeFilter(range) {
    if (!range?.from && !range?.to) return null;
    return {
        ...(range.from ? { $gte: range.from } : {}),
        ...(range.to ? { $lte: range.to } : {}),
    };
}

module.exports = { DEFAULT_RANGE_MS, openTimeRange, openTimeFilter };
