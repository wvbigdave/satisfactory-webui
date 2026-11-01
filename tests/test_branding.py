"""Branding: validation, persistence, logo handling and the HTTP routes.

Branding is operator-supplied input, so this covers the failure modes too:
bad colours, empty names, oversized or malformed logos, and path handling.
"""
import base64
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib import request, error

from satisfactory_webui import app, branding

# A 1x1 PNG — the smallest real image, used to prove the upload path decodes.
PNG_1PX = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
        "1f15c4890000000d49444154789c6360000002000100ffff0300000600"
        "05570c1c0000000049454e44ae426082"
    )
).decode()
PNG_DATA_URL = "data:image/png;base64," + PNG_1PX


class BrandingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        for name, value in [("STATE_DIR", root), ("BRANDING_FILE", root / "branding.json"),
                            ("LOGO_DIR", root / "branding")]:
            patcher = mock.patch.object(branding, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_defaults_when_unset(self):
        data = branding.load()
        self.assertEqual(data["accent"], "#ff963e")
        self.assertIsNone(data["logo"])
        self.assertTrue(data["name"])

    def test_round_trip(self):
        branding.save({"name": "Valhalla Foundry", "tagline": "Smelt it.", "mark": "VF", "accent": "#22d3ee"})
        data = branding.load()
        self.assertEqual(data["name"], "Valhalla Foundry")
        self.assertEqual(data["mark"], "VF")
        self.assertEqual(data["accent"], "#22d3ee")

    def test_rejects_bad_input(self):
        for payload, why in [
            ({"name": "ok", "accent": "red"}, "non-hex accent"),
            ({"name": "ok", "accent": "#12345"}, "short hex"),
            ({"name": ""}, "empty name"),
            ({"name": "ok", "clearLogo": True, "logoDataUrl": PNG_DATA_URL}, "clear+upload"),
            ({"name": "ok", "logoDataUrl": "data:image/png;base64,!!!not-base64!!!"}, "bad base64"),
            ({"name": "ok", "logoDataUrl": "data:text/html;base64,PHNjcmlwdD4="}, "non-image type"),
        ]:
            with self.assertRaises(ValueError, msg=why):
                branding.save(payload)

    def test_lengths_are_capped(self):
        data = branding.save({"name": "x" * 500, "tagline": "y" * 500, "mark": "zzzz"})
        self.assertLessEqual(len(data["name"]), branding.MAX_NAME)
        self.assertLessEqual(len(data["tagline"]), branding.MAX_TAGLINE)
        self.assertLessEqual(len(data["mark"]), branding.MAX_MARK)

    def test_logo_upload_and_clear(self):
        saved = branding.save({"name": "n", "logoDataUrl": PNG_DATA_URL})
        self.assertEqual(saved["logo"], "image/png")
        self.assertIsNotNone(branding.logo_path("image/png"))
        cleared = branding.save({"name": "n", "clearLogo": True})
        self.assertIsNone(cleared["logo"])
        self.assertIsNone(branding.logo_path("image/png"))

    def test_oversized_logo_rejected(self):
        big = "data:image/png;base64," + base64.b64encode(b"0" * (branding.MAX_LOGO_BYTES + 1)).decode()
        with self.assertRaises(ValueError):
            branding.save({"name": "n", "logoDataUrl": big})

    def test_hand_edited_file_cannot_break_reads(self):
        (branding.BRANDING_FILE).write_text(json.dumps({"name": 12, "accent": "nope", "logo": "../../etc/passwd"}))
        data = branding.load()
        self.assertEqual(data["accent"], "#ff963e")
        self.assertIsNone(data["logo"])
        self.assertIsInstance(data["name"], str)


class BrandingHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.host = "127.0.0.1:" + str(cls.server.server_port)
        cls.base = "http://" + cls.host
        cls.host_patch = mock.patch.object(app, "HOSTS", {cls.host})
        cls.host_patch.start()
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.host_patch.stop()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        for name, value in [("STATE_DIR", root), ("BRANDING_FILE", root / "branding.json"),
                            ("LOGO_DIR", root / "branding")]:
            patcher = mock.patch.object(branding, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def get(self, path, **headers):
        return request.urlopen(request.Request(self.base + path, headers=headers), timeout=5)

    def post(self, path, data, **headers):
        defaults = {"X-CSRF-Token": app._csrf, "Origin": self.base, "Content-Type": "application/json"}
        defaults.update(headers)
        return request.urlopen(request.Request(self.base + path, data=json.dumps(data).encode(), headers=defaults), timeout=5)

    def test_get_returns_defaults(self):
        with self.get("/api/branding") as r:
            data = json.load(r)
        self.assertEqual(data["accent"], "#ff963e")
        self.assertIn("name", data)

    def test_logo_is_404_until_one_is_set(self):
        with self.assertRaises(error.HTTPError) as e:
            self.get("/api/logo")
        self.assertEqual(e.exception.code, 404)

    def test_post_requires_csrf(self):
        with self.assertRaises(error.HTTPError) as e:
            self.post("/api/branding", {"name": "x"}, **{"X-CSRF-Token": "wrong"})
        self.assertEqual(e.exception.code, 403)

    def test_save_then_serve_logo(self):
        with self.post("/api/branding", {"name": "Test Rig", "accent": "#5aa9f0", "logoDataUrl": PNG_DATA_URL}) as r:
            saved = json.load(r)
        self.assertEqual(saved["logo"], "image/png")
        with self.get("/api/logo") as r:
            body = r.read()
            self.assertEqual(r.headers["Content-Type"], "image/png")
            self.assertIn("sandbox", r.headers["Content-Security-Policy"])
            self.assertTrue(body.startswith(b"\x89PNG"))
        with self.get("/api/branding") as r:
            self.assertEqual(json.load(r)["name"], "Test Rig")

    def test_bad_payload_is_400(self):
        with self.assertRaises(error.HTTPError) as e:
            self.post("/api/branding", {"name": "ok", "accent": "blue"})
        self.assertEqual(e.exception.code, 400)

    def test_stream_emits_sse_events(self):
        # Read a bounded prefix of the stream rather than waiting for it to end.
        with self.get("/api/stream") as r:
            self.assertEqual(r.headers["Content-Type"], "text/event-stream; charset=utf-8")
            chunk = r.read(4096)
        text = chunk.decode("utf-8", "replace")
        self.assertIn("event: overview", text)
        self.assertIn('"state"', text)


if __name__ == "__main__":
    unittest.main()
