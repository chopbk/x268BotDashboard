import { TAKER_FEE_RATE } from "../../trade-preview";
import { fmt, pnlClass } from "./format.js";

export default function PreviewBlock({ preview, title }) {
  if (!preview) return null;
  return (
    <div className="term-preview">
      {title ? <strong>{title}</strong> : null}
      <ul>
        <li>Qty đóng/mở: {fmt(preview.quantity)}</li>
        {preview.exitPrice != null ? <li>Giá thoát ước tính: {fmt(preview.exitPrice)}</li> : null}
        {preview.price != null && preview.exitPrice == null ? <li>Giá tham chiếu: {fmt(preview.price)}</li> : null}
        {preview.notional != null ? <li>Notional ≈ {fmt(preview.notional, 2)} USDT</li> : null}
        {preview.estimatedPnl != null ? (
          <li className={pnlClass(preview.estimatedPnl)}>PnL dự kiến ≈ {fmt(preview.estimatedPnl, 2)} USDT</li>
        ) : null}
        {preview.estimatedFee != null ? (
          <li>Phí ước tính (taker {(preview.feeRate || TAKER_FEE_RATE) * 100}%) ≈ {fmt(preview.estimatedFee, 4)} USDT</li>
        ) : null}
        {preview.netAfterFee != null ? (
          <li className={pnlClass(preview.netAfterFee)}>Net sau phí ≈ {fmt(preview.netAfterFee, 2)} USDT</li>
        ) : null}
      </ul>
      {preview.siblings?.length ? (
        <>
          <p className="muted">Sibling monitor dùng chung position ({preview.siblings.length}):</p>
          <ul>
            {preview.siblings.map((item) => (
              <li key={item.id || `${item.env}-${item.signal}`}>
                {item.env || "config"} · {item.signal || "—"} · qty riêng {fmt(item.ownQty)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">Không có sibling monitor.</p>
      )}
    </div>
  );
}
