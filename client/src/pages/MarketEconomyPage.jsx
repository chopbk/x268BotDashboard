import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import {
  DEFAULT_ECON_TZ,
  formatCountdown,
  formatInTz,
  statusLabel,
} from "../lib/market-economy";
import "./market-economy.css";

function impactClass(impact) {
  if (impact === "high") return "econ-impact high";
  if (impact === "medium") return "econ-impact medium";
  return "econ-impact";
}

function fmtYield(m) {
  if (m?.value == null) return "—";
  const bp =
    m.deltaBp != null && Number.isFinite(m.deltaBp)
      ? ` (${m.deltaBp > 0 ? "+" : ""}${m.deltaBp.toFixed(1)} bp)`
      : "";
  return `${Number(m.value).toFixed(2)}%${bp}`;
}

function MetricCard({ label, value, asOf, quality, hint }) {
  return (
    <div className="econ-card">
      <div className="econ-card-label">{label}</div>
      <div className="econ-card-value">{value}</div>
      <div className="econ-card-meta muted">
        {asOf ? `asOf ${asOf}` : "Chưa có"}
        {quality ? ` · ${quality}` : ""}
        {hint ? ` · ${hint}` : ""}
      </div>
    </div>
  );
}

export default function MarketEconomyPage() {
  const [params, setParams] = useSearchParams();
  const econView = params.get("econView") || "context";
  const econRange = params.get("econRange") || "today";
  const econImpact = params.get("econImpact") || "high,medium";
  const econCurrency = params.get("econCurrency") || "USD";
  const econTz = params.get("econTz") || DEFAULT_ECON_TZ;
  const eventId = params.get("event") || "";

  const [context, setContext] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const abortRef = useRef(null);
  const pollRef = useRef(null);
  const reqSeq = useRef(0);

  const serverNowSkew = useMemo(() => {
    if (!context?.serverNow) return 0;
    return Date.now() - new Date(context.serverNow).getTime();
  }, [context?.serverNow]);

  function setEconParam(patch, { replace = false } = {}) {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", "economy");
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === "") n.delete(k);
          else n.set(k, String(v));
        }
        return n;
      },
      { replace }
    );
  }

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (document.hidden) return undefined;
    let cancelled = false;
    const seq = ++reqSeq.current;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    async function load() {
      setError("");
      try {
        if (econView === "calendar") {
          const qs = new URLSearchParams({
            econRange,
            impact: econImpact,
            currencies: econCurrency === "ALL" ? "ALL" : econCurrency,
            econTz,
            limit: "50",
          });
          const body = await api(`/api/market/economy/calendar?${qs}`, { signal: ctrl.signal });
          if (cancelled || seq !== reqSeq.current) return;
          setCalendar(body);
          if (eventId) {
            const d = await api(
              `/api/market/economy/events/${encodeURIComponent(eventId)}?econTz=${encodeURIComponent(econTz)}`,
              { signal: ctrl.signal }
            );
            if (cancelled || seq !== reqSeq.current) return;
            setDetail(d);
          } else {
            setDetail(null);
          }
        } else {
          const body = await api("/api/market/economy/context?region=us", { signal: ctrl.signal });
          if (cancelled || seq !== reqSeq.current) return;
          setContext(body);
        }
      } catch (e) {
        if (cancelled || e?.name === "AbortError") return;
        setError(e?.message || "Không tải được dữ liệu kinh tế");
      }
    }

    load();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (document.hidden) return;
      load();
    }, 60_000);

    function onVis() {
      if (!document.hidden) load();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [econView, econRange, econImpact, econCurrency, econTz, eventId]);

  void tick;

  const metrics = context?.metrics || {};
  const curve = context?.curve;
  const cryptoRefs = context?.cryptoRefs;
  const nextEvent = context?.nextEvent;
  const clockSkewWarn = Math.abs(serverNowSkew) > 60_000;

  return (
    <div className="econ-page">
      <div className="econ-subtabs" role="tablist" aria-label="Kinh tế & Tin tức">
        <button
          type="button"
          role="tab"
          aria-selected={econView === "context"}
          className={econView === "context" ? "active" : ""}
          onClick={() => setEconParam({ econView: "context", event: "" })}
        >
          Bối cảnh
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={econView === "calendar"}
          className={econView === "calendar" ? "active" : ""}
          onClick={() => setEconParam({ econView: "calendar" })}
        >
          Lịch kinh tế
        </button>
        <span className="econ-subtabs-note muted">Tin tức — P1</span>
      </div>

      {error ? (
        <p className="econ-banner warn" role="alert">
          {error}
        </p>
      ) : null}
      {clockSkewWarn ? (
        <p className="econ-banner warn" role="status">
          Đồng hồ thiết bị lệch &gt;60s so với server — countdown chỉ mang tính tham khảo.
        </p>
      ) : null}

      {econView === "context" ? (
        <section className="econ-context" aria-label="Bối cảnh Mỹ">
          <div className="econ-crypto-strip">
            <span>
              BTC{" "}
              <strong>
                {cryptoRefs?.btc?.price != null
                  ? Number(cryptoRefs.btc.price).toLocaleString("en-US")
                  : "—"}
              </strong>
            </span>
            <span>
              ETH{" "}
              <strong>
                {cryptoRefs?.eth?.price != null
                  ? Number(cryptoRefs.eth.price).toLocaleString("en-US")
                  : "—"}
              </strong>
            </span>
            <span>
              BTC.D{" "}
              <strong>
                {cryptoRefs?.btcDominance?.value != null
                  ? `${Number(cryptoRefs.btcDominance.value).toFixed(1)}%`
                  : "—"}
              </strong>
              {cryptoRefs?.btcDominance?.quality === "stale" ? (
                <span className="econ-stale"> cũ</span>
              ) : null}
            </span>
            <span>
              ETH.D{" "}
              <strong>
                {cryptoRefs?.ethDominance?.value != null
                  ? `${Number(cryptoRefs.ethDominance.value).toFixed(1)}%`
                  : "—"}
              </strong>
            </span>
            <span>
              Cap{" "}
              <strong>
                {cryptoRefs?.totalMarketCap?.value != null
                  ? `$${(Number(cryptoRefs.totalMarketCap.value) / 1e12).toFixed(2)}T`
                  : "—"}
              </strong>
            </span>
            <span>
              Vol{" "}
              <strong>
                {cryptoRefs?.totalVolume?.value != null
                  ? `$${(Number(cryptoRefs.totalVolume.value) / 1e9).toFixed(1)}B`
                  : "—"}
              </strong>
            </span>
            <span>
              F&G{" "}
              <strong>
                {cryptoRefs?.fearGreed?.value != null ? cryptoRefs.fearGreed.value : "—"}
                {cryptoRefs?.fearGreed?.displayValue
                  ? ` ${cryptoRefs.fearGreed.displayValue}`
                  : ""}
              </strong>
              {cryptoRefs?.fearGreed?.quality === "stale" ? (
                <span className="econ-stale"> cũ</span>
              ) : null}
            </span>
          </div>
          <p className="muted econ-note">{cryptoRefs?.note}</p>

          {nextEvent ? (
            <div className="econ-next-event">
              <div>
                <strong>Sự kiện High/Med kế tiếp:</strong> {nextEvent.title} ·{" "}
                {formatInTz(nextEvent.scheduledAt, econTz)} ({econTz})
              </div>
              <div className="econ-countdown">
                {nextEvent.timePrecision === "datetime"
                  ? formatCountdown(
                      nextEvent.scheduledAt
                        ? new Date(nextEvent.scheduledAt).getTime() - (Date.now() - serverNowSkew)
                        : null
                    )
                  : "Không countdown (giờ không chắc)"}
                {nextEvent.badge ? <span className="econ-badge">{nextEvent.badge}</span> : null}
              </div>
              <button
                type="button"
                className="econ-link-btn"
                onClick={() =>
                  setEconParam({ econView: "calendar", event: nextEvent.eventId })
                }
              >
                Xem lịch
              </button>
            </div>
          ) : (
            <p className="econ-banner" role="status">
              {context?.coverage?.calendar?.status === "unavailable"
                ? "Chưa xác nhận lịch — coverage lịch chưa sẵn sàng (không đồng nghĩa không có rủi ro)."
                : "Không có sự kiện USD High/Med trong 24h tới theo filter hiện có."}
            </p>
          )}

          <div className="econ-cards">
            <MetricCard
              label="US 2Y"
              value={fmtYield(metrics["us.yield.2y"])}
              asOf={metrics["us.yield.2y"]?.observationDate}
              quality={metrics["us.yield.2y"]?.quality}
            />
            <MetricCard
              label="US 10Y"
              value={fmtYield(metrics["us.yield.10y"])}
              asOf={metrics["us.yield.10y"]?.observationDate}
              quality={metrics["us.yield.10y"]?.quality}
            />
            <MetricCard
              label="10Y−2Y"
              value={
                metrics["us.yield.spread_10y_2y"]?.value != null
                  ? `${metrics["us.yield.spread_10y_2y"].value.toFixed(1)} bp`
                  : "—"
              }
              asOf={metrics["us.yield.spread_10y_2y"]?.observationDate}
              quality={metrics["us.yield.spread_10y_2y"]?.quality}
              hint={
                metrics["us.yield.spread_10y_2y"]?.value < 0
                  ? "đảo ngược cặp 10Y−2Y"
                  : metrics["us.yield.spread_10y_2y"]?.reason || null
              }
            />
            <MetricCard
              label="VIX close"
              value={
                metrics["us.vix.close"]?.value != null
                  ? String(metrics["us.vix.close"].value)
                  : "—"
              }
              asOf={metrics["us.vix.close"]?.observationDate}
              quality={metrics["us.vix.close"]?.quality}
              hint="daily close, không phải IV BTC"
            />
          </div>

          <div className="econ-two-col">
            <div className="econ-panel">
              <h3>Yield curve</h3>
              {curve?.observationDate ? (
                <>
                  <p className="muted">Ngày quan sát chung: {curve.observationDate}</p>
                  <table className="econ-table">
                    <thead>
                      <tr>
                        <th>Tenor</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(curve.tenors || []).map((t) => (
                        <tr key={t.id}>
                          <td>{t.tenor}</td>
                          <td>{t.value != null ? Number(t.value).toFixed(2) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="econ-curve-bars" aria-hidden>
                    {(curve.tenors || []).map((t) => (
                      <div key={t.id} className="econ-curve-bar-wrap">
                        <div
                          className="econ-curve-bar"
                          style={{
                            height: t.value != null ? `${Math.max(8, t.value * 12)}px` : "4px",
                            opacity: t.value != null ? 1 : 0.3,
                          }}
                        />
                        <span>{t.tenor}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p role="status">
                  Chưa có ngày chung đủ tenor — xem bảng từng kỳ hạn ở card. Gaps:{" "}
                  {(curve?.gaps || []).join(", ") || "—"}
                </p>
              )}
            </div>

            <div className="econ-panel">
              <h3>{context?.brief?.title || "Bối cảnh kinh tế"}</h3>
              <ul className="econ-brief">
                {(context?.brief?.facts || []).map((f) => (
                  <li key={f.id}>
                    <div>{f.text}</div>
                    <div className="muted">
                      asOf {f.asOf || "—"} · {f.quality}
                      {f.drillDown?.econView === "calendar" && f.drillDown.event ? (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="econ-link-btn"
                            onClick={() =>
                              setEconParam({
                                econView: "calendar",
                                event: f.drillDown.event,
                              })
                            }
                          >
                            Chi tiết
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {!context?.brief?.facts?.length ? (
                <p className="muted">Thiếu metric — chưa đủ facts cho recap.</p>
              ) : null}
            </div>
          </div>

          {context?.attribution?.fred ? (
            <p className="econ-attr muted">{context.attribution.fred}</p>
          ) : null}
          {context?.coverage?.reasons?.length ? (
            <p className="muted">Coverage: {context.coverage.reasons.join(", ")}</p>
          ) : null}
          <p className="muted">Actual mode: schedule-only — không ghép FRED làm first-release actual.</p>
        </section>
      ) : null}

      {econView === "calendar" ? (
        <section className="econ-calendar" aria-label="Lịch kinh tế">
          <div className="econ-filters">
            <label>
              Khoảng
              <select
                value={econRange}
                onChange={(e) => setEconParam({ econRange: e.target.value }, { replace: true })}
              >
                <option value="today">Hôm nay</option>
                <option value="week">Tuần này</option>
                <option value="7d">7 ngày tới</option>
              </select>
            </label>
            <label>
              Currency
              <select
                value={econCurrency}
                onChange={(e) => setEconParam({ econCurrency: e.target.value }, { replace: true })}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="ALL">All</option>
              </select>
            </label>
            <label>
              Impact
              <select
                value={econImpact}
                onChange={(e) => setEconParam({ econImpact: e.target.value }, { replace: true })}
              >
                <option value="high,medium">High + Medium</option>
                <option value="high">High</option>
                <option value="all">All</option>
              </select>
            </label>
            <label>
              Timezone
              <select
                value={econTz}
                onChange={(e) => setEconParam({ econTz: e.target.value }, { replace: true })}
              >
                <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh</option>
                <option value="America/New_York">America/New_York</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
          </div>

          {calendar?.coverage ? (
            <p className="econ-banner" role="status">
              Coverage {calendar.coverage.status}
              {calendar.coverage.coverageTo
                ? ` tới ${formatInTz(calendar.coverage.coverageTo, econTz)}`
                : ""}
              {calendar.coverage.reasons?.length
                ? ` — ${calendar.coverage.reasons.join(", ")}`
                : ""}
              {calendar.emptyMeaning === "coverage_gap"
                ? ". Phần ngoài coverage không phải “không có sự kiện”."
                : ""}
              {calendar.emptyMeaning === "calendar_unavailable"
                ? ". Chưa xác nhận lịch."
                : ""}
            </p>
          ) : null}

          <div className="econ-cal-layout">
            <div className="econ-cal-list">
              <table className="econ-table">
                <thead>
                  <tr>
                    <th>Giờ</th>
                    <th>Sự kiện</th>
                    <th>Impact</th>
                    <th>Forecast</th>
                    <th>Previous</th>
                    <th>Actual</th>
                    <th>TT</th>
                  </tr>
                </thead>
                <tbody>
                  {(calendar?.events || []).map((ev) => (
                    <tr
                      key={ev.eventId}
                      className={eventId === ev.eventId ? "selected" : ""}
                      onClick={() => setEconParam({ event: ev.eventId })}
                    >
                      <td>
                        {ev.timePrecision === "datetime"
                          ? formatInTz(ev.scheduledAt, econTz)
                          : formatInTz(ev.scheduledAt, econTz, true)}
                      </td>
                      <td>
                        <div>{ev.title}</div>
                        <div className="muted">{ev.currency}</div>
                      </td>
                      <td>
                        <span className={impactClass(ev.impact)}>{ev.impact}</span>
                      </td>
                      <td>{ev.forecast?.displayValue || "—"}</td>
                      <td>{ev.previous?.displayValue || "—"}</td>
                      <td className="muted">{ev.actual?.displayValue || "chưa xác minh"}</td>
                      <td>
                        <div>{statusLabel(ev.status)}</div>
                        <div className="muted">
                          {ev.timePrecision === "datetime"
                            ? formatCountdown(
                                ev.scheduledAt
                                  ? new Date(ev.scheduledAt).getTime() -
                                      (Date.now() - serverNowSkew)
                                  : null
                              )
                            : "—"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!calendar?.events?.length ? (
                <p className="muted">
                  {calendar?.emptyMeaning === "coverage_gap"
                    ? "Không có dữ liệu trong phần coverage còn lại của khoảng đã chọn."
                    : calendar?.emptyMeaning === "calendar_unavailable"
                      ? "Chưa xác nhận lịch."
                      : "Không có sự kiện khớp bộ lọc trong khoảng đã có coverage."}
                </p>
              ) : null}
            </div>

            <aside className="econ-cal-detail" aria-label="Chi tiết sự kiện">
              {detail?.event ? (
                <>
                  <h3>{detail.event.title}</h3>
                  <p className="muted">
                    {detail.event.currency} · {detail.event.impact} ·{" "}
                    {statusLabel(detail.event.status)}
                  </p>
                  <dl className="econ-dl">
                    <dt>Giờ (UTC)</dt>
                    <dd>{detail.event.scheduledAt || "—"}</dd>
                    <dt>Giờ ({econTz})</dt>
                    <dd>{formatInTz(detail.event.scheduledAt, econTz)}</dd>
                    <dt>Kỳ tham chiếu</dt>
                    <dd>{detail.referencePeriod || "Chưa có từ nguồn lịch"}</dd>
                    <dt>Forecast</dt>
                    <dd>
                      {detail.values?.forecast?.displayValue || "—"}
                      {detail.values?.forecast?.numericValue != null
                        ? ` (${detail.values.forecast.numericValue})`
                        : ""}
                    </dd>
                    <dt>Previous</dt>
                    <dd>{detail.values?.previous?.displayValue || "—"}</dd>
                    <dt>Actual</dt>
                    <dd>
                      {detail.values?.actual?.displayValue ||
                        "Chưa có actual đã xác minh (schedule-only)"}
                    </dd>
                    <dt>Nguồn</dt>
                    <dd>
                      {detail.source?.name} / {detail.source?.sourceEventId}
                    </dd>
                  </dl>
                  {detail.revisions?.schedule?.length ? (
                    <div>
                      <h4>Revisions lịch</h4>
                      <ul className="econ-rev">
                        {detail.revisions.schedule.map((r, i) => (
                          <li key={i}>
                            {r.scheduledAt ? new Date(r.scheduledAt).toISOString() : "—"} ·{" "}
                            {r.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="muted">{detail.surpriseReason}</p>
                </>
              ) : (
                <p className="muted">Chọn một sự kiện để xem chi tiết.</p>
              )}
            </aside>
          </div>
        </section>
      ) : null}
    </div>
  );
}
