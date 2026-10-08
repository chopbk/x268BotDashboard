const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Exercise the real shell/publish path, with no package installs, PM2 or network.
function fixture(t, scenario) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-bot-deploy-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const dir of ["scripts", "bin", ".git", "public/assets"])
        fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "deploy.sh"), path.join(root, "scripts/deploy.sh"));
    fs.writeFileSync(path.join(root, ".env"), "DO_NOT_PRINT=private-test-value\n");
    fs.writeFileSync(path.join(root, "public/index.html"), "old page");
    fs.writeFileSync(path.join(root, "public/assets/old.js"), "old asset");
    const commands = {
        git: `case "$*" in
            'status --porcelain') [[ "$SCENARIO" != dirty ]] || echo ' M server/src/index.js';;
            'rev-parse --git-path web-bot-deploy.lock') echo .git/web-bot-deploy.lock;;
            'rev-parse --short HEAD') echo abc1234;;
            *) exit 2;;
        esac`,
        npm: `echo "npm $*" >> "$TEST_LOG"
            if [[ "$*" == '--prefix client run build' ]]; then
                [[ "$SCENARIO" != build-failure ]] || exit 1
                mkdir -p client/dist/assets
                printf 'new page' > client/dist/index.html
                printf 'new asset' > client/dist/assets/new.js
            fi`,
        pm2: `echo "pm2 $*" >> "$TEST_LOG"`,
        curl: `if [[ "$SCENARIO" == health-failure ]]; then
                echo '{"ok":false}'
            else
                echo '{"ok":true,"rateLimitStore":"memory"}'
            fi`,
        sleep: ":",
    };
    for (const [name, body] of Object.entries(commands))
        fs.writeFileSync(path.join(root, "bin", name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    if (scenario === "locked") fs.mkdirSync(path.join(root, ".git/web-bot-deploy.lock"));
    const result = spawnSync("bash", ["scripts/deploy.sh"], {
        cwd: root,
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, PATH: `${root}/bin:${path.dirname(process.execPath)}:${process.env.PATH}`,
            DEPLOY_WEB_ROOT: `${root}/public`, SCENARIO: scenario, TEST_LOG: `${root}/calls.log` },
    });
    assert.ifError(result.error);
    assert.doesNotMatch(result.stdout + result.stderr, /private-test-value/);
    const calls = fs.existsSync(`${root}/calls.log`) ? fs.readFileSync(`${root}/calls.log`, "utf8") : "";
    return { root, result, calls };
}

test("successful deploy publishes new index/assets and keeps old assets", (t) => {
    const { root, result, calls } = fixture(t, "success");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(`${root}/public/index.html`, "utf8"), "new page");
    assert.ok(fs.existsSync(`${root}/public/assets/new.js`));
    assert.ok(fs.existsSync(`${root}/public/assets/old.js`));
    assert.match(calls, /pm2 startOrRestart ecosystem.config.cjs --only web-bot --update-env/);
    assert.match(calls, /pm2 save/);
    assert.ok(!fs.existsSync(`${root}/.git/web-bot-deploy.lock`));
});

test("build failure leaves running app and frontend alone", (t) => {
    const { root, result, calls } = fixture(t, "build-failure");
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(calls, /pm2/);
    assert.equal(fs.readFileSync(`${root}/public/index.html`, "utf8"), "old page");
    assert.ok(!fs.existsSync(`${root}/.git/web-bot-deploy.lock`));
});

test("HTTP success with unhealthy JSON does not publish frontend or save PM2", (t) => {
    const { root, result, calls } = fixture(t, "health-failure");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Backend health failed/);
    assert.equal(fs.readFileSync(`${root}/public/index.html`, "utf8"), "old page");
    assert.doesNotMatch(calls, /pm2 save/);
    assert.ok(!fs.existsSync(`${root}/.git/web-bot-deploy.lock`));
});

for (const scenario of ["dirty", "locked"]) {
    test(`${scenario} checkout stops before installation or restart`, (t) => {
        const { result, calls } = fixture(t, scenario);
        assert.notEqual(result.status, 0);
        assert.equal(calls, "");
    });
}
