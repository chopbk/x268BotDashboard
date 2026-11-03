/**
 * Read API — chỉ đọc stored snapshot / Mongo; không gọi provider.
 */
const { SCHEMA_VERSION, FORMULA_VERSION, config } = require("./config");
const { isSeriesAllowed, getMetric, YIELD_TENORS } = require("./registry");
const { buildContextBrief } = require("./brief");
const { resolveEventStatus, countdownInfo, normalizeTimeZone, localDayUtcRange, calendarDateInZone } = require("./calendar-status");
const {
    getContextSnapshot,
    getCalendarMeta,
    listEventsInRange,
    listRecentDueOrPastEvents,
    listNews,
    getEventById,
    listEventValues,
    listMetricSeries,
} = require("./store");
const { getMacro, getTickers } = require("../market-dash/store");
const { buildCryptoRefs } = require("./collector/yields");
const { FRED_ATTRIBUTION } = require("./providers/fred");
const {
    eventHintVi,
    impactLabelVi,
    statusLabelVi,
    qualityLabelVi,
    coverageReasonsVi,
    sessionGuideVi,
} = require("./labels-vi");

function envelope(extra = {}) {
    const serverNow = new Date().toISOString();
    return {
        schemaVersion: SCHEMA_VERSION,
        formulaVersion: FORMULA_VERSION,
        generatedAt: extra.generatedAt || serverNow,
        serverNow,
        ...extra,
    };
}

async function getEconomyContext(query = {}) {
    const region = String(query.region || "us").toLowerCase();
    if (region !== "us") {
        return { status: 400, error: "Chỉ hỗ trợ region=us trong P0" };
    }

    const [snap, macro, tickers, calMeta] = await Promise.all([
        getContextSnapshot(),
        getMacro(),
        getTickers(),
        getCalendarMeta(),
    ]);

    const cryptoRefs = buildCryptoRefs(macro, tickers);
    const metrics = snap?.metrics || {};
    const serverNow = new Date();

    const nextEvent = await findNextHighEvent(serverNow);
    const recentRaw = await listRecentDueOrPastEvents({
        before: serverNow,
        currencies: ["USD"],
        impacts: ["high", "medium"],
        limit: 6,
    });
    const recentEvents = recentRaw.map((ev) => decorateEvent(ev, serverNow));
    const brief = buildContextBrief({ metrics, cryptoRefs, nextEvent, serverNow });

    const coverageReasons = [
        ...(snap?.coverage?.reasons || []),
        ...(calMeta?.coverage?.reasons || []),
    ];
    if (!calMeta?.ok && calMeta?.coverage?.status === "unavailable") {
        coverageReasons.push("calendar_unavailable");
    }
    const uniqReasons = [...new Set(coverageReasons)];

    return envelope({
        generatedAt: snap?.generatedAt || serverNow.toISOString(),
        region: "us",
        locale: "vi",
        defaultTz: config.defaultTz,
        sessionGuide: sessionGuideVi(),
        coverage: {
            status: uniqReasons.length ? "partial" : snap?.coverage?.status || "partial",
            reasons: uniqReasons,
            reasonsVi: coverageReasonsVi(uniqReasons),
            calendar: calMeta?.coverage || {
                status: "unavailable",
                reasons: ["calendar_not_collected"],
            },
        },
        metrics: pickContextMetrics(metrics),
        curve: snap?.curve || null,
        cryptoRefs,
        nextEvent,
        recentEvents,
        brief,
        sourceHealth: {
            fred: snap?.sourceHealth?.fred || { attribution: FRED_ATTRIBUTION },
            calendar: snap?.sourceHealth?.calendar || calMeta || { ok: false },
            news: snap?.sourceHealth?.news || null,
            crypto: { reusedMarketDashMacro: true },
        },
        attribution: {
            fred: FRED_ATTRIBUTION,
            calendar: calMeta?.coverage?.attribution || null,
        },
        flags: {
            economyEnabled: config.enabled,
            actualMode: "schedule_only",
            newsEnabled: config.newsEnabled,
            actualModeLabelVi:
                "Chế độ lịch: chỉ lịch + Forecast/Previous — chưa có Actual chính thức đã xác minh",
        },
    });
}

function pickContextMetrics(metrics) {
    const ids = [
        ...YIELD_TENORS.map((y) => y.id),
        "us.yield.spread_10y_2y",
        "us.vix.close",
    ];
    const out = {};
    for (const id of ids) {
        if (metrics[id]) out[id] = metrics[id];
    }
    return out;
}

async function findNextHighEvent(serverNow) {
    const from = serverNow.toISOString();
    const to = new Date(serverNow.getTime() + 24 * 3600_000).toISOString();
    const { events } = await listEventsInRange({
        from,
        to,
        currencies: ["USD"],
        impacts: ["high", "medium"],
        limit: 5,
    });
    if (!events.length) {
        // broaden: any upcoming USD
        const all = await listEventsInRange({ from, to, currencies: ["USD"], limit: 5 });
        if (!all.events.length) return null;
        return decorateEvent(all.events[0], serverNow);
    }
    return decorateEvent(events[0], serverNow);
}

function decorateEvent(ev, serverNow = new Date(), tz = config.defaultTz) {
    if (!ev) return null;
    const status = resolveEventStatus({
        scheduledAt: ev.scheduledAt,
        timePrecision: ev.timePrecision,
        status: ev.status,
        hasTrustedActual: false,
        serverNow,
    });
    const cd = countdownInfo(ev.scheduledAt, serverNow, ev.timePrecision || "datetime");
    return {
        eventId: ev.eventId,
        title: ev.title,
        hintVi: eventHintVi(ev.title),
        currency: ev.currency,
        country: ev.country,
        impact: ev.impact,
        impactLabelVi: impactLabelVi(ev.impact),
        scheduledAt: ev.scheduledAt ? new Date(ev.scheduledAt).toISOString() : null,
        timePrecision: ev.timePrecision,
        status,
        statusLabelVi: statusLabelVi(status),
        coverage: ev.coverage,
        referencePeriod: ev.referencePeriod,
        source: ev.source,
        ...cd,
        displayTz: normalizeTimeZone(tz),
        displayTzLabelVi:
            normalizeTimeZone(tz) === "Asia/Ho_Chi_Minh"
                ? "Giờ Việt Nam"
                : normalizeTimeZone(tz) === "America/New_York"
                  ? "Giờ New York"
                  : normalizeTimeZone(tz),
    };
}

async function getEconomySeries(metricId, query = {}) {
    if (!isSeriesAllowed(metricId)) {
        return { status: 404, error: "metricId không trong registry" };
    }
    const range = String(query.range || "30d");
    const days = range === "1y" ? 365 : range === "90d" ? 90 : 30;
    const fromDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const rows = await listMetricSeries(metricId, { fromDate, limit: days + 10 });
    const meta = getMetric(metricId);
    return envelope({
        metricId,
        meta: meta
            ? {
                  id: meta.id,
                  unit: meta.unit,
                  source: meta.source,
                  sourceSeriesId: meta.sourceSeriesId,
                  label: meta.label,
              }
            : null,
        points: rows.map((r) => ({
            observationDate: r.observationDate,
            value: r.value,
            quality: r.quality,
        })),
        gaps: [],
    });
}

async function getEconomyCalendar(query = {}) {
    const tz = normalizeTimeZone(query.econTz || query.tz || config.defaultTz);
    const serverNow = new Date();
    const range = String(query.econRange || query.range || "today");

    let from;
    let to;
    let rangeNote = null;

    if (query.from && query.to) {
        from = new Date(query.from);
        to = new Date(query.to);
        if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
            return { status: 400, error: "from/to không hợp lệ" };
        }
        if (to - from > 31 * 86400_000) {
            return { status: 400, error: "Khoảng thời gian tối đa 31 ngày" };
        }
        if (to <= from) return { status: 400, error: "to phải sau from" };
        from = from.toISOString();
        to = to.toISOString();
    } else if (range === "week" || range === "this_week") {
        const today = calendarDateInZone(serverNow, tz);
        const start = localDayUtcRange(today, tz);
        // approximate week: today .. today+7
        from = start?.from || serverNow.toISOString();
        to = new Date(new Date(from).getTime() + 7 * 86400_000).toISOString();
    } else if (range === "7d" || range === "next7") {
        from = serverNow.toISOString();
        to = new Date(serverNow.getTime() + 7 * 86400_000).toISOString();
        rangeNote = "calendar_next_week_may_be_unavailable";
    } else {
        // today
        const today = calendarDateInZone(serverNow, tz);
        const day = localDayUtcRange(today, tz);
        if (!day) return { status: 500, error: "Không tính được ngày theo timezone" };
        from = day.from;
        to = day.to;
    }

    const currencies = String(query.currencies || query.econCurrency || "USD")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    const impactRaw = String(query.impact || query.econImpact || "high,medium");
    const impacts = impactRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s && s !== "all");

    const limit = Math.min(Number(query.limit) || 50, 100);
    const { events, nextCursor, count } = await listEventsInRange({
        from,
        to,
        currencies: currencies.includes("ALL") ? null : currencies,
        impacts: impactRaw.toLowerCase() === "all" ? null : impacts,
        limit,
        cursor: query.cursor || null,
        q: query.q || query.econQ || null,
    });

    const calMeta = await getCalendarMeta();
    const coverage = calMeta?.coverage || {
        status: "unavailable",
        reasons: ["calendar_not_collected"],
    };

    // AC10: nếu range vượt coverageTo → partial, không nói “không có sự kiện”
    const coverageTo = coverage.coverageTo ? new Date(coverage.coverageTo).getTime() : null;
    const rangeTo = new Date(to).getTime();
    const reasons = [...(coverage.reasons || [])];
    if (rangeNote) reasons.push(rangeNote);
    if (coverageTo != null && rangeTo > coverageTo + 3600_000) {
        reasons.push("calendar_next_week_unavailable");
    }
    if (!calMeta?.ok) reasons.push("calendar_fetch_unhealthy");

    const decorated = [];
    for (const ev of events) {
        const base = decorateEvent(ev, serverNow, tz);
        const vals = await listEventValues(ev.eventId, { limit: 10 });
        const forecast = vals.find((v) => v.field === "forecast") || null;
        const previous = vals.find((v) => v.field === "previous") || null;
        const actualTrusted = vals.find((v) => v.field === "actual" && v.isTrustedActual) || null;
        decorated.push({
            ...base,
            forecast: forecast ? { displayValue: forecast.displayValue, numericValue: forecast.numericValue } : null,
            previous: previous ? { displayValue: previous.displayValue, numericValue: previous.numericValue } : null,
            actual: actualTrusted
                ? { displayValue: actualTrusted.displayValue, numericValue: actualTrusted.numericValue }
                : null,
        });
    }

    return envelope({
        from,
        to,
        tz,
        count,
        nextCursor,
        events: decorated,
        coverage: {
            status: reasons.length ? "partial" : coverage.status || "partial",
            reasons: [...new Set(reasons)],
            reasonsVi: coverageReasonsVi([...new Set(reasons)]),
            coverageFrom: coverage.coverageFrom || null,
            coverageTo: coverage.coverageTo || null,
        },
        emptyMeaning:
            decorated.length === 0 && reasons.includes("calendar_next_week_unavailable")
                ? "coverage_gap"
                : decorated.length === 0 && coverage.status === "unavailable"
                  ? "calendar_unavailable"
                  : decorated.length === 0
                    ? "no_events_in_filters"
                    : null,
        emptyMeaningVi: emptyMeaningVi(
            decorated.length === 0 && reasons.includes("calendar_next_week_unavailable")
                ? "coverage_gap"
                : decorated.length === 0 && coverage.status === "unavailable"
                  ? "calendar_unavailable"
                  : decorated.length === 0
                    ? "no_events_in_filters"
                    : null
        ),
        actualMode: "schedule_only",
        actualModeLabelVi:
            "Chưa có Actual đã xác minh — Forecast/Previous chỉ mang tính tham khảo từ nguồn lịch",
    });
}

function emptyMeaningVi(code) {
    if (code === "coverage_gap") {
        return "Phần còn lại của khoảng xem nằm ngoài phạm vi nguồn lịch — không có nghĩa là “không có sự kiện”.";
    }
    if (code === "calendar_unavailable") return "Chưa xác nhận lịch từ collector.";
    if (code === "no_events_in_filters") return "Không có sự kiện khớp bộ lọc trong phần lịch đã có.";
    return null;
}

async function getEconomyNews(query = {}) {
    if (!config.newsEnabled) {
        return { status: 503, error: "Tin tức chưa bật", flag: "MARKET_ECONOMY_NEWS_ENABLED" };
    }
    const topic = String(query.topic || query.newsTopic || "all").toLowerCase();
    const symbol = query.symbol || query.newsSymbol || null;
    const limit = Math.min(Number(query.limit) || 30, 100);
    const { items, nextCursor, count } = await listNews({
        topic: ["crypto", "macro", "all"].includes(topic) ? topic : "all",
        symbol: symbol ? String(symbol).toUpperCase() : null,
        limit,
        cursor: query.cursor || null,
    });

    return envelope({
        topic,
        symbol: symbol || null,
        count,
        nextCursor,
        items: items.map((n) => ({
            id: String(n._id),
            title: n.title,
            publisher: n.publisher,
            sourceId: n.sourceId,
            url: n.canonicalUrl,
            publishedAt: n.publishedAt ? new Date(n.publishedAt).toISOString() : null,
            publishedAtLabelVi: n.publishedAt
                ? null
                : "Chưa rõ giờ đăng",
            collectedAt: n.collectedAt ? new Date(n.collectedAt).toISOString() : null,
            topic: n.topic,
            locale: n.locale,
            assetIds: n.assetIds || [],
            noteVi: "Chỉ tiêu đề + link nguồn; không phải tín hiệu giao dịch đã xác minh.",
        })),
        disclaimerVi:
            "Tin tổng hợp từ RSS allowlist. Không scrape toàn bài; không tự gắn coin nếu thiếu bằng chứng trong tiêu đề.",
    });
}

async function getEconomyEvent(eventId, query = {}) {
    const ev = await getEventById(eventId);
    if (!ev) return { status: 404, error: "Không tìm thấy sự kiện" };
    const tz = normalizeTimeZone(query.econTz || query.tz || config.defaultTz);
    const serverNow = new Date();
    const values = await listEventValues(eventId, { limit: 50 });
    const byField = { forecast: [], previous: [], actual: [] };
    for (const v of values) {
        if (byField[v.field]) byField[v.field].push(v);
    }

    // P0: never promote series-derived to actual/released
    const hasTrustedActual = values.some((v) => v.field === "actual" && v.isTrustedActual);
    const status = resolveEventStatus({
        scheduledAt: ev.scheduledAt,
        timePrecision: ev.timePrecision,
        status: ev.status,
        hasTrustedActual,
        serverNow,
    });

    return envelope({
        event: decorateEvent({ ...ev, status }, serverNow, tz),
        referencePeriod: ev.referencePeriod,
        source: { name: ev.source, sourceEventId: ev.sourceEventId, sourceUrl: ev.sourceUrl },
        values: {
            forecast: byField.forecast[0] || null,
            previous: byField.previous[0] || null,
            actual: hasTrustedActual ? byField.actual[0] : null,
        },
        revisions: {
            schedule: ev.scheduleRevisions || [],
            forecast: byField.forecast,
            previous: byField.previous,
            actual: byField.actual.filter((v) => v.isTrustedActual),
        },
        seriesObservations: byField.actual.filter((v) => !v.isTrustedActual),
        surprise: null,
        surpriseReason: "actual_not_verified_schedule_only",
        surpriseReasonVi:
            "Chưa tính surprise — thiếu Actual cùng kỳ/đơn vị đã xác minh (không lấy Previous làm Actual).",
        actualMode: "schedule_only",
        qualityLabels: {
            forecast: qualityLabelVi("fresh"),
        },
    });
}

module.exports = {
    getEconomyContext,
    getEconomySeries,
    getEconomyCalendar,
    getEconomyEvent,
    getEconomyNews,
};
