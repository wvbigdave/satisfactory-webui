"""Monitoring and archive regressions: real sources, bounded storage, no mutations."""
import json
import tempfile
from pathlib import Path
import unittest
from unittest import mock

from satisfactory_webui import monitor, archives, app


class HistoryTests(unittest.TestCase):
    def test_retention_nulls_and_bounded_queries(self):
        with tempfile.TemporaryDirectory() as d:
            store = monitor.History(Path(d) / 'history.sqlite', retention=120, limit=4)
            for t in range(0, 301, 30):
                store.add({'ts': t, 'players': None if t == 300 else 2, 'tps': 30})
            rows = store.read(now=300)['samples']
            self.assertEqual(len(rows), 4)
            self.assertIsNone(rows[-1]['players'])
            self.assertEqual(rows[0]['ts'], 210)
            self.assertEqual(len(store.read(now=300)['heatmap']), 168)
            self.assertEqual(store.read(now=300)['heatmap'][4*24]['players'], 2)
            self.assertTrue(Path(d, 'history.sqlite').exists())

    def test_sampler_preserves_unknown_api_values(self):
        with mock.patch.object(monitor, 'resources', return_value={'memoryBytes': 12}), mock.patch.object(monitor, 'save_sizes', return_value={'bytes': 5}):
            sample = monitor.sample({'ok': False, 'state': None}, {'used': 7})
            self.assertIsNone(sample['players'])
            self.assertIsNone(sample['tps'])
            self.assertEqual(sample['memoryBytes'], 12)

    def test_cpu_counter_restart_is_not_negative(self):
        self.assertIsNone(monitor.cpu_percent((100, 200), (90, 10)))  # negative elapsed
        # 1e9 ns of CPU over 2 s = 50% of one core; cores divisor defaults to os.cpu_count().
        self.assertEqual(monitor.cpu_percent((100, 2000000000), (102, 3000000000), cores=1), 50)
        # Normalized to all given cores: 50% of one core across 4 cores = 12.5%.
        self.assertEqual(monitor.cpu_percent((100, 2000000000), (102, 3000000000), cores=4), 12.5)
        # Never exceeds 100%, even when every core is fully loaded.
        self.assertEqual(monitor.cpu_percent((100, 0), (101, 5000000000), cores=4), 100)


class ArchiveTests(unittest.TestCase):
    def test_snapshot_download_and_safety(self):
        with tempfile.TemporaryDirectory() as d:
            source, target = Path(d, 'saves'), Path(d, 'backups')
            source.mkdir(); target.mkdir()
            (source / 'A save.sav').write_bytes(b'real-save-data')
            (source / 'link.sav').symlink_to(source / 'A save.sav')
            with mock.patch.object(archives, 'SAVE_DIR', source), mock.patch.object(archives, 'BACKUP_DIR', target):
                for invalid in ['../A save.sav', '/etc/passwd', 'link.sav', 'x\n.sav']:
                    with self.assertRaises((ValueError, OSError)):
                        archives.create(invalid)
                result = archives.create('A save.sav')
                rows = archives.list_backups()['files']
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]['name'], result['name'])
                with archives.open_backup(result['name']) as f:
                    self.assertEqual(f.read(), b'real-save-data')
                with mock.patch.object(archives, 'MAX_FILES', 1):
                    with self.assertRaises(ValueError):
                        archives.create('A save.sav')
                self.assertEqual((source / 'A save.sav').read_bytes(), b'real-save-data')

    def test_oversized_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); (p / 'x.sav').write_bytes(b'1234')
            with mock.patch.object(archives, 'SAVE_DIR', p), mock.patch.object(archives, 'MAX_FILE_BYTES', 3):
                with self.assertRaises(ValueError):
                    archives.create('x.sav')

    def test_snapshot_is_not_published_until_verified(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            source, backup = root / 'saves', root / 'backups'
            source.mkdir()
            (source / 'test.sav').write_bytes(b'save')
            def during_write(_fd):
                self.assertEqual(archives.list_backups()['files'], [])
            with mock.patch.object(archives, 'SAVE_DIR', source), \
                    mock.patch.object(archives, 'BACKUP_DIR', backup), \
                    mock.patch.object(archives.os, 'fsync', side_effect=during_write):
                result = archives.create('test')
                self.assertEqual(archives.list_backups()['files'][0]['name'], result['name'])
            self.assertEqual(list(backup.glob('*.tmp')), [])


class SafetyTests(unittest.TestCase):
    def test_offline_api_not_reported_as_ok(self):
        with mock.patch.object(app.api, 'health', return_value=None), mock.patch.object(app.api, 'server_state', return_value=None), mock.patch.object(app.api, 'server_options'), mock.patch.object(app.api, 'advanced_settings'), mock.patch.object(app.api, 'sessions', return_value=[]), mock.patch.object(app.control, 'status', return_value={}):
            app._poll_cache['ts'] = 0
            self.assertFalse(app._fetch_state()['ok'])

    def test_mutating_routes_require_explicit_confirmation(self):
        with mock.patch.object(app.control, 'action') as action:
            result, status = app._post_service({'action': 'restart'})
            self.assertEqual(status, 400)
            action.assert_not_called()

    def test_frontend_never_injects_raw_html(self):
        # The vanilla app escaped strings by hand; the React SPA relies on React's
        # automatic escaping instead. The equivalent guarantee is that no component
        # ever bypasses it, so forbid raw-HTML injection in the frontend source.
        offenders = []
        for path in sorted(Path('frontend/src').rglob('*.ts*')):
            text = path.read_text()
            if 'dangerouslySetInnerHTML' in text or '.innerHTML' in text or 'insertAdjacentHTML' in text:
                offenders.append(str(path))
        self.assertEqual(offenders, [], f'raw HTML injection points: {offenders}')


if __name__ == '__main__':
    unittest.main()
