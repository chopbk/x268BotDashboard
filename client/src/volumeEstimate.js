/**
 * Ước lượng cost / volume notional theo công thức bot (margin-mode.js).
 * RATIO: cost = available × ratio / lev → volume ≈ available × ratio.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function estimateEntrySize(form, wallet) {
  const mode = String(form?.mode || "FIX").toUpperCase();
  const lev = num(form?.leverage) || 1;
  const costCfg = num(form?.cost);
  const ratio = num(form?.ratio);
  const available = num(wallet?.available);
  const balance = num(wallet?.balance);

  if (mode === "RATIO") {
    if (available != null && available > 0 && ratio != null && lev > 0) {
      const cost = (available * ratio) / lev;
      const volume = available * ratio;
      return {
        mode,
        cost,
        volume,
        available,
        balance,
        label: "Volume vào lệnh (ước lượng)",
        detail: `available ${available.toFixed(2)} × ratio ${ratio} ≈ ${volume.toFixed(2)} (cost ≈ ${cost.toFixed(2)} × lev ${lev})`,
        ready: true,
      };
    }
    return {
      mode,
      cost: null,
      volume: null,
      available,
      balance,
      label: "Volume vào lệnh",
      detail: available == null
        ? "Chưa có availableBalance từ Redis — bot trader/monitor cần REDIS_URL và sync số dư."
        : "Cần Ratio và đòn bẩy long hợp lệ.",
      ready: false,
    };
  }

  if (mode === "FIX" || !["RISK", "RR", "LOSS"].includes(mode)) {
    if (costCfg != null && lev > 0) {
      const volume = costCfg * lev;
      return {
        mode: mode === "FIX" ? "FIX" : mode,
        cost: costCfg,
        volume,
        available,
        balance,
        label: "Volume vào lệnh",
        detail: `Cost ${costCfg} × đòn bẩy long ${lev} = ${volume.toFixed(2)}`,
        ready: true,
      };
    }
  }

  if (mode === "RISK" && costCfg != null && lev > 0) {
    return {
      mode,
      cost: costCfg,
      volume: costCfg * lev,
      available,
      balance,
      label: "Volume gốc (trước × risk/5)",
      detail: `Mốc Cost × lev; size thật còn nhân risk signal / 5.`,
      ready: true,
    };
  }

  return {
    mode,
    cost: costCfg,
    volume: null,
    available,
    balance,
    label: "Volume vào lệnh",
    detail: mode === "LOSS" || mode === "RR"
      ? "Size theo Fix loss / ROI tại SL — cần giá entry & SL lúc mở lệnh, không ước lượng cố định trên form."
      : "Không ước lượng được với mode hiện tại.",
    ready: false,
  };
}
