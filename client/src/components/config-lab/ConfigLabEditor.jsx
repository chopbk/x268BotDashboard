import { createContext, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FIELD_LABELS, signalNames, splitConfigList } from "../../configDraft";

export const LabContext = createContext(null);
export const LAB_GROUPS = [
  { id: "operation", name: "Vận hành & Signal", note: "Nguồn tín hiệu, hướng giao dịch", sections: ["Chạy lệnh", "Signal", "Vận hành"] },
  { id: "capital", name: "Vốn & Khối lượng", note: "Cách tính size và đòn bẩy", sections: ["Cách tính vốn"] },
  { id: "entry", name: "Vào lệnh", note: "Loại lệnh, điều kiện và giới hạn", sections: ["Giới hạn lệnh"] },
  { id: "exit", name: "Thoát lệnh", note: "Cắt lỗ, chốt lời và trailing", sections: ["Cắt lỗ", "Chốt lời", "Trailing"] },
  { id: "filters", name: "Bộ lọc", note: "Symbol và điều kiện xử lý", sections: ["Lọc lệnh"] },
  { id: "sync", name: "Copy & Sync", note: "Theo nguồn và đồng bộ cấu hình", sections: ["Copy", "Sync"] },
];

export function journeyPaths(username, env, signalText = "") {
  const names = String(signalText || "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  const history = new URLSearchParams({ tab: "history", fromUser: username, fromEnv: env });
  const skip = new URLSearchParams({ tab: "stats", fromUser: username, fromEnv: env });
  if (names.length) {
    history.set("signals", names.join(","));
    skip.set("signals", names.join(","));
  }
  if (names.length === 1) {
    history.set("signal", names[0]);
    skip.set("signal", names[0]);
  }
  return {
    history: `/signal-search?${history}`,
    skip: `/signal-search?${skip}`,
    statics: `/signals?view=statics&username=${encodeURIComponent(username)}&env=${encodeURIComponent(env)}`,
    positions: `/positions?account=${encodeURIComponent(username)}&env=${encodeURIComponent(env)}`,
    bot: `/bots/${encodeURIComponent(username)}`,
    legacy: `/bots/${encodeURIComponent(username)}/accounts/${encodeURIComponent(env)}`,
  };
}

export function LabJourneyLinks({ username, env, signals = "", canHistory, canStatistics, canPositions }) {
  const paths = journeyPaths(username, env, signals);
  return <nav className="lab-journey" aria-label="Tiếp theo sau cấu hình">
    <span className="lab-kicker">THEO DÕI</span>
    {canPositions ? <Link className="ghost link-btn" to={paths.positions}>Position</Link> : null}
    {canStatistics ? <Link className="ghost link-btn" to={paths.statics}>Account Static</Link> : null}
    {canHistory ? <Link className="ghost link-btn" to={paths.history}>Lịch sử signal</Link> : null}
    <Link className="ghost link-btn" to={paths.skip}>Lý do bỏ qua</Link>
    <Link className="ghost link-btn" to={paths.bot}>User bot</Link>
  </nav>;
}

export function LabHeader({ username, env, form, returnTo, signals = "", canHistory, canStatistics, canPositions }) {
  const back = typeof returnTo === "string" && /^\/config-lab(?:\?|$)/.test(returnTo) ? returnTo : "/config-lab";
  const paths = journeyPaths(username, env, signals);
  return <header className="lab-heading">
    <div className="lab-heading-top">
      <Link to={back} className="lab-back">← Danh sách config</Link>
      <span className="lab-badge">Thử nghiệm</span>
    </div>
    <div className="lab-title-row"><div><p className="lab-kicker">CẤU HÌNH GIAO DỊCH · {username}</p><h1>{env}</h1></div>
      <Link className="ghost link-btn" to={paths.legacy}>Mở giao diện cũ ↗</Link>
    </div>
    <div className="lab-badges">
      {form ? <><span className={`lab-badge ${form.paper ? "paper" : "live"}`}>{form.paper ? "Paper" : "Live"}</span>
        <span className={`lab-badge ${form.on ? "positive" : ""}`}>{form.on ? "Nhận signal: bật" : "Nhận signal: tắt"}</span>
        <span className="lab-badge">{form.mode || "—"}</span></> : null}
      <span className="lab-caption">Giao diện thử nghiệm · lưu thay đổi vào config thật</span>
    </div>
    <LabJourneyLinks username={username} env={env} signals={signals} canHistory={canHistory} canStatistics={canStatistics} canPositions={canPositions} />
  </header>;
}

export function LabLayout({ enabled, group, setGroup, form, lists, changes, volumeLead, editing, children }) {
  const [summaryOpen, setSummaryOpen] = useState(true);
  useEffect(() => {
    if (!enabled) return undefined;
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setSummaryOpen(!media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [enabled]);
  if (!enabled) return children;
  const current = LAB_GROUPS.find((item) => item.id === group) || LAB_GROUPS[0];
  const signals = splitConfigList(lists.signals);
  return <div className="lab-workspace">
    <nav className="lab-groups" aria-label="Nhóm cấu hình">
      <p className="lab-kicker">THIẾT LẬP</p>
      {LAB_GROUPS.map((item, index) => <button key={item.id} type="button" className={group === item.id ? "selected" : ""} aria-current={group === item.id ? "page" : undefined} onClick={() => setGroup(item.id)}>
        <span className="lab-step">{String(index + 1).padStart(2, "0")}</span><span>{item.name}<small>{item.note}</small></span>
      </button>)}
      <p className="lab-nav-note">{editing ? `${changes.length} trường thay đổi. Đổi nhóm vẫn giữ nội dung đang sửa.` : "Đang xem cấu hình. Bấm Sửa cấu hình để bắt đầu."}</p>
    </nav>
    <div className="lab-main"><div className="lab-group-heading"><h2>{current.name}</h2><p>{current.note}</p></div>{children}</div>
    <aside className="lab-summary">
      <details open={summaryOpen} onToggle={(event) => setSummaryOpen(event.currentTarget.open)}><summary>Tóm tắt cấu hình <span className="lab-badge">{editing ? "Bản đang sửa" : "Đã lưu"}</span></summary>
        <div className="lab-summary-body">
          <p className="lab-caption">{editing ? "Phản ánh giá trị trong form, chưa áp dụng lên bot." : "Giá trị đã lưu; không phải trạng thái runtime của bot."}</p>
          <dl>
            <div><dt>Chế độ</dt><dd>{form.paper ? "Paper · không gửi lệnh" : "Live · lệnh thật"}</dd></div>
            <div><dt>Hướng</dt><dd>{[form.long && "Long", form.short && "Short"].filter(Boolean).join(" + ") || "Không nhận hướng nào"}{form.invert ? " · đảo chiều signal" : ""}</dd></div>
            <div><dt>Signal</dt><dd>{signals.length} nguồn{signals.length ? ` · ${signals.slice(0, 3).join(", ")}${signals.length > 3 ? "…" : ""}` : " · chưa chọn nguồn"}</dd></div>
            <div><dt>Size</dt><dd>{form.mode}</dd></div>
            {form.mode === "FIX" ? <div><dt>Cost × leverage</dt><dd>{form.cost ?? "—"} × {form.leverage ?? "—"}</dd></div> : null}
          </dl>
          <p className="lab-explanation">{volumeLead}</p>
          <dl>
            <div><dt>Vào lệnh</dt><dd>{form.openType || "—"}</dd></div>
            <div><dt>SL / TP</dt><dd>{form.slType || "—"} / {form.tpType || "—"}</dd></div>
            <div><dt>Monitor</dt><dd>{form.monitor ? "Bật" : "Tắt"}</dd></div>
            <div><dt>Trailing / HP</dt><dd>{form.trailing ? "Bật" : "Tắt"} / {form.hp ? "Bật" : "Tắt"}</dd></div>
            <div><dt>Copy</dt><dd>{form.copy ? "Nhận lệnh copy" : "Tắt"}</dd></div>
          </dl>
          {!form.monitor && (form.trailing || form.hp) ? <p className="lab-warning">Monitor đang tắt. Kiểm tra khả năng theo dõi SL/TP và trailing trước khi dùng.</p> : null}
          {!form.on ? <p className="lab-notice">Đang tắt nhận signal mới. Đây không phải thao tác đóng vị thế đang có.</p> : null}
          {form.syncFrom ? <div className="lab-inheritance"><span className="lab-kicker">NGUỒN ĐỒNG BỘ</span><strong>{form.syncFrom}</strong><p>Nguồn có thể ghi đè các nhóm đang đồng bộ.</p><p>Ngoại lệ: {lists.syncExcept || "Không có"}</p><p>Scale: {form.syncScale ? "bật" : "tắt"}</p></div> : <p className="lab-caption">Config độc lập · chưa liên kết nguồn sync.</p>}
        </div>
      </details>
    </aside>
  </div>;
}

export function SignalTags({ value, onChange, disabled, suggestions = [] }) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const id = useId();
  const names = splitConfigList(value);
  const picked = new Set(names.map((name) => name.toLowerCase()));
  const catalog = suggestions.filter((row) => {
    const name = typeof row === "string" ? row : row.signal;
    return name && !picked.has(String(name).toLowerCase());
  }).slice(0, 24);
  useEffect(() => { if (disabled) setInput(""); }, [disabled]);
  function add(raw = input) {
    const next = [...new Set([...names, ...signalNames(raw)])];
    if (String(raw || "").trim()) onChange(next.join(", "));
    setInput("");
  }
  return <div className="lab-signals span-all">
    <div className="lab-signal-top"><span>{names.length} signal được chọn</span>
      {names.length > 5 ? <input type="search" aria-label="Tìm trong signal đã chọn" placeholder="Tìm signal đã chọn…" value={search} onChange={(event) => setSearch(event.target.value)} /> : null}
    </div>
    <div className="lab-tags">{names.filter((name) => name.toLowerCase().includes(search.toLowerCase())).map((name) => <span className="lab-tag" key={name}>{name}{!disabled ? <button type="button" aria-label={`Gỡ signal ${name}`} onClick={() => onChange(names.filter((item) => item !== name).join(", "))}>×</button> : null}</span>)}
      {!names.length ? <p className="lab-caption">Chưa có signal. Config sẽ không nhận tín hiệu từ kênh nào.</p> : null}
    </div>
    {!disabled && catalog.length ? <div className="lab-suggest"><span className="lab-caption">Gợi ý từ kênh / đang dùng</span><div className="lab-tags">{catalog.map((row) => {
      const name = typeof row === "string" ? row : row.signal;
      const note = typeof row === "object" && row.configs != null ? ` · ${row.configs}` : "";
      return <button type="button" className="lab-tag lab-tag-btn" key={name} onClick={() => add(name)}>{name}{note}</button>;
    })}</div></div> : null}
    {!disabled ? <><label htmlFor={id}>Thêm signal</label><div className="lab-signal-input"><input id={id} value={input} placeholder="SIGNAL_A, SIGNAL_B…" onChange={(event) => setInput(event.target.value)} onBlur={() => add()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} list={`${id}-suggest`} /><button type="button" className="ghost" onClick={() => add()}>Thêm</button></div>
      <datalist id={`${id}-suggest`}>{suggestions.map((row) => {
        const name = typeof row === "string" ? row : row.signal;
        return name ? <option key={name} value={name} /> : null;
      })}</datalist>
      <small className="lab-caption">Enter để thêm. Có thể dán nhiều tên, cách nhau bằng dấu phẩy hoặc khoảng trắng. Chọn từ gợi ý hoặc gõ tên mới.</small></> : null}
  </div>;
}

export function SyncSourceField({ value, onChange, disabled, options = [], placeholder = "Tên config gốc" }) {
  const id = useId();
  const list = options.filter((row) => row?.env);
  return <label className="span-2 lab-sync-source">
    <span className="field-name">Sync from</span>
    <div className="lab-sync-row">
      <input list={id} value={value || ""} placeholder={placeholder} disabled={disabled} autoComplete="off"
        onChange={(event) => onChange(String(event.target.value || "").trim().toUpperCase())} />
      <select aria-label="Chọn config nguồn sync" disabled={disabled}
        value={list.some((row) => row.env === value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}>
        <option value="">Không sync / gõ tay</option>
        {list.map((row) => <option key={`${row.username}/${row.env}`} value={row.env}>{row.username}/{row.env}</option>)}
      </select>
    </div>
    <datalist id={id}>{list.map((row) => <option key={`dl-${row.username}/${row.env}`} value={row.env}>{row.username}/{row.env}</option>)}</datalist>
    <small className="lab-caption">Gốc sửa thì nhánh bị ghi đè, trừ nhóm Sync except. Để trống = config độc lập.</small>
  </label>;
}

function displayValue(value) {
  if (value == null || value === "") return "Chưa đặt";
  if (typeof value === "boolean") return value ? "Bật" : "Tắt";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Rỗng";
  return String(value);
}
export function ChangeReview({ open, changes, onClose }) {
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [open]);
  if (!open) return null;
  return <section ref={ref} className="lab-review" aria-label="Xem thay đổi">
    <div className="lab-title-row"><h2>Xem thay đổi · {changes.length} trường</h2><button className="ghost" type="button" onClick={onClose}>Đóng</button></div>
    <p className="lab-caption">Đối chiếu với bản trước khi bấm Sửa. Bấm Lưu và áp dụng để ghi các thay đổi này.</p>
    <div className="lab-table-scroll"><table><thead><tr><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>{changes.map(({ key, before, after }) => <tr key={key}><th>{FIELD_LABELS[key] || key}</th><td>{displayValue(before)}</td><td>{displayValue(after)}</td></tr>)}</tbody></table></div>
  </section>;
}

function applyTone(applyState) {
  if (!applyState) return "";
  if (applyState.status === "succeeded" && applyState.terminal) return "ok";
  if (["failed", "expired"].includes(applyState.status) && applyState.terminal) return "warn";
  if (applyState.requestId && !applyState.terminal) return "pending";
  return "";
}

export function LabSaveBar({ editing, busy, count, onEdit, onSave, onCancel, onReview, ready, saved, applyState, onRetry }) {
  const canRetry = applyState && ["failed", "expired"].includes(applyState.status) && applyState.terminal && applyState.requestId;
  const tone = applyTone(applyState);
  return <footer className={`lab-savebar ${tone ? `is-${tone}` : ""}`}><div aria-live="polite">
    <strong>{busy ? "Đang xử lý…" : editing ? `${count} trường đã thay đổi` : "Cấu hình đã lưu"}</strong>
    <small>{saved || (editing ? "Chưa áp dụng các chỉnh sửa lên bot" : "Bấm Sửa cấu hình để bắt đầu")}</small>
    {!editing && applyState?.requestId ? <small className="lab-apply-meta">Đồng bộ bot · {applyState.status}{applyState.terminal ? " · xong" : " · chờ ACK"}</small> : null}
  </div>
    <div className="lab-save-actions">
      {canRetry ? <button type="button" className="ghost" onClick={onRetry} disabled={busy}>Thử áp dụng lại</button> : null}
      {editing ? <><button type="button" className="ghost" onClick={onCancel} disabled={busy}>Hủy</button><button type="button" className="ghost" onClick={onReview} disabled={busy || !count}>Xem thay đổi</button><button type="button" onClick={onSave} disabled={busy || !count}>Lưu và áp dụng</button></>
        : <button type="button" onClick={onEdit} disabled={busy || !ready}>Sửa cấu hình</button>}
    </div>
  </footer>;
}
