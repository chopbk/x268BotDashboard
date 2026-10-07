const WebUser = require("../models/web-user");
const config = require("../config");
const { hashPassword } = require("./password");

async function bootstrapAdmin() {
    try {
        const activeAdmins = await WebUser.countDocuments({ role: "admin", disabled: false });
        if (activeAdmins > 0) return;

        if (!config.adminEmail || !config.adminPassword) {
            console.warn(
                "[bootstrapAdmin] chưa có admin — đặt WEB_ADMIN_EMAIL và WEB_ADMIN_PASSWORD rồi chạy lại"
            );
            return;
        }
        if (config.adminPassword.length < 8) {
            console.error("[bootstrapAdmin] WEB_ADMIN_PASSWORD phải từ 8 ký tự");
            return;
        }

        const passwordHash = await hashPassword(config.adminPassword);
        const existing = await WebUser.findOne({ email: config.adminEmail });
        if (existing) {
            existing.role = "admin";
            existing.disabled = false;
            existing.passwordHash = passwordHash;
            if (!existing.name) existing.name = "Admin";
            await existing.save();
            console.log("[bootstrapAdmin] đã kích hoạt lại admin", config.adminEmail);
            return;
        }

        await WebUser.create({
            email: config.adminEmail,
            passwordHash,
            name: "Admin",
            role: "admin",
            botUsernames: [],
            disabled: false,
        });
        console.log("[bootstrapAdmin] đã tạo admin", config.adminEmail);
    } catch (error) {
        if (error?.code === 11000) {
            console.warn("[bootstrapAdmin] admin vừa được tạo");
            return;
        }
        console.error("[bootstrapAdmin]", error);
        throw error;
    }
}

module.exports = { bootstrapAdmin };
