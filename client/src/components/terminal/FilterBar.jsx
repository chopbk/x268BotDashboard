import { SAVED_VIEWS } from "./prefs.js";

export default function FilterBar({
  tab,
  params,
  audience,
  account,
  accounts,
  envs,
  viewId,
  customViews,
  density,
  columnsOpen,
  advancedOpen,
  canPositions,
  canOpen,
  notifyReady,
  onFilter,
  onView,
  onDensity,
  onToggleColumns,
  onToggleAdvanced,
  onNotify,
  onSaveView,
  onDeleteView,
}) {
  const showPosFilters = tab === "positions";

  return (
    <div className="term-filters">
      <div className="term-filters-main">
        <label>Phạm vi
          <select value={audience} onChange={(e) => onFilter("audience", e.target.value)}>
            <option value="mine">Của tôi</option>
            <option value="all">Có quyền xem</option>
          </select>
        </label>
        <label>Tài khoản
          <select value={account} onChange={(e) => onFilter("account", e.target.value)}>
            <option value="">Tất cả</option>
            {accounts.map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
          </select>
        </label>
        <label>Sổ
          <select value={params.get("book") || "live"} onChange={(e) => onFilter("book", e.target.value === "live" ? "" : e.target.value)}>
            <option value="live">Live</option>
            <option value="paper">Paper</option>
            <option value="all">Live và paper</option>
            <option value="pending" disabled={tab === "position-history"}>Lệnh chờ</option>
            <option value="notpsl" disabled={tab === "position-history"}>NOTPSL</option>
          </select>
        </label>
        {showPosFilters ? (
          <label>Tìm coin
            <input value={params.get("symbol") || ""} placeholder="BTC…" onChange={(e) => onFilter("symbol", e.target.value.toUpperCase())} />
          </label>
        ) : null}
        {showPosFilters ? (
          <label>View
            <select value={viewId || "all"} onChange={(e) => onView(e.target.value)}>
              {SAVED_VIEWS.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              {customViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        ) : null}
        {showPosFilters ? (
          <button type="button" className="ghost" onClick={onToggleAdvanced}>
            Bộ lọc thêm{advancedOpen ? " ▴" : " ▾"}
          </button>
        ) : null}
        {showPosFilters ? (
          <button type="button" className="ghost" onClick={onToggleColumns}>Cột{columnsOpen ? " ▴" : ""}</button>
        ) : null}
        {showPosFilters ? (
          <label>Mật độ
            <select value={density} onChange={(e) => onDensity(e.target.value)}>
              <option value="comfortable">Thường</option>
              <option value="compact">Gọn</option>
            </select>
          </label>
        ) : null}
        {showPosFilters && canPositions && typeof Notification !== "undefined" && !notifyReady ? (
          <button type="button" className="ghost" onClick={onNotify}>Bật thông báo</button>
        ) : null}
        {showPosFilters && canOpen ? (
          <button type="button" className="ghost" onClick={onSaveView}>Lưu view</button>
        ) : null}
        {showPosFilters && viewId && !SAVED_VIEWS.some((v) => v.id === viewId) ? (
          <button type="button" className="ghost" onClick={() => onDeleteView(viewId)}>Xóa view</button>
        ) : null}
      </div>
      {showPosFilters && advancedOpen ? (
        <div className="term-filters-advanced">
          <label>Config
            <select value={params.get("env") || ""} onChange={(e) => onFilter("env", e.target.value)}>
              <option value="">Tất cả</option>
              {envs.map((env) => <option key={env} value={env}>{env}</option>)}
            </select>
          </label>
          <label>Signal
            <input value={params.get("signal") || ""} placeholder="ROSE…" onChange={(e) => onFilter("signal", e.target.value)} />
          </label>
          <label>Side
            <select value={params.get("side") || ""} onChange={(e) => onFilter("side", e.target.value)}>
              <option value="">Tất cả</option>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
          </label>
          <label>Cảnh báo
            <select value={params.get("warn") || ""} onChange={(e) => onFilter("warn", e.target.value)}>
              <option value="">Tất cả</option>
              <option value="1">Chỉ cảnh báo</option>
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
