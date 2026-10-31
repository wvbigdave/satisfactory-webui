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
    }}; }, querySelector() { return element(); }},
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
for (const path of ['/', '/saves', '/config', '/logs', '/about']) {
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
