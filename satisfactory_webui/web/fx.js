/* Satisfactory WebUI — visual effects (fx.js)
 *
 * Vanilla-JS port of the mouse-following glow technique from
 * Bread-Ch4n/FRM-s-WebUI-Source src/components/magicui/magic-card.tsx
 * (pinned 9f0d01340af1ad17cd6c835c575a6502175e923e). Reuse authorized by
 * Dave on 2026-10-31. No framework, no CDN, dependency free. See fx.css for
 * the matching CSS effects and THIRD_PARTY_NOTICES.md for full provenance.
 */
(function () {
  "use strict";

  /* Mouse-following radial gradient on .fx-magic cards.
     Mirrors MagicCard's handleMouseMove / mouseout behaviour. */
  function trackMouse(ev) {
    ev.currentTarget.style.setProperty("--mx", ev.clientX + "px");
    ev.currentTarget.style.setProperty("--my", ev.clientY + "px");
  }

  function resetMouse(ev) {
    var el = ev.currentTarget;
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "50%");
  }

  function seedBackground() {
    var body = document.body;
    if (body.querySelector(".fx-grid-bg")) return;
    var grid = document.createElement("div");
    grid.className = "fx-grid-bg";
    grid.setAttribute("aria-hidden", "true");
    body.appendChild(grid);
  }

  function wireFx(root) {
    seedBackground();
    var cards = (root || document).querySelectorAll(".fx-magic");
    cards.forEach(function (card) {
      card.addEventListener("mousemove", trackMouse);
      card.addEventListener("mouseleave", resetMouse);
    });
  }

  if (typeof window !== "undefined") {
    window.__satisfactoryFx = { wireFx: wireFx };
    if (window.__satisfactoryOnRoute) {
      /* Hook into the SPA router so freshly rendered cards get wired.
         app.js calls __satisfactoryOnRoute(cb) after each render. */
      var hook = window.__satisfactoryOnRoute;
      hook(function () { wireFx(document); });
    } else {
      /* Fallback: observe DOM additions and wire any .fx-magic nodes. */
      var mo = new MutationObserver(function () {
        var nodes = document.querySelectorAll(".fx-magic:not([data-fx-wired])");
        nodes.forEach(function (card) {
          card.setAttribute("data-fx-wired", "1");
          card.addEventListener("mousemove", trackMouse);
          card.addEventListener("mouseleave", resetMouse);
        });
      });
      if (document.body) { wireFx(document); mo.observe(document.body, {childList: true, subtree: true}); }
      else {
        document.addEventListener("DOMContentLoaded", function () {
          wireFx(document);
          mo.observe(document.body, {childList: true, subtree: true});
        });
      }
    }
  }
})();
