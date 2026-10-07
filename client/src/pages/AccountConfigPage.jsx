import { createContext, useContext, useEffect, useState } from "react";
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

const ShowHint = createContext(false);

function Hint({ text }) {
  if (!text) return null;
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

function HintText({ text }) {
  const open = useContext(ShowHint);
  if (!open || !text) return null;
  return <small className="field-hint">{text}</small>;
}

function FieldName({ label, hint }) {
  const open = useContext(ShowHint);
  return (
    <span className="field-name" data-hint={open ? undefined : hint || undefined}>
      {label}
      <Hint text={hint} />
    </span>
  );
}

function Check({ label, checked, onChange, disabled, hint }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span>
        <FieldName label={label} hint={hint} />
        <HintText text={hint} />
      </span>
    </label>
  );
}

function Num({ label, value, onChange, disabled, hint }) {
  return (
    <label>
      <FieldName label={label} hint={hint} />
      <input type="number" step="any" value={value ?? ""} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      <HintText text={hint} />
    </label>
  );
}

function Select({ label, value, options, onChange, disabled, hint }) {
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
      <HintText text={hint} />
    </label>
  );
}

function Text({ label, value, onChange, disabled, placeholder, hint }) {
  return (
    <label className="span-2">
      <FieldName label={label} hint={hint} />
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      <HintText text={hint} />
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
          <p className="muted">Trỏ dấu ? để xem gợi ý. Bấm Sửa thì gợi ý hiện dưới từng mục. Volume = cost × đòn bẩy long. Bot nhận bản mới sau khi restart.</p>
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
          <Link className="ghost link-btn" to="/signals">
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
        <ShowHint.Provider value={editing}>
        <form id="config-form" className="card config-form" onSubmit={onSubmit}>
          <Section title="Bật tắt">
            <Check label="On" checked={form.on} onChange={(value) => setField("on", value)} disabled={disabled} hint="Bật thì account nhận signal mới. Tắt thì bỏ qua." />
            <Check label="Long" checked={form.long} onChange={(value) => setField("long", value)} disabled={disabled} hint="Cho phép vào lệnh LONG." />
            <Check label="Short" checked={form.short} onChange={(value) => setField("short", value)} disabled={disabled} hint="Cho phép vào lệnh SHORT." />
            <Check label="Invert" checked={form.invert} onChange={(value) => setField("invert", value)} disabled={disabled} hint="Đảo chiều signal: LONG thành SHORT và ngược lại." />
            <Check label="Paper" checked={form.paper} onChange={(value) => setField("paper", value)} disabled={disabled} hint="Đánh giấy. Không gửi lệnh lên sàn." />
            <Check label="Monitor" checked={form.monitor} onChange={(value) => setField("monitor", value)} disabled={disabled} hint="Theo dõi SL, TP và trailing sau khi mở lệnh." />
            <Check label="Whitelist mode" checked={form.wl} onChange={(value) => setField("wl", value)} disabled={disabled} hint="Tắt: symbol trong Blacklist bị chặn. Bật: Blacklist thành danh sách được phép, symbol không có trong đó bị bỏ." />
            <Check label="Auto config" checked={form.autoConfig} onChange={(value) => setField("autoConfig", value)} disabled={disabled} hint="Job định kỳ chạy backtest và ghi đè TP/SL của account này." />
            <Check label="Report profit" checked={form.reportProfit} onChange={(value) => setField("reportProfit", value)} disabled={disabled} hint="Monitor gửi báo cáo lãi khi cập nhật lời." />
          </Section>
          <Section title="Danh sách">
            <Text label="Signal" value={lists.signals || ""} onChange={(value) => setList("signals", value)} disabled={disabled} placeholder="ROSE, BULL" hint="Kênh signal được nhận, cách nhau bằng dấu phẩy. Rỗng thì không nhận kênh nào." />
            <Text label="Blacklist" value={lists.blacklist || ""} onChange={(value) => setList("blacklist", value)} disabled={disabled} placeholder="BTCUSDT, ETHUSDT" hint="Danh sách symbol bot thực sự xét. Whitelist mode tắt thì đây là danh sách cấm. Bật thì đây là danh sách được vào." />
            <Text label="Whitelist" value={lists.whitelist || ""} onChange={(value) => setList("whitelist", value)} disabled={disabled} hint="Mảng whitelist lưu riêng. Bot đang dùng Blacklist cùng cờ Whitelist mode, không đọc mảng này khi lọc lệnh." />
          </Section>
          <Section title="Volume">
            <Select label="Mode" value={form.mode} options={MODES} onChange={(value) => setField("mode", value)} disabled={disabled} hint="FIX: volume = cost × đòn bẩy. RATIO: cost lấy theo tỷ lệ ví. RISK: theo risk lệnh. LOSS và RR: size để chạm SL lỗ khoảng Fix loss. sl chỉ đặt giá cắt lỗ." />
            <Num label="Cost ($)" value={form.cost} onChange={(value) => setField("cost", value)} disabled={disabled} hint="USD ký quỹ khi mode FIX. Volume hiển thị = cost × đòn bẩy long." />
            <Num label="Đòn bẩy long" value={form.leverage} onChange={(value) => setField("leverage", value)} disabled={disabled} hint="LONG_LEVERAGE dùng khi vào LONG." />
            <Num label="Đòn bẩy short" value={form.shortLeverage} onChange={(value) => setField("shortLeverage", value)} disabled={disabled} hint="SHORT_LEVERAGE dùng khi vào SHORT." />
            <Num label="Level" value={form.level} onChange={(value) => setField("level", value)} disabled={disabled} hint="FIX_LEVERAGE, đòn bẩy mặc định khi lệnh không chỉ định level." />
            <Num label="Ratio" value={form.ratio} onChange={(value) => setField("ratio", value)} disabled={disabled} hint="Tỷ lệ ví khi mode RATIO. Cost ≈ ví × ratio / đòn bẩy long." />
            <Num label="Fix loss ($)" value={form.fixloss} onChange={(value) => setField("fixloss", value)} disabled={disabled} hint="USD lỗ mục tiêu khi chạm SL, cho mode LOSS và RR. Để 0 thì bot lấy Max loss." />
            <Num label="Margin period" value={form.marginPeriod} onChange={(value) => setField("marginPeriod", value)} disabled={disabled} hint="MARGIN.PERIOD, mặc định 50. Bot không dùng số này để tính volume." />
            <p className="muted">Volume vào lệnh: {money(volume)}</p>
          </Section>
          <Section title="Mở lệnh">
            <Select label="Open type" value={form.openType} options={OPEN_TYPES} onChange={(value) => setField("openType", value)} disabled={disabled} hint="MARKET vào ngay. LIMIT và STOP chờ giá. FOLLOWSIGNAL theo kiểu của signal." />
            <Num label="Spread" value={form.spread} onChange={(value) => setField("spread", value)} disabled={disabled} hint="Khoảng giá chấp nhận khi vào. 0.05 = 5%." />
            <Num label="Wait (phút)" value={form.wait} onChange={(value) => setField("wait", value)} disabled={disabled} hint="Số phút chờ lệnh limit. Bot đổi thành giây bằng cách nhân 60." />
            <Num label="Risk" value={form.risk} onChange={(value) => setField("risk", value)} disabled={disabled} hint="Ngưỡng risk của signal. LONG bị chặn nếu risk signal nhỏ hơn số này. SHORT bị chặn nếu risk signal lớn hơn. 0 là tắt." />
            <Num label="Mark" value={form.mark} onChange={(value) => setField("mark", value)} disabled={disabled} hint="Mốc nhân volume. Lệnh truyền mark thì cost nhân mark rồi chia mốc này." />
            <Num label="Max position" value={form.maxPosition} onChange={(value) => setField("maxPosition", value)} disabled={disabled} hint="Số lệnh đang mở tối đa. Đủ rồi thì bỏ signal mới." />
            <Text label="Symbol types" value={lists.symbolTypes || ""} onChange={(value) => setList("symbolTypes", value)} disabled={disabled} placeholder={SYMBOL_TYPES.join(", ")} hint="Chỉ nhận nhóm vốn hoá. Rỗng = tất cả. MEGA ≥10B, BLUECHIP ≥1B, LARGE ≥500M, MIDCAP ≥150M, SMALLCAP ≥50M, MICRO ≥20M, SHIT <20M." />
            <Text label="Symbol types deny" value={lists.symbolTypesDeny || ""} onChange={(value) => setList("symbolTypesDeny", value)} disabled={disabled} placeholder={SYMBOL_TYPES.join(", ")} hint="Cấm nhóm này. Trùng với danh sách cho phép thì lệnh cấm thắng." />
            <Check label="Filter on" checked={form.filterOn} onChange={(value) => setField("filterOn", value)} disabled={disabled} hint="Sau khi đặt TP, dính một bộ lọc: đang lãi thì kéo SL về entry, chưa lãi thì đóng market." />
            <Text label="Filters" value={lists.filters || ""} onChange={(value) => setList("filters", value)} disabled={disabled} placeholder={FILTERS.join(", ")} hint="Dính một bộ lọc là đủ. EMA15_REVERSE bỏ qua nếu 15m, 1h hoặc 4h vẫn cùng chiều lệnh." />
            <Num label="Chase %" value={form.chasePct} onChange={(value) => setField("chasePct", value)} disabled={disabled} hint="Ngưỡng đuổi giá của bộ lọc, filter_chase." />
            <Num label="Blow ATR" value={form.blowAtr} onChange={(value) => setField("blowAtr", value)} disabled={disabled} hint="Ngưỡng nến blow-off, tính bằng số lần ATR." />
            <Num label="Fomo ATR" value={form.fomoAtr} onChange={(value) => setField("fomoAtr", value)} disabled={disabled} hint="Ngưỡng fomo, tính bằng số lần ATR." />
          </Section>
          <Section title="Chốt lời">
            <Select label="TP type" value={form.tpType} options={TP_TYPES} onChange={(value) => setField("tpType", value)} disabled={disabled} hint="FIX là % lãi. ATR và ROSE là số lần ATR. TRAILING gồng. FOLLOWSIGNAL theo TP của signal. STOPLOSS lấy theo SL. HYBRID và ENTRY_STYLE dùng mẫu riêng." />
            <Text label="TP percent" value={lists.tpPercent || ""} onChange={(value) => setList("tpPercent", value)} disabled={disabled} placeholder="0.1, 0.2" hint="Các mốc chốt, cách nhau bằng dấu phẩy. FIX: 0.2 = 20% lãi. ATR: 1.2, 2, 3 là số lần ATR." />
            <Num label="Close" value={form.tpClose} onChange={(value) => setField("tpClose", value)} disabled={disabled} hint="Tỷ lệ volume chốt mỗi TP. 0.4 = 40%. Muốn Hold gồng phần dư thì để nhỏ hơn 1." />
            <Num label="TP time (giây)" value={form.tpTime} onChange={(value) => setField("tpTime", value)} disabled={disabled} hint="Số giây chờ trước khi xử lý TP." />
            <Check label="Hold" checked={form.tpHold} onChange={(value) => setField("tpHold", value)} disabled={disabled} hint="Từ 2 TP: TP cuối chỉ chốt Close × phần còn lại, phần dư gồng. Đúng 1 TP thì luôn chốt hết." />
          </Section>
          <Section title="Cắt lỗ">
            <Select label="SL type" value={form.slType} options={SL_TYPES} onChange={(value) => setField("slType", value)} disabled={disabled} hint="Cách đặt giá cắt lỗ. ATR = hệ số × ATR. ROSE neo EMA gần hoặc entry trừ 2 ATR. HYBRID và ENTRY_STYLE dùng SL candle với Period." />
            <Select label="SL candle" value={form.slCandle} options={CANDLES} onChange={(value) => setField("slCandle", value)} disabled={disabled} hint="Khung nến cho ATR, EMA, ROSE, HYBRID và ENTRY_STYLE." />
            <Num label="Period" value={form.slPeriod} onChange={(value) => setField("slPeriod", value)} disabled={disabled} hint="Số nến tính ATR hoặc EMA. ATR và ROSE dùng chung số này." />
            <Num label="SL" value={form.sl} onChange={(value) => setField("sl", value)} disabled={disabled} hint="Mốc cắt lỗ chính. % ROI thì số âm là lỗ, ví dụ -0.3. ATR thì là số lần ATR, ví dụ 1.5." />
            <Num label="SLI" value={form.sli} onChange={(value) => setField("sli", value)} disabled={disabled} hint="Mốc cắt lỗ phụ, bot dùng làm stopPrice." />
            <Num label="SL2" value={form.sl2} onChange={(value) => setField("sl2", value)} disabled={disabled} hint="Mốc cắt lỗ thứ hai. Khi SL type là ATR thì giá SL2 lấy cùng SL chính." />
            <Num label="SL time (giây)" value={form.slTime} onChange={(value) => setField("slTime", value)} disabled={disabled} hint="Số giây sau khi mở lệnh, monitor mới được dời hoặc gửi lại SL." />
            <Num label="Max loss" value={form.maxLoss} onChange={(value) => setField("maxLoss", value)} disabled={disabled} hint="Trần lỗ. Nhỏ hơn 1 là tỷ lệ ví, từ 1 là USD. Mode LOSS/RR chưa có Fix loss thì dùng số này. Sync không nhân max loss." />
            <Check label="SL theo position" checked={form.slPosition} onChange={(value) => setField("slPosition", value)} disabled={disabled} hint="Cờ SL.POSITION. Lệnh tay có slp cũng bật cờ này trên SL của lệnh đó." />
          </Section>
          <Section title="Trailing">
            <Check label="Trailing" checked={form.trailing} onChange={(value) => setField("trailing", value)} disabled={disabled} hint="Bật thì dời SL theo lời." />
            <Select label="Trailing type" value={form.trailingType} options={TRAILING_TYPES} onChange={(value) => setField("trailingType", value)} disabled={disabled} hint="FIX là % lãi. TP1 đến TP4 chờ chạm TP đó mới gồng. ATR và ROSE là số lần ATR. HYBRID dùng type này để gồng, SP rộng theo R." />
            <Num label="SP" value={form.sp} onChange={(value) => setField("sp", value)} disabled={disabled} hint="Khoảng cách SL gồng. FIX: 0.01 = 1% lãi. ATR: số lần ATR. SP phải nhỏ hơn Trigger." />
            <Num label="Trigger" value={form.trigger} onChange={(value) => setField("trigger", value)} disabled={disabled} hint="Lời cần đạt rồi mới bắt đầu gồng. FIX là % lãi. ATR là số lần ATR." />
            <Num label="R" value={form.r} onChange={(value) => setField("r", value)} disabled={disabled} hint="Mỗi lần giá đi thêm chừng này thì dời SL một bước. FIX là % lãi. ATR là số lần ATR." />
            <Check label="HP" checked={form.hp} onChange={(value) => setField("hp", value)} disabled={disabled} hint="Khi lời vượt HP trigger thì kéo SL theo đỉnh." />
            <Num label="HP trigger" value={form.hpTrigger} onChange={(value) => setField("hpTrigger", value)} disabled={disabled} hint="Ngưỡng lời để bật HP. Nhiều TP thì bot có thể gán trigger bằng TP cuối." />
            <Num label="RHSL" value={form.rhsl} onChange={(value) => setField("rhsl", value)} disabled={disabled} hint="Kéo SL lùi so với lời hiện tại khi HP kích hoạt." />
            <Num label="RH" value={form.rh} onChange={(value) => setField("rh", value)} disabled={disabled} hint="Bước lời thêm để dời tiếp SL kiểu HP." />
          </Section>
          <Section title="Copy">
            <Check label="Copy" checked={form.copy} onChange={(value) => setField("copy", value)} disabled={disabled} hint="Cho phép nhận lệnh copy. Tắt thì signal copy bị bỏ." />
            <Check label="Fix cost" checked={form.copyFix} onChange={(value) => setField("copyFix", value)} disabled={disabled} hint="Bật thì lệnh copy giữ volume của signal. Tắt thì volume nhân Rate và bị trần Max volume." />
            <Check label="DCA" checked={form.copyDca} onChange={(value) => setField("copyDca", value)} disabled={disabled} hint="Theo lệnh thêm volume của nguồn copy. Tắt thì bỏ qua." />
            <Check label="Follow" checked={form.copyFollow} onChange={(value) => setField("copyFollow", value)} disabled={disabled} hint="Theo lệnh đóng bớt của nguồn copy. Tắt thì không đóng theo." />
            <Num label="Max volume ($)" value={form.maxVolume} onChange={(value) => setField("maxVolume", value)} disabled={disabled} hint="Trần volume của lệnh copy khi không bật Fix cost." />
            <Num label="Rate" value={form.copyRate} onChange={(value) => setField("copyRate", value)} disabled={disabled} hint="Tỷ lệ volume so với lệnh nguồn khi tắt Fix cost. 0.1 = 10%." />
          </Section>
          <Section title="Sync">
            <Num label="Interval (giây)" value={form.interval} onChange={(value) => setField("interval", value)} disabled={disabled} hint="Chu kỳ monitor, tính bằng giây." />
            <Text label="Sync from" value={form.syncFrom || ""} onChange={(value) => setField("syncFrom", value)} disabled={disabled} placeholder="Tên config gốc" hint="Config gốc. Gốc sửa bằng /sc thì nhánh bị ghi đè, trừ nhóm nằm trong Sync except." />
            <Text label="Sync except" value={lists.syncExcept || ""} onChange={(value) => setList("syncExcept", value)} disabled={disabled} placeholder={SYNC_GROUPS.join(", ")} hint="Nhóm nhánh tự giữ, không lấy từ gốc: cost, level, sl, tp, trailing, hp, open, margin, copy, on, paper, signals, blacklist." />
            <Check label="Sync scale" checked={form.syncScale} onChange={(value) => setField("syncScale", value)} disabled={disabled} hint="Bật thì nhân USD theo tỷ lệ ví nhánh trên ví gốc. Tắt thì copy đúng số USD. Max loss không nhân." />
            <Num label="Sync margin ratio" value={form.syncMarginRatio} onChange={(value) => setField("syncMarginRatio", value)} disabled={disabled} hint="Acc gốc lưu cost chia ví. Nhánh scale cost đọc số này, không gọi API của gốc." />
            <Num label="Sync wallet" value={form.syncWalletBal} onChange={(value) => setField("syncWalletBal", value)} disabled={disabled} hint="Ví gốc lúc ghi ratio. Nhánh LOSS/FIX nhân USD theo ví nhánh chia số này." />
          </Section>
        </form>
        </ShowHint.Provider>
      ) : null}
    </section>
  );
}
