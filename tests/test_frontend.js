/* Run with node --test tests/test_frontend.js; no npm dependencies. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('satisfactory_webui/web/app.js', 'utf8');

function boot(path, response) {
  const elements = {};
  function element() {
    return {textContent: '', innerHTML: '', hidden: false, className: '',
      attrs: {'aria-busy': 'true'}, addEventListener() {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; }, querySelectorAll() { return []; }};
  }
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const context = {document: {
    getElementById(id) { return elements[id] ||= element(); },
    createElement() { return {textContent: '', get innerHTML() {
      return String(this.textContent).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }}; }, querySelector() { return element(); }, querySelectorAll() { return []; }},
    location: {pathname: path}, window: {addEventListener() {}},
    setInterval() {}, clearInterval() {},
    fetch(url) {
      if (url === '/api/session') return Promise.resolve({ok: true, json: async () => ({csrf: 'test'})});
      if (url === '/api/version') return Promise.resolve({ok: true, json: async () => ({version: 'test'})});
      return pending;
    }};
  vm.runInNewContext(source, context);
  return {elements, finish() {
    if (response instanceof Error) reject(response);
    else resolve({ok: true, json: async () => response});
  }};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('settling a load preserves an intervening action notice', async () => {
  const app = boot('/logs', {text: 'hello'});
  await flush();
  app.elements.notice.textContent = 'Saved manual_save';
  app.finish();
  await flush();
  assert.equal(app.elements.notice.textContent, 'Saved manual_save');
  assert.equal(app.elements.notice.hidden, false);
});
test('About labels UI, installed game, CL and Steam separately', async () => {
  const app = boot('/about', {version: '0.2.0', networks: [], serverVersion: {
    gameVersion: '1.2.3.4', changelist: '123456', steamBuildId: '999999',
    steamSource: '/manifest.acf', gameSource: '/server.version'}});
  await flush(); app.finish(); await flush();
  const html = app.elements.view.innerHTML;
  for (const value of ['WebUI version', 'Game version', 'Game changelist (CL)',
    'Steam build ID', '0.2.0', '1.2.3.4', '123456', '999999', '/manifest.acf', '/server.version'])
    assert.ok(html.includes(value), value);
});
for (const path of ['/', '/saves', '/config', '/logs', '/about', '/history', '/backups', '/credits']) {
  for (const mode of ['success', 'api-error', 'network-error']) {
    test(`${path}: loading settles after ${mode}`, async () => {
      const data = mode === 'network-error' ? new Error('network unavailable') :
        mode === 'api-error' ? {ok: false, error: 'offline'} :
        {ok: true, state: {}, sessions: [], serverFields: {}, advancedFields: {},
          serverOptions: {}, advanced: {}, networks: [], serverVersion: {}};
      const app = boot(path, data);
      await flush();
      assert.equal(app.elements.notice.textContent, 'Loading…');
      assert.equal(app.elements.view.getAttribute('aria-busy'), 'true');
      app.finish();
      await flush();
      assert.equal(app.elements.view.getAttribute('aria-busy'), 'false');
      assert.notEqual(app.elements.notice.textContent, 'Loading…');
      assert.equal(app.elements.notice.hidden, true);
      assert.ok(app.elements.view.innerHTML.length > 0);
      if (mode === 'success') assert.doesNotMatch(app.elements.view.innerHTML, /class="err"/);
      if (mode === 'network-error') assert.match(app.elements.view.innerHTML, /network unavailable/);
      if (mode === 'api-error' && ['/', '/saves', '/config'].includes(path))
        assert.match(app.elements.view.innerHTML, /offline/);
    });
  }
}
test('overview hero carries the shine/ripple effect classes', async () => {
  const app = boot('/', {ok: true, state: {}, history: {}, resources: {}, disk: {},
    saveStorage: {}, serverVersion: {}});
  await flush(); app.finish(); await flush();
  const html = app.elements.view.innerHTML;
  assert.ok(html.includes('hero fx-shine'), 'hero must use fx-shine');
  assert.ok(html.includes('fx-ripple-ring'), 'hero must include ripple rings');
  assert.ok(html.includes('fx-magic'), 'metric cards must use fx-magic');
});
test('credits page renders the authorized FRM reuse entry', async () => {
  const app = boot('/credits', {projects: [{
    name: 'Bread-Ch4n/FRM-s-WebUI-Source',
    url: 'https://github.com/Bread-Ch4n/FRM-s-WebUI-Source',
    revision: '9f0d01340af1ad17cd6c835c575a6502175e923e',
    licenseName: 'No license file (reuse authorized by repo owner)',
    license: 'Upstream ships without a license file; reuse authorized by the owner.',
    use: 'Adapted techniques; data pages NOT ported.'}]});
  await flush(); app.finish(); await flush();
  const html = app.elements.view.innerHTML;
  assert.ok(html.includes('Bread-Ch4n/FRM-s-WebUI-Source'), 'FRM must be credited');
  assert.ok(html.includes('9f0d01340af1ad17cd6c835c575a6502175e923e'), 'pinned revision shown');
  assert.ok(html.includes('No license file'), 'license status shown honestly');
  assert.ok(html.includes('Deliberately not included'), 'exclusions stated');
});
