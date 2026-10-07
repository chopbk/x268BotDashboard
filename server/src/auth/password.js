const bcrypt = require("bcryptjs");

const ROUNDS = 12;
let dummyHashPromise = null;

function dummyHash() {
    if (!dummyHashPromise) {
        dummyHashPromise = bcrypt.hash("web-bot-dummy-password", ROUNDS);
    }
    return dummyHashPromise;
}

async function hashPassword(password) {
    return bcrypt.hash(password, ROUNDS);
}

async function verifyPassword(password, passwordHash) {
    const hash = passwordHash || (await dummyHash());
    return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, verifyPassword, dummyHash };
