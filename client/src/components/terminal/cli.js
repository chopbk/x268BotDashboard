/**
 * Parser CLI Terminal kiểu Telegram (/cl /o /sl …).
 * Chỉ tạo draft action — UI vẫn confirm + kiểm tra permission.
 */

const COMMANDS = [
  { id: "help", aliases: ["h", "help", "?"], usage: "/help", hint: "Danh sách lệnh" },
  { id: "p", aliases: ["p", "pos", "position", "v"], usage: "/p [SYMBOL]", hint: "Chọn / lọc vị thế" },
  { id: "b", aliases: ["b", "bal", "balance"], usage: "/b [ACCOUNT]", hint: "Số dư available (Redis)" },
  { id: "cl", aliases: ["cl", "close"], usage: "/cl [SYMBOL] [%|qty]", hint: "Đóng vị thế đã chọn hoặc theo symbol" },
  { id: "clall", aliases: ["clall", "closeall", "cla"], usage: "/clall [%]", hint: "Đóng toàn bộ vị thế live trong bộ lọc (cùng % mỗi dòng)" },
  { id: "o", aliases: ["o", "open", "long", "short"], usage: "/o SYMBOL SIDE qty|N%|$N", hint: "Mở lệnh (qty / % ví / $ notional)" },
  { id: "sl", aliases: ["sl"], usage: "/sl PRICE", hint: "Đặt SL vị thế đang chọn" },
  { id: "tp", aliases: ["tp"], usage: "/tp PRICE", hint: "Đặt TP vị thế đang chọn" },
  { id: "rev", aliases: ["rev", "reverse"], usage: "/rev", hint: "Đảo chiều vị thế đang chọn" },
  { id: "j", aliases: ["j", "journal", "note"], usage: "/j nội dung", hint: "Ghi journal nhanh" },
  { id: "ai", aliases: ["ai", "coach"], usage: "/ai", hint: "Mở tab AI phân tích lệnh đang chọn" },
];

function normToken(value) {
  return String(value || "").trim().replace(/^\//, "").toUpperCase();
}

function parseSizeToken(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/%$/.test(text)) {
    const percent = Number(text.replace(/%$/, ""));
    if (!(percent > 0 && percent <= 100)) return null;
    return { mode: "percent", percent };
  }
  if (/^\$/.test(text) || /usdt$/i.test(text)) {
    const usdt = Number(text.replace(/^\$/i, "").replace(/usdt$/i, ""));
    if (!(usdt > 0)) return null;
    return { mode: "usdt", usdt };
  }
  const quantity = Number(text.replace(/,/g, ""));
  if (!(quantity > 0)) return null;
  return { mode: "qty", quantity };
}

export function listCommands(query = "") {
  const q = String(query || "").trim().replace(/^\//, "").toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS.filter((cmd) =>
    cmd.aliases.some((a) => a.startsWith(q)) || cmd.usage.includes(q) || cmd.hint.toLowerCase().includes(q)
  );
}

export function suggestCli(input) {
  const text = String(input || "");
  if (!text.startsWith("/")) return [];
  const parts = text.slice(1).split(/\s+/);
  const head = (parts[0] || "").toLowerCase();
  if (parts.length <= 1) {
    return listCommands(head).slice(0, 8).map((cmd) => ({
      label: cmd.usage,
      detail: cmd.hint,
      insert: `/${cmd.aliases[0]}`,
    }));
  }
  const cmd = COMMANDS.find((c) => c.aliases.includes(head));
  if (!cmd) return [];
  if (cmd.id === "cl" && parts.length === 2) {
    return ["10%", "25%", "50%", "75%", "100%", "SYMBOL"].map((item) => ({
      label: `/${head} ${item}`,
      detail: item.includes("%") ? "Đóng theo %" : "Symbol rồi %",
      insert: `/${head} ${item === "SYMBOL" ? "" : item}`.trim(),
    }));
  }
  if (cmd.id === "o" && parts.length >= 2) {
    return [
      { label: `/${head} BTCUSDT LONG 1%`, detail: "1% ví làm margin", insert: `/${head} BTCUSDT LONG 1%` },
      { label: `/${head} ETHUSDT SHORT $200`, detail: "Notional 200 USDT", insert: `/${head} ETHUSDT SHORT $200` },
      { label: `/${head} BTCUSDT LONG 0.01`, detail: "Qty cố định", insert: `/${head} BTCUSDT LONG 0.01` },
    ];
  }
  return [{ label: cmd.usage, detail: cmd.hint, insert: cmd.usage.split(" ")[0] }];
}

/**
 * @returns {{ ok: boolean, error?: string, action?: object, message?: string }}
 */
export function parseCli(input, ctx = {}) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "Nhập lệnh, bắt đầu bằng /" };
  if (!raw.startsWith("/")) return { ok: false, error: "Lệnh phải bắt đầu bằng / (vd /help)" };

  const body = raw.slice(1).trim();
  const [headRaw, ...rest] = body.split(/\s+/);
  const head = String(headRaw || "").toLowerCase();
  const cmd = COMMANDS.find((c) => c.aliases.includes(head));
  if (!cmd) return { ok: false, error: `Không biết lệnh /${head}. Gõ /help` };

  if (cmd.id === "help") {
    return {
      ok: true,
      action: { type: "help" },
      message: COMMANDS.map((c) => `${c.usage} — ${c.hint}`).join("\n"),
    };
  }

  if (cmd.id === "p") {
    const symbol = rest[0] ? normToken(rest[0]) : "";
    return { ok: true, action: { type: "select", symbol } };
  }

  if (cmd.id === "b") {
    const account = rest[0] ? String(rest[0]).trim() : (ctx.selectedAccount || "");
    return { ok: true, action: { type: "balance", account } };
  }

  if (cmd.id === "cl") {
    let symbol = "";
    let sizeRaw = rest[0] || "100%";
    if (rest[0] && /[A-Z]/i.test(rest[0]) && !/%$/.test(rest[0]) && Number.isNaN(Number(rest[0]))) {
      symbol = normToken(rest[0]);
      sizeRaw = rest[1] || "100%";
    }
    let percent = null;
    let quantity = null;
    if (/%$/.test(sizeRaw)) {
      percent = Number(String(sizeRaw).replace(/%$/, ""));
      if (!(percent > 0 && percent <= 100)) return { ok: false, error: "% đóng phải trong (0,100]" };
    } else {
      quantity = Number(String(sizeRaw).replace(/,/g, ""));
      if (!(quantity > 0)) return { ok: false, error: "Qty đóng phải > 0 hoặc dùng 50%" };
    }
    return { ok: true, action: { type: "close", symbol, percent, quantity, orderType: "MARKET" } };
  }

  if (cmd.id === "clall") {
    const sizeRaw = rest[0] || "100%";
    let percent = 100;
    if (/%$/.test(sizeRaw)) {
      percent = Number(String(sizeRaw).replace(/%$/, ""));
    } else if (rest[0]) {
      percent = Number(String(sizeRaw).replace(/,/g, ""));
    }
    if (!(percent > 0 && percent <= 100)) return { ok: false, error: "% đóng phải trong (0,100]" };
    return { ok: true, action: { type: "closeAll", percent, orderType: "MARKET" } };
  }

  if (cmd.id === "o") {
    const verb = head;
    let symbol = normToken(rest[0]);
    let side = normToken(rest[1]);
    let sizeTok = rest[2];
    if (verb === "long" || verb === "short") {
      side = verb.toUpperCase();
      symbol = normToken(rest[0]);
      sizeTok = rest[1];
    }
    if (!symbol) return { ok: false, error: "Thiếu SYMBOL" };
    if (side !== "LONG" && side !== "SHORT") return { ok: false, error: "SIDE phải LONG hoặc SHORT" };
    const size = parseSizeToken(sizeTok);
    if (!size) return { ok: false, error: "Size: qty | 5% | $200" };
    return {
      ok: true,
      action: {
        type: "open",
        symbol,
        side,
        orderType: "MARKET",
        sizeMode: size.mode,
        quantity: size.quantity,
        percent: size.percent,
        usdt: size.usdt,
      },
    };
  }

  if (cmd.id === "sl" || cmd.id === "tp") {
    const price = Number(String(rest[0] || "").replace(/,/g, ""));
    if (!(price > 0)) return { ok: false, error: `${cmd.id.toUpperCase()} cần giá > 0` };
    return { ok: true, action: { type: "protect", kind: cmd.id, price } };
  }

  if (cmd.id === "rev") {
    return { ok: true, action: { type: "reverse" } };
  }

  if (cmd.id === "j") {
    const note = rest.join(" ").trim();
    if (!note) return { ok: false, error: "Thiếu nội dung journal" };
    if (note.length > 2000) return { ok: false, error: "Journal tối đa 2000 ký tự" };
    return { ok: true, action: { type: "journal", body: note } };
  }

  if (cmd.id === "ai") {
    return { ok: true, action: { type: "coach" } };
  }

  return { ok: false, error: "Lệnh chưa hỗ trợ" };
}

export { COMMANDS };
