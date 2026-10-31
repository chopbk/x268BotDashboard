import { forwardRef, useImperativeHandle, useRef } from "react";
import { Link } from "react-router-dom";
import { fmtMarketPrice } from "../../lib/market-price";

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${fmt(value, 2)}%`;
}

function zoneShort(z, role, symbolInfo) {
  if (!z) return { text: "—", title: `Không có ${role}` };
  const near = z.nearFar && z.nearFar !== "far" ? z.nearFar : null;
  const dist = z.distancePct != null ? fmtPct(z.distancePct) : null;
  const parts = [role === "support" ? "S" : "R"];
  if (near) parts.push(near);
  if (dist) parts.push(dist);
  const low = fmtMarketPrice(z.low, symbolInfo);
  const high = fmtMarketPrice(z.high, symbolInfo);
  return {
    text: parts.join(" · "),
    title: `${z.role || role} [${low}–${high}] · ATR ${fmt(z.distanceAtr, 2)} · ${z.source || ""}`,
  };
}

function positionCell(loc, symbolInfo) {
  const tags = (loc.positionTags || []).filter(Boolean);
  const sup = zoneShort(loc.support, "support", symbolInfo);
  const res = zoneShort(loc.resistance, "resistance", symbolInfo);
  const tagText = tags.length ? tags.join(", ") : "—";
  return {
    text: tagText,
    sub: `${sup.text} / ${res.text}`,
    title: `${sup.title}\n${res.title}`,
  };
}

function setupTriggerCell(setup, trigger) {
  if (!setup) return { text: "—", title: "Không có setup active", cls: "" };
  const side = setup.side === "long" ? "L" : setup.side === "short" ? "S" : "?";
  const type = setup.type || trigger?.type || "";
  const state = setup.entryState || setup.lifecycle || "";
  const touch = setup.touchEvidence || trigger?.touchEvidence;
  return {
    text: `${side} ${type} · ${state}`,
    title: [
      type,
      state,
      touch ? `touch: ${touch}` : null,
      (trigger?.reasons || setup.reasons || []).slice(0, 2).join("; "),
    ]
      .filter(Boolean)
      .join(" · "),
    cls: setup.side === "long" ? "mkt-long" : setup.side === "short" ? "mkt-short" : "",
  };
}

function waitingCell(ctx) {
  if (ctx?.waiting?.text) return { text: ctx.waiting.text, title: ctx.waiting.entryState || "" };
  return { text: "—", title: ctx?.waitingReason || "Không có điều kiện chờ" };
}

function obstaclesCell(ctx) {
  const list = ctx?.obstacles || [];
  if (!list.length) return { text: "—", title: "Không ghi nhận cản trở từ dữ liệu hiện có" };
  return {
    text: list.map((o) => o.text).join(" · "),
    title: list.map((o) => o.text).join("\n"),
  };
}

function actionClass(action) {
  if (action === "in_zone") return "mkt-action-in";
  if (action === "wait_confirm") return "mkt-action-wait";
  if (action === "skip") return "mkt-action-skip";
  return "mkt-action-watch";
}

function entryRrCell(decision, symbolInfo) {
  if (!decision || (decision.entryLow == null && decision.entryHigh == null)) {
    return { text: "—", title: decision?.rrNote || "Không có entry band" };
  }
  const low = fmtMarketPrice(decision.entryLow, symbolInfo);
  const high = fmtMarketPrice(decision.entryHigh, symbolInfo);
  const inv =
    decision.invalidationLevel != null ? fmtMarketPrice(decision.invalidationLevel, symbolInfo) : "—";
  const rr = decision.rr != null ? `RR ${fmt(decision.rr, 2)}` : "RR —";
  return {
    text: `[${low}–${high}] · inv ${inv} · ${rr}`,
    title: [
      decision.rrNote,
      decision.targetLevel != null
        ? `target ${decision.targetRole || ""} ${fmtMarketPrice(decision.targetLevel, symbolInfo)}`
        : "thiếu vùng đối diện → không tính RR",
      decision.actionReason,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const MarketLocationTable = forwardRef(function MarketLocationTable(
  { rows, symbol, canFlow, canTerminal = false, top, onSelect, loading },
  ref
) {
  const rowRefs = useRef(new Map());

  useImperativeHandle(ref, () => ({
    focusSymbol(sym) {
      const el = rowRefs.current.get(sym);
      if (el && typeof el.focus === "function") el.focus();
    },
  }));

  if (loading && !rows?.length) {
    return <div className="mkt-empty mkt-skel">Đang tải vị trí & setup…</div>;
  }
  if (!rows?.length) {
    return (
      <div className="mkt-empty">
        Không có dòng khớp bộ lọc. Collector có thể chưa tính location (cần chấm lại symbol).
      </div>
    );
  }

  const showOiCol = rows.some((r) => r.context?.decision?.oiRegime || r.flow);

  return (
    <table className="mkt-table mkt-loc-table">
      <thead>
        <tr>
          <th>Coin</th>
          <th className="num">Giá / Δ</th>
          <th>Cấu trúc</th>
          <th>Hành động</th>
          <th>Entry · Inv · RR</th>
          <th>Vị trí</th>
          <th>Setup / Trigger</th>
          <th>Mâu thuẫn</th>
          {showOiCol ? <th className="mkt-col-hide-mobile">OI×Giá</th> : null}
          <th className="mkt-col-hide-mobile">Cần chờ</th>
          <th className="mkt-col-hide-mobile">Cản trở</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const loc = row.location || {};
          const ctx = row.context || {};
          const decision = ctx.decision || null;
          const info = row.symbolInfo || null;
          const selected = row.symbol === symbol;
          const pos = positionCell(loc, info);
          const setup = setupTriggerCell(loc.primarySetup, ctx.trigger);
          const wait = waitingCell(ctx);
          const obst = obstaclesCell(ctx);
          const entry = entryRrCell(decision, info);
          const flowHref = `/market?tab=flow&flowTab=overview&symbol=${encodeURIComponent(row.symbol)}&top=${top || 10}`;
          const terminalHref = `/terminal?symbol=${encodeURIComponent(row.symbol)}`;
          const change = row.price?.changePct24h;
          const changeCls =
            change == null ? "muted" : Number(change) >= 0 ? "mkt-long" : "mkt-short";
          const conflicts =
            decision?.conflictsShort?.length > 0 ? decision.conflictsShort.join(" · ") : "—";
          const changed = decision?.changed?.label;
          return (
            <tr
              key={row.symbol}
              ref={(el) => {
                if (el) rowRefs.current.set(row.symbol, el);
                else rowRefs.current.delete(row.symbol);
              }}
              tabIndex={0}
              className={selected ? "selected" : ""}
              onClick={() => onSelect(row.symbol)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(row.symbol);
                }
              }}
            >
              <td>
                <strong>{row.symbol}</strong>
                {changed ? (
                  <span className="mkt-changed-badge" title={decision?.changed?.at || ""}>
                    {changed}
                  </span>
                ) : null}
                {canFlow ? (
                  <>
                    {" "}
                    <Link
                      className="mkt-flow-link"
                      to={flowHref}
                      title={`Xem dòng tiền ${row.symbol}`}
                      aria-label={`Xem dòng tiền ${row.symbol}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Dòng tiền
                    </Link>
                  </>
                ) : null}
                {canTerminal ? (
                  <>
                    {" "}
                    <Link
                      className="mkt-flow-link"
                      to={terminalHref}
                      title={`Mở Terminal ${row.symbol}`}
                      aria-label={`Mở Terminal ${row.symbol}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Terminal
                    </Link>
                  </>
                ) : null}
                <div className="mkt-loc-mobile-extra muted">
                  <span className={actionClass(decision?.action)}>
                    {decision?.actionLabel || "—"}
                  </span>
                  {" · "}
                  {entry.text !== "—" ? entry.text : setup.text}
                </div>
              </td>
              <td className="num">
                {fmtMarketPrice(row.price?.last, info)}
                <div className={changeCls} style={{ fontSize: 11 }}>
                  {change == null ? "—" : `${fmt(change, 2)}%`}
                  {decision?.relativeVsBtc24h != null ? (
                    <span className="muted" title="Δ24h so với BTC (điểm %)">
                      {" "}
                      · vsBTC {fmt(decision.relativeVsBtc24h, 2)}
                    </span>
                  ) : null}
                  {row.price?.asOf ? (
                    <span className="muted" title={row.price.asOf}>
                      {" "}
                      · tuổi dữ liệu
                    </span>
                  ) : null}
                </div>
              </td>
              <td>
                {loc.structureLabel || "—"}
                {loc.htfLabel && loc.htfLabel !== "N/A" ? (
                  <div className="muted" style={{ fontSize: 11 }}>
                    Lớn: {loc.htfLabel}
                    {loc.structureBias &&
                    loc.htfBias &&
                    loc.htfBias !== "n/a" &&
                    loc.structureBias !== loc.htfBias &&
                    loc.htfBias !== "unknown"
                      ? " · mâu thuẫn"
                      : null}
                  </div>
                ) : null}
              </td>
              <td className={actionClass(decision?.action)} title={decision?.actionReason || ""}>
                {decision?.actionLabel || "—"}
              </td>
              <td className="muted" title={entry.title} style={{ fontSize: 11 }}>
                {entry.text}
              </td>
              <td title={pos.title}>
                {pos.text}
                <div className="muted mkt-col-hide-mobile" style={{ fontSize: 11 }}>
                  {pos.sub}
                </div>
              </td>
              <td className={setup.cls} title={setup.title}>
                {setup.text}
              </td>
              <td className="mkt-conflict" title={conflicts}>
                {conflicts}
              </td>
              {showOiCol ? (
                <td
                  className="mkt-col-hide-mobile"
                  title={
                    decision?.oiRegimeReason
                      ? `Lý do: ${decision.oiRegimeReason}`
                      : "Giá×OI 24h — quan sát, không phải cá voi"
                  }
                >
                  {decision?.oiRegimeLabel || "—"}
                </td>
              ) : null}
              <td className="mkt-col-hide-mobile" title={wait.title}>
                {wait.text}
              </td>
              <td className="mkt-col-hide-mobile" title={obst.title}>
                <span className="mkt-obstacle">{obst.text}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

export default MarketLocationTable;
