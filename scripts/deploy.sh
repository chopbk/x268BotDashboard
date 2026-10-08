#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
    cat <<'HELP'
Usage: npm run deploy
Run on the Debian server as the app user, after git pull --ff-only.
Requires Node.js >= 22, npm, Git, PM2, curl, rsync, a root .env,
and a writable /var/www/web-bot directory (see docs/deploy-debian.md).
Deploys the current clean checkout; does not pull, configure Nginx or issue TLS.
HELP
    exit 0
fi
[[ $# -eq 0 ]] || { echo "Unknown argument. Use --help." >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for command in node npm git pm2 curl rsync; do
    command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Use Node.js >= 22 (recommended: 24 LTS)"); process.exit(1); }'
[[ -f .env ]] || { echo "Create .env from .env.example first." >&2; exit 1; }
web_root="${DEPLOY_WEB_ROOT:-/var/www/web-bot}"
[[ "$web_root" == /* && "$web_root" != / && -d "$web_root" && -w "$web_root" ]] || {
    echo "App user needs write access to /var/www/web-bot. See docs/deploy-debian.md." >&2
    exit 1
}
[[ -z "$(git status --porcelain)" ]] || {
    echo "Checkout has uncommitted files. Deploy a clean checkout; .env must stay ignored." >&2
    exit 1
}

lock_dir="$(git rev-parse --git-path web-bot-deploy.lock)"
mkdir "$lock_dir" 2>/dev/null || { echo "Deploy lock exists: $lock_dir" >&2; exit 1; }
trap 'rmdir "$lock_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Deploying $(git rev-parse --short HEAD)"
npm --prefix server ci --omit=dev
npm --prefix client ci --include=dev
npm --prefix server test
npm --prefix client run build
[[ -s client/dist/index.html ]] || { echo "Build did not produce index.html" >&2; exit 1; }

pm2 startOrRestart ecosystem.config.cjs --only web-bot --update-env
healthy=false
for attempt in {1..15}; do
    if curl --fail --silent --max-time 3 http://127.0.0.1:4000/api/health |
        node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => { try { process.exit(JSON.parse(s).ok === true ? 0 : 1); } catch { process.exit(1); } });'; then
        healthy=true
        break
    fi
    sleep 2
done
[[ "$healthy" == true ]] || {
    echo "Backend health failed. Frontend unchanged. Inspect: pm2 logs web-bot --lines 100" >&2
    echo "Backend/dependencies may already have changed; no automatic rollback." >&2
    exit 1
}

# Keep old hashed assets for browsers with the previous index.html open.
# Publish assets first, then atomically replace the entry page on the same filesystem.
rsync -rltp --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --exclude=index.html client/dist/ "$web_root/"
install -m 644 client/dist/index.html "$web_root/.index.html.next"
mv -f "$web_root/.index.html.next" "$web_root/index.html"
pm2 save
echo "Deploy complete. Check https://YOUR_DOMAIN/api/health and log in."
