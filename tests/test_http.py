"""Exercise actual HTTP framing, admission, CSRF, downloads and API routes."""
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib import request, error
from unittest import mock
from satisfactory_webui import app, archives, api


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.host = '127.0.0.1:' + str(cls.server.server_port)
        cls.base = 'http://' + cls.host
        cls.host_patch = mock.patch.object(app, 'HOSTS', {cls.host})
        cls.host_patch.start()
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.host_patch.stop()

    def get(self, path, **headers):
        return request.urlopen(request.Request(self.base+path, headers=headers), timeout=5)

    def post(self, path, data, **headers):
        defaults = {'X-CSRF-Token': app._csrf, 'Origin': self.base, 'Content-Type': 'application/json'}
        defaults.update(headers)
        return request.urlopen(request.Request(self.base+path, data=json.dumps(data).encode(), headers=defaults), timeout=5)

    def test_all_shells_and_headers(self):
        for path in ['/', '/history', '/backups', '/saves', '/config', '/logs', '/about', '/credits']:
            with self.get(path) as r:
                shell = r.read()
                self.assertIn(b'id="root"', shell)          # React mount point
                self.assertIn(b'/assets/', shell)           # bundled SPA assets
                self.assertIn("script-src 'self'", r.headers['Content-Security-Policy'])
                self.assertEqual(r.headers['X-Frame-Options'], 'DENY')
                self.assertEqual(r.headers['Cache-Control'], 'no-store')

    def test_https_origin_matching_host_is_accepted(self):
        # The WebUI is fronted by an HTTPS proxy (nginx basic-auth vhost); the
        # browser Origin is https while nginx forwards http to the app. The
        # Origin netloc must equal Host and be allowlisted — scheme is transport.
        with mock.patch.object(app.control, 'action', return_value=(True, 'ok')) as control:
            r = self.post('/api/service', {'action': 'restart', 'confirm': True},
                          Origin='https://' + self.host)
            self.assertEqual(r.status, 200)
            control.assert_called_once_with('restart')

    def test_invalid_host_origin_token_and_confirmation(self):
        with self.assertRaises(error.HTTPError) as e:
            self.get('/api/session', Host='attacker.invalid')
        self.assertEqual(e.exception.code, 403)
        for headers in [{'Origin': 'http://attacker.invalid'}, {'X-CSRF-Token': 'wrong'}]:
            with self.assertRaises(error.HTTPError) as e:
                self.post('/api/service', {'action': 'restart'}, **headers)
            self.assertEqual(e.exception.code, 403)
        with mock.patch.object(app.control, 'action') as control:
            with self.assertRaises(error.HTTPError) as e:
                self.post('/api/service', {'action': 'restart'})
            self.assertEqual(e.exception.code, 400)
            control.assert_not_called()

    def test_ranges_and_traversal(self):
        with self.get('/api/history?hours=168') as r:
            self.assertIn('samples', json.load(r))
        for path in ['/api/history?hours=999', '/api/download-save?name=..%2Fetc%2Fpasswd.sav']:
            with self.assertRaises(error.HTTPError) as e:
                self.get(path)
            self.assertEqual(e.exception.code, 400)

    def test_sso_identity_and_logout(self):
        # Without a proxy there is no identity; logout URL is still returned.
        with self.get('/api/sso') as r:
            data = json.load(r)
            self.assertEqual(data['user'], None)
            self.assertFalse(data['authenticated'])
        # The Authelia whitelist vhost forwards the username as Remote-User.
        for value in ['dave', 'pioneer']:
            with self.get('/api/sso', **{'Remote-User': value}) as r:
                data = json.load(r)
                self.assertEqual(data['user'], value)
                self.assertTrue(data['authenticated'])
        import urllib.parse
        expected = 'https://auth.axtriss.site/logout?rd=' + urllib.parse.quote('https://satserv.axtriss.site', safe='')
        with self.get('/api/sso') as r:
            self.assertEqual(json.load(r)['logoutUrl'], expected)

    def test_snapshot_roundtrip_and_removal(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); saves=root/'saves'; backups=root/'backups'; saves.mkdir()
            (saves/'test.sav').write_bytes(b'real fixture')
            with mock.patch.object(archives, 'SAVE_DIR', saves), mock.patch.object(archives, 'BACKUP_DIR', backups):
                with self.post('/api/backup', {'name':'test.sav'}) as r:
                    result=json.load(r)
                with self.get('/api/backups') as r:
                    self.assertEqual(json.load(r)['files'][0]['name'], result['name'])
                with self.get('/api/download-backup?name='+result['name']) as r:
                    self.assertEqual(r.read(), b'real fixture')
                    self.assertIn('attachment', r.headers['Content-Disposition'])
                with self.post('/api/remove-backup', {'name':result['name'], 'confirm':True}) as r:
                    self.assertEqual(json.load(r)['removed'], result['name'])
                self.assertTrue((saves/'test.sav').exists())
                self.assertEqual(archives.list_backups()['files'], [])

    def test_snapshot_accepts_bare_save_name(self):
        # The Saves page lists save names without the .sav suffix and calls
        # /api/backup with exactly that; include the .sav when missing.
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); saves=root/'saves'; backups=root/'backups'; saves.mkdir()
            (saves/'test.sav').write_bytes(b'bare fixture')
            with mock.patch.object(archives, 'SAVE_DIR', saves), mock.patch.object(archives, 'BACKUP_DIR', backups):
                with self.post('/api/backup', {'name':'test'}) as r:
                    result=json.load(r)
                self.assertTrue(result['name'].endswith('.sav'))
                with self.get('/api/download-backup?name='+result['name']) as r:
                    self.assertEqual(r.read(), b'bare fixture')
                with self.post('/api/remove-backup', {'name':result['name'], 'confirm':True}) as r:
                    self.assertEqual(json.load(r)['removed'], result['name'])

    def test_load_request_is_explicitly_vanilla(self):
        with mock.patch.object(api, 'safe_call') as call:
            api.load_game('session', 'save')
            call.assert_called_once_with('LoadGame', {'SaveName':'save', 'EnableAdvancedGameSettings':False})

    def test_built_assets_are_served_with_correct_types(self):
        # The SPA fallback must NOT swallow asset requests: real content and
        # correct MIME types, resolved from the shell the server actually serves.
        with self.get('/') as r:
            shell = r.read().decode()
        import re
        refs = re.findall(r'(?:src|href)="(/assets/[^"]+)"', shell)
        self.assertTrue(refs, 'the shell must reference bundled assets')
        for ref in refs:
            with self.get(ref) as r:
                body = r.read()
                ctype = r.headers['Content-Type']
                self.assertNotIn(b'id="root"', body, 'asset must not be the SPA shell')
                if ref.endswith('.js'):
                    self.assertEqual(ctype, 'application/javascript; charset=utf-8')
                    self.assertGreater(len(body), 200)
                elif ref.endswith('.css'):
                    self.assertEqual(ctype, 'text/css; charset=utf-8')
                    self.assertIn(b'prefers-reduced-motion', body)
        # The entry bundle is split from its lazy chunks but must still be real.
        entry = re.search(r'<script type="module"[^>]+src="(/assets/[^"]+\.js)"', shell)
        assert entry is not None, 'the shell must load a module entry script'
        with self.get(entry.group(1)) as r:
            self.assertGreater(len(r.read()), 100000, 'entry bundle looks like a stub')

    def test_asset_path_traversal_is_rejected(self):
        for bad in ['/assets/../../etc/passwd', '/assets/..%2f..%2fetc%2fpasswd',
                    '/assets/%2e%2e/%2e%2e/etc/passwd', '/assets//etc/passwd']:
            with self.assertRaises(error.HTTPError) as e:
                self.get(bad)
            self.assertEqual(e.exception.code, 404, bad)

    def test_unknown_asset_is_404_not_shell(self):
        with self.assertRaises(error.HTTPError) as e:
            self.get('/assets/does-not-exist.js')
        self.assertEqual(e.exception.code, 404)

    def test_credits_report_the_authorized_frm_reuse(self):
        with self.get('/api/credits') as r:
            data = json.load(r)
        by_name = {p['name']: p for p in data['projects']}
        frm = by_name.get('Bread-Ch4n/FRM-s-WebUI-Source')
        assert frm is not None, 'FRM-s-WebUI-Source must be credited'
        self.assertEqual(frm['revision'], '9f0d01340af1ad17cd6c835c575a6502175e923e')
        # Honest provenance: no license file upstream, owner-authorized reuse.
        self.assertIn('No license file', frm['licenseName'])
        self.assertIn('authorized', frm['license'].lower())
        # The data pages must be explicitly stated as NOT ported.
        self.assertIn('NOT ported', frm['use'])


if __name__ == '__main__':
    unittest.main()
