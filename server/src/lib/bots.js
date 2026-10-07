const UserAccount = require("../models/user-account");

async function unknownBotUsernames(names) {
    if (!names.length) return [];
    const found = await UserAccount.find({ username: { $in: names } })
        .select("username")
        .lean();
    const known = new Set(found.map((row) => row.username));
    return names.filter((name) => !known.has(name));
}

module.exports = { unknownBotUsernames };
