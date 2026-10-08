#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
    echo "Usage: npm run update — pull current branch's upstream, then deploy on the server."
    exit 0
fi
[[ $# -eq 0 ]] || { echo "Unknown argument. Use --help." >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -z "$(git status --porcelain)" ]] || {
    echo "Checkout has uncommitted files. Commit or move them before updating." >&2
    exit 1
}
git rev-parse --verify '@{upstream}' >/dev/null 2>&1 || {
    echo "Current branch has no upstream. Switch to the deployment branch first." >&2
    exit 1
}
[[ ! -d "$(git rev-parse --git-path web-bot-deploy.lock)" ]] || {
    echo "A deploy lock exists. Wait for the running deploy to finish." >&2
    exit 1
}

git pull --ff-only
# Load the newly pulled deploy script, including any changes to the deployment steps.
exec bash scripts/deploy.sh
