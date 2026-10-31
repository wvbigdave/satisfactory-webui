"""Sandbox must expose metadata directories (not pinned individual inodes)."""
from pathlib import Path
import unittest


class TestDeployment(unittest.TestCase):
    def test_home_is_hidden_with_explicit_server_bind(self):
        unit = (Path(__file__).resolve().parents[1] / 'deploy/satisfactory-webui.service').read_text()
        self.assertIn('ProtectHome=tmpfs', unit)
        self.assertIn('BindReadOnlyPaths=/home/satisfactory/server\n', unit)
        self.assertIn('BindPaths=/home/satisfactory/server/FactoryGame/Saved/Config/LinuxServer\n', unit)
        self.assertNotIn('ProtectHome=false', unit)
