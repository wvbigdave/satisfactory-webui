"""Generate a site-neutral, least-privilege Linux/systemd deployment."""
import argparse
import grp
import ipaddress
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parents[1]


def systemd_quote(value):
    if any(c in str(value) for c in '\n\r\0'):
        raise ValueError('configuration values must be single-line')
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--user', required=True, help='Existing OS account running the game server')
    p.add_argument('--group', help='Defaults to that account’s primary group')
    p.add_argument('--server-dir', help='Game install directory (default: USER_HOME/server)')
    p.add_argument('--save-dir', help='Actual .sav directory (default: USER_HOME/.config/Epic/FactoryGame/Saved/SaveGames/server)')
    p.add_argument('--config-dir', help='Game config directory (default: SERVER_DIR/FactoryGame/Saved/Config/LinuxServer)')
    p.add_argument('--code-dir', default='/opt/satisfactory-webui', help='Root-owned WebUI installation directory')
    p.add_argument('--service', default='satisfactory.service', help='Game systemd unit')
    p.add_argument('--cgroup', help='Override the game cgroup path for custom systemd slices')
    p.add_argument('--bind', default='127.0.0.1', help='IPv4 listen address (loopback by default)')
    p.add_argument('--port', type=int, default=8082)
    p.add_argument('--networks', default='127.0.0.0/8', help='Comma-separated admitted IPv4 CIDRs')
    p.add_argument('--hosts', help='Exact comma-separated Host headers, including port where required')
    p.add_argument('--steamcmd', default='/usr/games/steamcmd', help='Absolute SteamCMD executable path')
    p.add_argument('--api-url', default='https://127.0.0.1:7777/api/v1')
    p.add_argument('--sso-logout', default='', help='Optional authenticated proxy logout URL')
    p.add_argument('--sso-return', default='', help='Optional post-logout return URL')
    p.add_argument('--dry-run', action='store_true', help='Print generated configuration; change nothing')
    return p


def render(args, account):
    if getattr(account, 'pw_uid', 1) == 0:
        raise ValueError('the WebUI must run as an unprivileged game account, not root')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*[$]?', args.user):
        raise ValueError('invalid user name')
    group = args.group or grp.getgrgid(account.pw_gid).gr_name
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*[$]?', group):
        raise ValueError('invalid group name')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@:-]*\.service', args.service):
        raise ValueError('invalid game unit name')
    if args.service == 'satisfactory-webui.service':
        raise ValueError('game service cannot be the WebUI service')
    if not 1 <= args.port <= 65535:
        raise ValueError('invalid port')
    ipaddress.IPv4Address(args.bind)
    for cidr in args.networks.split(','):
        ipaddress.IPv4Network(cidr.strip(), strict=False)
    home = Path(account.pw_dir)
    server = Path(args.server_dir or home / 'server')
    saves = Path(args.save_dir or home / '.config/Epic/FactoryGame/Saved/SaveGames/server')
    config = Path(args.config_dir or server / 'FactoryGame/Saved/Config/LinuxServer')
    code = Path(args.code_dir)
    for path in (home, server, saves, config, code, Path(args.steamcmd)):
        if not path.is_absolute() or '..' in path.parts:
            raise ValueError('all paths must be absolute without parent traversal')
    server, saves, config = server.resolve(), saves.resolve(), config.resolve()
    if code == Path('/') or code in (home, server, saves) or code in SOURCE.parents:
        raise ValueError('unsafe code installation directory')
    hosts = args.hosts or f'{args.bind}:{args.port},127.0.0.1:{args.port},localhost:{args.port}'
    env = {
        'SATISFACTORY_BIND': args.bind, 'SATISFACTORY_PORT': args.port,
        'SATISFACTORY_NETWORKS': args.networks, 'SATISFACTORY_HOSTS': hosts,
        'SATISFACTORY_SERVER_DIR': server, 'SATISFACTORY_SAVE_DIR': saves,
        'SATISFACTORY_CONFIG_DIR': config, 'SATISFACTORY_SERVICE': args.service,
        'SATISFACTORY_STATE_DIR': '/var/lib/satisfactory-webui',
        'SATISFACTORY_API_URL': args.api_url, 'SATISFACTORY_SSO_LOGOUT': args.sso_logout,
        'SATISFACTORY_SSO_RETURN': args.sso_return,
    }
    if args.cgroup:
        if not Path(args.cgroup).is_absolute():
            raise ValueError('cgroup path must be absolute')
        env['SATISFACTORY_CGROUP'] = args.cgroup
    substitutions = {'USER': args.user, 'GROUP': group, 'SERVICE': args.service,
                     'WORKING_DIR': str(code).replace('%', '%%'),
                     'CODE_DIR': systemd_quote(code), 'SERVER_DIR': systemd_quote(server),
                     'SAVE_DIR': systemd_quote(saves)}
    unit = (SOURCE / 'deploy/satisfactory-webui.service').read_text()
    sudoers = (SOURCE / 'deploy/satisfactory-webui.sudoers').read_text()
    for key, value in substitutions.items():
        unit = unit.replace('@' + key + '@', value)
        sudoers = sudoers.replace('@' + key + '@', value)
    # Custom config dirs must be visible in the sandbox, but never writable.
    unit = unit.replace('StateDirectory=satisfactory-webui',
                        f'BindReadOnlyPaths={systemd_quote(config)}\nStateDirectory=satisfactory-webui')
    helper = {'GAME_USER': args.user, 'GAME_GROUP': group, 'GAME_HOME': str(home),
              'INSTALL_DIR': str(server), 'STEAMCMD': args.steamcmd, 'SERVICE': args.service}
    return {
        'satisfactory-webui.service': unit,
        'satisfactory-webui.sudoers': sudoers,
        'webui.env': ''.join(f'{k}={systemd_quote(v)}\n' for k, v in env.items()),
        'update.conf': ''.join(f'{k}={shlex.quote(v)}\n' for k, v in helper.items()),
    }


def main():
    args = parser().parse_args()
    try:
        account = pwd.getpwnam(args.user)
        files = render(args, account)
    except (KeyError, ValueError) as error:
        raise SystemExit(str(error)) from error
    if args.dry_run:
        for name, text in files.items():
            print(f'# {name}\n{text}')
        return
    if os.geteuid() != 0:
        raise SystemExit('installation requires root; use --dry-run to preview')
    # Validate and test before writing any privileged configuration.
    subprocess.run(['/usr/bin/python3', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], cwd=SOURCE, check=True)
    with tempfile.TemporaryDirectory(prefix='satisfactory-webui-install-') as tmp:
        allowlist = Path(tmp) / 'sudoers'
        allowlist.write_text(files['satisfactory-webui.sudoers'])
        subprocess.run(['/usr/sbin/visudo', '-cf', str(allowlist)], check=True)
        if Path('/usr/bin/systemd-analyze').is_file():
            unit = Path(tmp) / 'satisfactory-webui.service'
            unit.write_text(files['satisfactory-webui.service'])
            subprocess.run(['/usr/bin/systemd-analyze', 'verify', str(unit)], check=True)
    code = Path(args.code_dir)
    if code.exists() and code.resolve() != SOURCE and not (code / 'satisfactory_webui/app.py').is_file():
        raise SystemExit('refusing to install over a directory that is not a WebUI installation')
    for path in (code, *code.parents):
        if path.is_symlink():
            raise SystemExit(f'refusing symlink in code installation path: {path}')
    if code.exists():
        for path in code.rglob('*'):
            if path.is_symlink():
                raise SystemExit(f'refusing symlink in existing code installation: {path}')
    if code.resolve() != SOURCE:
        for directory in ('satisfactory_webui', 'frontend', 'deploy', 'tests', 'licenses'):
            shutil.copytree(SOURCE / directory, code / directory, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('node_modules', '__pycache__', '.venv'))
        for name in ('README.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md'):
            shutil.copy2(SOURCE / name, code / name)
    for root, dirs, names in os.walk(code):
        for name in ['.'] + dirs + names:
            path = Path(root) / name
            if path.is_symlink():
                raise SystemExit(f'refusing symlink in code installation: {path}')
            os.chown(path, 0, 0)
            path.chmod(path.stat().st_mode & ~0o022)
    config_dir = Path('/etc/satisfactory-webui')
    config_dir.mkdir(mode=0o755, exist_ok=True)
    targets = {
        'webui.env': (config_dir / 'webui.env', 0o600),
        'update.conf': (config_dir / 'update.conf', 0o600),
        'satisfactory-webui.service': (Path('/etc/systemd/system/satisfactory-webui.service'), 0o644),
        'satisfactory-webui.sudoers': (Path('/etc/sudoers.d/satisfactory-webui'), 0o440),
    }
    for name, (target, mode) in targets.items():
        with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(files[name])
        temporary.chmod(mode)
        os.replace(temporary, target)
    for name in ('satisfactory-server-update', 'satisfactory-server-update-worker'):
        target = Path('/usr/local/sbin') / name
        shutil.copyfile(SOURCE / 'deploy' / name, target)
        os.chown(target, 0, 0)
        target.chmod(0o755)
    subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
    subprocess.run(['/usr/bin/systemctl', 'enable', 'satisfactory-webui.service'], check=True)
    subprocess.run(['/usr/bin/systemctl', 'restart', 'satisfactory-webui.service'], check=True)
    subprocess.run(['/usr/bin/systemctl', 'is-active', 'satisfactory-webui.service'], check=True)


if __name__ == '__main__':
    main()
