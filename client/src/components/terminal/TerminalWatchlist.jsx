/**
 * Watchlist trái — đồng bộ market identity với chart/ticket.
 */
export default function TerminalWatchlist({
  items = [],
  selectedSymbol = "",
  positions = [],
  onSelect,
  onAddSymbol,
  onRemove,
}) {
  const fromPositions = [];
  const seen = new Set();
  for (const row of positions || []) {
    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    fromPositions.push({
      symbol,
      instrumentId: row.instrumentId || symbol,
      exchange: row.exchange || "binance",
      marketType: "usdt_perp_linear",
      mark: row.mark,
      side: row.side,
    });
  }

  const merged = [];
  const keys = new Set();
  for (const item of [...(items || []), ...fromPositions]) {
    const symbol = String(item.symbol || item.instrumentId || "").toUpperCase();
    if (!symbol || keys.has(symbol)) continue;
    keys.add(symbol);
    merged.push({
      ...item,
      symbol,
      instrumentId: item.instrumentId || symbol,
      exchange: item.exchange || "binance",
      marketType: item.marketType || "usdt_perp_linear",
    });
  }

  function add() {
    const raw = window.prompt("Symbol (vd BTCUSDT)", selectedSymbol || "BTCUSDT");
    if (!raw) return;
    const symbol = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!symbol) return;
    onAddSymbol?.({
      symbol,
      instrumentId: symbol,
      exchange: "binance",
      marketType: "usdt_perp_linear",
    });
  }

  return (
    <aside className="term-watchlist" aria-label="Watchlist">
      <header className="term-watchlist-head">
        <strong>Watchlist</strong>
        <button type="button" className="ghost" onClick={add} title="Thêm symbol">+</button>
      </header>
      {!merged.length ? <p className="muted">Chưa có symbol. Thêm hoặc chọn vị thế.</p> : null}
      <ul className="term-watchlist-list">
        {merged.map((item) => (
          <li key={item.symbol}>
            <button
              type="button"
              className={item.symbol === selectedSymbol ? "active" : ""}
              onClick={() => onSelect?.(item)}
            >
              <span>{item.symbol}</span>
              {item.mark != null ? <span className="muted">{Number(item.mark).toPrecision?.(6) || item.mark}</span> : null}
            </button>
            {onRemove ? (
              <button
                type="button"
                className="ghost term-watchlist-x"
                aria-label={`Xóa ${item.symbol}`}
                onClick={() => onRemove(item.symbol)}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}
