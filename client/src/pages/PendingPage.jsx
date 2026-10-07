export default function PendingPage() {
  return (
    <section className="card pending-card">
      <p className="eyebrow">Tài khoản đã được tạo</p>
      <h1>Đang chờ admin cấp quyền</h1>
      <p className="muted">
        Bạn đã đăng nhập thành công nhưng chưa thể xem hoặc vận hành bot. Vui lòng liên hệ admin
        để được cấp quyền phù hợp.
      </p>
    </section>
  );
}
