/* Satisfactory WebUI frontend — stdlib-free, no build step. */
(function () {
  "use strict";

  var VERSION = null;
  var CSRF = null;
  var POLL = 15000;
  var timers = [];

  var $ = function (id) { return document.getElementById(id); };
  var view = $("view");
  var notice = $("notice");
  var title = $("title");

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clearTimers() {
    timers.forEach(clearInterval);
    timers = [];
  }

  function setNotice(msg, kind) {
    notice.textContent = msg;
    notice.hidden = !msg;
    notice.className = kind ? "notice " + kind : "notice";
  }

  function loadPage(path, render) {
    return apiGet(path).then(render).catch(function (e) {
      view.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    }).finally(function () {
      view.setAttribute("aria-busy", "false");
      if (notice.textContent === "Loading…") setNotice("");
    });
  }

  function apiGet(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function apiPost(path, data) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF },
      body: JSON.stringify(data || {}),
    }).then(function (r) { return r.json().then(function (j) {
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      return j;
    }); });
  }

  /* ---------- Overview ---------- */
  function renderOverview(d) {
    var g = d.state || {}, r = d.resources || {}, disk = d.disk || {}, sizes = d.saveStorage || {};
    var html = '<section class="hero fx-shine"><span class="fx-hero-rings" aria-hidden="true"><span class="fx-ripple-ring"></span><span class="fx-ripple-ring"></span><span class="fx-ripple-ring"></span><span class="fx-ripple-ring"></span></span><div class="hero-content"><p class="eyebrow">VANILLA / LINUX OPERATIONS</p><h2>' + esc(g.activeSessionName || 'Dedicated server') + '</h2><p>One console. Your server. No game mods.</p></div><span class="status-pill ' + (d.ok ? 'ok' : 'bad') + '">' + esc(d.health || 'API offline') + '</span></section>';
    if (!d.ok) html += '<p class="err">Server unreachable: ' + esc(d.error || 'API unavailable') + '</p>';
    html += '<div class="metric-grid">';
    html += metric('Connected players', g.numConnectedPlayers, 'of ' + (g.playerLimit == null ? '—' : g.playerLimit) + ' slots', 'blue', g.numConnectedPlayers, g.playerLimit);
    html += metric('Average tick rate', number(g.averageTickRate), 'TPS · API-reported, not a fixed target', 'green', null, null);
    html += metric('Game service memory', fmtBytes(r.memoryBytes), 'cgroup memory (includes cache)', 'purple', null, null);
    html += metric('Game service CPU', r.cpuPercent == null ? '—' : number(r.cpuPercent) + '%', '100% = one core · up to ' + (r.cpuCores || '?') + ' cores', 'orange', r.cpuPercent, (r.cpuCores || 1)*100);
    html += '</div><div class="dashboard-grid"><section class="card"><div class="section-head"><h2>Server pulse</h2><a href="/history">Explore history →</a></div><p class="hint">Last 6 hours · 30-second samples · gaps remain unknown</p>';
    html += chart((d.history || {}).samples || [], 'tps', 'Tick rate', 'TPS', 'green');
    html += chart((d.history || {}).samples || [], 'players', 'Concurrent players', 'players', 'blue');
    if (d.history && d.history.error) html += '<p class="hint">' + esc(d.history.error) + '</p>';
    html += '</section><section class="card"><p class="eyebrow">SESSION / PROGRESSION</p><h2>Current expedition</h2>';
    html += kv('Tech tier', g.techTier) + kv('Game phase', phaseName(g.gamePhase)) + kv('Active schematic', objectName(g.activeSchematic));
    html += kv('Accumulated game time', fmtDuration(g.totalGameDuration)) + kv('Session state', g.isGamePaused == null ? '—' : g.isGamePaused ? 'Paused' : g.isGameRunning ? 'Running' : 'Not running');
    html += kv('Autoload session', g.autoLoadSessionName) + '<p class="hint">Game time is not process uptime. Factory, power and inventories are not available through the vanilla API.</p></section></div>';
    html += '<div class="dashboard-grid"><section class="card"><h2>Storage &amp; saves</h2>';
    html += gauge(disk.used, disk.total, 'Server filesystem used', 'orange') + kv('Disk free', fmtBytes(disk.free)) + kv('Save storage', fmtBytes(sizes.bytes)) + kv('Latest file size', fmtBytes(sizes.latestBytes)) + kv('API save count', d.saveCount);
    if (d.latestSave) html += kv('Latest save', d.latestSave.name) + kv('Saved at', d.latestSave.date);
    if (sizes.error) html += '<p class="hint">' + esc(sizes.error) + '</p>';
    html += '<a href="/saves">Manage saves →</a> · <a href="/backups">Backup vault →</a></section>' + renderVersion(d.serverVersion) + '</div>';
    html += '<section class="card"><div class="section-head"><h2>Service controls</h2><span class="hint">' + esc((d.service || {}).ActiveState || 'unknown') + '</span></div><p class="hint">Manual actions only. Restart and stop disconnect players. No scheduled updates, restarts or watchdogs are enabled by this console.</p><div class="btnrow"><button data-svc="start">Start game</button><button data-svc="restart">Restart game…</button><button class="danger" data-svc="stop">Stop game…</button></div></section>';
    view.innerHTML = html;
    view.querySelectorAll('[data-svc]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Confirm game service ' + b.dataset.svc + '? Restart/stop will disconnect players.')) return;
        apiPost('/api/service', {action: b.dataset.svc, confirm: true}).then(function () {
          setNotice('Service action requested', 'ok'); loadOverview();
        }).catch(function (e) { setNotice(e.message, 'err'); });
      });
    });
  }

  function loadOverview() {
    return loadPage("/api/overview", renderOverview);
  }

  /* ---------- Saves ---------- */
  function renderSaves(d) {
    if (!d.ok) {
      view.innerHTML = '<p class="err">Server unreachable: ' + esc(d.error) + "</p>";
      return;
    }
    var html = '<section class="card"><h2>Sessions &amp; saves</h2>';
    if (!d.sessions || !d.sessions.length) {
      html += '<p class="hint">No sessions found.</p></section>';
      view.innerHTML = html;
      return;
    }
    d.sessions.forEach(function (sess) {
      var name = sess.sessionName || "?";
      var saves = sess.saveHeaders || [];
      html += '<h3 class="sess">' + esc(name) + ' <span class="muted">(' + saves.length + " saves)</span></h3>";
      if (!saves.length) {
        html += '<p class="hint">No saves in this session.</p>';
        return;
      }
      html += '<table><thead><tr><th>Save</th><th>Date</th><th>Play time</th><th>Modded</th><th></th></tr></thead><tbody>';
      saves.forEach(function (h) {
        html += "<tr>";
        html += "<td>" + esc(h.saveName) + "</td>";
        html += "<td>" + esc(h.saveDateTime) + "</td>";
        html += "<td>" + fmtDuration(h.playDurationSeconds) + "</td>";
        html += "<td>" + (h.isModdedSave ? "yes" : "no") + "</td>";
        html += '<td class="actions">';
        html += '<button data-load="' + esc(name) + '" data-save="' + esc(h.saveName) + '">Load</button>';
        html += '<button data-del="' + esc(name) + '" data-save="' + esc(h.saveName) + '" class="danger">Delete</button>';
        var filename = h.saveName.endsWith('.sav') ? h.saveName : h.saveName + '.sav';
        html += '<a class="button" href="/api/download-save?name=' + encodeURIComponent(filename) + '">Download</a> ';
        html += '<button data-backup="' + esc(filename) + '">Snapshot</button>';
        html += "</td></tr>";
      });
      html += "</tbody></table>";
    });
    html += "</section>";
    html += '<section class="card"><h2>Save now</h2>';
    html += '<div class="row"><input id="save-name" placeholder="save name" value="manual_save"><button id="do-save">Save</button></div></section>';
    view.innerHTML = html;

    view.querySelectorAll('[data-backup]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        apiPost('/api/backup', {name: b.dataset.backup}).then(function (result) {
          setNotice('Snapshot created: ' + result.name + ' · SHA-256 ' + result.sha256, 'ok');
        }).catch(function (e) { setNotice(e.message, 'err'); }).finally(function () { b.disabled = false; });
      });
    });
    view.querySelectorAll("[data-load]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("Load save '" + b.dataset.save + "'? The current session will be replaced.")) return;
        apiPost("/api/load", { session: b.dataset.load, save: b.dataset.save, confirm: true }).then(function () {
          setNotice("Loading " + b.dataset.save + "…", "ok");
        }).catch(function (e) { setNotice(e.message, "err"); });
      });
    });
    view.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("Delete save '" + b.dataset.save + "'? This cannot be undone.")) return;
        apiPost("/api/delete-save", { session: b.dataset.del, save: b.dataset.save, confirm: true }).then(function () {
          setNotice("Deleted " + b.dataset.save, "ok");
          loadSaves();
        }).catch(function (e) { setNotice(e.message, "err"); });
      });
    });
    $("do-save").addEventListener("click", function () {
      var n = $("save-name").value.trim();
      if (!n) { setNotice("Enter a save name", "err"); return; }
      if (!confirm("Save now as '" + n + "'? Existing name may be overwritten.")) return;
      apiPost("/api/save", { name: n }).then(function () {
        setNotice("Saved " + n, "ok");
        loadSaves();
      }).catch(function (e) { setNotice(e.message, "err"); });
    });
  }

  function loadSaves() {
    return loadPage("/api/saves", renderSaves);
  }

  /* ---------- Configuration ---------- */
  function renderConfig(d) {
    if (!d.ok) {
      view.innerHTML = '<p class="err">Server unreachable: ' + esc(d.error) + "</p>";
      return;
    }
    var html = "";
    html += '<section class="card"><h2>Server options</h2>';
    html += '<p class="hint">Changes apply to the running server. Some options take effect immediately; others on the next save/restart.</p>';
    html += '<div class="cfg">';
    Object.keys(d.serverFields).forEach(function (key) {
      html += fieldRow(key, d.serverFields[key], d.serverOptions[key], "opt");
    });
    html += "</div>";
    html += '<div class="btnrow"><button id="apply-opt">Apply server options</button></div></section>';

    html += '<section class="card"><h2>Advanced game settings</h2>';
    html += '<p class="hint">Advanced Game Settings are ' + (d.creativeModeEnabled ? "enabled" : "disabled") + " for the current save. Applying any setting here enables them.</p>";
    html += '<div class="cfg">';
    Object.keys(d.advancedFields).forEach(function (key) {
      html += fieldRow(key, d.advancedFields[key], d.advanced[key], "adv");
    });
    html += "</div>";
    html += '<div class="btnrow"><button id="apply-adv">Apply advanced settings</button></div></section>';
    view.innerHTML = html;

    $("apply-opt").addEventListener("click", function () {
      var updated = collectFields("opt");
      if (!Object.keys(updated).length) { setNotice("No changes", "err"); return; }
      if (!confirm("Apply server options to the running game?")) return;
      apiPost("/api/apply-options", { updated: updated }).then(function () {
        setNotice("Server options applied", "ok");
        loadConfig();
      }).catch(function (e) { setNotice(e.message, "err"); });
    });
    $("apply-adv").addEventListener("click", function () {
      var updated = collectFields("adv");
      if (!Object.keys(updated).length) { setNotice("No changes", "err"); return; }
      if (!confirm("Apply advanced settings? This can enable creative/advanced mode for this save.")) return;
      apiPost("/api/apply-advanced", { updated: updated }).then(function () {
        setNotice("Advanced settings applied", "ok");
        loadConfig();
      }).catch(function (e) { setNotice(e.message, "err"); });
    });
  }

  function fieldRow(key, def, value, group) {
    var v = value != null ? value : def.default;
    var html = '<div class="frow" data-key="' + esc(key) + '" data-group="' + group + '">';
    html += '<label class="flabel" for="' + group + '-' + esc(key) + '" title="' + esc(def.help) + '">' + esc(def.label) + "</label>";
    if (def.kind === "bool") {
      var checked = v === "True" || v === "true" || v === "1";
      html += '<select id="' + group + '-' + esc(key) + '" class="fval" data-kind="bool"><option value="True"' + (checked ? " selected" : "") + ">True</option><option value=\"False\"" + (!checked ? " selected" : "") + ">False</option></select>";
    } else if (def.kind === "int" || def.kind === "float") {
      html += '<input id="' + group + '-' + esc(key) + '" class="fval" type="number" data-kind="' + def.kind + '" value="' + esc(v) + '"' +
        (def.min != null ? ' min="' + def.min + '"' : "") +
        (def.max != null ? ' max="' + def.max + '"' : "") +
        (def.step != null ? ' step="' + def.step + '"' : "") + ">";
    } else {
      html += '<input id="' + group + '-' + esc(key) + '" class="fval" type="text" data-kind="text" value="' + esc(v) + '">';
    }
    html += "</div>";
    return html;
  }

  function collectFields(group) {
    var out = {};
    view.querySelectorAll('.frow[data-group="' + group + '"]').forEach(function (row) {
      var key = row.dataset.key;
      var input = row.querySelector(".fval");
      var val = input.value;
      if (input.dataset.kind === "bool") val = val === "True" ? "True" : "False";
      out[key] = val;
    });
    return out;
  }

  function loadConfig() {
    return loadPage("/api/config", renderConfig);
  }

  /* ---------- Logs ---------- */
  function renderLogs(d) {
    var html = '<section class="card"><h2>Server logs</h2>';
    html += '<pre class="log">' + esc(d.text || "(no output)") + "</pre></section>";
    view.innerHTML = html;
  }

  function loadLogs() {
    return loadPage("/api/logs", renderLogs);
  }

  /* ---------- About ---------- */
  function renderAbout(d) {
    var html = '<section class="card"><h2>About</h2>';
    html += '<div class="kv"><span>WebUI version</span><b>' + esc(d.version) + "</b></div>";
    html += '<div class="kv"><span>Bind</span><b>' + esc(d.bind) + ":" + esc(d.port) + "</b></div>";
    html += '<div class="kv"><span>Admitted networks</span><b>' + esc((d.networks || []).join(", ")) + "</b></div>";
    html += '<div class="kv"><span>Config dir</span><b>' + esc(d.configDir) + "</b></div>";
    html += '<div class="kv"><span>Service</span><b>' + esc((d.service && d.service.ActiveState) || "—") + "</b></div>";
    html += "</section>";
    html += renderVersion(d.serverVersion);
    html += '<section class="card"><h2>Listeners</h2><pre class="log">' + esc(d.listeners || "(none)") + "</pre></section>";
    view.innerHTML = html;
  }

  function loadAbout() {
    return loadPage("/api/about", renderAbout);
  }

  function renderVersion(info) {
    var v = info || {};
    var html = '<section class="card"><h2>Installed game server</h2>';
    [["Game version", v.gameVersion], ["Game changelist (CL)", v.changelist],
      ["Steam build ID", v.steamBuildId]].forEach(function (row) {
      html += '<div class="kv"><span>' + row[0] + '</span><b>' + esc(row[1] || "Unknown") + '</b></div>';
    });
    html += '<p class="hint">Installed files, not a latest-release lookup or proof of the running process version.</p>';
    html += '<p class="hint">Steam source: ' + esc(v.steamSource || "unavailable") + '<br>Game source: ' + esc(v.gameSource || "unavailable") + '</p>';
    if (v.errors && v.errors.length) html += '<p class="hint">' + esc(v.errors.join("; ")) + '</p>';
    return html + '</section>';
  }

  /* ---------- helpers ---------- */
  function phaseName(p) {
    if (!p) return "—";
    var m = p.match(/GP_([A-Za-z0-9_]+)/);
    return m ? m[1].replace(/_/g, " ") : p;
  }

  function fmtDuration(sec) {
    if (sec == null) return "—";
    // Adapted from Svennix/Satisfactory_Ultimate_Dashboard www/app.js fmtDur.
    // MIT Copyright (c) 2026 Svennix; see THIRD_PARTY_NOTICES.md.
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec/60) + 'm';
    if (sec < 86400) return Math.floor(sec/3600) + 'h ' + Math.floor((sec%3600)/60) + 'm';
    return Math.floor(sec/86400) + 'd ' + Math.floor((sec%86400)/3600) + 'h';
  }

  function fmtBytes(n) {
    if (n == null) return "—";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(1) + " " + u[i];
  }

  function number(value) { return value == null ? '—' : Number(value).toFixed(1); }
  function objectName(value) {
    if (!value) return '—';
    var match = String(value).match(/([A-Za-z0-9_]+)(?:_C)?'$/);
    return match ? match[1].replace(/_C$/, '').replace(/_/g, ' ') : value;
  }
  function kv(label, value) { return '<div class="kv"><span>' + esc(label) + '</span><b>' + esc(value == null ? '—' : value) + '</b></div>'; }
  function gauge(value, max, label, color) {
    var pct = value == null || !max ? null : Math.min(100, Math.max(0, value / max * 100));
    return '<div class="gauge ' + color + '"><div class="section-head"><span>' + esc(label) + '</span><b>' + (pct == null ? 'Unknown' : pct.toFixed(1) + '%') + '</b></div><progress max="100" value="' + (pct == null ? 0 : pct) + '" aria-label="' + esc(label) + '"></progress></div>';
  }
  function metric(label, value, detail, color, n, max) {
    return '<section class="card metric ' + color + ' fx-magic fx-glow"><p class="eyebrow">' + esc(label) + '</p><strong>' + esc(value == null ? '—' : value) + '</strong><p class="hint">' + esc(detail) + '</p>' + (n != null && max ? gauge(n, max, label + ' capacity', color) : '') + '</section>';
  }
  function chart(rows, key, label, unit, color) {
    var valid = rows.filter(function (r) { return r[key] != null && Number.isFinite(r[key]); });
    var head = '<div class="chart ' + color + '"><div class="section-head"><h3>' + esc(label) + '</h3><span class="hint">' + esc(unit) + '</span></div>';
    if (!valid.length) return head + '<p class="empty">No observations yet. The sampler records every 30 seconds; unavailable values stay unknown.</p></div>';
    var high = Math.max(1, ...valid.map(function (r) { return r[key]; })), start = rows[0].ts, end = rows[rows.length-1].ts;
    var segments = [], points = [];
    rows.forEach(function (r, i) {
      if (r[key] == null || !Number.isFinite(r[key]) || (i && r.ts - rows[i-1].ts > (r.gapThreshold || 75))) {
        if (points.length) segments.push(points); points = [];
        if (r[key] == null || !Number.isFinite(r[key])) return;
      }
      points.push((40 + (r.ts-start)/Math.max(1, end-start)*640).toFixed(1) + ',' + (145-r[key]/high*115).toFixed(1));
    });
    if (points.length) segments.push(points);
    var lines = segments.map(function (segment) { return '<polyline points="' + segment.join(' ') + '"/>'; }).join('');
    var last = valid[valid.length-1];
    var titleText = label + ': latest ' + number(last[key]) + ' ' + unit + ', observed maximum ' + number(high);
    return head + '<svg viewBox="0 0 720 180" role="img" aria-label="' + esc(titleText) + '"><title>' + esc(titleText) + '</title><path class="gridline" d="M40 30H680 M40 87H680 M40 145H680"/><text x="0" y="35">' + high.toFixed(1) + '</text><text x="10" y="148">0</text>' + lines + '<circle cx="' + (40+(last.ts-start)/Math.max(1,end-start)*640).toFixed(1) + '" cy="' + (145-last[key]/high*115).toFixed(1) + '" r="3"/><text x="40" y="175">' + esc(new Date(start*1000).toLocaleTimeString()) + '</text><text text-anchor="end" x="680" y="175">' + esc(new Date(end*1000).toLocaleTimeString()) + '</text></svg><p class="hint">Latest ' + number(last[key]) + ' ' + esc(unit) + ' · ' + valid.length + ' plotted observations · autoscaled from zero</p></div>';
  }
  var historyHours = 24;
  function renderHistory(d) {
    var rows = d.samples || [];
    var html = '<section class="card"><div class="section-head"><div><h2>Observed server history</h2><p class="hint">30-second Linux/API sampling · seven-day rolling retention · persists across WebUI restarts</p></div><label>Window <select id="history-range">';
    [[1,'1 hour'],[6,'6 hours'],[24,'24 hours'],[168,'7 days']].forEach(function (v) { html += '<option value="' + v[0] + '"' + (historyHours === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; });
    html += '</select></label></div><p class="hint">' + esc(d.totalSamples || 0) + ' retained samples · ' + (d.lastTs ? 'Last observation ' + esc(new Date(d.lastTs*1000).toLocaleString()) : 'Waiting for first observation') + '</p>';
    if (d.error) html += '<p class="err">' + esc(d.error) + '</p>';
    html += '</section><div class="dashboard-grid">';
    [['tps','Tick rate','TPS','green',1],['players','Concurrent players','players','blue',1],['cpuPercent','Game service CPU','% (100 = one core)','orange',1],['memoryBytes','Game service memory','MiB','purple',1048576],['diskUsed','Filesystem used','GiB','orange',1073741824],['saveBytes','All save files','MiB','blue',1048576]].forEach(function (c) {
      var values = rows.map(function (r) { var v = Object.assign({}, r); v[c[0]] = r[c[0]] == null ? null : r[c[0]]/c[4]; return v; });
      html += '<section class="card">' + chart(values,c[0],c[1],c[2],c[3]) + '</section>';
    });
    html += '</div><section class="card"><h2>Player-count activity · UTC</h2><p class="hint">Mean observed concurrent players by weekday/hour over retained history. Not individual playtime or unique players. Empty = unobserved; 0 = observed idle.</p>' + heatmap(d.heatmap || []) + '</section>';
    view.innerHTML = html;
    $('history-range').addEventListener('change', function () { historyHours = Number(this.value); loadHistory(); });
  }
  function heatmap(buckets) {
    if (!buckets.length) return '<p class="empty">No observations yet.</p>';
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var peak = Math.max(1, ...buckets.map(function (b) { return b.players || 0; }));
    var html = '<div class="heat-scroll"><div class="heatmap"><span></span>';
    for (var h=0; h<24; h++) html += '<span class="heat-label">' + (h%3===0 ? String(h).padStart(2,'0') : '') + '</span>';
    days.forEach(function (day,i) {
      html += '<span class="heat-label">' + day + '</span>';
      for (var hour=0;hour<24;hour++) {
        var b = buckets[i*24+hour] || {}, level = b.players == null ? 'unknown' : b.players === 0 ? 'idle' : 'level-' + Math.max(1,Math.ceil(b.players/peak*4));
        var tip = day + ' ' + hour + ':00 UTC: ' + (b.players == null ? 'unobserved' : b.players + ' mean players, ' + b.samples + ' samples');
        html += '<span class="heat-cell ' + level + '" tabindex="0" title="' + esc(tip) + '" aria-label="' + esc(tip) + '"></span>';
      }
    });
    return html + '</div></div><p class="hint">Intensity: observed idle ░ → busy ▓ · Keyboard focus or hover for counts.</p>';
  }
  function loadHistory() { return loadPage('/api/history?hours=' + historyHours, renderHistory); }
  function renderBackups(d) {
    var html = '<section class="hero fx-shine"><span class="fx-hero-rings" aria-hidden="true"><span class="fx-ripple-ring"></span><span class="fx-ripple-ring"></span><span class="fx-ripple-ring"></span><span class="fx-ripple-ring"></span></span><div class="hero-content"><p class="eyebrow">RECOVERY / LOCAL ARCHIVES</p><h2>Backup vault</h2><p>Manual snapshots. No automatic pruning. Original saves untouched.</p></div><a class="button" href="/saves">Choose a save →</a></section><section class="card"><h2>Archive capacity</h2>' + gauge(d.totalBytes || 0,d.maxBytes || 536870912,'Local backup storage','purple') + '<p class="hint">' + esc((d.files || []).length) + ' / ' + esc(d.maxFiles || 32) + ' files · ' + fmtBytes(d.totalBytes || 0) + ' / ' + fmtBytes(d.maxBytes || 536870912) + ' · per-file limit 64 MiB</p><p class="hint">' + esc(d.policy || '') + '</p><p class="hint">Snapshots are local copies, not off-host disaster recovery. Download important archives. Concurrently changing saves are rejected; this is not a forced game save.</p></section><section class="card"><h2>Snapshots</h2>';
    if (!(d.files || []).length) html += '<p class="empty">No snapshots yet. Use Snapshot beside a save on the Saves page.</p>';
    else {
      html += '<div class="table-scroll"><table><thead><tr><th>Archive</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
      d.files.forEach(function (f) {
        html += '<tr><td>' + esc(f.name) + '</td><td>' + fmtBytes(f.bytes) + '</td><td>' + esc(new Date(f.modified*1000).toLocaleString()) + '</td><td class="actions"><a class="button" href="/api/download-backup?name=' + encodeURIComponent(f.name) + '">Download</a> <button class="danger" data-remove-backup="' + esc(f.name) + '">Remove…</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    view.innerHTML = html + '</section>';
    view.querySelectorAll('[data-remove-backup]').forEach(function (b) { b.addEventListener('click', function () {
      if (!confirm('Permanently remove archive ' + b.dataset.removeBackup + '? The game save is not affected.')) return;
      apiPost('/api/remove-backup',{name:b.dataset.removeBackup,confirm:true}).then(function () { setNotice('Archive removed','ok'); loadBackups(); }).catch(function (e) { setNotice(e.message,'err'); });
    }); });
  }
  function loadBackups() { return loadPage('/api/backups',renderBackups); }
  function loadCredits() {
    return loadPage('/api/credits',function (d) {
      var html = '<section class="card"><h2>Built on community work</h2><p>This Linux console uses the vanilla dedicated-server HTTPS API. No FRM, SML, game mods or player installs are required. Visual effects reuse the self-contained UI work of FRM\'s Web UI (authorized by its repo owner); data features that need a game mod remain out of scope. Reuse is credited below with pinned revisions, and complete upstream licenses are preserved where they exist.</p></section>';
      (d.projects || []).forEach(function (p) {
        html += '<section class="card"><h2><a href="' + esc(p.url) + '">' + esc(p.name) + '</a></h2><p>' + esc(p.use) + '</p>' + kv('Pinned revision',p.revision) + '<details><summary>' + esc(p.licenseName) + ' · full license</summary><pre class="license">' + esc(p.license) + '</pre></details></section>';
      });
      html += '<section class="card"><h2>Deliberately not included</h2><p>Factory production, power, map, inventories, vehicles and named player telemetry need game-mod APIs (FRM) and remain unavailable here. Windows PowerShell operations and third-party automatic restart/update/prune policies are not imported. No mod is installed and no player is asked to install one.</p></section>';
      view.innerHTML = html;
    });
  }

  /* ---------- router ---------- */
  var routes = {
    "/": { title: "Overview", load: loadOverview, poll: true },
    "/saves": { title: "Saves", load: loadSaves, poll: false },
    "/config": { title: "Configuration", load: loadConfig, poll: false },
    "/logs": { title: "Server logs", load: loadLogs, poll: true },
    "/history": { title: "Telemetry & activity", load: loadHistory, poll: true },
    "/backups": { title: "Backup vault", load: loadBackups, poll: false },
    "/credits": { title: "Credits & provenance", load: loadCredits, poll: false },
    "/about": { title: "About & ports", load: loadAbout, poll: false },
  };

  function route() {
    var path = location.pathname;
    var r = routes[path] || routes["/"];
    title.textContent = r.title;
    document.querySelectorAll('nav a').forEach(function (a) {
      if (a.getAttribute('href') === path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    clearTimers();
    setNotice("Loading…");
    view.setAttribute("aria-busy", "true");
    r.load();
    if (r.poll) timers.push(setInterval(r.load, POLL));
  }

  $("refresh").addEventListener("click", route);

  /* ---------- boot ---------- */
  function boot() {
    apiGet("/api/version").then(function (v) {
      VERSION = v.version;
      document.querySelector("footer").textContent =
        "Satisfactory WebUI v" + v.version + " · Private-network console · Do not expose publicly without authentication and HTTPS.";
    }).catch(function () {});
    apiGet("/api/session").then(function (s) {
      CSRF = s.csrf;
      route();
    }).catch(function (e) {
      setNotice("Could not start session: " + e.message, "err");
    });
  }

  window.addEventListener("popstate", route);
  boot();
})();
