import test from "node:test";
import assert from "node:assert/strict";
import { normalizeThemeId, THEMES, THEME_STORAGE_KEY } from "./theme.js";

test("normalizeThemeId chỉ nhận skin đã khai báo", () => {
  assert.equal(normalizeThemeId("gold"), "gold");
  assert.equal(normalizeThemeId("ocean"), "ocean");
  assert.equal(normalizeThemeId("oled"), "oled");
  assert.equal(normalizeThemeId("day"), "day");
  assert.equal(normalizeThemeId("unknown"), "gold");
  assert.equal(normalizeThemeId(""), "gold");
  assert.equal(normalizeThemeId(null), "gold");
});

test("THEMES có đủ 4 skin và storage key ổn định", () => {
  assert.equal(THEMES.length, 4);
  assert.deepEqual(
    THEMES.map((theme) => theme.id).sort(),
    ["day", "gold", "ocean", "oled"]
  );
  assert.equal(THEME_STORAGE_KEY, "web-bot-theme");
});
