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
                self.assertIn(b'id="view"', r.read())
                self.assertIn("script-src 'self'", r.headers['Content-Security-Policy'])
                self.assertEqual(r.headers['X-Frame-Options'], 'DENY')
                self.assertEqual(r.headers['Cache-Control'], 'no-store')

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

    def test_load_request_is_explicitly_vanilla(self):
        with mock.patch.object(api, 'safe_call') as call:
            api.load_game('session', 'save')
            call.assert_called_once_with('LoadGame', {'SaveName':'save', 'EnableAdvancedGameSettings':False})

    def test_visual_effects_assets_are_served_explicitly(self):
        # The SPA fallback must NOT swallow the effect files: verify real content
        # and correct MIME type for both, and that reduced-motion is honoured.
        with self.get('/fx.css') as r:
            body = r.read()
            self.assertEqual(r.headers['Content-Type'], 'text/css; charset=utf-8')
            self.assertIn(b'prefers-reduced-motion', body)
            self.assertIn(b'fx-ripple-ring', body)
            self.assertNotIn(b'id="view"', body)
        with self.get('/fx.js') as r:
            body = r.read()
            self.assertEqual(r.headers['Content-Type'], 'application/javascript; charset=utf-8')
            self.assertIn(b'__satisfactoryFx', body)
            self.assertNotIn(b'id="view"', body)
        with self.get('/') as r:
            shell = r.read()
            self.assertIn(b'/fx.css', shell)
            self.assertIn(b'/fx.js', shell)

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
