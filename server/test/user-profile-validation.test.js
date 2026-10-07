const test = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizeTelegramId,
    isValidTelegramId,
    normalizeTelegramUsername,
    isValidTelegramUsername,
    normalizePhone,
    isValidPhone,
} = require("../src/lib/validate");

test("Telegram identity fields are normalized and validated", () => {
    assert.equal(normalizeTelegramId(" 123456789 "), "123456789");
    assert.equal(isValidTelegramId("123456789"), true);
    assert.equal(isValidTelegramId("telegram-id"), false);

    assert.equal(normalizeTelegramUsername(" @Test_User "), "test_user");
    assert.equal(isValidTelegramUsername("test_user"), true);
    assert.equal(isValidTelegramUsername("bad-name"), false);
});

test("phone numbers are normalized to a linkable form", () => {
    assert.equal(normalizePhone("+84 901-234-567"), "+84901234567");
    assert.equal(normalizePhone("00 84 901 234 567"), "+84901234567");
    assert.equal(isValidPhone("+84901234567"), true);
    assert.equal(isValidPhone("0123"), false);
});

test("profile fields remain optional", () => {
    assert.equal(isValidTelegramId(""), true);
    assert.equal(isValidTelegramUsername(""), true);
    assert.equal(isValidPhone(""), true);
});
