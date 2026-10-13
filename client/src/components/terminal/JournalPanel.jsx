import { useEffect, useState } from "react";
import { api } from "../../api";
import { when } from "./format.js";
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

export default function JournalPanel({ row }) {
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

  if (!row) return <p className="muted">Chọn vị thế để ghi journal và phân tích.</p>;

  const factors = coach?.factors;

  return (
    <section className="term-panel-section stack term-journal">
      <div className="term-journal-actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => runCoach(false)}>Phân tích nhanh</button>
        <button type="button" className="term-primary" disabled={busy} onClick={() => runCoach(true)}>Gợi ý AI</button>
      </div>

      {coach?.suggestions?.length ? (
        <div className="term-coach stack">
          <p className="muted">Nguồn: {coach.source}{coach.message ? ` · ${coach.message}` : ""}</p>
          <ul className="term-coach-list">
            {coach.suggestions.map((item, idx) => (
              <li key={`${item.title}-${idx}`}>
                <strong>{item.title}</strong>
                {item.detail ? <span className="muted"> — {item.detail}</span> : null}
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
