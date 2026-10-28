/* Satisfactory WebUI frontend — stdlib-free, no build step. */
(function () {
  "use strict";

  var VERSION = null;
  var CSRF = null;
  var POLL = 2000;
  var timers = [];

  var $ = function (id) { return document.getElementById(id); };
  var view = $("view");
  var notice = $("notice");
  var title = $("title");

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function clearTimers() {
    timers.forEach(clearInterval);
    timers = [];
  }

  function setNotice(msg, kind) {
    notice.textContent = msg;
    notice.className = kind ? "notice " + kind : "notice";
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
    if (!d.ok) {
      view.innerHTML = '<p class="err">Server unreachable: ' + esc(d.error) + "</p>";
      return;
    }
    var g = d.state || {};
    var svc = d.service || {};
    var active = svc.ActiveState === "active";
    var html = "";
    html += '<section class="card"><h2>Server</h2>';
    html += '<div class="kv"><span>Health</span><b class="' + (d.health === "healthy" ? "ok" : "bad") + '">' + esc(d.health || "—") + "</b></div>";
    html += '<div class="kv"><span>Service</span><b class="' + (active ? "ok" : "bad") + '">' + esc(svc.ActiveState || "—") + " / " + esc(svc.SubState || "—") + "</b></div>";
    html += '<div class="kv"><span>Session</span><b>' + esc(g.activeSessionName) + "</b></div>";
    html += '<div class="kv"><span>Players</span><b>' + esc(g.numConnectedPlayers) + " / " + esc(g.playerLimit) + "</b></div>";
    html += '<div class="kv"><span>Game running</span><b>' + (g.isGameRunning ? "yes" : "no") + "</b></div>";
    html += '<div class="kv"><span>Paused</span><b>' + (g.isGamePaused ? "yes" : "no") + "</b></div>";
    html += '<div class="kv"><span>Tech tier</span><b>' + esc(g.techTier) + "</b></div>";
    html += '<div class="kv"><span>Game phase</span><b>' + esc(phaseName(g.gamePhase)) + "</b></div>";
    html += '<div class="kv"><span>Avg tick rate</span><b>' + (g.averageTickRate != null ? g.averageTickRate.toFixed(1) : "—") + "</b></div>";
    html += '<div class="kv"><span>Uptime</span><b>' + fmtDuration(g.totalGameDuration) + "</b></div>";
    html += '<div class="kv"><span>Autoload</span><b>' + esc(g.autoLoadSessionName) + "</b></div>";
    html += "</section>";

    if (d.latestSave) {
      html += '<section class="card"><h2>Latest save</h2>';
      html += '<div class="kv"><span>Name</span><b>' + esc(d.latestSave.name) + "</b></div>";
      html += '<div class="kv"><span>Time</span><b>' + esc(d.latestSave.date) + "</b></div>";
      html += '<div class="kv"><span>Total saves</span><b>' + esc(d.saveCount) + "</b></div></section>";
    }

    if (d.disk) {
      html += '<section class="card"><h2>Disk</h2>';
      html += '<div class="kv"><span>Used</span><b>' + fmtBytes(d.disk.used) + "</b></div>";
      html += '<div class="kv"><span>Free</span><b>' + fmtBytes(d.disk.free) + "</b></div>";
      html += '<div class="kv"><span>Total</span><b>' + fmtBytes(d.disk.total) + "</b></div></section>";
    }

    html += '<section class="card"><h2>Service control</h2><div class="btnrow">';
    html += '<button data-svc="start">Start</button>';
    html += '<button data-svc="restart">Restart</button>';
    html += '<button data-svc="stop" class="danger">Stop</button>';
    html += "</div><p class=" + '"hint">Restarting or stopping the service takes the game offline.</p></section>';
    view.innerHTML = html;
    view.querySelectorAll("[data-svc]").forEach(function (b) {
      b.addEventListener("click", function () {
        apiPost("/api/service", { action: b.dataset.svc }).then(function () {
          setNotice("Service " + b.dataset.svc + " requested", "ok");
          loadOverview();
        }).catch(function (e) { setNotice(e.message, "err"); });
      });
    });
  }

  function loadOverview() {
    apiGet("/api/overview").then(renderOverview).catch(function (e) {
      view.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    });
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
        html += "</td></tr>";
      });
      html += "</tbody></table>";
    });
    html += "</section>";
    html += '<section class="card"><h2>Save now</h2>';
    html += '<div class="row"><input id="save-name" placeholder="save name" value="manual_save"><button id="do-save">Save</button></div></section>';
    view.innerHTML = html;

    view.querySelectorAll("[data-load]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("Load save '" + b.dataset.save + "'? The current session will be replaced.")) return;
        apiPost("/api/load", { session: b.dataset.load, save: b.dataset.save }).then(function () {
          setNotice("Loading " + b.dataset.save + "…", "ok");
        }).catch(function (e) { setNotice(e.message, "err"); });
      });
    });
    view.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("Delete save '" + b.dataset.save + "'? This cannot be undone.")) return;
        apiPost("/api/delete-save", { session: b.dataset.del, save: b.dataset.save }).then(function () {
          setNotice("Deleted " + b.dataset.save, "ok");
          loadSaves();
        }).catch(function (e) { setNotice(e.message, "err"); });
      });
    });
    $("do-save").addEventListener("click", function () {
      var n = $("save-name").value.trim();
      if (!n) { setNotice("Enter a save name", "err"); return; }
      apiPost("/api/save", { name: n }).then(function () {
        setNotice("Saved " + n, "ok");
        loadSaves();
      }).catch(function (e) { setNotice(e.message, "err"); });
    });
  }

  function loadSaves() {
    apiGet("/api/saves").then(renderSaves).catch(function (e) {
      view.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    });
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
      apiPost("/api/apply-options", { updated: updated }).then(function () {
        setNotice("Server options applied", "ok");
        loadConfig();
      }).catch(function (e) { setNotice(e.message, "err"); });
    });
    $("apply-adv").addEventListener("click", function () {
      var updated = collectFields("adv");
      if (!Object.keys(updated).length) { setNotice("No changes", "err"); return; }
      apiPost("/api/apply-advanced", { updated: updated }).then(function () {
        setNotice("Advanced settings applied", "ok");
        loadConfig();
      }).catch(function (e) { setNotice(e.message, "err"); });
    });
  }

  function fieldRow(key, def, value, group) {
    var v = value != null ? value : def.default;
    var html = '<div class="frow" data-key="' + esc(key) + '" data-group="' + group + '">';
    html += '<label class="flabel" title="' + esc(def.help) + '">' + esc(def.label) + "</label>";
    if (def.kind === "bool") {
      var checked = v === "True" || v === "true" || v === "1";
      html += '<select class="fval" data-kind="bool"><option value="True"' + (checked ? " selected" : "") + ">True</option><option value=\"False\"" + (!checked ? " selected" : "") + ">False</option></select>";
    } else if (def.kind === "int" || def.kind === "float") {
      html += '<input class="fval" type="number" data-kind="' + def.kind + '" value="' + esc(v) + '"' +
        (def.min != null ? ' min="' + def.min + '"' : "") +
        (def.max != null ? ' max="' + def.max + '"' : "") +
        (def.step != null ? ' step="' + def.step + '"' : "") + ">";
    } else {
      html += '<input class="fval" type="text" data-kind="text" value="' + esc(v) + '">';
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
    apiGet("/api/config").then(renderConfig).catch(function (e) {
      view.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    });
  }

  /* ---------- Logs ---------- */
  function renderLogs(d) {
    var html = '<section class="card"><h2>Server logs</h2>';
    html += '<pre class="log">' + esc(d.text || "(no output)") + "</pre></section>";
    view.innerHTML = html;
  }

  function loadLogs() {
    apiGet("/api/logs").then(renderLogs).catch(function (e) {
      view.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    });
  }

  /* ---------- About ---------- */
  function renderAbout(d) {
    var html = '<section class="card"><h2>About</h2>';
    html += '<div class="kv"><span>Version</span><b>' + esc(d.version) + "</b></div>";
    html += '<div class="kv"><span>Bind</span><b>' + esc(d.bind) + ":" + esc(d.port) + "</b></div>";
    html += '<div class="kv"><span>Admitted networks</span><b>' + esc(d.networks.join(", ")) + "</b></div>";
    html += '<div class="kv"><span>Config dir</span><b>' + esc(d.configDir) + "</b></div>";
    html += '<div class="kv"><span>Service</span><b>' + esc((d.service && d.service.ActiveState) || "—") + "</b></div>";
    html += "</section>";
    html += '<section class="card"><h2>Listeners</h2><pre class="log">' + esc(d.listeners || "(none)") + "</pre></section>";
    view.innerHTML = html;
  }

  function loadAbout() {
    apiGet("/api/about").then(renderAbout).catch(function (e) {
      view.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    });
  }

  /* ---------- helpers ---------- */
  function phaseName(p) {
    if (!p) return "—";
    var m = p.match(/GP_([A-Za-z0-9_]+)/);
    return m ? m[1].replace(/_/g, " ") : p;
  }

  function fmtDuration(sec) {
    if (sec == null) return "—";
    sec = Math.floor(sec);
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600),
        m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function fmtBytes(n) {
    if (n == null) return "—";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(1) + " " + u[i];
  }

  /* ---------- router ---------- */
  var routes = {
    "/": { title: "Overview", load: loadOverview, poll: true },
    "/saves": { title: "Saves", load: loadSaves, poll: false },
    "/config": { title: "Configuration", load: loadConfig, poll: false },
    "/logs": { title: "Server logs", load: loadLogs, poll: true },
    "/about": { title: "About & ports", load: loadAbout, poll: false },
  };

  function route() {
    var path = location.pathname;
    var r = routes[path] || routes["/"];
    title.textContent = r.title;
    clearTimers();
    setNotice("Loading…");
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
