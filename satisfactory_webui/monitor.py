"""Read-only Linux cgroup metrics and bounded, persistent vanilla API history."""
import datetime
from contextlib import contextmanager
import json
import logging
import math
import os
from pathlib import Path
import sqlite3
import threading
import time
from . import config
from .config import STATE_DIR, SAVE_DIR

# Service-scoped cgroup path (set by SATISFACTORY_CGROUP). Kept as a public
# attribute for config introspection; resource gauges read the whole-container
# root (MACHINE_CGROUP) instead.
CGROUP = config.CGROUP

# cgroup root covering the whole container as seen by the hypervisor (also the
# machine root on bare metal). CPU gauges reflect everything in the container,
# not just the satisfactory service's own cgroup (config.CGROUP).
MACHINE_CGROUP = Path('/sys/fs/cgroup')

INTERVAL = 30
RETENTION = 7 * 86400
MAX_SAMPLES = RETENTION // INTERVAL + 1
_previous = None
_resource_lock = threading.Lock()


def cpu_percent(previous, current, cores=None):
    """All given cores fully occupied = 100%; result is capped at 100.

    ``delta`` is in nanoseconds, ``elapsed`` in seconds. Normalized to the
    number of cores given to the container so a fully loaded multi-core
    container never reports more than 100%.
    """
    cores = cores if cores is not None else os.cpu_count() or 1
    elapsed, delta = current[0] - previous[0], current[1] - previous[1]
    if not (elapsed > 0 and delta >= 0):
        return None
    percent = delta / 1e9 / elapsed / cores * 100
    return round(min(percent, 100.0), 2)


def memory_max_bytes():
    """Memory ceiling in bytes: cgroup limit when finite, else MemTotal.

    Works on cgroup v2 (``memory.max``), cgroup v1 (``memory.limit_in_bytes``),
    and bare metal (falls back to ``MemTotal`` from ``/proc/meminfo``)."""
    for path, huge in ((MACHINE_CGROUP / 'memory.max', 1 << 62),
                       (Path('/sys/fs/cgroup/memory/memory.limit_in_bytes'), 1 << 62)):
        try:
            raw = path.read_text().strip()
        except OSError:
            continue
        if raw in ('max', ''):
            continue
        try:
            v = int(raw)
        except ValueError:
            continue
        if 0 < v < huge:
            return v
        return None  # reserve the pathological case
    return _meminfo('MemTotal')


def _meminfo(key):
    """Value of a ``/proc/meminfo`` counter in bytes, or None when absent."""
    try:
        for line in Path('/proc/meminfo').read_text().splitlines():
            if line.startswith(key + ':'):
                return int(line.split()[1]) * 1024  # kB -> bytes
    except (OSError, ValueError, IndexError):
        return None
    return None


def _stat_map(paths):
    """First readable cgroup ``*.stat`` parsed into {key: value}."""
    for p in paths:
        try:
            return dict(line.split() for line in p.read_text().splitlines())
        except (OSError, ValueError):
            continue
    return None


def memory_usage_bytes():
    """Anonymous (committed) memory, excluding page cache.

    Reads the ``anon`` counter from cgroup v2 ``memory.stat`` (or cgroup v1),
    so the gauge matches what the hypervisor (Proxmox) reports as the
    container's memory usage. On bare metal without a readable cgroup, falls
    back to ``AnonPages`` from ``/proc/meminfo`` so the figure is always
    meaningful and never just raw ``memory.current`` (which includes reclaimable
    file page cache and overstates live usage).
    """
    stat = _stat_map((MACHINE_CGROUP / 'memory.stat', Path('/sys/fs/cgroup/memory/memory.stat')))
    if stat and stat.get('anon'):
        return int(stat['anon'])
    return _meminfo('AnonPages')


def _cpu_usage_ns():
    """CPU usage numerator (nanoseconds) for whatever backend is present.

    Returns ``(name, nanoseconds)``: cgroup v2 ``cpu.stat`` usage_usec, cgroup
    v1 ``cpuacct.usage`` (already ns), or a /proc/stat whole-machine aggregate
    for bare metal (jiffies scaled by USER_HZ). Returns ``(None, None)`` when
    nothing is readable."""
    stat = _stat_map((MACHINE_CGROUP / 'cpu.stat',))
    if stat and stat.get('usage_usec'):
        return 'cgroup-v2', int(stat['usage_usec']) * 1000
    try:
        ns = int(Path('/sys/fs/cgroup/cpuacct/cpuacct.usage').read_text())
        return 'cgroup-v1', ns
    except (OSError, ValueError):
        pass
    try:
        with open('/proc/stat', encoding='utf-8') as f:
            parts = f.readline().split()
        if parts and parts[0] == 'cpu' and len(parts) >= 5:
            jiffies = sum(int(x) for x in parts[1:5])
            hz = os.sysconf('SC_CLK_TCK') or 100
            return 'procfs', int(jiffies * (1e9 / hz))
    except (OSError, ValueError):
        pass
    return None, None


def resources():
    global _previous
    backend, usage = _cpu_usage_ns()
    out = {'memoryBytes': None, 'memoryMaxBytes': None, 'cpuPercent': None,
           'cpuCores': os.cpu_count(), 'source': backend or str(MACHINE_CGROUP), 'error': None}
    try:
        out['memoryBytes'] = memory_usage_bytes()
        out['memoryMaxBytes'] = memory_max_bytes()
        if usage is not None:
            current = (time.monotonic(), usage)
            with _resource_lock:
                if _previous:
                    out['cpuPercent'] = cpu_percent(_previous, current)
                _previous = current
    except (OSError, ValueError, KeyError) as e:
        out['error'] = str(e)
    return out


def save_sizes():
    try:
        files = [p.stat() for p in SAVE_DIR.glob('*.sav') if p.is_file() and not p.is_symlink()]
        return {'bytes': sum(p.st_size for p in files), 'count': len(files),
                'latestBytes': max(files, key=lambda s: s.st_mtime).st_size if files else None,
                'source': str(SAVE_DIR), 'error': None}
    except OSError as e:
        return {'bytes': None, 'latestBytes': None, 'count': None, 'error': str(e), 'source': str(SAVE_DIR)}


def sample(state, disk):
    g = state.get('state') or {}
    valid = bool(state.get('ok'))
    r = resources()
    sizes = save_sizes()
    return {'ts': time.time(), 'players': g.get('numConnectedPlayers') if valid else None,
            'tps': g.get('averageTickRate') if valid else None,
            'memoryBytes': r['memoryBytes'], 'cpuPercent': r.get('cpuPercent'),
            'diskUsed': (disk or {}).get('used'), 'saveBytes': sizes['bytes'],
            'latestSaveBytes': sizes.get('latestBytes'), 'session': g.get('activeSessionName') if valid else None}


class History:
    def __init__(self, path=None, retention=RETENTION, limit=MAX_SAMPLES):
        self.path = Path(path or STATE_DIR / 'history.sqlite')
        self.retention, self.limit = retention, limit
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS samples (ts REAL PRIMARY KEY, data TEXT NOT NULL)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def add(self, row):
        now = row['ts']
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO samples VALUES (?, ?)', (now, json.dumps(row, allow_nan=False)))
            db.execute('DELETE FROM samples WHERE ts < ?', (now - self.retention,))
            db.execute('DELETE FROM samples WHERE ts NOT IN (SELECT ts FROM samples ORDER BY ts DESC LIMIT ?)', (self.limit,))

    def read(self, now=None, hours=24):
        now = time.time() if now is None else now
        with self.connect() as db:
            rows = [json.loads(r[0]) for r in db.execute('SELECT data FROM samples WHERE ts >= ? ORDER BY ts', (now-self.retention,))]
        # Average observed concurrent counts per UTC weekday/hour. Never infer playtime
        # or fill unknown buckets with zero. Aggregate before plotting/downsampling.
        buckets = [{'day': d, 'hour': h, 'players': None, 'samples': 0} for d in range(7) for h in range(24)]
        for row in rows:
            if row.get('players') is None:
                continue
            dt = datetime.datetime.fromtimestamp(row['ts'], datetime.timezone.utc)
            b = buckets[((dt.weekday()+1) % 7)*24 + dt.hour]
            b['players'] = (b['players'] or 0) + row['players']
            b['samples'] += 1
        for b in buckets:
            if b['samples']:
                b['players'] = round(b['players']/b['samples'], 2)
        recent = [r for r in rows if r['ts'] >= now - hours*3600]
        stride = max(1, math.ceil(len(recent)/600))
        plotted = []
        for i in range(0, len(recent), stride):
            chunk = recent[i:i+stride]
            point = dict(chunk[-1])
            point['gapThreshold'] = INTERVAL * stride * 2.5
            # Never bridge an offline/null interval just because it was skipped.
            for key in ('tps', 'players', 'cpuPercent', 'memoryBytes', 'diskUsed', 'saveBytes', 'latestSaveBytes'):
                if any(r.get(key) is None for r in chunk):
                    point[key] = None
            plotted.append(point)
        if recent and (not plotted or plotted[-1]['ts'] != recent[-1]['ts']):
            plotted.append(recent[-1])
        return {'samples': plotted, 'heatmap': buckets, 'totalSamples': len(rows),
                'firstTs': rows[0]['ts'] if rows else None, 'lastTs': rows[-1]['ts'] if rows else None,
                'intervalSeconds': INTERVAL, 'retentionDays': self.retention/86400,
                'hours': hours, 'timezone': 'UTC', 'error': None}


history = None
sampler_error = None


def start(fetch, disk):
    """One poller shared by all viewers; no game-changing operations."""
    def run():
        global history, sampler_error
        while True:
            try:
                if history is None:
                    history = History()
                history.add(sample(fetch(), disk()))
                sampler_error = None
            except Exception as e:
                sampler_error = str(e)
                logging.exception('History sampler failed')
            time.sleep(INTERVAL)
    threading.Thread(target=run, name='history-sampler', daemon=True).start()


def read(hours=24):
    if history is None:
        return {'samples': [], 'heatmap': [], 'totalSamples': 0, 'error': sampler_error or 'Sampler starting',
                'intervalSeconds': INTERVAL, 'retentionDays': 7, 'timezone': 'UTC'}
    result = history.read(hours=hours)
    result['error'] = sampler_error
    return result
