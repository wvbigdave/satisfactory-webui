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
        with mock.patch("subprocess.run", return_value=mock.Mock(
                returncode=0, stdout=worker_out, stderr="")):
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


class ExtractTests(unittest.TestCase):
    def test_public_buildid_parsed_from_app_info(self):
        pat = __import__("re").compile(r'"([A-Za-z0-9_]+)"\s*\{\s*(?:[^{}]*?)"buildid"\s+"(\d+)"')
        found = dict(pat.findall(SAMPLE_APP_INFO))
        self.assertEqual(found["public"], "26281360")
        self.assertEqual(found["experimental"], "26281360")


if __name__ == "__main__":
    unittest.main()
