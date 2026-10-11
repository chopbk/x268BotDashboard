# Spec Provider Scorecard

Trạng thái: triển khai trên web-bot, 2026-10-11.  
Phạm vi: xếp hạng channel/signal bằng số thật từ `signal_infos` + `account_statics`.

## 1. Mục tiêu

Một bảng xếp hạng provider (tên channel/signal) để trả lời: kênh nào có tin thật, lệnh thật
và lãi/lỗ thế nào trong cùng khoảng thời gian — không đoán từ tên menu hay từ AI.

Người dùng có quyền xem được:

1. Số tin signal nhận được theo kênh (`signal_infos`).
2. Số lệnh, win rate, profit, volume theo kênh trên các bot được xem (`account_statics`).
3. Cờ có listener channel cùng tên hay không (`telegram_clients.channels`).
4. Lọc thời gian / sổ live·paper / tối thiểu số lệnh, sắp xếp theo profit hoặc metric khác.
5. Deep-link sang Tìm Signal, Lịch sử signal, Account Static cùng tên kênh.

## 2. Định nghĩa

| Thuật ngữ | Nghĩa trong scorecard |
|---|---|
| Provider / channel | Tên signal viết hoa; khóa ghép từ `signal_infos.signal`, `account_statics.typeSignal`, và (nếu có) `telegram_clients.channels[].name` |
| Feed | Đếm tin trong `signal_infos` theo `openTime` — nhật ký hệ thống, **không** scope bot |
| Trades | Lệnh trong `account_statics` theo `openTime`, env thuộc bot actor được `statistics.view` |
| Win | `status === "WIN"` (cùng Account Static / Summary; **không** dùng `profit > 0` như Tìm Signal) |
| Sổ mặc định | `book=live` (`isPaper` khác `true`) |

Không coi profit Account Static bằng income ví. Không cộng live với paper khi `book` tách sổ.

## 3. API

`GET /api/provider-scorecard`

| | |
|---|---|
| Auth | Cookie JWT |
| Permission | `statistics.view` **hoặc** `signals.history` |
| Lib | [provider-scorecard.js](../server/src/lib/provider-scorecard.js) |
| Route | [provider-scorecard.js](../server/src/routes/provider-scorecard.js) |

### Query

| Query | Mặc định | Ghi chú |
|---|---|---|
| `from` / `to` | 3 ngày gần nhất nếu thiếu cả hai | Lọc **openTime** (ISO) |
| `scope` | `mine` | `mine` = bot sở hữu/được gán; `all` = thêm bot `statistics.view` cho phép (chỉ ảnh hưởng trades) |
| `book` | `live` | `live` \| `paper` \| `all` |
| `minTrades` | `0` | Bỏ provider có số lệnh &lt; ngưỡng (feed-only vẫn hiện nếu `minTrades=0`) |
| `sort` | `profit` | `profit` \| `winRate` \| `trades` \| `feed` \| `volume` |
| `q` | — | Lọc tên provider gần đúng (không phân biệt hoa thường) |

### Response (rút gọn)

```json
{
  "from": "...",
  "to": "...",
  "scope": "mine",
  "book": "live",
  "sort": "profit",
  "minTrades": 0,
  "canSeeFeed": true,
  "canSeeTrades": true,
  "formula": {
    "feed": "signal_infos theo openTime, cả hệ thống",
    "trades": "account_statics theo openTime, env trong scope bot",
    "win": "status WIN; LOSS/LOSE là thua",
    "pnl": "Tổng field profit đã lưu; không cộng live với paper"
  },
  "summary": {
    "providers": 12,
    "feed": 80,
    "trades": 40,
    "profit": 12.5,
    "winRate": 55
  },
  "rows": [
    {
      "signal": "SIGNAL_A",
      "channel": true,
      "feed": 20,
      "feedLong": 12,
      "feedShort": 8,
      "trades": 10,
      "wins": 6,
      "losses": 4,
      "winRate": 60,
      "profit": 5.2,
      "volume": 1000,
      "cost": 200,
      "avgRoi": 2.6,
      "configs": 3,
      "accounts": 2,
      "longCount": 7,
      "shortCount": 3,
      "longProfit": 4,
      "shortProfit": 1.2
    }
  ]
}
```

- Không có `statistics.view`: `canSeeTrades=false`, cột trades/profit = 0, `rows` vẫn có feed nếu có `signals.history`.
- Không có `signals.history`: `canSeeFeed=false`, cột feed = 0, vẫn xếp theo trades nếu có `statistics.view`.
- Thiếu cả hai quyền: 403.

## 4. UI

Tab **Scorecard** trên `/signal-search?tab=scorecard` ([SignalSearchPage](../client/src/pages/SignalSearchPage.jsx) + [SignalScorecardPanel](../client/src/pages/SignalScorecardPanel.jsx)).

Hiện tab khi actor có `statistics.view` hoặc `signals.history`.

| Phần | Hành vi |
|---|---|
| Bộ lọc | from/to, scope, book, minTrades, sort, ô tìm tên |
| Ghi chú nguồn | Luôn hiện công thức feed vs trades vs win |
| Bảng | Hạng, Signal, Channel, Feed, Lệnh, Win rate, Profit, Volume, Config, Account |
| Click signal | Tìm config (`tab=search`) nếu có `config.view`; link Lịch sử / Static khi đủ quyền |

Không tạo route menu riêng; không ghi Mongo từ web.

## 5. Nằm ngoài phạm vi

- Score AI / trọng số tùy chỉnh ngoài các sort đã liệt kê.
- Backtest `/bt` hay số từ paper-trading-handler riêng.
- Sửa Telegram session / OCR từ scorecard.
- Snapshot cache kiểu Summary hệ thống (luôn tính trực tiếp theo actor).

## 6. Kiểm tra tối thiểu

```sh
npm --prefix server test -- --test-name-pattern=provider-scorecard
npm --prefix client run build
```

Đối chiếu: cùng khoảng openTime, cùng book, cùng định nghĩa WIN trước khi so với Account Static hoặc Tổng kết (Tổng kết dùng closeTime lệnh đóng).
