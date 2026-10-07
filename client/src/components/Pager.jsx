export default function Pager({ page, total, limit, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return <div className="pager"><button type="button" className="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Trang trước</button><span className="muted">Trang {page}/{pages} · {total} kết quả</span><button type="button" className="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Trang sau</button></div>;
}
