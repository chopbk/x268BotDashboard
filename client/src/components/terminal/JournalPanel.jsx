import { useEffect, useState } from "react";
import { api } from "../../api";
import { fmt, when } from "./format.js";
import { ownershipView } from "./summary.js";
import { protectionStatus } from "./protection.js";
import { qtyOf } from "../../position-sort";

function factorsPayload(row) {
  if (!row) return null;
  const own = ownershipView(row);
  const protect = protectionStatus(row);
  return {
    account: row.account,
    symbol: row.symbol,
    side: row.side,
    book: row.book,
    entry: row.entry,
    mark: row.mark,
    size: qtyOf(row),
    unrealized: row.unrealized,
    leverage: row.leverage,
    liquidation: row.liquidation,
    exchangeSl: protect.exchange?.sl ?? row.exchangeSl,
    exchangeTp: protect.exchange?.tp ?? row.exchangeTp,
    ownership: own.allocation,
    monitors: row.monitors,
    recorded: row.recorded,
  };
}

function kindLabel(kind) {
  if (kind === "structure") return "Cấu trúc";
  if (kind === "level") return "Mức";
  if (kind === "market") return "Thị trường";
  if (kind === "risk") return "Rủi ro";
  return "Gợi ý";
}

export default function JournalPanel({ row, canTpsl, onApplyProtect }) {
  const [notes, setNotes] = useState([]);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [coach, setCoach] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function loadNotes() {
    if (!row?.account || !row?.symbol || !row?.side) {
      setNotes([]);
      return;
    }
    try {
      const q = new URLSearchParams({
        account: row.account,
        symbol: row.symbol,
        side: row.side,
      });
      const data = await api(`/api/terminal/journal?${q}`);
      setNotes(data.items || []);
    } catch (err) {
      console.warn("[JournalPanel]", err.message);
      setError(err.message || "Không tải journal");
    }
  }

  useEffect(() => {
    setError("");
    setOk("");
    setCoach(null);
    setBody("");
    setTags("");
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.key]);

  async function saveNote() {
    if (!row || busy) return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api("/api/terminal/journal", {
        method: "POST",
        body: {
          account: row.account,
          symbol: row.symbol,
          side: row.side,
          body,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        },
      });
      setBody("");
      setTags("");
      setOk("Đã lưu journal");
      await loadNotes();
    } catch (err) {
      setError(err.message || "Không lưu được");
    } finally {
      setBusy(false);
    }
  }

  async function removeNote(id) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/terminal/journal/${id}`, { method: "DELETE" });
      await loadNotes();
    } catch (err) {
      setError(err.message || "Không xoá được");
    } finally {
      setBusy(false);
    }
  }

  async function runCoach(useAi) {
    if (!row || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/terminal/coach", {
        method: "POST",
        body: { position: factorsPayload(row), ai: useAi },
        timeoutMs: 45000,
      });
      setCoach(data);
    } catch (err) {
      if (err.status === 429 && err.data) {
        setCoach(err.data);
        setError(err.message || "Rate limit AI");
      } else {
        setError(err.message || "Không phân tích được");
      }
    } finally {
      setBusy(false);
    }
  }

  function applyAction(action) {
    if (!action || !onApplyProtect) return;
    if (action.type === "both") {
      onApplyProtect({ sl: String(action.sl), tp: String(action.tp), tab: "tpsl" });
      return;
    }
    if (action.type === "sl" && action.price != null) {
      onApplyProtect({ sl: String(action.price), tab: "tpsl" });
      return;
    }
    if (action.type === "tp" && action.price != null) {
      onApplyProtect({ tp: String(action.price), tab: "tpsl" });
    }
  }

  if (!row) return <p className="muted">Chọn vị thế để ghi journal và phân tích.</p>;

  const factors = coach?.factors;
  const market = factors?.market;

  return (
    <section className="term-panel-section stack term-journal">
      <div className="term-journal-actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => runCoach(false)}>Phân tích kỹ thuật</button>
        <button type="button" className="term-primary" disabled={busy} onClick={() => runCoach(true)}>Gợi ý AI</button>
      </div>
      <p className="muted">Phân tích lấy nến 15m/1h công khai: cấu trúc, EMA/ATR, vùng hỗ trợ–kháng cự, mức SL/TP gợi ý. Bấm Áp dụng để mở confirm bảo vệ (không tự gửi sàn).</p>

      {coach?.suggestions?.length ? (
        <div className="term-coach stack">
          <p className="muted">Nguồn: {coach.source}{coach.message ? ` · ${coach.message}` : ""}</p>

          {market && !market.error ? (
            <div className="term-market-card">
              <strong>Thị trường · {market.symbol}</strong>
              <dl className="term-kv term-kv-compact">
                <div><span>Cấu trúc 15m</span><strong>{market.structure15?.label || "—"}</strong></div>
                <div><span>Cấu trúc 1h</span><strong>{market.structure1h?.label || "—"}</strong></div>
                <div><span>EMA20 / 50</span><strong>{fmt(market.ema20)} / {fmt(market.ema50)}</strong></div>
                <div><span>ATR14</span><strong>{fmt(market.atr14)} ({market.atrPct != null ? `${market.atrPct}%` : "—"})</strong></div>
                <div><span>Hỗ trợ</span><strong className="term-num">{fmt(market.support)}</strong></div>
                <div><span>Kháng cự</span><strong className="term-num">{fmt(market.resistance)}</strong></div>
                <div><span>Khớp side</span><strong>{market.alignment === "with" ? "Cùng chiều" : market.alignment === "against" ? "Ngược chiều" : "Trung lập"}</strong></div>
              </dl>
              {market.note ? <p className="muted">{market.note}</p> : null}
            </div>
          ) : null}
          {market?.error ? <p className="form-error">Nến: {market.error}</p> : null}

          {(coach.levels || []).length ? (
            <div className="term-level-list stack">
              <strong>Mức có thể áp dụng</strong>
              <ul>
                {(coach.levels || []).map((level) => (
                  <li key={level.id || `${level.role}-${level.price}`}>
                    <div>
                      <span className={`term-level-role term-level-${level.role}`}>{level.role?.toUpperCase()}</span>
                      {" "}
                      <strong>{level.label}</strong>
                      <span className="term-num"> {fmt(level.price)}</span>
                      {level.reason ? <span className="muted"> — {level.reason}</span> : null}
                    </div>
                    {(level.role === "sl" || level.role === "tp") && canTpsl ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || row.book === "paper" || row.book === "pending"}
                        onClick={() => applyAction({ type: level.role, price: level.price, label: level.label })}
                      >
                        Áp {level.role.toUpperCase()}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="term-coach-list">
            {coach.suggestions.map((item, idx) => (
              <li key={`${item.title}-${idx}`} className={`term-coach-item term-coach-${item.kind || "risk"}`}>
                <div className="term-coach-item-head">
                  <span className="term-coach-kind">{kindLabel(item.kind)}</span>
                  <strong>{item.title}</strong>
                </div>
                {item.detail ? <p className="muted">{item.detail}</p> : null}
                {item.action && (item.action.type === "sl" || item.action.type === "tp" || item.action.type === "both") && canTpsl ? (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || row.book === "paper" || row.book === "pending"}
                    onClick={() => applyAction(item.action)}
                  >
                    {item.action.type === "both"
                      ? `Áp SL ${fmt(item.action.sl)} + TP ${fmt(item.action.tp)}`
                      : `Áp ${item.action.type.toUpperCase()} ${fmt(item.action.price)}`}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {factors ? (
            <details>
              <summary>Yếu tố lệnh</summary>
              <dl className="term-kv term-kv-compact">
                <div><span>uPnL</span><strong>{factors.unrealized ?? "—"}</strong></div>
                <div><span>ROI margin≈</span><strong>{factors.roiEst == null ? "—" : `${factors.roiEst.toFixed(1)}%`}</strong></div>
                <div><span>Move</span><strong>{factors.movePct == null ? "—" : `${factors.movePct.toFixed(2)}%`}</strong></div>
                <div><span>Tới SL</span><strong>{factors.slDistancePct == null ? "—" : `${factors.slDistancePct.toFixed(2)}%`}</strong></div>
                <div><span>Tới TP</span><strong>{factors.tpDistancePct == null ? "—" : `${factors.tpDistancePct.toFixed(2)}%`}</strong></div>
                <div><span>Tới liq</span><strong>{factors.liqDistancePct == null ? "—" : `${factors.liqDistancePct.toFixed(2)}%`}</strong></div>
                <div><span>Lev</span><strong>{factors.leverage ?? "—"}</strong></div>
                <div><span>SL/TP</span><strong>{factors.sl ?? "—"} / {factors.tp ?? "—"}</strong></div>
              </dl>
            </details>
          ) : null}
        </div>
      ) : null}

      <label>Ghi chú (chỉ bạn thấy)
        <textarea
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Setup, lý do giữ/cắt, sai lầm…"
        />
      </label>
      <label>Tags (phẩy, tối đa 10)
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fomo, scalp" />
      </label>
      <button type="button" className="term-primary" disabled={busy || !body.trim()} onClick={saveNote}>Lưu journal</button>

      {error ? <p className="form-error">{error}</p> : null}
      {ok ? <p className="form-ok">{ok}</p> : null}

      <ul className="term-journal-list">
        {notes.map((note) => (
          <li key={note.id}>
            <div className="term-journal-meta">
              <time className="muted">{when(note.createdAt)}</time>
              {note.tags?.length ? <span className="muted">{note.tags.join(", ")}</span> : null}
              <button type="button" className="ghost" disabled={busy} onClick={() => removeNote(note.id)}>Xoá</button>
            </div>
            <p>{note.body}</p>
          </li>
        ))}
        {!notes.length ? <li className="muted">Chưa có ghi chú cho lệnh này.</li> : null}
      </ul>
    </section>
  );
}
