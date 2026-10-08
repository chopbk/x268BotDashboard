module.exports = {
    apps: [{
        name: "web-bot",
        cwd: __dirname,
        script: "server/src/index.js",
        instances: 1,
        exec_mode: "fork",
        autorestart: true,
        restart_delay: 3000,
        time: true,
        env: {
            NODE_ENV: "production",
            WEB_HOST: "127.0.0.1",
            WEB_PORT: "4000",
            WEB_TRUST_PROXY: "true",
        },
    }],
};
