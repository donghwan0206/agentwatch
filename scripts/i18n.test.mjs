import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const i18n = require("../static/i18n.js");
const html = readFileSync("static/index.html", "utf8");
const app = readFileSync("static/app.js", "utf8");
const server = readFileSync("src-tauri/src/server.rs", "utf8");
const localeCodes = i18n.locales.map((locale) => locale.code);

assert.deepEqual(localeCodes, ["en", "ko", "ja", "zh"]);
assert.equal(i18n.detectLocale(["ko-KR"]), "ko");
assert.equal(i18n.detectLocale(["ja-JP"]), "ja");
assert.equal(i18n.detectLocale(["zh-Hant-TW"]), "zh");
assert.equal(i18n.detectLocale(["fr-FR", "en-GB"]), "en");
assert.equal(i18n.detectLocale(["fr-FR"]), "en");
assert.equal(i18n.translate("ja", "tokens.today", { value: "12K" }), "今日 12K");
assert.equal(i18n.translate("zh", "update.current", { version: "1.2.3" }), "当前 v1.2.3");

const storage = {
  value: null,
  getItem(key) {
    assert.equal(key, i18n.STORAGE_KEY);
    return this.value;
  },
  setItem(key, value) {
    assert.equal(key, i18n.STORAGE_KEY);
    this.value = value;
  },
};
assert.equal(i18n.initialLocale(storage, { languages: ["ja-JP"] }), "ja");
i18n.saveLocale(storage, "ko");
assert.equal(i18n.initialLocale(storage, { languages: ["zh-CN"] }), "ko");

for (const [key, translations] of Object.entries(i18n.messages)) {
  assert.deepEqual(Object.keys(translations).sort(), [...localeCodes].sort(), `${key} must support all locales`);
  for (const locale of localeCodes) {
    assert.ok(translations[locale].trim(), `${key}.${locale} must not be empty`);
  }
}

const referencedKeys = new Set();
for (const match of html.matchAll(/data-i18n(?:-aria-label|-title)?="([^"]+)"/g)) {
  referencedKeys.add(match[1]);
}
for (const match of app.matchAll(/\bt\("([^"]+)"/g)) {
  if (!match[1].includes("${")) referencedKeys.add(match[1]);
}
for (const key of referencedKeys) {
  assert.ok(i18n.messages[key], `missing translation key: ${key}`);
}

for (const marker of [
  'const I18N_JS: &str = include_str!("../../static/i18n.js")',
  '.route("/i18n.js", get(i18n_js))',
  "async fn i18n_js()",
]) {
  assert.match(server, new RegExp(escapeRegExp(marker)), `server missing i18n asset contract: ${marker}`);
}

assert.match(html, /href="https:\/\/github\.com\/donghwan0206\/agentwatch"/);
assert.equal((html.match(/data-locale="(?:en|ko|ja|zh)"/g) || []).length, 4);
assert.match(app, /I18N\.initialLocale\(window\.localStorage, navigator\)/);
assert.match(app, /I18N\.saveLocale\(window\.localStorage, normalized\)/);

console.log("i18n tests ok");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
