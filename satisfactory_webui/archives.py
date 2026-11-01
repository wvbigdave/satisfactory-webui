"""Explicit, bounded local snapshots. Never loads, rewrites or deletes game saves."""
import datetime
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import threading
import uuid

SAVE_DIR = Path('/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames/server')
BACKUP_DIR = Path(os.environ.get('SATISFACTORY_STATE_DIR', '/var/lib/satisfactory-webui')) / 'backups'
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_FILES = 32
_lock = threading.Lock()


def validate(name):
    if not isinstance(name, str) or not name.endswith('.sav') or len(name) > 180 or not name:
        raise ValueError('Expected a .sav filename (maximum 180 characters)')
    if any(c in name for c in '/\\') or any(ord(c) < 32 or ord(c) == 127 for c in name) or name in ('.', '..'):
        raise ValueError('Invalid filename')
    return name


def _open(root, name):
    # Accept either a full ".sav" filename or the bare save name the API lists
    # (which has no extension); append ".sav" when missing, then validate the
    # resolved name against the same strict path/traversal rules.
    if not isinstance(name, str) or not name:
        raise ValueError('Expected a .sav filename (maximum 180 characters)')
    candidate = name if name.endswith('.sav') else name + '.sav'
    candidate = validate(candidate)
    fd = os.open(root / candidate, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_BYTES:
            raise ValueError('Save must be a regular file of at most 64 MiB')
        return os.fdopen(fd, 'rb')
    except Exception:
        os.close(fd)
        raise


def open_save(name):
    return _open(SAVE_DIR, name)


def open_backup(name):
    return _open(BACKUP_DIR, name)


def list_backups():
    files = []
    if BACKUP_DIR.exists():
        for p in BACKUP_DIR.glob('*.sav'):
            if p.is_symlink() or not p.is_file():
                continue
            s = p.stat()
            files.append({'name': p.name, 'bytes': s.st_size, 'modified': s.st_mtime})
    return {'files': sorted(files, key=lambda r: r['modified'], reverse=True),
            'totalBytes': sum(f['bytes'] for f in files), 'maxBytes': MAX_TOTAL_BYTES,
            'maxFiles': MAX_FILES, 'maxFileBytes': MAX_FILE_BYTES,
            'policy': 'Manual only. No automatic backup, pruning or restore. Download and remove explicitly.'}


def create(name):
    with _lock, open_save(name) as source:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        current = list_backups()
        before = os.fstat(source.fileno())
        if len(current['files']) >= MAX_FILES or current['totalBytes'] + before.st_size > MAX_TOTAL_BYTES:
            raise ValueError('Backup storage full; explicitly download/remove an archive first')
        if shutil.disk_usage(BACKUP_DIR).free < before.st_size + 64*1024*1024:
            raise ValueError('Insufficient disk headroom for backup')
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        dest = BACKUP_DIR / (stamp + '-' + uuid.uuid4().hex[:12] + '.sav')
        digest = hashlib.sha256()
        try:
            with dest.open('xb') as output:
                size = 0
                while True:
                    block = source.read(256*1024)
                    if not block:
                        break
                    size += len(block)
                    if size > MAX_FILE_BYTES or size > before.st_size:
                        raise ValueError('Source changed during snapshot; retry after autosave')
                    output.write(block)
                    digest.update(block)
                output.flush()
                os.fsync(output.fileno())
            after = os.fstat(source.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                raise ValueError('Source changed during snapshot; retry after autosave')
            return {'name': dest.name, 'bytes': size, 'sha256': digest.hexdigest(), 'source': name}
        except Exception:
            dest.unlink(missing_ok=True)
            raise


def remove(name):
    validate(name)
    with _lock, open_backup(name):
        (BACKUP_DIR / name).unlink()
    return {'removed': name}
