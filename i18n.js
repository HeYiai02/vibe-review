/* i18n：极简扁平字典 + {var} 插值。
   语言由环境变量决定：LANG=en（或 REVIEW_LANG=en）走英文，默认中文。
   缺 key 时回落到中文，再回落到 key 本身——保证永远不渲染出 undefined。 */
const fs = require('fs');
const path = require('path');

const raw = String(process.env.REVIEW_LANG || process.env.LANG || 'zh').toLowerCase();
const LANG = raw.startsWith('en') ? 'en' : 'zh';
const DIR = path.join(__dirname, 'i18n');

function load(lang) {
  const f = path.join(DIR, lang + '.json');
  try {
    // 去掉 BOM：PowerShell 的 Set-Content -Encoding UTF8 会写 BOM，
    // 而 JSON.parse 遇到 \uFEFF 直接抛错，整本字典会静默变成 {}。
    return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) { return {}; }
}
const DICT = load(LANG);
const FALLBACK = LANG === 'zh' ? DICT : load('zh');

function t(key, vars) {
  let s = DICT[key];
  if (s == null) s = FALLBACK[key];
  if (s == null) s = key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : vars[k]));
  return s;
}

module.exports = { LANG, t, DICT };
