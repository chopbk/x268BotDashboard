import { Link } from "react-router-dom";

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${fmt(value, 2)}%`;
}

function zoneCell(z) {
  if (!z) return { text: "—", title: "" };
  const band = `[${fmt(z.low, 6)}–${fmt(z.high, 6)}]`;
  const dist = z.distancePct != null ? ` · ${fmtPct(z.distancePct)}` : "";
  const near = z.nearFar && z.nearFar !== "far" ? ` · ${z.nearFar}` : "";
  return {
    text: `${band}${dist}${near}`,
    title: `${z.role || ""} · ${z.source || ""} · ATR ${fmt(z.distanceAtr, 2)}`,
  };
}

function setupCell(setup) {
  if (!setup) return "—";
  const side = setup.side === "long" ? "L" : setup.side === "short" ? "S" : "?";
  return `${side} ${setup.type || ""} · ${setup.entryState || setup.lifecycle || ""}`;
}

function signalCell(entries) {
  const list = entries || [];
  if (!list.length) return "—";
  const primary = list.find((e) => !e.missingEntry) || list[0];
  const side = primary.side === "LONG" ? "L" : primary.side === "SHORT" ? "S" : "?";
  if (primary.missingEntry) return `${primary.source || "?"} ${side} · thiếu entry`;
  return `${primary.source || "?"} ${side} · ${primary.priceRelation || "?"} · ${primary.validity || "?"}`;
}

function tagsLabel(tags) {
  if (!tags?.length) return "—";
  return tags.join(", ");
}

export default function MarketLocationTable({
  rows,
  symbol,
  canFlow,
  top,
  onSelect,
  loading,
}) {
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

  return (
    <table className="mkt-table mkt-loc-table">
      <thead>
        <tr>
          <th>Coin</th>
          <th className="num">Giá</th>
          <th>Cấu trúc</th>
          <th>Hỗ trợ</th>
          <th className="mkt-col-hide-mobile">Kháng cự</th>
          <th>Vị trí</th>
          <th>Setup</th>
          <th className="mkt-col-hide-mobile">Entry signal</th>
          <th className="mkt-col-hide-mobile">Xác nhận</th>
          <th>Độ mới</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const loc = row.location || {};
          const selected = row.symbol === symbol;
          const sup = zoneCell(loc.support);
          const res = zoneCell(loc.resistance);
          const flowHref = `/market?tab=flow&flowTab=overview&symbol=${encodeURIComponent(row.symbol)}&top=${top || 10}`;
          return (
            <tr
              key={row.symbol}
              className={selected ? "selected" : ""}
              onClick={() => onSelect(row.symbol)}
            >
              <td>
                <strong>{row.symbol}</strong>
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
              </td>
              <td className="num">
                {fmt(row.price?.last, 6)}
                <div className={`muted ${Number(row.price?.changePct24h) >= 0 ? "mkt-long" : "mkt-short"}`} style={{ fontSize: 11 }}>
                  {row.price?.changePct24h == null ? "" : `${fmt(row.price.changePct24h, 2)}%`}
                </div>
              </td>
              <td>
                {loc.structureLabel || "—"}
                {loc.htfLabel && loc.htfLabel !== "N/A" ? (
                  <div className="muted" style={{ fontSize: 11 }}>
                    Lớn: {loc.htfLabel}
                  </div>
                ) : null}
              </td>
              <td title={sup.title}>{sup.text}</td>
              <td className="mkt-col-hide-mobile" title={res.title}>
                {res.text}
              </td>
              <td>{tagsLabel(loc.positionTags)}</td>
              <td className={loc.primarySetup?.side === "long" ? "mkt-long" : loc.primarySetup?.side === "short" ? "mkt-short" : ""}>
                {setupCell(loc.primarySetup)}
              </td>
              <td className="mkt-col-hide-mobile">{signalCell(row.signalEntries)}</td>
              <td className="mkt-col-hide-mobile">
                {(loc.confirmations || []).map((c) => c.label).join(" · ") || "—"}
              </td>
              <td>
                <span className={`mkt-status ${loc.quality || ""}`}>{loc.quality || "—"}</span>
                {!loc.priceFresh ? <div className="muted" style={{ fontSize: 11 }}>giá stale/unknown</div> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
