import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import {
  DEFAULT_ECON_TZ,
  formatCountdown,
  formatInTz,
  impactLabel,
  qualityLabel,
  statusLabel,
  tzOptionLabel,
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
        {asOf ? `Ngày quan sát ${asOf}` : "Chưa có"}
        {quality ? ` · ${qualityLabel(quality)}` : ""}
        {hint ? ` · ${hint}` : ""}
      </div>
    </div>
  );
}

export default function MarketEconomyPage({ newsEnabled: newsEnabledProp = true } = {}) {
  const [params, setParams] = useSearchParams();
  const econView = params.get("econView") || "context";
  const econRange = params.get("econRange") || "today";
  const econImpact = params.get("econImpact") || "high,medium";
  const econCurrency = params.get("econCurrency") || "USD";
  const econTz = params.get("econTz") || DEFAULT_ECON_TZ;
  const eventId = params.get("event") || "";
  const newsTopic = params.get("newsTopic") || "all";
  const newsSymbol = params.get("newsSymbol") || "";
  const econQ = params.get("econQ") || "";

  const [context, setContext] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [detail, setDetail] = useState(null);
  const [news, setNews] = useState(null);
  const [searchDraft, setSearchDraft] = useState(econQ);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const abortRef = useRef(null);
  const pollRef = useRef(null);
  const reqSeq = useRef(0);
  const searchTimer = useRef(null);

  const newsEnabled = context?.flags?.newsEnabled ?? newsEnabledProp;

  const serverNowSkew = useMemo(() => {
    const nowIso = context?.serverNow || calendar?.serverNow || news?.serverNow;
    if (!nowIso) return 0;
    return Date.now() - new Date(nowIso).getTime();
  }, [context?.serverNow, calendar?.serverNow, news?.serverNow]);

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
    setSearchDraft(econQ);
  }, [econQ]);

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
          if (econQ.trim()) qs.set("q", econQ.trim());
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
        } else if (econView === "news") {
          const qs = new URLSearchParams({
            topic: newsTopic,
            limit: "30",
          });
          if (newsSymbol) qs.set("symbol", newsSymbol);
          const body = await api(`/api/market/economy/news?${qs}`, { signal: ctrl.signal });
          if (cancelled || seq !== reqSeq.current) return;
          setNews(body);
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
  }, [econView, econRange, econImpact, econCurrency, econTz, eventId, econQ, newsTopic, newsSymbol]);

  void tick;

  const metrics = context?.metrics || {};
  const curve = context?.curve;
  const cryptoRefs = context?.cryptoRefs;
  const nextEvent = context?.nextEvent;
  const clockSkewWarn = Math.abs(serverNowSkew) > 60_000;

  function onSearchChange(value) {
    setSearchDraft(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setEconParam({ econQ: value.trim() || null }, { replace: true });
    }, 300);
  }

  return (
    <div className="econ-page">
      <p className="econ-lead muted">
        Chuẩn bị nhận định theo giờ Việt Nam: sự kiện Mỹ, lợi suất, VIX và tin crypto/vĩ mô. Không phải
        khuyến nghị vào lệnh.
      </p>

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
        {newsEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={econView === "news"}
            className={econView === "news" ? "active" : ""}
            onClick={() => setEconParam({ econView: "news", event: "" })}
          >
            Tin tức
          </button>
        ) : (
          <span className="econ-subtabs-note muted">Tin tức đang tắt</span>
        )}
      </div>

      {error ? (
        <p className="econ-banner warn" role="alert">
          {error}
        </p>
      ) : null}
      {clockSkewWarn ? (
        <p className="econ-banner warn" role="status">
          Đồng hồ máy lệch &gt;60 giây so với server — countdown chỉ mang tính tham khảo.
        </p>
      ) : null}

      {econView === "context" ? (
        <section className="econ-context" aria-label="Bối cảnh Mỹ">
          {context?.sessionGuide ? (
            <div className="econ-guide">
              <strong>{context.sessionGuide.title}</strong>
              <ul>
                {(context.sessionGuide.bullets || []).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}

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
              Vốn hóa{" "}
              <strong>
                {cryptoRefs?.totalMarketCap?.value != null
                  ? `$${(Number(cryptoRefs.totalMarketCap.value) / 1e12).toFixed(2)}T`
                  : "—"}
              </strong>
            </span>
            <span>
              Vol 24h{" "}
              <strong>
                {cryptoRefs?.totalVolume?.value != null
                  ? `$${(Number(cryptoRefs.totalVolume.value) / 1e9).toFixed(1)}B`
                  : "—"}
              </strong>
            </span>
            <span>
              Sợ hãi &amp; tham lam{" "}
              <strong>
                {cryptoRefs?.fearGreed?.value != null ? cryptoRefs.fearGreed.value : "—"}
                {cryptoRefs?.fearGreed?.displayValue
                  ? ` (${cryptoRefs.fearGreed.displayValue})`
                  : ""}
              </strong>
              {cryptoRefs?.fearGreed?.quality === "stale" ? (
                <span className="econ-stale"> cũ</span>
              ) : null}
            </span>
          </div>
          <p className="muted econ-note">
            {cryptoRefs?.note ||
              "Số liệu global USD từ CoinGecko — khác volume Futures Binance USDT."}
          </p>

          {nextEvent ? (
            <div className="econ-next-event">
              <div>
                <strong>Sự kiện mức Cao/Trung kế tiếp:</strong> {nextEvent.title}
                {nextEvent.impactLabelVi ? ` · ${nextEvent.impactLabelVi}` : ""} ·{" "}
                {formatInTz(nextEvent.scheduledAt, econTz)} (
                {nextEvent.displayTzLabelVi || tzOptionLabel(econTz)})
                {nextEvent.hintVi ? <div className="muted econ-hint">{nextEvent.hintVi}</div> : null}
              </div>
              <div className="econ-countdown">
                {nextEvent.timePrecision === "datetime"
                  ? formatCountdown(
                      nextEvent.scheduledAt
                        ? new Date(nextEvent.scheduledAt).getTime() - (Date.now() - serverNowSkew)
                        : null
                    )
                  : "Không đếm ngược (giờ không chắc)"}
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
                ? "Chưa xác nhận lịch — không đồng nghĩa là không có rủi ro sự kiện."
                : "Không có sự kiện USD mức Cao/Trung trong 24 giờ tới theo dữ liệu hiện có."}
            </p>
          )}

          <div className="econ-cards">
            <MetricCard
              label="Lợi suất Mỹ 2 năm"
              value={fmtYield(metrics["us.yield.2y"])}
              asOf={metrics["us.yield.2y"]?.observationDate}
              quality={metrics["us.yield.2y"]?.quality}
            />
            <MetricCard
              label="Lợi suất Mỹ 10 năm"
              value={fmtYield(metrics["us.yield.10y"])}
              asOf={metrics["us.yield.10y"]?.observationDate}
              quality={metrics["us.yield.10y"]?.quality}
            />
            <MetricCard
              label="Chênh 10Y−2Y"
              value={
                metrics["us.yield.spread_10y_2y"]?.value != null
                  ? `${metrics["us.yield.spread_10y_2y"].value.toFixed(1)} bp`
                  : "—"
              }
              asOf={metrics["us.yield.spread_10y_2y"]?.observationDate}
              quality={metrics["us.yield.spread_10y_2y"]?.quality}
              hint={
                metrics["us.yield.spread_10y_2y"]?.value < 0
                  ? "đường cong đảo ngược (cặp 10Y−2Y)"
                  : null
              }
            />
            <MetricCard
              label="VIX (đóng cửa ngày)"
              value={
                metrics["us.vix.close"]?.value != null
                  ? String(metrics["us.vix.close"].value)
                  : "—"
              }
              asOf={metrics["us.vix.close"]?.observationDate}
              quality={metrics["us.vix.close"]?.quality}
              hint="không phải biến động ẩn BTC"
            />
          </div>

          <div className="econ-two-col">
            <div className="econ-panel">
              <h3>Đường cong lợi suất Mỹ</h3>
              {curve?.observationDate ? (
                <>
                  <p className="muted">Cùng ngày quan sát: {curve.observationDate}</p>
                  <table className="econ-table">
                    <thead>
                      <tr>
                        <th>Kỳ hạn</th>
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
                  Chưa có ngày chung đủ kỳ hạn — xem từng thẻ lợi suất. Thiếu:{" "}
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
                      Thời điểm {f.asOf ? formatInTz(f.asOf, econTz) : "—"} ·{" "}
                      {qualityLabel(f.quality)}
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
                <p className="muted">Thiếu số liệu — chưa đủ để viết bản tin ngắn.</p>
              ) : null}

              <h4 className="econ-subh">Công bố gần đây (USD)</h4>
              <ul className="econ-recent">
                {(context?.recentEvents || []).map((ev) => (
                  <li key={ev.eventId}>
                    <button
                      type="button"
                      className="econ-link-btn"
                      onClick={() => setEconParam({ econView: "calendar", event: ev.eventId })}
                    >
                      {ev.title}
                    </button>
                    <span className="muted">
                      {" "}
                      · {formatInTz(ev.scheduledAt, econTz)} ·{" "}
                      {statusLabel(ev.status, ev.statusLabelVi)}
                    </span>
                  </li>
                ))}
              </ul>
              {!context?.recentEvents?.length ? (
                <p className="muted">Chưa có sự kiện gần đây trong snapshot lịch.</p>
              ) : null}
            </div>
          </div>

          {context?.coverage?.reasonsVi?.length ? (
            <p className="muted">Phạm vi dữ liệu: {context.coverage.reasonsVi.join("; ")}</p>
          ) : null}
          <p className="muted">
            {context?.flags?.actualModeLabelVi ||
              "Chưa có Actual đã xác minh — không lấy Previous làm Actual."}
          </p>
          {context?.attribution?.fred ? (
            <p className="econ-attr muted">{context.attribution.fred}</p>
          ) : null}
        </section>
      ) : null}

      {econView === "calendar" ? (
        <section className="econ-calendar" aria-label="Lịch kinh tế">
          <div className="econ-filters">
            <label>
              Khoảng thời gian
              <select
                value={econRange}
                onChange={(e) => setEconParam({ econRange: e.target.value }, { replace: true })}
              >
                <option value="today">Hôm nay (giờ VN)</option>
                <option value="week">Tuần này</option>
                <option value="7d">7 ngày tới</option>
              </select>
            </label>
            <label>
              Tiền tệ
              <select
                value={econCurrency}
                onChange={(e) => setEconParam({ econCurrency: e.target.value }, { replace: true })}
              >
                <option value="USD">USD (Mỹ)</option>
                <option value="EUR">EUR</option>
                <option value="ALL">Tất cả</option>
              </select>
            </label>
            <label>
              Mức ảnh hưởng
              <select
                value={econImpact}
                onChange={(e) => setEconParam({ econImpact: e.target.value }, { replace: true })}
              >
                <option value="high,medium">Cao + Trung bình</option>
                <option value="high">Chỉ Cao</option>
                <option value="all">Tất cả</option>
              </select>
            </label>
            <label>
              Múi giờ hiển thị
              <select
                value={econTz}
                onChange={(e) => setEconParam({ econTz: e.target.value }, { replace: true })}
              >
                <option value="Asia/Ho_Chi_Minh">{tzOptionLabel("Asia/Ho_Chi_Minh")}</option>
                <option value="America/New_York">{tzOptionLabel("America/New_York")}</option>
                <option value="UTC">{tzOptionLabel("UTC")}</option>
              </select>
            </label>
            <label className="econ-search">
              Tìm theo tên
              <input
                type="search"
                value={searchDraft}
                placeholder="CPI, NFP, FOMC…"
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </label>
          </div>

          {calendar?.coverage ? (
            <p className="econ-banner" role="status">
              {(calendar.coverage.reasonsVi || []).join("; ") ||
                `Phạm vi: ${calendar.coverage.status}`}
              {calendar.coverage.coverageTo
                ? ` · Có dữ liệu tới ${formatInTz(calendar.coverage.coverageTo, econTz)}`
                : ""}
              {calendar.emptyMeaningVi ? ` ${calendar.emptyMeaningVi}` : ""}
            </p>
          ) : null}
          {calendar?.actualModeLabelVi ? (
            <p className="muted">{calendar.actualModeLabelVi}</p>
          ) : null}

          <div className="econ-cal-layout">
            <div className="econ-cal-list">
              <table className="econ-table">
                <thead>
                  <tr>
                    <th>Giờ</th>
                    <th>Sự kiện</th>
                    <th>Mức</th>
                    <th>Dự báo</th>
                    <th>Trước đó</th>
                    <th>Thực tế</th>
                    <th>Trạng thái</th>
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
                        <span className={impactClass(ev.impact)}>
                          {impactLabel(ev.impact, ev.impactLabelVi)}
                        </span>
                      </td>
                      <td>{ev.forecast?.displayValue || "—"}</td>
                      <td>{ev.previous?.displayValue || "—"}</td>
                      <td className="muted">{ev.actual?.displayValue || "chưa xác minh"}</td>
                      <td>
                        <div>{statusLabel(ev.status, ev.statusLabelVi)}</div>
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
                <p className="muted">{calendar?.emptyMeaningVi || "Không có sự kiện."}</p>
              ) : null}
            </div>

            <aside className="econ-cal-detail" aria-label="Chi tiết sự kiện">
              {detail?.event ? (
                <>
                  <h3>{detail.event.title}</h3>
                  <p className="muted">
                    {detail.event.currency} ·{" "}
                    {impactLabel(detail.event.impact, detail.event.impactLabelVi)} ·{" "}
                    {statusLabel(detail.event.status, detail.event.statusLabelVi)}
                  </p>
                  {detail.event.hintVi ? <p className="econ-hint">{detail.event.hintVi}</p> : null}
                  <dl className="econ-dl">
                    <dt>Giờ UTC</dt>
                    <dd>{detail.event.scheduledAt || "—"}</dd>
                    <dt>{tzOptionLabel(econTz)}</dt>
                    <dd>{formatInTz(detail.event.scheduledAt, econTz)}</dd>
                    <dt>Kỳ tham chiếu</dt>
                    <dd>{detail.referencePeriod || "Chưa có từ nguồn lịch"}</dd>
                    <dt>Dự báo (Forecast)</dt>
                    <dd>{detail.values?.forecast?.displayValue || "—"}</dd>
                    <dt>Trước đó (Previous)</dt>
                    <dd>{detail.values?.previous?.displayValue || "—"}</dd>
                    <dt>Thực tế (Actual)</dt>
                    <dd>
                      {detail.values?.actual?.displayValue ||
                        "Chưa có số liệu đã xác minh — không dùng Previous thay Actual"}
                    </dd>
                    <dt>Nguồn</dt>
                    <dd>
                      {detail.source?.name} / {detail.source?.sourceEventId}
                    </dd>
                  </dl>
                  {detail.revisions?.schedule?.length ? (
                    <div>
                      <h4>Lịch sử đổi giờ</h4>
                      <ul className="econ-rev">
                        {detail.revisions.schedule.map((r, i) => (
                          <li key={i}>
                            {r.scheduledAt ? formatInTz(r.scheduledAt, econTz) : "—"} · {r.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="muted">{detail.surpriseReasonVi || detail.surpriseReason}</p>
                </>
              ) : (
                <p className="muted">Chọn một sự kiện để xem chi tiết.</p>
              )}
            </aside>
          </div>
        </section>
      ) : null}

      {econView === "news" && newsEnabled ? (
        <section className="econ-news" aria-label="Tin tức">
          <div className="econ-filters">
            <label>
              Chủ đề
              <select
                value={newsTopic}
                onChange={(e) => setEconParam({ newsTopic: e.target.value }, { replace: true })}
              >
                <option value="all">Tất cả</option>
                <option value="crypto">Crypto</option>
                <option value="macro">Vĩ mô</option>
              </select>
            </label>
            <label>
              Coin (nếu có trong tiêu đề)
              <select
                value={newsSymbol}
                onChange={(e) =>
                  setEconParam({ newsSymbol: e.target.value || null }, { replace: true })
                }
              >
                <option value="">Tất cả</option>
                <option value="BTCUSDT">BTC</option>
                <option value="ETHUSDT">ETH</option>
              </select>
            </label>
            <button
              type="button"
              className="econ-link-btn"
              onClick={() => setEconParam({ econView: "context" })}
            >
              Về bối cảnh
            </button>
          </div>
          {news?.disclaimerVi ? <p className="econ-banner">{news.disclaimerVi}</p> : null}
          <ul className="econ-news-list">
            {(news?.items || []).map((item) => (
              <li key={item.id}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                <div className="muted">
                  {item.publisher || "Nguồn"} ·{" "}
                  {item.publishedAt
                    ? formatInTz(item.publishedAt, econTz)
                    : item.publishedAtLabelVi || "Chưa rõ giờ đăng"}
                  {item.assetIds?.length ? ` · ${item.assetIds.join(", ")}` : ""}
                  {item.locale === "vi" ? " · tiếng Việt" : ""}
                </div>
                {item.assetIds?.includes("BTCUSDT") || item.assetIds?.includes("ETHUSDT") ? (
                  <div>
                    <button
                      type="button"
                      className="econ-link-btn"
                      onClick={() =>
                        setParams(
                          (prev) => {
                            const n = new URLSearchParams(prev);
                            n.set("tab", "technical");
                            n.set(
                              "symbol",
                              item.assetIds.includes("BTCUSDT") ? "BTCUSDT" : "ETHUSDT"
                            );
                            return n;
                          },
                          { replace: false }
                        )
                      }
                    >
                      Xem kỹ thuật
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {!news?.items?.length ? (
            <p className="muted">Chưa có tin trong snapshot — collector có thể đang chạy.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
