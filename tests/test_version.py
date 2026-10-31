"""Installed metadata only: never substitute save-header or latest-release versions."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from satisfactory_webui import app


class TestInstalledVersion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.manifest = Path(self.tmp.name) / 'manifest.acf'
        self.runtime = Path(self.tmp.name) / 'server.version'
        self.manifest.write_text('"AppState" { "appid" "1690800" "buildid" "12345" "TargetBuildID" "99999" }')
        self.runtime.write_text(json.dumps({'GameVersion': '1.2.3.4', 'Changelist': 123456,
                                            'MajorVersion': 5, 'MinorVersion': 6}))
        for name, value in [('STEAM_MANIFEST', str(self.manifest)), ('GAME_METADATA', str(self.runtime))]:
            patcher = mock.patch.object(app, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_installed_values_and_sources(self):
        info = app._installed_version()
        self.assertEqual(info['steamBuildId'], '12345')
        self.assertEqual(info['gameVersion'], '1.2.3.4')
        self.assertEqual(info['changelist'], '123456')
        self.assertEqual(info['steamSource'], str(self.manifest))
        self.assertEqual(info['gameSource'], str(self.runtime))

    def test_missing_is_unknown(self):
        self.manifest.unlink()
        self.runtime.unlink()
        info = app._installed_version()
        for key in ['steamBuildId', 'gameVersion', 'changelist']:
            self.assertIsNone(info[key])
        self.assertTrue(info['errors'])

    def test_malformed_or_wrong_app_not_a_version(self):
        self.manifest.write_text('"AppState" { "appid" "42" "buildid" "888" }')
        self.runtime.write_text('not json')
        info = app._installed_version()
        self.assertIsNone(info['steamBuildId'])
        self.assertIsNone(info['gameVersion'])

    def test_unreal_engine_version_is_not_game_version(self):
        self.runtime.write_text('{"MajorVersion":5,"MinorVersion":6,"PatchVersion":1,"Changelist":513885}')
        info = app._installed_version()
        self.assertIsNone(info['gameVersion'])
        self.assertEqual(info['changelist'], '513885')

    def test_reads_changes_without_ui_restart(self):
        app._installed_version()
        self.manifest.write_text('"AppState" { "appid" "1690800" "buildid" "67890" }')
        self.assertEqual(app._installed_version()['steamBuildId'], '67890')

    @mock.patch.object(app, '_fetch_state', return_value={'ok': False})
    def test_overview_has_version_even_if_game_offline(self, state):
        self.assertEqual(app._route_overview()['serverVersion']['steamBuildId'], '12345')

    @mock.patch.object(app, '_listeners', return_value='')
    @mock.patch.object(app.control, 'status', return_value={})
    def test_about_distinguishes_ui_version(self, status, listeners):
        info = app._route_about()
        self.assertEqual(info['version'], app.__version__)
        self.assertEqual(info['serverVersion']['steamBuildId'], '12345')
