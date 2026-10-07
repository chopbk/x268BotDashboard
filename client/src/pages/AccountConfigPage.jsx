import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const CONFIG_EDIT = "config.edit";
const SIGNALS_HISTORY = "signals.history";
const STATISTICS_VIEW = "statistics.view";
const MODES = ["FIX", "RATIO", "RISK", "RR", "LOSS"];
const OPEN_TYPES = ["MARKET", "LIMIT", "STOPMARKET", "STOPLIMIT", "FOLLOWSIGNAL"];
const SL_TYPES = ["MARKET", "LIMIT", "CANDLE", "EMA", "ATR", "FOLLOWSIGNAL", "HYBRID", "ENTRY_STYLE", "ROSE"];
const CANDLES = ["1M", "5M", "15M", "30M", "1H", "4H", "12H", "1D"];
const TP_TYPES = ["FIX", "TRAILING", "FOLLOWSIGNAL", "STOPLOSS", "HYBRID", "ENTRY_STYLE", "ROSE", "ATR"];
const TRAILING_TYPES = ["FIX", "STOPLOSS", "TP1", "TP2", "TP3", "TP4", "ATR", "ROSE"];
const SYMBOL_TYPES = ["MEGA", "BLUECHIP", "LARGE", "MIDCAP", "SMALLCAP", "MICRO", "SHIT", "UNKNOWN"];
const FILTERS = ["EMA15_REVERSE", "EMA15", "BLUECHIP", "BLUE", "BLOWOFF", "BLOW", "FOMO", "MEGA_BTC15"];
const SYNC_GROUPS = ["cost", "level", "sl", "tp", "trailing", "hp", "open", "margin", "copy", "on", "paper", "signals", "blacklist", "interval"];

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

function splitList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function withCurrent(options, current) {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

function Check({ label, checked, onChange, disabled }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

function Num({ label, value, onChange, disabled, hint }) {
  return (
    <label>
      {label}
      <input type="number" step="any" value={value ?? ""} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      {hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

function Select({ label, value, options, onChange, disabled }) {
  const choices = withCurrent(options, value);
  return (
    <label>
      {label}
      <select value={value || ""} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {choices.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Text({ label, value, onChange, disabled, placeholder, hint }) {
  return (
    <label className="span-2">
      {label}
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      {hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

function Section({ title, children }) {
  return (
    <fieldset className="config-section">
      <legend>{title}</legend>
      <div className="config-fields">{children}</div>
    </fieldset>
  );
}

function optionalNumber(value) {
  if (value === "" || value == null) return undefined;
  return Number(value);
}

export default function AccountConfigPage() {
  const { username = "", env = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = can(user, CONFIG_EDIT);
  const canViewSignalHistory = can(user, SIGNALS_HISTORY);
  const canViewStatistics = can(user, STATISTICS_VIEW);
  const [form, setForm] = useState(null);
  const [lists, setLists] = useState({});
  const [snapshot, setSnapshot] = useState(null);
  const [editing, setEditing] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [bots, setBots] = useState([]);
  const [copyUser, setCopyUser] = useState(username);
  const [copyName, setCopyName] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const disabled = !editing || busy;

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
    setLoading(true);
    setEditing(false);
    setCopyOpen(false);
    setBusy(false);
    api(`/api/bots/${encodeURIComponent(username)}/configs/${encodeURIComponent(env)}`)
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
    };
  }, [username, env]);

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
    if (!canEdit || !editing || !form) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const data = await api(`/api/bots/${encodeURIComponent(username)}/configs/${encodeURIComponent(env)}`, {
        method: "PATCH",
        body: {
          on: !!form.on,
          long: !!form.long,
          short: !!form.short,
          invert: !!form.invert,
          paper: !!form.paper,
          monitor: !!form.monitor,
          wl: !!form.wl,
          autoConfig: !!form.autoConfig,
          reportProfit: !!form.reportProfit,
          signals: splitList(lists.signals),
          blacklist: splitList(lists.blacklist),
          whitelist: splitList(lists.whitelist),
          mode: form.mode,
          cost: Number(form.cost),
          leverage: Number(form.leverage),
          shortLeverage: optionalNumber(form.shortLeverage),
          level: optionalNumber(form.level),
          ratio: optionalNumber(form.ratio),
          fixloss: optionalNumber(form.fixloss),
          marginPeriod: optionalNumber(form.marginPeriod),
          openType: form.openType,
          spread: optionalNumber(form.spread),
          wait: optionalNumber(form.wait),
          risk: optionalNumber(form.risk),
          mark: optionalNumber(form.mark),
          maxPosition: optionalNumber(form.maxPosition),
          symbolTypes: splitList(lists.symbolTypes),
          symbolTypesDeny: splitList(lists.symbolTypesDeny),
          filterOn: !!form.filterOn,
          filters: splitList(lists.filters),
          chasePct: optionalNumber(form.chasePct),
          blowAtr: optionalNumber(form.blowAtr),
          fomoAtr: optionalNumber(form.fomoAtr),
          tpType: form.tpType,
          tpPercent: splitList(lists.tpPercent).map(Number),
          tpClose: optionalNumber(form.tpClose),
          tpTime: optionalNumber(form.tpTime),
          tpHold: !!form.tpHold,
          slType: form.slType,
          slCandle: form.slCandle,
          slPeriod: optionalNumber(form.slPeriod),
          sl: optionalNumber(form.sl),
          sli: optionalNumber(form.sli),
          sl2: optionalNumber(form.sl2),
          slTime: optionalNumber(form.slTime),
          maxLoss: optionalNumber(form.maxLoss),
          slPosition: !!form.slPosition,
          trailing: !!form.trailing,
          trailingType: form.trailingType,
          sp: optionalNumber(form.sp),
          trigger: optionalNumber(form.trigger),
          r: optionalNumber(form.r),
          hp: !!form.hp,
          hpTrigger: optionalNumber(form.hpTrigger),
          rhsl: optionalNumber(form.rhsl),
          rh: optionalNumber(form.rh),
          copy: !!form.copy,
          copyFix: !!form.copyFix,
          copyDca: !!form.copyDca,
          copyFollow: !!form.copyFollow,
          maxVolume: optionalNumber(form.maxVolume),
          copyRate: optionalNumber(form.copyRate),
          interval: optionalNumber(form.interval),
          syncFrom: form.syncFrom || "",
          syncExcept: splitList(lists.syncExcept),
          syncScale: !!form.syncScale,
          syncMarginRatio: optionalNumber(form.syncMarginRatio),
          syncWalletBal: optionalNumber(form.syncWalletBal),
        },
      });
      applyConfig(data.config);
      setEditing(false);
      setSnapshot(null);
      setSaved("Đã lưu. Bot đang chạy chỉ nhận config mới sau khi restart.");
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setSnapshot({ form: { ...form }, lists: { ...lists } });
    setEditing(true);
    setSaved("");
    setCopyOpen(false);
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
      navigate(`/bots/${encodeURIComponent(username)}`, { replace: true });
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
      setBusy(false);
    }
  }

  async function openCopy() {
    setCopyOpen(true);
    setCopyName("");
    setCopyUser(username);
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
        body: { username: copyUser, env: copyName },
      });
      navigate(`/bots/${encodeURIComponent(data.username)}/accounts/${encodeURIComponent(data.env)}`, { replace: true });
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
      setBusy(false);
    }
  }

  return (
    <section className="config-screen">
      <header className="page-head config-head">
        <div>
          <p>
            <Link to={`/bots/${encodeURIComponent(username)}`}>← {username}</Link>
          </p>
          <h1>{env}</h1>
          <p className="muted">Bấm Sửa để đổi thông tin. Volume = cost × đòn bẩy long. Bot nhận bản mới sau khi restart.</p>
        </div>
        {canEdit ? (
          <div className="config-toolbar">
            {editing ? (
              <button type="button" key="save" onClick={onSave} disabled={busy}>
                Lưu
              </button>
            ) : (
              <button type="button" key="edit" onClick={startEdit} disabled={busy || !form}>
                Sửa
              </button>
            )}
            {editing ? (
              <button type="button" className="ghost" onClick={cancelEdit} disabled={busy}>
                Huỷ
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={openCopy} disabled={busy || editing}>
              Copy
            </button>
            <button type="button" className="danger" onClick={onDelete} disabled={busy || editing}>
              Xoá
            </button>
          </div>
        ) : null}
        {canViewSignalHistory ? (
          <Link className="ghost link-btn" to={`/signals?username=${encodeURIComponent(username)}&env=${encodeURIComponent(env)}`}>
            Lịch sử signal
          </Link>
        ) : null}
        {canViewStatistics ? (
          <Link className="ghost link-btn" to={`/signals?view=statics&username=${encodeURIComponent(username)}&env=${encodeURIComponent(env)}`}>
            Account Static
          </Link>
        ) : null}
      </header>
      {copyOpen && canEdit ? (
        <form className="card config-copy" onSubmit={onCopy}>
          <label>
            User nhận
            <select value={copyUser} onChange={(event) => setCopyUser(event.target.value)} disabled={busy}>
              {(bots.some((bot) => bot.username === copyUser) ? bots : [{ username: copyUser }, ...bots]).map((bot) => (
                <option key={bot.username} value={bot.username}>
                  {bot.username}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tên config mới
            <input value={copyName} onChange={(event) => setCopyName(event.target.value)} required disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>
            Tạo bản sao
          </button>
          <button type="button" className="ghost" onClick={() => setCopyOpen(false)} disabled={busy}>
            Đóng
          </button>
        </form>
      ) : null}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {saved ? <p className="muted">{saved}</p> : null}
      {form ? (
        <form id="config-form" className="card config-form" onSubmit={onSubmit}>
          <Section title="Bật tắt">
            <Check label="On" checked={form.on} onChange={(value) => setField("on", value)} disabled={disabled} />
            <Check label="Long" checked={form.long} onChange={(value) => setField("long", value)} disabled={disabled} />
            <Check label="Short" checked={form.short} onChange={(value) => setField("short", value)} disabled={disabled} />
            <Check label="Invert" checked={form.invert} onChange={(value) => setField("invert", value)} disabled={disabled} />
            <Check label="Paper" checked={form.paper} onChange={(value) => setField("paper", value)} disabled={disabled} />
            <Check label="Monitor" checked={form.monitor} onChange={(value) => setField("monitor", value)} disabled={disabled} />
            <Check label="Whitelist mode" checked={form.wl} onChange={(value) => setField("wl", value)} disabled={disabled} />
            <Check label="Auto config" checked={form.autoConfig} onChange={(value) => setField("autoConfig", value)} disabled={disabled} />
            <Check label="Report profit" checked={form.reportProfit} onChange={(value) => setField("reportProfit", value)} disabled={disabled} />
          </Section>
          <Section title="Danh sách">
            <Text label="Signal" value={lists.signals || ""} onChange={(value) => setList("signals", value)} disabled={disabled} placeholder="ROSE, BULL" />
            <Text label="Blacklist" value={lists.blacklist || ""} onChange={(value) => setList("blacklist", value)} disabled={disabled} placeholder="BTCUSDT, ETHUSDT" />
            <Text label="Whitelist" value={lists.whitelist || ""} onChange={(value) => setList("whitelist", value)} disabled={disabled} />
          </Section>
          <Section title="Volume">
            <Select label="Mode" value={form.mode} options={MODES} onChange={(value) => setField("mode", value)} disabled={disabled} />
            <Num label="Cost ($)" value={form.cost} onChange={(value) => setField("cost", value)} disabled={disabled} />
            <Num label="Đòn bẩy long" value={form.leverage} onChange={(value) => setField("leverage", value)} disabled={disabled} />
            <Num label="Đòn bẩy short" value={form.shortLeverage} onChange={(value) => setField("shortLeverage", value)} disabled={disabled} />
            <Num label="Level" value={form.level} onChange={(value) => setField("level", value)} disabled={disabled} />
            <Num label="Ratio" value={form.ratio} onChange={(value) => setField("ratio", value)} disabled={disabled} />
            <Num label="Fix loss ($)" value={form.fixloss} onChange={(value) => setField("fixloss", value)} disabled={disabled} />
            <Num label="Margin period" value={form.marginPeriod} onChange={(value) => setField("marginPeriod", value)} disabled={disabled} />
            <p className="muted">Volume vào lệnh: {money(volume)}</p>
          </Section>
          <Section title="Mở lệnh">
            <Select label="Open type" value={form.openType} options={OPEN_TYPES} onChange={(value) => setField("openType", value)} disabled={disabled} />
            <Num label="Spread" value={form.spread} onChange={(value) => setField("spread", value)} disabled={disabled} hint="0.05 = 5%" />
            <Num label="Wait (phút)" value={form.wait} onChange={(value) => setField("wait", value)} disabled={disabled} />
            <Num label="Risk" value={form.risk} onChange={(value) => setField("risk", value)} disabled={disabled} />
            <Num label="Mark" value={form.mark} onChange={(value) => setField("mark", value)} disabled={disabled} />
            <Num label="Max position" value={form.maxPosition} onChange={(value) => setField("maxPosition", value)} disabled={disabled} />
            <Text label="Symbol types" value={lists.symbolTypes || ""} onChange={(value) => setList("symbolTypes", value)} disabled={disabled} placeholder={SYMBOL_TYPES.join(", ")} hint="Để trống = tất cả" />
            <Text label="Symbol types deny" value={lists.symbolTypesDeny || ""} onChange={(value) => setList("symbolTypesDeny", value)} disabled={disabled} placeholder={SYMBOL_TYPES.join(", ")} />
            <Check label="Filter on" checked={form.filterOn} onChange={(value) => setField("filterOn", value)} disabled={disabled} />
            <Text label="Filters" value={lists.filters || ""} onChange={(value) => setList("filters", value)} disabled={disabled} placeholder={FILTERS.join(", ")} />
            <Num label="Chase %" value={form.chasePct} onChange={(value) => setField("chasePct", value)} disabled={disabled} />
            <Num label="Blow ATR" value={form.blowAtr} onChange={(value) => setField("blowAtr", value)} disabled={disabled} />
            <Num label="Fomo ATR" value={form.fomoAtr} onChange={(value) => setField("fomoAtr", value)} disabled={disabled} />
          </Section>
          <Section title="Chốt lời">
            <Select label="TP type" value={form.tpType} options={TP_TYPES} onChange={(value) => setField("tpType", value)} disabled={disabled} />
            <Text label="TP percent" value={lists.tpPercent || ""} onChange={(value) => setList("tpPercent", value)} disabled={disabled} placeholder="0.1, 0.2" />
            <Num label="Close" value={form.tpClose} onChange={(value) => setField("tpClose", value)} disabled={disabled} />
            <Num label="TP time (giây)" value={form.tpTime} onChange={(value) => setField("tpTime", value)} disabled={disabled} />
            <Check label="Hold" checked={form.tpHold} onChange={(value) => setField("tpHold", value)} disabled={disabled} />
          </Section>
          <Section title="Cắt lỗ">
            <Select label="SL type" value={form.slType} options={SL_TYPES} onChange={(value) => setField("slType", value)} disabled={disabled} />
            <Select label="SL candle" value={form.slCandle} options={CANDLES} onChange={(value) => setField("slCandle", value)} disabled={disabled} />
            <Num label="Period" value={form.slPeriod} onChange={(value) => setField("slPeriod", value)} disabled={disabled} />
            <Num label="SL" value={form.sl} onChange={(value) => setField("sl", value)} disabled={disabled} />
            <Num label="SLI" value={form.sli} onChange={(value) => setField("sli", value)} disabled={disabled} />
            <Num label="SL2" value={form.sl2} onChange={(value) => setField("sl2", value)} disabled={disabled} />
            <Num label="SL time (giây)" value={form.slTime} onChange={(value) => setField("slTime", value)} disabled={disabled} />
            <Num label="Max loss" value={form.maxLoss} onChange={(value) => setField("maxLoss", value)} disabled={disabled} hint="Dưới 1 là tỷ lệ ví, từ 1 là USD" />
            <Check label="SL theo position" checked={form.slPosition} onChange={(value) => setField("slPosition", value)} disabled={disabled} />
          </Section>
          <Section title="Trailing">
            <Check label="Trailing" checked={form.trailing} onChange={(value) => setField("trailing", value)} disabled={disabled} />
            <Select label="Trailing type" value={form.trailingType} options={TRAILING_TYPES} onChange={(value) => setField("trailingType", value)} disabled={disabled} />
            <Num label="SP" value={form.sp} onChange={(value) => setField("sp", value)} disabled={disabled} />
            <Num label="Trigger" value={form.trigger} onChange={(value) => setField("trigger", value)} disabled={disabled} />
            <Num label="R" value={form.r} onChange={(value) => setField("r", value)} disabled={disabled} />
            <Check label="HP" checked={form.hp} onChange={(value) => setField("hp", value)} disabled={disabled} />
            <Num label="HP trigger" value={form.hpTrigger} onChange={(value) => setField("hpTrigger", value)} disabled={disabled} />
            <Num label="RHSL" value={form.rhsl} onChange={(value) => setField("rhsl", value)} disabled={disabled} />
            <Num label="RH" value={form.rh} onChange={(value) => setField("rh", value)} disabled={disabled} />
          </Section>
          <Section title="Copy">
            <Check label="Copy" checked={form.copy} onChange={(value) => setField("copy", value)} disabled={disabled} />
            <Check label="Fix cost" checked={form.copyFix} onChange={(value) => setField("copyFix", value)} disabled={disabled} />
            <Check label="DCA" checked={form.copyDca} onChange={(value) => setField("copyDca", value)} disabled={disabled} />
            <Check label="Follow" checked={form.copyFollow} onChange={(value) => setField("copyFollow", value)} disabled={disabled} />
            <Num label="Max volume ($)" value={form.maxVolume} onChange={(value) => setField("maxVolume", value)} disabled={disabled} />
            <Num label="Rate" value={form.copyRate} onChange={(value) => setField("copyRate", value)} disabled={disabled} hint="0.1 = 10%" />
          </Section>
          <Section title="Sync">
            <Num label="Interval (giây)" value={form.interval} onChange={(value) => setField("interval", value)} disabled={disabled} />
            <Text label="Sync from" value={form.syncFrom || ""} onChange={(value) => setField("syncFrom", value)} disabled={disabled} placeholder="Tên config gốc" />
            <Text label="Sync except" value={lists.syncExcept || ""} onChange={(value) => setList("syncExcept", value)} disabled={disabled} placeholder={SYNC_GROUPS.join(", ")} />
            <Check label="Sync scale" checked={form.syncScale} onChange={(value) => setField("syncScale", value)} disabled={disabled} />
            <Num label="Sync margin ratio" value={form.syncMarginRatio} onChange={(value) => setField("syncMarginRatio", value)} disabled={disabled} />
            <Num label="Sync wallet" value={form.syncWalletBal} onChange={(value) => setField("syncWalletBal", value)} disabled={disabled} />
          </Section>
        </form>
      ) : null}
    </section>
  );
}
