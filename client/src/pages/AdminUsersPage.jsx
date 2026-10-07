import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

const emptyForm = {
  email: "",
  username: "",
  telegramId: "",
  telegramUsername: "",
  phone: "",
  password: "",
  name: "",
  role: "viewer",
  botUsernames: [],
  customPermissions: null,
  disabled: false,
};

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [bots, setBots] = useState([]);
  const [permissionOptions, setPermissionOptions] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [userData, botData, accessData] = await Promise.all([
      api("/api/admin/users"),
      api("/api/bots"),
      api("/api/admin/users/access-control"),
    ]);
    setUsers(userData.users || []);
    setBots(botData.bots || []);
    setPermissionOptions(accessData.permissions || []);
    setRolePermissions(accessData.rolePermissions || {});
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const visibleBots = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return bots;
    return bots.filter((bot) => bot.username.toLowerCase().includes(query));
  }, [bots, filter]);

  const visibleUsers = useMemo(() => {
    const query = userFilter.trim().toLowerCase();
    if (!query) return users;
    return users.filter((row) =>
      [
        row.name,
        row.email,
        row.username,
        row.telegramId,
        row.telegramUsername,
        row.phone,
        row.role,
      ].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }, [users, userFilter]);

  const staleBots = useMemo(() => {
    if (loading) return [];
    const known = new Set(bots.map((bot) => bot.username));
    return form.botUsernames.filter((name) => !known.has(name));
  }, [bots, form.botUsernames, loading]);

  function toggleBot(username) {
    setForm((prev) => {
      const has = prev.botUsernames.includes(username);
      return {
        ...prev,
        botUsernames: has
          ? prev.botUsernames.filter((name) => name !== username)
          : [...prev.botUsernames, username],
      };
    });
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  function startEdit(row) {
    setEditingId(row.id);
    setForm({
      email: row.email,
      username: row.username || "",
      telegramId: row.telegramId || "",
      telegramUsername: row.telegramUsername || "",
      phone: row.phone || "",
      password: "",
      name: row.name,
      role: row.role,
      botUsernames: row.botUsernames || [],
      customPermissions: row.customPermissions,
      disabled: !!row.disabled,
    });
    setError("");
  }

  const selectedPermissions = useMemo(
    () => form.customPermissions ?? rolePermissions[form.role] ?? [],
    [form.customPermissions, form.role, rolePermissions]
  );

  function togglePermission(permission) {
    if (form.role === "admin" || form.role === "pending") return;
    setForm((prev) => {
      const current = prev.customPermissions ?? rolePermissions[prev.role] ?? [];
      return {
        ...prev,
        customPermissions: current.includes(permission)
          ? current.filter((item) => item !== permission)
          : [...current, permission],
      };
    });
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        const body = {
          name: form.name,
          role: form.role,
          botUsernames: form.botUsernames,
          telegramId: form.telegramId,
          telegramUsername: form.telegramUsername,
          phone: form.phone,
          customPermissions: form.customPermissions,
          disabled: form.disabled,
        };
        if (form.username) body.username = form.username;
        if (form.password) body.password = form.password;
        await api(`/api/admin/users/${editingId}`, { method: "PATCH", body });
      } else {
        await api("/api/admin/users", {
          method: "POST",
          body: {
            email: form.email,
            username: form.username,
            telegramId: form.telegramId,
            telegramUsername: form.telegramUsername,
            phone: form.phone,
            password: form.password,
            name: form.name,
            role: form.role,
            botUsernames: form.botUsernames,
            customPermissions: form.customPermissions,
          },
        });
      }
      startCreate();
      await load();
    } catch (err) {
      const missing = err.data?.missing;
      setError(missing?.length ? `${err.message}: ${missing.join(", ")}` : err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-layout">
      <div className="user-list-panel">
        <header className="page-head user-list-head">
          <div>
            <h1>User web</h1>
            <p className="muted">Viewer chỉ xem, operator có thể vận hành. Admin quản lý toàn hệ thống.</p>
          </div>
          <label className="user-search">
            Tìm user
            <input
              type="search"
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
              placeholder="Tên, email, username, Telegram…"
            />
          </label>
        </header>
        {loading ? <p className="muted">Đang tải…</p> : null}
        <div className="table-wrap user-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Email</th>
                <th>Username</th>
                <th>Role</th>
                <th>Telegram</th>
                <th>Quyền</th>
                <th>Bot</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.email}</td>
                  <td>{row.username || "—"}</td>
                  <td>{row.role}</td>
                  <td>
                    {row.telegramUsername ? `@${row.telegramUsername}` : row.telegramId || "—"}
                  </td>
                  <td>{(row.permissions || []).length}</td>
                  <td>{row.role === "admin" ? "Tất cả" : row.botUsernames.join(", ") || "—"}</td>
                  <td>{row.disabled ? "Khóa" : "Hoạt động"}</td>
                  <td>
                    <button type="button" className="ghost" onClick={() => startEdit(row)}>
                      Sửa
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan="9" className="empty">Không tìm thấy user phù hợp.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card admin-form" onSubmit={onSubmit}>
        <div className="form-title">
          <h2>{editingId ? "Sửa user" : "Tạo user"}</h2>
          {editingId ? (
            <button type="button" className="ghost" onClick={startCreate}>
              Tạo mới
            </button>
          ) : null}
        </div>
        <label>
          Tên
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label>
          Username
          <input
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })}
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9][a-z0-9._-]{2,31}"
            required={!editingId}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
            disabled={!!editingId}
          />
        </label>
        <label>
          Telegram ID
          <input
            inputMode="numeric"
            value={form.telegramId}
            onChange={(event) => setForm({ ...form, telegramId: event.target.value })}
            placeholder="123456789"
          />
        </label>
        <label>
          Telegram username
          <input
            value={form.telegramUsername}
            onChange={(event) =>
              setForm({ ...form, telegramUsername: event.target.value.toLowerCase() })
            }
            placeholder="@username"
          />
        </label>
        <label>
          Số điện thoại
          <input
            type="tel"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="+84901234567"
          />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required={!editingId}
            minLength={form.password ? 8 : undefined}
            placeholder={editingId ? "Để trống nếu không đổi" : "Tối thiểu 8 ký tự"}
            autoComplete="new-password"
          />
        </label>
        <label>
          Role
          <select
            value={form.role}
            onChange={(event) =>
              setForm({ ...form, role: event.target.value, customPermissions: null })
            }
          >
            {form.role === "user" ? <option value="user">user (legacy, như viewer)</option> : null}
            {form.role === "pending" ? <option value="pending">pending (chờ cấp quyền)</option> : null}
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <fieldset className="permission-picker">
          <legend>Phân quyền chi tiết</legend>
          {permissionOptions.map((permission) => (
            <label className="check" key={permission.key}>
              <input
                type="checkbox"
                checked={selectedPermissions.includes(permission.key)}
                disabled={form.role === "admin" || form.role === "pending"}
                onChange={() => togglePermission(permission.key)}
              />
              <span>
                {permission.label}
                <small>{permission.key}</small>
              </span>
            </label>
          ))}
          {form.role === "admin" ? <small className="muted">Admin luôn có toàn bộ quyền.</small> : null}
          {form.role === "pending" ? <small className="muted">Pending luôn có 0 quyền.</small> : null}
          {form.customPermissions !== null && form.role !== "admin" && form.role !== "pending" ? (
            <button
              type="button"
              className="ghost"
              onClick={() => setForm({ ...form, customPermissions: null })}
            >
              Dùng quyền mặc định của role
            </button>
          ) : null}
        </fieldset>
        {editingId && currentUser?.id !== editingId ? (
          <label className="check">
            <input
              type="checkbox"
              checked={form.disabled}
              onChange={(event) => setForm({ ...form, disabled: event.target.checked })}
            />
            Khóa đăng nhập
          </label>
        ) : null}
        <label>
          Lọc bot
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="username"
          />
        </label>
        <div className="bot-picker">
          {visibleBots.length === 0 ? <p className="muted">Không có bot khớp.</p> : null}
          {visibleBots.map((bot) => (
            <label className="check" key={bot.username}>
              <input
                type="checkbox"
                checked={form.botUsernames.includes(bot.username)}
                onChange={() => toggleBot(bot.username)}
              />
              <span>
                {bot.username}
                <small>{(bot.accounts || []).join(", ")}</small>
              </span>
            </label>
          ))}
        </div>
        {staleBots.length > 0 ? (
          <div className="chips">
            {staleBots.map((name) => (
              <button
                type="button"
                className="ghost chip-btn"
                key={name}
                onClick={() => toggleBot(name)}
              >
                Bỏ {name}
              </button>
            ))}
          </div>
        ) : null}
        {form.botUsernames.length > 0 ? (
          <p className="muted">Đã chọn: {form.botUsernames.join(", ")}</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu"}
        </button>
      </form>
    </section>
  );
}
