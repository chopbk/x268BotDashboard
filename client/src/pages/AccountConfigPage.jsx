import { configPayload, configChanges, changedPatch } from "../configDraft";
import { LabContext, LabLayout, LabHeader, SignalTags, SyncSourceField, ChangeReview, LAB_GROUPS, LabSaveBar } from "../components/config-lab/ConfigLabEditor";
import "../components/config-lab/config-lab.css";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEditResource } from "../access";
import { Crumbs, useEscape, useLeaveGuard } from "../navigation";
import { applyStatusLabel, waitForApply } from "../applyStatus";

const CONFIG_EDIT = "config.edit";
const CONFIG_VIEW = "config.view";
const SIGNALS_HISTORY = "signals.history";
const STATISTICS_VIEW = "statistics.view";
const POSITIONS_VIEW = "positions.view";
const COPY_MODES = [
  { id: "new", label: "Tạo mới", note: "Config mới, không gắn sync." },
  { id: "replace", label: "Ghi đè đích", note: "Ghi đè config đã có, gỡ sync đích." },
  { id: "sync", label: "Tạo + sync", note: "Config mới gắn sync_from về nguồn này." },
];
const MODES = ["FIX", "RATIO", "RISK", "RR", "LOSS"];
const OPEN_TYPES = ["MARKET", "LIMIT", "STOPMARKET", "STOPLIMIT", "FOLLOWSIGNAL"];
const SL_TYPES = ["MARKET", "LIMIT", "CANDLE", "EMA", "ATR", "FOLLOWSIGNAL", "HYBRID", "ENTRY_STYLE", "ROSE"];
const CANDLES = ["1M", "5M", "15M", "30M", "1H", "4H", "12H", "1D"];
const TP_TYPES = ["FIX", "TRAILING", "FOLLOWSIGNAL", "STOPLOSS", "HYBRID", "ENTRY_STYLE", "ROSE", "ATR"];
const TRAILING_TYPES = ["FIX", "STOPLOSS", "TP1", "TP2", "TP3", "TP4", "ATR", "ROSE"];
const SYMBOL_TYPES = ["MEGA", "BLUECHIP", "LARGE", "MIDCAP", "SMALLCAP", "MICRO", "SHIT", "UNKNOWN"];
const FILTERS = ["EMA15_REVERSE", "EMA15", "BLUECHIP", "BLUE", "BLOWOFF", "BLOW", "FOMO", "MEGA_BTC15"];
const SYNC_GROUPS = ["cost", "level", "sl", "tp", "trailing", "hp", "open", "margin", "copy", "on", "paper", "signals", "blacklist", "interval"];
const DYNAMIC_SL = ["CANDLE", "MA", "EMA", "SMA", "HYBRID", "ENTRY_STYLE", "ROSE", "ATR"];
const OPEN_WAITS = ["LIMIT", "STOPMARKET", "STOPLIMIT"];

function signalContextPath(tab, username, env, signalText) {
  const query = new URLSearchParams({ tab, fromUser: username, fromEnv: env });
  const names = String(signalText || "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  if (names.length) query.set("signals", names.join(","));
  if (names.length === 1) query.set("signal", names[0]);
  return `/signal-search?${query}`;
}

function describeVolume(form) {
  const mode = String(form?.mode || "FIX").toUpperCase();
  const dynamic = DYNAMIC_SL.includes(String(form?.slType || "").toUpperCase());
  const fix = Math.abs(Number(form?.fixloss));
  const hasFix = Number.isFinite(fix) && fix > 0;
  const known = ["FIX", "RATIO", "RISK", "RR", "LOSS"].includes(mode);
  if (!known) {
    return {
      lead: `Mode ${mode} không có công thức riêng. Bot không nhận ra thì tính như FIX: volume = Cost × đòn bẩy long.`,
      drive: ["cost"],
      idle: ["ratio", "fixloss"],
      notes: {
        cost: "USD ký quỹ nếu bot rơi về FIX.",
        ratio: "Không đọc khi bot xử lý như FIX.",
        fixloss: "Chỉ dùng khi mode LOSS hoặc RR.",
      },
      showVolume: true,
    };
  }
  if (mode === "RATIO") {
    return {
      lead: "RATIO: size ≈ số dư ví × Ratio / đòn bẩy long. Cost chỉ là vốn giả khi chưa có số dư. Fix loss không đọc.",
      drive: ["ratio"],
      idle: ["cost", "fixloss"],
      notes: {
        ratio: "Quyết định phần ví đưa vào lệnh.",
        cost: "Không phải size thật. Chỉ dùng khi chưa có số dư ví.",
        fixloss: "Không đọc ở mode RATIO.",
      },
    };
  }
  if (mode === "RISK") {
    return {
      lead: "RISK: size = Cost × (risk trên signal / 5). Ô Risk ở Giới hạn lệnh không nhân vào đây. Ratio và Fix loss không đọc.",
      drive: ["cost"],
      idle: ["ratio", "fixloss"],
      notes: {
        cost: "Mốc size, rồi nhân risk của signal / 5.",
        ratio: "Không đọc ở mode RISK.",
        fixloss: "Không đọc ở mode RISK.",
      },
    };
  }
  if (mode === "LOSS" || mode === "RR") {
    if (!dynamic) {
      return {
        lead: `${mode}: bot chỉ size theo lỗ khi SL type là CANDLE, EMA, ATR, HYBRID, ENTRY_STYLE hoặc ROSE. Type hiện tại không thuộc nhóm đó, nên size giữ Cost. Ratio không đọc.`,
        drive: ["cost"],
        idle: ["fixloss", "ratio"],
        notes: {
          cost: "Đang là size thật vì SL type không tính được ROI.",
          fixloss: "Có tác dụng sau khi đổi SL type sang nhóm nến hoặc ATR.",
          ratio: `Không đọc ở mode ${mode}.`,
        },
      };
    }
    if (!hasFix) {
      return {
        lead: `${mode}: Fix loss đang để 0, nên USD lỗ mục tiêu lấy Max loss ở phần Cắt lỗ. Size = lỗ mục tiêu / |ROI tại SL|. Ratio không đọc.`,
        drive: ["fixloss"],
        idle: ["cost", "ratio"],
        notes: {
          fixloss: "Đang 0. Bot lấy Max loss. Điền số dương nếu muốn lỗ cố định theo USD.",
          cost: "Chỉ giữ làm size khi không tính được ROI tại SL.",
          ratio: `Không đọc ở mode ${mode}.`,
        },
      };
    }
    return {
      lead: `${mode}: size để chạm SL thì lỗ khoảng Fix loss. Ratio không đọc. Cost chỉ là dự phòng khi không tính được ROI.`,
      drive: ["fixloss"],
      idle: ["cost", "ratio"],
      notes: {
        fixloss: "USD lỗ khi chạm SL. Đây là ô quyết định size.",
        cost: "Không phải size thật, trừ khi không tính được ROI tại SL.",
        ratio: `Không đọc ở mode ${mode}.`,
      },
    };
  }
  return {
    lead: "FIX: volume = Cost × đòn bẩy long. Ratio và Fix loss không đọc.",
    drive: ["cost"],
    idle: ["ratio", "fixloss"],
    notes: {
      cost: "USD ký quỹ. Volume = số này × đòn bẩy long.",
      ratio: "Không đọc ở mode FIX.",
      fixloss: "Chỉ dùng khi mode LOSS hoặc RR.",
    },
    showVolume: true,
  };
}

function slLead(type) {
  const name = String(type || "").toUpperCase();
  if (DYNAMIC_SL.includes(name)) return `${name}: khung nến và Period quyết định giá SL.`;
  if (name === "FOLLOWSIGNAL") return "FOLLOWSIGNAL: giá SL theo signal. Khung nến và Period không dùng.";
  return `${name || "SL"}: mốc cắt lỗ là ô SL. Khung nến và Period không dùng cho type này.`;
}

function tpLead(type) {
  switch (type) {
    case "FIX":
      return "FIX: TP percent là % lãi. 0.2 = 20%.";
    case "ATR":
      return "ATR: TP percent là số lần ATR, ví dụ 1.2, 2, 3.";
    case "TRAILING":
      return "TRAILING: gồng theo lời. SP, Trigger và R nằm ở tab Nâng cao.";
    case "FOLLOWSIGNAL":
      return "FOLLOWSIGNAL: mốc TP lấy theo signal.";
    case "STOPLOSS":
      return "STOPLOSS: mốc TP lấy theo SL.";
    case "HYBRID":
    case "ENTRY_STYLE":
    case "ROSE":
      return `${type}: dùng mẫu riêng. TP percent vẫn là các mốc chốt.`;
    default:
      return "TP percent là các mốc chốt, cách nhau bằng dấu phẩy.";
  }
}

function openLead(type) {
  if (OPEN_WAITS.includes(type)) return `${type}: Spread là khoảng giá chấp nhận, Wait là số phút chờ khớp.`;
  if (type === "FOLLOWSIGNAL") return "FOLLOWSIGNAL: kiểu vào theo signal. Spread và Wait không tự giữ lệnh market.";
  return "MARKET: vào ngay. Spread và Wait không giữ lệnh.";
}

function trailingLead(type) {
  if (!type || type === "FIX") return "FIX: SP, Trigger và R là % lãi. SP phải nhỏ hơn Trigger.";
  if (type === "ATR") return "ATR: SP, Trigger và R là số lần ATR.";
  if (["TP1", "TP2", "TP3", "TP4"].includes(type)) return `${type}: chờ chạm mốc TP đó rồi mới gồng.`;
  if (type === "STOPLOSS") return "STOPLOSS: khoảng gồng bám theo SL.";
  if (type === "ROSE") return "ROSE: mẫu gồng riêng. SP và Trigger vẫn là mốc.";
  return `${type}: đơn vị của SP và Trigger xem ở dấu ?.`;
}

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  return `${text}$`;
}

function joinList(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function withCurrent(options, current) {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

const HelpUi = createContext({ help: false, editing: false });

function Hint({ text }) {
  const { help } = useContext(HelpUi);
  if (!help || !text) return null;
  return (
    <button
      type="button"
      className="hint-mark"
      data-hint={text}
      aria-label={text}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      ?
    </button>
  );
}

function FieldNote({ hint, note }) {
  const { help, editing } = useContext(HelpUi);
  return (
    <>
      {note ? <small className="field-note">{note}</small> : null}
      {help && editing && hint && hint !== note ? <small className="field-hint">{hint}</small> : null}
    </>
  );
}

function FieldName({ label, hint, badge }) {
  return (
    <span className="field-name">
      {label}
      {badge ? <span className="unused-badge">{badge}</span> : null}
      <Hint text={hint} />
    </span>
  );
}

function Check({ label, checked, onChange, disabled, hint, note }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span>
        <FieldName label={label} hint={hint} />
        <FieldNote hint={hint} note={note} />
      </span>
    </label>
  );
}

function Num({ label, value, onChange, disabled, hint, note, badge }) {
  return (
    <label>
      <FieldName label={label} hint={hint} badge={badge} />
      <input type="number" step="any" value={value ?? ""} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      <FieldNote hint={hint} note={note} />
    </label>
  );
}

function Select({ label, value, options, onChange, disabled, hint, note }) {
  const choices = withCurrent(options, value);
  return (
    <label>
      <FieldName label={label} hint={hint} />
      <select value={value || ""} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {choices.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <FieldNote hint={hint} note={note} />
    </label>
  );
}

function Text({ label, value, onChange, disabled, placeholder, hint, note, badge }) {
  return (
    <label className="span-2">
      <FieldName label={label} hint={hint} badge={badge} />
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      <FieldNote hint={hint} note={note} />
    </label>
  );
}

function Section({ title, children, stack = false }) {
  const group = useContext(LabContext);
  if (group && !LAB_GROUPS.find((item) => item.id === group)?.sections.includes(title)) return null;
  return (
    <fieldset className="config-section">
      <legend>{title}</legend>
      <div className={stack ? "config-stack" : "config-fields"}>{children}</div>
    </fieldset>
  );
}

const VOLUME_META = {
  cost: {
    label: "Cost ($)",
    hint: "USD ký quỹ khi mode FIX. Volume hiển thị = cost × đòn bẩy long.",
  },
  ratio: {
    label: "Ratio",
    hint: "Tỷ lệ ví khi mode RATIO. Cost ≈ ví × ratio / đòn bẩy long.",
  },
  fixloss: {
    label: "Fix loss ($)",
    hint: "USD lỗ mục tiêu khi chạm SL, cho mode LOSS và RR. Để 0 thì bot lấy Max loss.",
  },
};

function VolumeField({ id, form, onChange, disabled, note }) {
  const meta = VOLUME_META[id];
  return (
    <Num label={meta.label} value={form[id]} onChange={onChange} disabled={disabled} hint={meta.hint} note={note} />
  );
}

export default function AccountConfigPage({ experimental = false }) {
  const { username = "", env = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const copyButtonRef = useRef(null);
  const saveLock = useRef(false);
  const [group, setGroup] = useState("operation");
  const [review, setReview] = useState(false);
  const { user } = useAuth();
  const [openedBot, setOpenedBot] = useState(null);
  const canEdit = user?.role === "admin" ? can(user, CONFIG_EDIT) : canEditResource(user, CONFIG_EDIT, openedBot);
  const canViewSignalHistory = can(user, SIGNALS_HISTORY);
  const canViewStatistics = can(user, STATISTICS_VIEW);
  const canViewPositions = can(user, POSITIONS_VIEW);
  const [form, setForm] = useState(null);
  const [lists, setLists] = useState({});
  const [snapshot, setSnapshot] = useState(null);
  const [editing, setEditing] = useState(false);
  const [help, setHelp] = useState(!!experimental);
  const [panel, setPanel] = useState("basic");
  const copyOpen = params.get("copy") === "1";
  const [bots, setBots] = useState([]);
  const [copyUser, setCopyUser] = useState(username);
  const [copyName, setCopyName] = useState("");
  const [copyMode, setCopyMode] = useState("new");
  const [renameEnv, setRenameEnv] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [signalSuggestions, setSignalSuggestions] = useState([]);
  const [syncOptions, setSyncOptions] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [applyState, setApplyState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const disabled = !editing || busy;
  const changes = configChanges(snapshot, form, lists);
  useLeaveGuard(experimental ? editing && changes.length > 0 : editing, "Rời trang sẽ bỏ các thay đổi config chưa lưu.");
  useEscape(copyOpen, closeCopy);

  function applyConfig(config) {
    setForm(config);
    setLists({
      signals: joinList(config.signals),
      blacklist: joinList(config.blacklist),
      whitelist: joinList(config.whitelist),
      symbolTypes: joinList(config.symbolTypes),
      symbolTypesDeny: joinList(config.symbolTypesDeny),
      filters: joinList(config.filters),
      tpPercent: joinList(config.tpPercent),
      syncExcept: joinList(config.syncExcept),
    });
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setForm(null);
    setSnapshot(null);
    setError("");
    setSaved("");
    setApplyState(null);
    setReview(false);
    setGroup("operation");
    setEditing(false);
    setPanel("basic");
    setBusy(false);
    api(`/api/bots/${encodeURIComponent(username)}/configs/${encodeURIComponent(env)}`, { signal: controller.signal })
      .then((data) => {
        if (!cancelled) applyConfig(data.config);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [username, env]);

  useEffect(() => {
    if (user?.role === "admin") return undefined;
    let cancelled = false;
    const controller = new AbortController();
    api(`/api/bots/${encodeURIComponent(username)}`, { signal: controller.signal })
      .then((data) => {
        if (!cancelled) setOpenedBot(data.bot || null);
      })
      .catch(() => {
        if (!cancelled) setOpenedBot(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [user?.role, username]);

  useEffect(() => {
    if (!experimental || !can(user, CONFIG_VIEW)) {
      setSignalSuggestions([]);
      setSyncOptions([]);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const scope = user?.scopes?.[CONFIG_VIEW] === "all" || user?.role === "admin" ? "all" : "mine";
    Promise.all([
      api("/api/signal-config", { signal: controller.signal }).catch(() => null),
      api(`/api/bots/assigned-configs?scope=${scope}`, { signal: controller.signal }).catch(() => null),
    ]).then(([signalData, assigned]) => {
      if (cancelled) return;
      const usage = signalData?.usage || [];
      const channels = (signalData?.channels || []).map((row) => row.name).filter(Boolean);
      const merged = new Map();
      for (const row of usage) {
        if (row?.signal) merged.set(row.signal, row);
      }
      for (const name of channels) {
        if (!merged.has(name)) merged.set(name, { signal: name, configs: 0 });
      }
      setSignalSuggestions([...merged.values()].sort((a, b) => String(a.signal).localeCompare(String(b.signal))));
      const rows = [];
      for (const row of assigned?.users || []) {
        for (const cfg of row.configs || []) {
          const envName = String(cfg?.env || "").trim();
          if (!envName || (row.username === username && envName === env)) continue;
          rows.push({ username: row.username, env: envName });
        }
      }
      rows.sort((a, b) => a.env.localeCompare(b.env) || a.username.localeCompare(b.username));
      setSyncOptions(rows);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [experimental, user, username, env]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved("");
  }

  function setList(key, value) {
    setLists((prev) => ({ ...prev, [key]: value }));
    setSaved("");
  }

  const volume =
    form && Number.isFinite(Number(form.cost)) && Number.isFinite(Number(form.leverage))
      ? Number(form.cost) * Number(form.leverage)
      : null;

  async function onSubmit(event) {
    event.preventDefault();
    if (!canEdit || !editing || !form || saveLock.current || (experimental && !changes.length)) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const data = await api(`/api/bots/${encodeURIComponent(username)}/configs/${encodeURIComponent(env)}`, {
        method: "PATCH",
        body: experimental ? changedPatch(changes) : configPayload(form, lists),
      });
      applyConfig(data.config);
      setEditing(false);
      setReview(false);
      setSnapshot(null);
      let apply = data.apply || null;
      setApplyState(apply);
      setSaved(applyStatusLabel(apply));
      if (apply?.requestId && !apply.terminal) {
        apply = await waitForApply(username, apply.requestId);
        if (apply) {
          setApplyState(apply);
          setSaved(applyStatusLabel(apply));
        }
      }
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  async function retryApply() {
    if (!applyState?.requestId) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(
        `/api/bots/${encodeURIComponent(username)}/accounts/${encodeURIComponent(env)}/commands/${encodeURIComponent(applyState.requestId)}/retry`,
        { method: "POST", body: {} }
      );
      let apply = data.command || null;
      setApplyState(apply);
      setSaved(applyStatusLabel(apply));
      if (apply?.requestId && !apply.terminal) {
        apply = await waitForApply(username, apply.requestId);
        if (apply) {
          setApplyState(apply);
          setSaved(applyStatusLabel(apply));
        }
      }
    } catch (err) {
      setError(err.message || "Thử lại thất bại");
    } finally {
      setBusy(false);
    }
  }

  function closeCopy() {
    if (location.state?.layer) navigate(-1);
    else {
      const next = new URLSearchParams(location.search);
      next.delete("copy");
      const search = next.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true, state: location.state });
    }
    copyButtonRef.current?.focus();
  }

  function startEdit() {
    setSnapshot({ form: { ...form }, lists: { ...lists } });
    setEditing(true);
    setError("");
    setReview(false);
    setSaved("");
    if (copyOpen) closeCopy();
  }

  function onSave() {
    document.getElementById("config-form")?.requestSubmit();
  }

  function cancelEdit() {
    if (snapshot) {
      setForm(snapshot.form);
      setLists(snapshot.lists);
    }
    setEditing(false);
    setError("");
    setReview(false);
    setSnapshot(null);
  }

  async function onDelete() {
    if (!canEdit) return;
    if (!window.confirm(`Xoá config ${env} khỏi user ${username}? Bản ghi account config cũng bị xoá nếu không còn user nào giữ.`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/bots/${encodeURIComponent(username)}/accounts/${encodeURIComponent(env)}`, { method: "DELETE" });
      navigate(experimental ? "/config-lab" : `/bots/${encodeURIComponent(username)}`, { replace: true });
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
      setBusy(false);
    }
  }

  async function openCopy(event) {
    if (copyOpen) return;
    copyButtonRef.current = event?.currentTarget || copyButtonRef.current;
    const next = new URLSearchParams(location.search);
    next.set("copy", "1");
    navigate(
      { pathname: location.pathname, search: `?${next}` },
      { state: { ...(location.state || {}), layer: (location.state?.layer || 0) + 1 } }
    );
    setCopyName("");
    setCopyUser(username);
    setCopyMode("new");
    setError("");
    try {
      const data = await api("/api/bots");
      setBots(data.bots || []);
    } catch (err) {
      setError(err.message || "Không tải được danh sách user");
    }
  }

  async function onCopy(event) {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(`/api/bots/${encodeURIComponent(username)}/configs/${encodeURIComponent(env)}/copy`, {
        method: "POST",
        body: { username: copyUser, env: copyName, mode: experimental ? copyMode : "new" },
      });
      let apply = data.apply || null;
      if (apply?.requestId && !apply.terminal) {
        apply = await waitForApply(data.username, apply.requestId);
      }
      if (apply) setSaved(applyStatusLabel(apply));
      navigate(experimental ? `/config-lab/${encodeURIComponent(data.username)}/${encodeURIComponent(data.env)}` : `/bots/${encodeURIComponent(data.username)}/accounts/${encodeURIComponent(data.env)}`, { replace: true });
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
      setBusy(false);
    }
  }

  async function onRename(event) {
    event.preventDefault();
    if (!canEdit || !experimental) return;
    const next = String(renameEnv || "").trim().toUpperCase();
    if (!next || next === env) return;
    if (!window.confirm(`Đổi tên config ${env} → ${next} trên user ${username}?`)) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(`/api/bots/${encodeURIComponent(username)}/accounts/${encodeURIComponent(env)}`, {
        method: "PATCH",
        body: { env: next },
      });
      let apply = data.apply || null;
      if (apply?.requestId && !apply.terminal) {
        apply = await waitForApply(username, apply.requestId);
      }
      navigate(`/config-lab/${encodeURIComponent(username)}/${encodeURIComponent(next)}`, {
        replace: true,
        state: location.state,
      });
      if (apply) setSaved(applyStatusLabel(apply));
    } catch (err) {
      setError(err.message || "Đổi tên thất bại");
      setBusy(false);
    }
  }

  const volumeView = form ? describeVolume(form) : null;
  const slDynamic = DYNAMIC_SL.includes(String(form?.slType || "").toUpperCase());
  const lossUsesMax =
    (form?.mode === "LOSS" || form?.mode === "RR") && slDynamic && !(Math.abs(Number(form?.fixloss)) > 0);

  return (
    <section className={`${editing ? "config-screen is-editing" : "config-screen"}${experimental ? " config-lab" : ""}`}>
      {experimental ? <LabHeader username={username} env={env} form={form} returnTo={location.state?.labReturnTo} signals={lists.signals || ""} canHistory={canViewSignalHistory} canStatistics={canViewStatistics} canPositions={canViewPositions} /> : null}
      <header className={`page-head config-head${experimental ? " lab-editor-toolbar" : ""}`}>
        <div>
          {!experimental ? <Crumbs
            items={[
              { label: "Bot", to: location.state?.returnTo || "/bots" },
              { label: username, to: location.state?.listTo || `/bots/${encodeURIComponent(username)}`, state: { returnTo: location.state?.returnTo || "" } },
              { label: env },
            ]}
            returnTo={location.state?.returnTo || ""}
          /> : null}
          {!experimental ? <h1>{env}</h1> : null}
          {editing && !experimental ? <p className="dirty-note muted">Có thay đổi chưa lưu.</p> : null}
          {help ? (
            <p className="muted">{experimental
              ? "Help bật: gợi ý hiện dưới từng mục theo nhóm. Lưu Mongo xong bot nhận qua MQTT — xem thanh dưới cùng để biết đã đồng bộ chưa."
              : "Trỏ dấu ? để xem gợi ý. Bấm Sửa thì gợi ý hiện dưới từng mục. Tab Cơ bản là cách vào lệnh. Tab Nâng cao là lọc, gồng, copy và sync. Lưu xong hệ thống tự áp dụng lên bot qua MQTT."}</p>
          ) : null}
          {saved && !experimental ? <p className="muted">{saved}</p> : null}
          {!experimental && applyState && ["failed", "expired"].includes(applyState.status) && applyState.terminal ? (
            <p>
              <button type="button" className="ghost" onClick={retryApply} disabled={busy}>
                Thử áp dụng lại
              </button>
            </p>
          ) : null}
        </div>
        <div className="config-toolbar">
          <label className="check help-toggle">
            <input type="checkbox" checked={help} onChange={(event) => setHelp(event.target.checked)} />
            <span>Help</span>
          </label>
          {canEdit ? (
            <>
            {editing ? (
              <button type="button" key="save" className="config-save" onClick={onSave} disabled={busy || (experimental && !changes.length)}>
                {experimental ? "Lưu và áp dụng" : "Lưu"}
              </button>
            ) : (
              <button type="button" key="edit" onClick={startEdit} disabled={busy || !form}>
                Sửa
              </button>
            )}
            {editing ? (
              <button type="button" className="ghost config-cancel" onClick={cancelEdit} disabled={busy}>
                Huỷ
              </button>
            ) : null}
            {experimental ? (
              <button type="button" className="ghost" onClick={() => { setRenameOpen((value) => !value); setRenameEnv(env); }} disabled={busy || editing}>
                Đổi tên
              </button>
            ) : null}
            <button type="button" className="ghost" ref={copyButtonRef} onClick={openCopy} disabled={busy || editing}>
              Copy
            </button>
            <button type="button" className="danger" onClick={onDelete} disabled={busy || editing}>
              Xoá
            </button>
            </>
          ) : null}
        </div>
        {!experimental && canViewSignalHistory ? (
          <Link className="ghost link-btn" to={signalContextPath("history", username, env, lists.signals)}>
            Lịch sử signal
          </Link>
        ) : null}
        {!experimental ? <Link className="ghost link-btn" to={signalContextPath("stats", username, env, lists.signals)}>
          Lý do bỏ qua
        </Link> : null}
        {!experimental && canViewStatistics ? (
          <Link className="ghost link-btn" to={`/signals?view=statics&username=${encodeURIComponent(username)}&env=${encodeURIComponent(env)}`}>
            Account Static
          </Link>
        ) : null}
      </header>
      {experimental && renameOpen && canEdit ? (
        <form className="card config-copy lab-rename" onSubmit={onRename}>
          <label>
            Tên mới
            <input value={renameEnv} onChange={(event) => setRenameEnv(event.target.value.toUpperCase())} required disabled={busy} />
          </label>
          <button type="submit" disabled={busy || !renameEnv || renameEnv === env}>Đổi tên</button>
          <button type="button" className="ghost" onClick={() => setRenameOpen(false)} disabled={busy}>Đóng</button>
        </form>
      ) : null}
      {copyOpen && canEdit ? (
        <form className="card config-copy" onSubmit={onCopy}>
          <label>
            User nhận
            <select value={copyUser} onChange={(event) => setCopyUser(event.target.value)} disabled={busy}>
              {(bots.some((bot) => bot.username === copyUser) ? bots : [{ username: copyUser }, ...bots]).filter((bot) => canEditResource(user, CONFIG_EDIT, bot)).map((bot) => (
                <option key={bot.username} value={bot.username}>
                  {bot.username}
                </option>
              ))}
            </select>
          </label>
          <label>
            {experimental && copyMode === "replace" ? "Tên config đích" : "Tên config mới"}
            <input value={copyName} onChange={(event) => setCopyName(event.target.value.toUpperCase())} required disabled={busy} />
          </label>
          {experimental ? (
            <label>
              Mode
              <select value={copyMode} onChange={(event) => setCopyMode(event.target.value)} disabled={busy}>
                {COPY_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
              <span className="muted">{COPY_MODES.find((mode) => mode.id === copyMode)?.note}</span>
            </label>
          ) : null}
          <button type="submit" disabled={busy}>
            {experimental && copyMode === "replace" ? "Ghi đè" : experimental && copyMode === "sync" ? "Tạo và sync" : "Tạo bản sao"}
          </button>
          <button type="button" className="ghost" onClick={closeCopy} disabled={busy}>
            Đóng
          </button>
        </form>
      ) : null}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {form ? (
        <HelpUi.Provider value={{ help, editing }}>
        <LabContext.Provider value={experimental ? group : null}>
        <LabLayout enabled={experimental} group={group} setGroup={setGroup} form={form} lists={lists} changes={changes} volumeLead={volumeView.lead} editing={editing}>
        {!experimental ? <div className="config-tabs" role="tablist" aria-label="Nhóm cấu hình">
          <button type="button" role="tab" aria-selected={panel === "basic"} onClick={() => setPanel("basic")}>
            Cơ bản
          </button>
          <button type="button" role="tab" aria-selected={panel === "advanced"} onClick={() => setPanel("advanced")}>
            Nâng cao
          </button>
        </div> : null}
        <form id="config-form" className="card config-form" onSubmit={onSubmit}>
          {experimental || panel === "basic" ? (
            <>
          <Section title="Chạy lệnh">
            <label>
              <FieldName label="Live / Paper" hint="Paper không gửi lệnh lên sàn. Live gửi lệnh thật." />
              <select value={form.paper ? "PAPER" : "LIVE"} onChange={(event) => setField("paper", event.target.value === "PAPER")} disabled={disabled}>
                <option value="LIVE">Live — gửi lệnh lên sàn</option>
                <option value="PAPER">Paper — đánh giấy</option>
              </select>
              <FieldNote hint="Paper không gửi lệnh lên sàn. Live gửi lệnh thật." note={form.paper ? "Đang đánh giấy, không gửi lệnh lên sàn." : "Đang Live, lệnh gửi lên sàn."} />
            </label>
            <Check label="On" checked={form.on} onChange={(value) => setField("on", value)} disabled={disabled} hint="Bật thì account nhận signal mới. Tắt thì bỏ qua." />
            <Check label="Long" checked={form.long} onChange={(value) => setField("long", value)} disabled={disabled} hint="Cho phép vào lệnh LONG." />
            <Check label="Short" checked={form.short} onChange={(value) => setField("short", value)} disabled={disabled} hint="Cho phép vào lệnh SHORT." />
            <Check label="Invert" checked={form.invert} onChange={(value) => setField("invert", value)} disabled={disabled} hint="Đảo chiều signal: LONG thành SHORT và ngược lại." />
            <Check label="Monitor" checked={form.monitor} onChange={(value) => setField("monitor", value)} disabled={disabled} hint="Theo dõi SL, TP và trailing sau khi mở lệnh." />
          </Section>
          <Section title="Signal">
            {experimental ? <SignalTags value={lists.signals || ""} onChange={(value) => setList("signals", value)} disabled={disabled} suggestions={signalSuggestions} /> : (
            <Text label="Signal" value={lists.signals || ""} onChange={(value) => setList("signals", value)} disabled={disabled} placeholder="SIGNAL_A, BULL" hint="Kênh signal được nhận, cách nhau bằng dấu phẩy. Rỗng thì không nhận kênh nào." />
            )}
          </Section>
          <Section title="Cách tính vốn" stack>
            <div className="mode-pick">
              <Select label="Mode" value={form.mode} options={MODES} onChange={(value) => setField("mode", value)} disabled={disabled} hint="FIX: volume = cost × đòn bẩy long. RATIO: cost lấy theo tỷ lệ ví. RISK: theo risk lệnh. LOSS và RR: size để chạm SL lỗ khoảng Fix loss. sl chỉ đặt giá cắt lỗ. Lưu xong tự áp dụng lên bot." />
            </div>
            <p className="mode-lead">{volumeView.lead}</p>
            <div className="mode-box">
              <p className="group-label">Quyết định size</p>
              <div className="field-grid">
                {volumeView.drive.map((id) => (
                  <VolumeField key={id} id={id} form={form} onChange={(value) => setField(id, value)} disabled={disabled} note={volumeView.notes[id]} />
                ))}
              </div>
            </div>
            <details className="idle-box" open={experimental ? undefined : true}>
              <summary className="group-label">Không quyết định size ở mode này</summary>
              <div className="field-grid">
                {volumeView.idle.map((id) => (
                  <VolumeField key={id} id={id} form={form} onChange={(value) => setField(id, value)} disabled={disabled} note={volumeView.notes[id]} />
                ))}
              </div>
            </details>
            <div>
              <p className="group-label">Đòn bẩy — mọi mode</p>
              <div className="field-grid">
                <Num label="Đòn bẩy long" value={form.leverage} onChange={(value) => setField("leverage", value)} disabled={disabled} hint="LONG_LEVERAGE dùng khi vào LONG." />
                <Num label="Đòn bẩy short" value={form.shortLeverage} onChange={(value) => setField("shortLeverage", value)} disabled={disabled} hint="SHORT_LEVERAGE dùng khi vào SHORT." />
                <Num label="Level" value={form.level} onChange={(value) => setField("level", value)} disabled={disabled} hint="FIX_LEVERAGE, đòn bẩy mặc định khi lệnh không chỉ định level." note="Đòn bẩy khi lệnh không ghi level. Không nằm trong công thức volume." />
              </div>
            </div>
            {volumeView.showVolume ? <p className="muted">Volume vào lệnh: {money(volume)} (Cost × đòn bẩy long).</p> : null}
          </Section>
          <Section title="Giới hạn lệnh">
            <Num label="Max position" value={form.maxPosition} onChange={(value) => setField("maxPosition", value)} disabled={disabled} hint="Số lệnh đang mở tối đa. Đủ rồi thì bỏ signal mới." />
            <Select label="Open type" value={form.openType} options={OPEN_TYPES} onChange={(value) => setField("openType", value)} disabled={disabled} hint="MARKET vào ngay. LIMIT và STOP chờ giá. FOLLOWSIGNAL theo kiểu của signal." />
            <p className="field-note span-all">{openLead(form.openType)}</p>
            <Num label="Spread" value={form.spread} onChange={(value) => setField("spread", value)} disabled={disabled} hint="Khoảng giá chấp nhận khi vào. 0.05 = 5%." note={OPEN_WAITS.includes(form.openType) ? "Khoảng giá khi chờ khớp." : "Không giữ lệnh ở kiểu này."} />
            <Num label="Wait (phút)" value={form.wait} onChange={(value) => setField("wait", value)} disabled={disabled} hint="Số phút chờ lệnh limit. Bot đổi thành giây bằng cách nhân 60." note={OPEN_WAITS.includes(form.openType) ? "Số phút chờ khớp." : "Không chờ lệnh ở kiểu này."} />
            <Num label="Risk" value={form.risk} onChange={(value) => setField("risk", value)} disabled={disabled} hint="Ngưỡng risk của signal. LONG bị chặn nếu risk signal nhỏ hơn số này. SHORT bị chặn nếu risk signal lớn hơn. 0 là tắt." note="Ngưỡng chặn signal. Không phải hệ số của mode RISK." />
            <Num label="Mark" value={form.mark} onChange={(value) => setField("mark", value)} disabled={disabled} hint="Mốc nhân volume. Lệnh truyền mark thì cost nhân mark rồi chia mốc này." />
          </Section>
          <Section title="Cắt lỗ">
            <Select label="SL type" value={form.slType} options={SL_TYPES} onChange={(value) => setField("slType", value)} disabled={disabled} hint="Cách đặt giá cắt lỗ. ATR = hệ số × ATR. HYBRID và ENTRY_STYLE dùng SL candle với Period." />
            <p className="field-note span-all">{slLead(form.slType)}</p>
            {slDynamic ? (
              <>
                <Select label="SL candle" value={form.slCandle} options={CANDLES} onChange={(value) => setField("slCandle", value)} disabled={disabled} hint="Khung nến cho ATR, EMA, HYBRID và ENTRY_STYLE." note="Đang dùng cho SL type này." />
                <Num label="Period" value={form.slPeriod} onChange={(value) => setField("slPeriod", value)} disabled={disabled} hint="Số nến tính ATR hoặc EMA. Các loại dùng ATR hoặc EMA dùng chung số này." note="Số nến tính giá SL." />
              </>
            ) : (
              <div className="idle-box span-all">
                <p className="group-label">Không dùng cho SL type này</p>
                <div className="field-grid">
                  <Select label="SL candle" value={form.slCandle} options={CANDLES} onChange={(value) => setField("slCandle", value)} disabled={disabled} hint="Khung nến cho ATR, EMA, HYBRID và ENTRY_STYLE." note="Không đọc khi SL type không lấy giá từ nến." />
                  <Num label="Period" value={form.slPeriod} onChange={(value) => setField("slPeriod", value)} disabled={disabled} hint="Số nến tính ATR hoặc EMA. Các loại dùng ATR hoặc EMA dùng chung số này." note="Không đọc khi SL type không lấy giá từ nến." />
                </div>
              </div>
            )}
            <Num label="SL" value={form.sl} onChange={(value) => setField("sl", value)} disabled={disabled} hint="Mốc cắt lỗ chính. % ROI thì số âm là lỗ, ví dụ -0.3. ATR thì là số lần ATR, ví dụ 1.5." />
            <Num label="SLI" value={form.sli} onChange={(value) => setField("sli", value)} disabled={disabled} hint="Mốc cắt lỗ phụ, bot dùng làm stopPrice." />
            <Num label="SL2" value={form.sl2} onChange={(value) => setField("sl2", value)} disabled={disabled} hint="Mốc cắt lỗ thứ hai. Khi SL type là ATR thì giá SL2 lấy cùng SL chính." />
            <Num label="SL time (giây)" value={form.slTime} onChange={(value) => setField("slTime", value)} disabled={disabled} hint="Số giây sau khi mở lệnh, monitor mới được dời hoặc gửi lại SL." />
            <Num label="Max loss" value={form.maxLoss} onChange={(value) => setField("maxLoss", value)} disabled={disabled} hint="Trần lỗ. Nhỏ hơn 1 là tỷ lệ ví, từ 1 là USD. Mode LOSS/RR chưa có Fix loss thì dùng số này. Sync không nhân max loss." note={lossUsesMax ? "Đang là USD lỗ mục tiêu vì Fix loss để 0." : undefined} />
            <Check label="SL theo position" checked={form.slPosition} onChange={(value) => setField("slPosition", value)} disabled={disabled} hint="Cờ SL.POSITION. Lệnh tay có slp cũng bật cờ này trên SL của lệnh đó." />
          </Section>
          <Section title="Chốt lời">
            <Select label="TP type" value={form.tpType} options={TP_TYPES} onChange={(value) => setField("tpType", value)} disabled={disabled} hint="FIX là % lãi. ATR là số lần ATR. TRAILING gồng. FOLLOWSIGNAL theo TP của signal. STOPLOSS lấy theo SL. HYBRID và ENTRY_STYLE dùng mẫu riêng." />
            <p className="field-note span-all">{tpLead(form.tpType)}</p>
            <Text label="TP percent" value={lists.tpPercent || ""} onChange={(value) => setList("tpPercent", value)} disabled={disabled} placeholder="0.1, 0.2" hint="Các mốc chốt, cách nhau bằng dấu phẩy. FIX: 0.2 = 20% lãi. ATR: 1.2, 2, 3 là số lần ATR." />
            <Num label="Close" value={form.tpClose} onChange={(value) => setField("tpClose", value)} disabled={disabled} hint="Tỷ lệ volume chốt mỗi TP. 0.4 = 40%. Muốn Hold gồng phần dư thì để nhỏ hơn 1." />
            <Num label="TP time (giây)" value={form.tpTime} onChange={(value) => setField("tpTime", value)} disabled={disabled} hint="Số giây chờ trước khi xử lý TP." />
            <Check label="Hold" checked={form.tpHold} onChange={(value) => setField("tpHold", value)} disabled={disabled} hint="Từ 2 TP: TP cuối chỉ chốt Close × phần còn lại, phần dư gồng. Đúng 1 TP thì luôn chốt hết." />
          </Section>
            </>
          ) : null}
          {experimental || panel === "advanced" ? (
            <>
          <Section title="Lọc lệnh">
            <Check label="Whitelist mode" checked={form.wl} onChange={(value) => setField("wl", value)} disabled={disabled} hint="Tắt: symbol trong Blacklist bị chặn. Bật: Blacklist thành danh sách được phép, symbol không có trong đó bị bỏ." note="Tắt: Blacklist là danh sách cấm. Bật: Blacklist là danh sách được vào." />
            <Text label="Blacklist" value={lists.blacklist || ""} onChange={(value) => setList("blacklist", value)} disabled={disabled} placeholder="BTCUSDT, ETHUSDT" hint="Danh sách symbol bot thực sự xét. Whitelist mode tắt thì đây là danh sách cấm. Bật thì đây là danh sách được vào." note="Bot đọc danh sách này cùng cờ Whitelist mode." />
            <Text label="Whitelist" badge="Bot không dùng" value={lists.whitelist || ""} onChange={(value) => setList("whitelist", value)} disabled={disabled} hint="Mảng whitelist lưu riêng. Bot đang dùng Blacklist cùng cờ Whitelist mode, không đọc mảng này khi lọc lệnh." />
            <p className="unused-note span-all">Bot không đọc ô Whitelist khi lọc lệnh. Symbol được xét qua Blacklist và cờ Whitelist mode.</p>
            <Text label="Symbol types" value={lists.symbolTypes || ""} onChange={(value) => setList("symbolTypes", value)} disabled={disabled} placeholder={SYMBOL_TYPES.join(", ")} hint="Chỉ nhận nhóm vốn hoá. Rỗng = tất cả. MEGA ≥10B, BLUECHIP ≥1B, LARGE ≥500M, MIDCAP ≥150M, SMALLCAP ≥50M, MICRO ≥20M, SHIT <20M." />
            <Text label="Symbol types deny" value={lists.symbolTypesDeny || ""} onChange={(value) => setList("symbolTypesDeny", value)} disabled={disabled} placeholder={SYMBOL_TYPES.join(", ")} hint="Cấm nhóm này. Trùng với danh sách cho phép thì lệnh cấm thắng." />
            <Check label="Filter on" checked={form.filterOn} onChange={(value) => setField("filterOn", value)} disabled={disabled} hint="Sau khi đặt TP, dính một bộ lọc: đang lãi thì kéo SL về entry, chưa lãi thì đóng market." note={form.filterOn ? "Đang bật: dính một bộ lọc thì xử lý lệnh." : "Đang tắt: Filters, Chase, Blow ATR và Fomo ATR không chạy."} />
            <Text label="Filters" value={lists.filters || ""} onChange={(value) => setList("filters", value)} disabled={disabled} placeholder={FILTERS.join(", ")} hint="Dính một bộ lọc là đủ. EMA15_REVERSE bỏ qua nếu 15m, 1h hoặc 4h vẫn cùng chiều lệnh." note={form.filterOn ? undefined : "Chưa chạy vì Filter on đang tắt."} />
            <Num label="Chase %" value={form.chasePct} onChange={(value) => setField("chasePct", value)} disabled={disabled} hint="Ngưỡng đuổi giá của bộ lọc, filter_chase." note={form.filterOn ? undefined : "Chưa chạy vì Filter on đang tắt."} />
            <Num label="Blow ATR" value={form.blowAtr} onChange={(value) => setField("blowAtr", value)} disabled={disabled} hint="Ngưỡng nến blow-off, tính bằng số lần ATR." note={form.filterOn ? undefined : "Chưa chạy vì Filter on đang tắt."} />
            <Num label="Fomo ATR" value={form.fomoAtr} onChange={(value) => setField("fomoAtr", value)} disabled={disabled} hint="Ngưỡng fomo, tính bằng số lần ATR." note={form.filterOn ? undefined : "Chưa chạy vì Filter on đang tắt."} />
          </Section>
          <Section title="Trailing">
            <Check label="Trailing" checked={form.trailing} onChange={(value) => setField("trailing", value)} disabled={disabled} hint="Bật thì dời SL theo lời." note={form.trailing ? "Đang bật: dời SL theo lời." : "Đang tắt: type, SP, Trigger và R không dời SL."} />
            <Select label="Trailing type" value={form.trailingType} options={TRAILING_TYPES} onChange={(value) => setField("trailingType", value)} disabled={disabled} hint="FIX là % lãi. TP1 đến TP4 chờ chạm TP đó mới gồng. ATR là số lần ATR. HYBRID dùng type này để gồng, SP rộng theo R." />
            <p className="field-note span-all">{trailingLead(form.trailingType)}</p>
            <Num label="SP" value={form.sp} onChange={(value) => setField("sp", value)} disabled={disabled} hint="Khoảng cách SL gồng. FIX: 0.01 = 1% lãi. ATR: số lần ATR. SP phải nhỏ hơn Trigger." />
            <Num label="Trigger" value={form.trigger} onChange={(value) => setField("trigger", value)} disabled={disabled} hint="Lời cần đạt rồi mới bắt đầu gồng. FIX là % lãi. ATR là số lần ATR." />
            <Num label="R" value={form.r} onChange={(value) => setField("r", value)} disabled={disabled} hint="Mỗi lần giá đi thêm chừng này thì dời SL một bước. FIX là % lãi. ATR là số lần ATR." />
            <Check label="HP" checked={form.hp} onChange={(value) => setField("hp", value)} disabled={disabled} hint="Khi lời vượt HP trigger thì kéo SL theo đỉnh." note={form.hp ? "Đang bật: kéo SL theo đỉnh khi lời vượt HP trigger." : "Đang tắt: HP trigger, RHSL và RH không chạy."} />
            <Num label="HP trigger" value={form.hpTrigger} onChange={(value) => setField("hpTrigger", value)} disabled={disabled} hint="Ngưỡng lời để bật HP. Nhiều TP thì bot có thể gán trigger bằng TP cuối." note={form.hp ? undefined : "Chỉ chạy khi bật HP."} />
            <Num label="RHSL" value={form.rhsl} onChange={(value) => setField("rhsl", value)} disabled={disabled} hint="Kéo SL lùi so với lời hiện tại khi HP kích hoạt." note={form.hp ? undefined : "Chỉ chạy khi bật HP."} />
            <Num label="RH" value={form.rh} onChange={(value) => setField("rh", value)} disabled={disabled} hint="Bước lời thêm để dời tiếp SL kiểu HP." note={form.hp ? undefined : "Chỉ chạy khi bật HP."} />
          </Section>
          <Section title="Copy">
            <Check label="Copy" checked={form.copy} onChange={(value) => setField("copy", value)} disabled={disabled} hint="Cho phép nhận lệnh copy. Tắt thì signal copy bị bỏ." note={form.copy ? "Đang nhận lệnh copy." : "Đang tắt: signal copy bị bỏ."} />
            <Check label="Fix cost" checked={form.copyFix} onChange={(value) => setField("copyFix", value)} disabled={disabled} hint="Bật thì lệnh copy giữ volume của signal. Tắt thì volume nhân Rate và bị trần Max volume." note={form.copy ? undefined : "Chưa áp dụng vì Copy đang tắt."} />
            <Check label="DCA" checked={form.copyDca} onChange={(value) => setField("copyDca", value)} disabled={disabled} hint="Theo lệnh thêm volume của nguồn copy. Tắt thì bỏ qua." note={form.copy ? undefined : "Chưa áp dụng vì Copy đang tắt."} />
            <Check label="Follow" checked={form.copyFollow} onChange={(value) => setField("copyFollow", value)} disabled={disabled} hint="Theo lệnh đóng bớt của nguồn copy. Tắt thì không đóng theo." note={form.copy ? undefined : "Chưa áp dụng vì Copy đang tắt."} />
            <Num label="Max volume ($)" value={form.maxVolume} onChange={(value) => setField("maxVolume", value)} disabled={disabled} hint="Trần volume của lệnh copy khi không bật Fix cost." note={!form.copy ? "Chưa áp dụng vì Copy đang tắt." : form.copyFix ? "Không trần volume khi đang bật Fix cost." : undefined} />
            <Num label="Rate" value={form.copyRate} onChange={(value) => setField("copyRate", value)} disabled={disabled} hint="Tỷ lệ volume so với lệnh nguồn khi tắt Fix cost. 0.1 = 10%." note={!form.copy ? "Chưa áp dụng vì Copy đang tắt." : form.copyFix ? "Không nhân Rate khi đang bật Fix cost." : undefined} />
          </Section>
          <Section title="Sync">
            <Num label="Interval (giây)" value={form.interval} onChange={(value) => setField("interval", value)} disabled={disabled} hint="Chu kỳ monitor, tính bằng giây." />
            {experimental ? (
              <SyncSourceField value={form.syncFrom || ""} onChange={(value) => setField("syncFrom", value || "")} disabled={disabled} options={syncOptions} />
            ) : (
              <Text label="Sync from" value={form.syncFrom || ""} onChange={(value) => setField("syncFrom", value)} disabled={disabled} placeholder="Tên config gốc" hint="Config gốc. Gốc sửa bằng /sc thì nhánh bị ghi đè, trừ nhóm nằm trong Sync except." note={form.syncFrom ? undefined : "Để trống thì account này không kéo config từ gốc."} />
            )}
            <Text label="Sync except" value={lists.syncExcept || ""} onChange={(value) => setList("syncExcept", value)} disabled={disabled} placeholder={SYNC_GROUPS.join(", ")} hint="Nhóm nhánh tự giữ, không lấy từ gốc: cost, level, sl, tp, trailing, hp, open, margin, copy, on, paper, signals, blacklist." note={form.syncFrom ? undefined : "Chỉ có tác dụng khi có Sync from."} />
            <Check label="Sync scale" checked={form.syncScale} onChange={(value) => setField("syncScale", value)} disabled={disabled} hint="Bật thì nhân USD theo tỷ lệ ví nhánh trên ví gốc. Tắt thì copy đúng số USD. Max loss không nhân." note={form.syncFrom ? undefined : "Chỉ có tác dụng khi có Sync from."} />
            <Num label="Sync margin ratio" value={form.syncMarginRatio} onChange={(value) => setField("syncMarginRatio", value)} disabled={disabled} hint="Acc gốc lưu cost chia ví. Nhánh scale cost đọc số này, không gọi API của gốc." note={form.syncFrom ? undefined : "Chỉ có tác dụng khi có Sync from."} />
            <Num label="Sync wallet" value={form.syncWalletBal} onChange={(value) => setField("syncWalletBal", value)} disabled={disabled} hint="Ví gốc lúc ghi ratio. Nhánh LOSS/FIX nhân USD theo ví nhánh chia số này." note={form.syncFrom ? undefined : "Chỉ có tác dụng khi có Sync from."} />
          </Section>
          <Section title="Vận hành">
            <Check label="Auto config" checked={form.autoConfig} onChange={(value) => setField("autoConfig", value)} disabled={disabled} hint="Job định kỳ chạy backtest và ghi đè TP/SL của account này." />
            <Check label="Report profit" checked={form.reportProfit} onChange={(value) => setField("reportProfit", value)} disabled={disabled} hint="Monitor gửi báo cáo lãi khi cập nhật lời." />
            <Num label="Margin period" badge="Bot không dùng" value={form.marginPeriod} onChange={(value) => setField("marginPeriod", value)} disabled={disabled} hint="MARGIN.PERIOD, mặc định 50. Bot không dùng số này để tính volume." />
            <p className="unused-note span-all">Bot không dùng Margin period để tính volume hay vào lệnh. Ô vẫn lưu được.</p>
          </Section>
            </>
          ) : null}
        </form>
        </LabLayout>
        </LabContext.Provider>
        </HelpUi.Provider>
      ) : null}
      {experimental && editing ? <ChangeReview open={review} changes={changes} onClose={() => setReview(false)} /> : null}
      {experimental && canEdit ? <LabSaveBar editing={editing} busy={busy} count={changes.length} onEdit={startEdit} onSave={onSave} onCancel={cancelEdit} onReview={() => setReview((value) => !value)} ready={!!form && !loading} saved={saved} applyState={applyState} onRetry={retryApply} /> : null}
      {!experimental && editing && canEdit ? (
        <div className="config-savebar">
          <span className="muted">Chưa lưu</span>
          <div>
            <button type="button" onClick={onSave} disabled={busy}>Lưu</button>
            <button type="button" className="ghost" onClick={cancelEdit} disabled={busy}>Huỷ</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
