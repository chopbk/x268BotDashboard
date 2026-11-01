# Quant Terminal contracts (P0)

Contracts đã chốt ngày 2026-11-01. Không phải runtime schema đã migrate.

| File | Nội dung |
|---|---|
| `identity.v1.json` | actor / botUsername / env / market / tradeInstanceId / messId |
| `provenance.v1.json` | quality envelope, TTL hints |
| `reservation.v1.json` | risk reservation lifecycle + unblock reduce |
| `capability.v1.json` | adapter capabilities / Q7 flags |
| `compatibility.v1.json` | producer ACK matrix + rollout/rollback |
| `entry-surfaces.v1.json` | web path + bot exposure inventory |
| `fixtures/` | offline acceptance shapes (timeline, risk, backtest engines) |

Nguồn trạng thái: [../../quant-terminal-implementation-status.md](../../quant-terminal-implementation-status.md).
