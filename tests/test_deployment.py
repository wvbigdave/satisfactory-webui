"""Sandbox must expose metadata directories (not pinned individual inodes)."""
from pathlib import Path
import json
import importlib.util
import os
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest


class TestDeployment(unittest.TestCase):
    @staticmethod
    def installer():
        path = Path(__file__).resolve().parents[1] / 'deploy/install.py'
        spec = importlib.util.spec_from_file_location('webui_installer', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_home_is_hidden_with_explicit_server_bind(self):
        installer = self.installer()
        args = installer.parser().parse_args(['--user', 'games', '--group', 'games', '--server-dir', '/srv/factory', '--save-dir', '/srv/saves', '--service', 'factory.service'])
        files = installer.render(args, SimpleNamespace(pw_dir='/srv/games', pw_gid=1000))
        unit = files['satisfactory-webui.service']
        self.assertIn('ProtectHome=tmpfs', unit)
        self.assertIn('BindReadOnlyPaths="/srv/factory"\n', unit)
        self.assertIn('BindReadOnlyPaths="/srv/saves"\n', unit)
        self.assertIn('User=games', unit)
        self.assertIn('WorkingDirectory=/opt/satisfactory-webui\n', unit)
        self.assertIn('stop factory.service', files['satisfactory-webui.sudoers'])
        self.assertIn('SERVICE=factory.service', files['update.conf'])
        self.assertNotIn('BindPaths=', unit)
        self.assertNotIn('ProtectHome=false', unit)

    def test_installer_rejects_unsafe_unit_and_paths(self):
        installer = self.installer()
        for extra in (['--service', 'x.service;id'], ['--code-dir', '/'], ['--server-dir', 'relative']):
            args = installer.parser().parse_args(['--user', 'games', '--group', 'games', *extra])
            with self.assertRaises(ValueError):
                installer.render(args, SimpleNamespace(pw_dir='/srv/games', pw_gid=1000))

    def test_worker_passes_branch_to_app_update_not_global_argv(self):
        worker_source = (Path(__file__).resolve().parents[1] / 'deploy/satisfactory-server-update-worker').read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            steam = root / 'steamcmd'
            steam.write_text(f'#!{sys.executable}\nimport json, os, sys\n'
                             'open(os.environ["TEST_STEAM_ARGS"], "w").write(json.dumps(sys.argv[1:]))\n')
            steam.chmod(0o755)
            for name, output in [('sudo', ''), ('systemctl', 'active')]:
                stub = root / name
                stub.write_text('#!/bin/sh\nprintf "%s\\n" "' + output + '"\n')
                stub.chmod(0o755)
            worker = root / 'worker'
            worker.write_text(worker_source)
            target = root / 'argv.json'
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'], 'TEST_STEAM_ARGS': str(target)}
            for branch in ('public', 'experimental'):
                result = subprocess.run(['bash', str(worker), 'update', '1690800', str(root), branch, 'yes', str(steam), 'factory.service'],
                                        env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                args = json.loads(target.read_text())
                self.assertEqual(args[args.index('+app_update'):], ['+app_update', '1690800', '-beta', branch, 'validate', '+quit'])

    def test_transient_update_unit_has_a_runtime_limit(self):
        helper = (Path(__file__).resolve().parents[1] / 'deploy/satisfactory-server-update').read_text()
        self.assertIn('--property="RuntimeMaxSec=$runtime"', helper)
