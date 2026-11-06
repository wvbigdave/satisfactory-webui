"""Configuration must not depend on the original author's machine."""
import json
import os
import subprocess
import sys
import unittest


class PortableConfigTests(unittest.TestCase):
    def run_config(self, values):
        env = {k: v for k, v in os.environ.items() if not k.startswith('SATISFACTORY_')}
        env.update(values)
        return subprocess.run([sys.executable, '-c', '''
import json
from satisfactory_webui import app, api, config, control, monitor, archives, branding, update
print(json.dumps({"bind": app.BIND, "hosts": app.HOSTS, "logout": app._route_sso({})["logoutUrl"],
 "server": str(config.SERVER_DIR), "save": str(archives.SAVE_DIR), "state": str(branding.STATE_DIR),
 "manifest": str(update.STEAM_MANIFEST), "service": control.SERVICE, "cgroup": str(monitor.CGROUP), "api": api.API}))
'''], env=env, capture_output=True, text=True, timeout=10)

    def test_safe_site_neutral_defaults(self):
        result = self.run_config({})
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['bind'], '127.0.0.1')
        self.assertEqual(data['logout'], '')
        self.assertNotIn('axtriss', result.stdout)

    def test_custom_paths_account_network_and_service(self):
        result = self.run_config({
            'SATISFACTORY_SERVER_DIR': '/srv/factory', 'SATISFACTORY_SAVE_DIR': '/data/saves',
            'SATISFACTORY_STATE_DIR': '/data/webui', 'SATISFACTORY_SERVICE': 'factory.service',
            'SATISFACTORY_BIND': '10.20.30.40', 'SATISFACTORY_PORT': '9090',
            'SATISFACTORY_NETWORKS': '10.20.30.0/24',
            'SATISFACTORY_API_URL': 'https://127.0.0.1:8888/api/v1',
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['server'], '/srv/factory')
        self.assertEqual(data['save'], '/data/saves')
        self.assertEqual(data['state'], '/data/webui')
        self.assertEqual(data['manifest'], '/srv/factory/steamapps/appmanifest_1690800.acf')
        self.assertEqual(data['service'], 'factory.service')
        self.assertTrue(data['cgroup'].endswith('/factory.service'))
        self.assertIn('10.20.30.40:9090', data['hosts'])
        self.assertEqual(data['api'], 'https://127.0.0.1:8888/api/v1')

    def test_remote_api_requires_verified_tls(self):
        result = self.run_config({'SATISFACTORY_API_URL': 'https://game.example.com/api/v1',
                                  'SATISFACTORY_API_VERIFY_TLS': '0'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('TLS verification', result.stderr)
