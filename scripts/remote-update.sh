#!/usr/bin/env bash
# Local: sau khi đã push upstream → SSH vào server chạy npm run update.
# Không commit, không push. Dùng: npm run deploy:remote
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--help" ]]; then
    echo "Usage: npm run deploy:remote"
    echo "  Đọc .env.deploy (DEPLOY_SSH, DEPLOY_DIR), SSH từng host và chạy npm run update."
    exit 0
fi
[[ $# -eq 0 ]] || { echo "Unknown argument. Use --help." >&2; exit 1; }

if [ -f "$ROOT/.env.deploy" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env.deploy"
    set +a
fi

DEPLOY_SSH="${DEPLOY_SSH:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/chopbk/web-bot}"

if [ -z "$DEPLOY_SSH" ]; then
    echo "[remote-update] Thiếu DEPLOY_SSH. Copy .env.deploy.example → .env.deploy rồi điền host." >&2
    exit 1
fi

trim() {
    local s="$1"
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    printf '%s' "$s"
}

IFS=',' read -ra HOSTS <<< "$DEPLOY_SSH"
fail=0
for raw in "${HOSTS[@]}"; do
    host="$(trim "$raw")"
    [ -z "$host" ] && continue
    echo "[remote-update] $host → cd $DEPLOY_DIR && npm run update"
    if ! ssh -o BatchMode=yes -o ConnectTimeout=20 "$host" \
        "cd $(printf '%q' "$DEPLOY_DIR") && npm run update"; then
        echo "[remote-update] FAIL $host" >&2
        fail=1
    else
        echo "[remote-update] OK $host"
    fi
done

exit "$fail"
