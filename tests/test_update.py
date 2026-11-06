"""Update module: build availability aggregate, branch validation, quota, and
safe delegation to the fixed sudo helper. No real steamcmd or sudo is executed.
"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from satisfactory_webui import update

SAMPLE_APP_INFO = """
"branches"
{
    "public"
    {
        "description"   "Default branch"
        "timeupdated"   "1690000000"
        "buildid"       "26281360"
        "pwdrequired"   "0"
    }
    "experimental"
    {
        "description"   "Experimental"
        "timeupdated"   "1690000000"
        "buildid"       "26281360"
    }
}
"""


class UpdateStatusTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.manifest = self.dir / "appmanifest_1690800.acf"
        self.runtime = self.dir / "server.version"
        self.manifest.write_text('"AppState" { "appid" "1690800" "buildid" "25782485" }')
        self.runtime.write_text('{"GameVersion": "1.2.4.1", "Changelist": 513885}')

        self.manifest_patcher = mock.patch(
            "satisfactory_webui.update.open",
            mock.mock_open(read_data=self.manifest.read_text()),
            create=True,
        )
        self.runtime_patcher = mock.patch(
            "satisfactory_webui.app.open",
            mock.mock_open(read_data=self.runtime.read_text()),
            create=True,
        )
        self.manifest_patcher.start()
        self.runtime_patcher.start()
        self.addCleanup(self.manifest_patcher.stop)
        self.addCleanup(self.runtime_patcher.stop)
        # The real sudo helper lives at /usr/local/sbin only on the target host;
        # fake its presence so the helper-existence gate passes in unit tests.
        self.exists_patcher = mock.patch.object(update.os.path, "exists", return_value=True)
        self.access_patcher = mock.patch.object(update.os, "access", return_value=True)
        self.exists_patcher.start()
        self.access_patcher.start()
        self.addCleanup(self.exists_patcher.stop)
        self.addCleanup(self.access_patcher.stop)
        # Patch the module-level job/available state so tests are isolated.
        self.started_job = {
            "running": False, "mode": None, "startedAt": None, "finishedAt": None,
            "exitCode": None, "error": None, "log": __import__("collections").deque(maxlen=update.LOG_TAIL),
        }
        self.avail = {"ts": 0.0, "byBranch": {}, "error": None}
        update._job, update._available = self.started_job, self.avail
        self.state_patch = mock.patch.object(update, 'STATE_DIR', self.dir)
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)

    def test_installed_read_from_disk(self):
        info = update._read_installed()
        self.assertEqual(info["steamBuildId"], "25782485")

    def test_empty_status_without_check(self):
        st = update.status()
        self.assertEqual(st["installed"]["steamBuildId"], "25782485")
        self.assertFalse(st["available"]["byBranch"])
        self.assertFalse(st["updateAvailable"])
        self.assertFalse(st["job"]["running"])

    def test_check_parses_branch_buildids(self):
        # The worker normalizes raw app_info into `AVAILABLE <branch>=<buildid>`
        # lines; update.check() parses exactly that (never raw steamcmd output).
        worker_out = "AVAILABLE public=26281360\nAVAILABLE experimental=26281360\n"
        with mock.patch.object(update, '_run_helper', return_value=(0, worker_out.splitlines())):
            update.check()
            # check() returns after spawning the thread; poll for the threaded result.
            import time
            for _ in range(100):
                if update._available["ts"]:
                    break
                time.sleep(0.02)
        self.assertEqual(update._available["byBranch"]["public"], "26281360")
        self.assertEqual(update._available["byBranch"]["experimental"], "26281360")
        self.assertTrue(update.status()["updateAvailable"])

    def test_up_to_date_when_equal(self):
        update._available = {"ts": 1, "byBranch": {"public": "25782485"}, "error": None}
        self.assertFalse(update.status()["updateAvailable"])

    def test_unknown_when_never_checked(self):
        update._available = {"ts": 0, "byBranch": {}, "error": None}
        self.assertFalse(update.status()["updateAvailable"])

    def test_branch_must_be_allowed(self):
        ok, payload = update.start_update("hack")
        self.assertFalse(ok)
        self.assertIn("branch", payload["error"])

    def test_update_rejects_second_concurrent(self):
        update._job["running"] = True
        ok, payload = update.start_update("public")
        self.assertFalse(ok)
        self.assertIn("already running", payload["error"])

    def test_failed_checks_are_also_quota_limited(self):
        import time
        update._available = {"ts": time.time(), "byBranch": {}, "error": "Steam offline"}
        with mock.patch.object(update, '_run_helper') as run:
            self.assertTrue(update.check()['quotaLimited'])
            run.assert_not_called()

    def test_validate_requires_a_real_boolean(self):
        for value in (0, 1, 'yes', [], None):
            self.assertFalse(update.start_update('public', value)[0])

    def test_persistent_log_is_bounded(self):
        for i in range(update.LOG_TAIL + 5):
            update._append_log(str(i) + 'x' * (update.LOG_LINE_CHARS + 10))
        lines = (self.dir / 'update.log').read_text().splitlines()
        self.assertEqual(len(lines), update.LOG_TAIL)
        self.assertTrue(all(len(line) <= update.LOG_LINE_CHARS for line in lines))

    def test_successful_update_keeps_stdout(self):
        with mock.patch.object(update, '_run_helper', return_value=(0, ['done'])):
            update._JobThread(['unused'], 'update').run()
        self.assertEqual(update._job['exitCode'], 0)
        self.assertFalse(update._job['running'])


class HelperOutputTests(unittest.TestCase):
    def test_output_arrives_before_process_exits(self):
        import sys
        import threading
        seen = threading.Event()
        release = threading.Event()
        processes = []
        real_popen = update.subprocess.Popen
        def popen(*args, **kwargs):
            proc = real_popen(*args, **kwargs)
            processes.append(proc)
            return proc
        def append(line):
            if line == 'progress':
                seen.set()
                release.wait(3)
        result = []
        with mock.patch.object(update, '_append_log', side_effect=append), \
                mock.patch.object(update.subprocess, 'Popen', side_effect=popen):
            thread = threading.Thread(target=lambda: result.append(update._run_helper(
                [sys.executable, '-u', '-c', "import time; print('progress'); time.sleep(1); print('done')"], 5)))
            thread.start()
            try:
                self.assertTrue(seen.wait(3))
                self.assertIsNone(processes[0].poll(), 'progress must arrive while the child is running')
                self.assertTrue(thread.is_alive())
            finally:
                release.set()
                thread.join(5)
        self.assertEqual(result, [(0, ['progress', 'done'])])

    def test_timeout_terminates_child(self):
        import sys
        import subprocess
        with self.assertRaises(subprocess.TimeoutExpired):
            update._run_helper([sys.executable, '-c', 'import time; time.sleep(30)'], 0.1)

    def test_no_newline_output_is_bounded(self):
        import sys
        with mock.patch.object(update, '_append_log'):
            code, lines = update._run_helper([sys.executable, '-c', "print('x' * 1000000, end='')"], 5)
        self.assertEqual(code, 0)
        self.assertLessEqual(len(lines), update.LOG_TAIL)
        self.assertTrue(all(len(line) <= update.LOG_LINE_CHARS for line in lines))


class ExtractTests(unittest.TestCase):
    def test_public_buildid_parsed_from_app_info(self):
        pat = __import__("re").compile(r'"([A-Za-z0-9_]+)"\s*\{\s*(?:[^{}]*?)"buildid"\s+"(\d+)"')
        found = dict(pat.findall(SAMPLE_APP_INFO))
        self.assertEqual(found["public"], "26281360")
        self.assertEqual(found["experimental"], "26281360")


if __name__ == "__main__":
    unittest.main()
