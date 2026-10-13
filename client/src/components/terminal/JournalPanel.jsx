import { useEffect, useState } from "react";
import { api } from "../../api";
import { when } from "./format.js";

/** Journal chỉ ghi chú cá nhân — AI nằm tab riêng. */
export default function JournalPanel({ row }) {
  const [notes, setNotes] = useState([]);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
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

  if (!row) return <p className="muted">Chọn vị thế để ghi journal.</p>;

  return (
    <section className="term-panel-section stack term-journal">
      <p className="muted">Ghi chú cá nhân (chỉ bạn thấy). Phân tích AI nằm tab «AI phân tích».</p>

      <label>Ghi chú
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
