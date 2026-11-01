/* Build-output sanity tests for the React SPA.
 *
 * Run with: node --test tests/test_frontend.js   (no npm dependencies needed —
 * these only inspect the committed build output; they do not build or serve).
 *
 * These guard the invariants the Python server and CSP depend on. The React
 * app's interactive behaviour is verified in a real browser, not here.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = path.join(__dirname, "..", "satisfactory_webui", "web", "app");
const ASSETS = path.join(APP_DIR, "assets");
const INDEX = path.join(APP_DIR, "index.html");
const read = (p) => fs.readFileSync(p, "utf8");

test("built shell has a React root and no inline script/style", () => {
  const html = read(INDEX);
  assert.match(html, /<div id="root"><\/div>/, "must contain the React root element");
  assert.match(html, /<script type="module"[^>]+src="\/assets\//, "must load the bundled module from /assets/");
  assert.match(html, /<link rel="stylesheet"[^>]+href="\/assets\//, "must load the bundled stylesheet from /assets/");
  // CSP is 'self' with no 'unsafe-inline': an inline <script>/<style> would be blocked.
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/, "no inline <script> allowed");
  assert.doesNotMatch(html, /<style[\s>]/, "no inline <style> allowed");
  assert.doesNotMatch(html, /https?:\/\//, "no external asset origins (everything must be self-hosted)");
});

test("every asset referenced by the shell exists and is non-trivial", () => {
  const html = read(INDEX);
  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, "expected at least a JS and a CSS asset");
  for (const ref of refs) {
    const file = path.join(APP_DIR, ref.replace(/^\/assets\//, "assets/"));
    assert.ok(fs.existsSync(file), `missing built asset: ${ref}`);
    assert.ok(fs.statSync(file).size > 1000, `suspiciously small asset: ${ref}`);
  }
});

test("bundled CSS carries the ported visual effects and reduced-motion guards", () => {
  const cssFile = fs.readdirSync(ASSETS).find((f) => f.endsWith(".css"));
  assert.ok(cssFile, "a built CSS bundle must exist");
  const css = read(path.join(ASSETS, cssFile));
  for (const marker of ["magic", "shine", "ripple", "ambient-grid"]) {
    assert.ok(css.includes(marker), `expected effect class "${marker}" in the bundle`);
  }
  assert.ok(css.includes("prefers-reduced-motion"), "effects must honour prefers-reduced-motion");
});

test("bundled JS is a real application bundle, not a placeholder", () => {
  const jsFile = fs.readdirSync(ASSETS).find((f) => f.endsWith(".js"));
  assert.ok(jsFile, "a built JS bundle must exist");
  const js = read(path.join(ASSETS, jsFile));
  assert.ok(js.length > 100000, "bundle looks too small to be the real app");
  assert.ok(js.includes("root"), "bundle should reference the React mount point");
});
