"""Unit tests for satisfactory_webui — run with `python3 -m unittest discover -s tests -v`."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from satisfactory_webui import fields, control  # noqa: E402


class TestFields(unittest.TestCase):
    def test_server_options_have_required_keys(self):
        for key, defn in fields.SERVER_OPTIONS.items():
            self.assertIn("label", defn)
            self.assertIn("help", defn)
            self.assertIn("kind", defn)

    def test_advanced_settings_have_required_keys(self):
        for key, defn in fields.ADVANCED_SETTINGS.items():
            self.assertIn("label", defn)
            self.assertIn("help", defn)
            self.assertIn("kind", defn)

    def test_bool_options_default_to_valid(self):
        for key, defn in fields.SERVER_OPTIONS.items():
            if defn["kind"] == "bool":
                self.assertIn(defn["default"], ("True", "False"))


class TestControl(unittest.TestCase):
    def test_allowed_actions(self):
        self.assertEqual(control.ALLOWED, {"start", "stop", "restart"})

    @mock.patch("satisfactory_webui.control.subprocess.run")
    def test_action_rejects_unknown(self, mock_run):
        ok, msg = control.action("hack")
        self.assertFalse(ok)
        mock_run.assert_not_called()

    @mock.patch("satisfactory_webui.control.subprocess.run")
    def test_action_success(self, mock_run):
        mock_run.return_value = mock.Mock(returncode=0, stdout="ok", stderr="")
        ok, msg = control.action("restart")
        self.assertTrue(ok)
        self.assertEqual(msg, "ok")


if __name__ == "__main__":
    unittest.main()
