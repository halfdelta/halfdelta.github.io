/*
 * Team page: a few small surprises. The page is complete without this file;
 * everything here only adds to it, and nothing moves until a visitor does
 * something (the one exception is a note in the developer console).
 *
 * - The vane's arrow turns toward the pointer, about its pole.
 * - Five quick clicks (or Enter presses) on the gorilla drop a banana.
 * - The old cheat code moves the Half Delta mark's point from half delta to
 *   full delta, and back.
 * - Felix's and Keel's marks have hover titles.
 * - GoiDev67's mark winks on hover; opening it shows where it all started
 *   and lights the fixed point of the Half Delta mark for a moment.
 *
 * With reduced motion the vane stays still, and the banana and the point
 * appear in place instead of travelling. No storage, no requests.
 */
(function () {
  "use strict";

  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var news = document.getElementById("egg-news");
  document.documentElement.classList.add("js-team");

  function say(text) {
    if (!news) return;
    news.textContent = "";
    window.setTimeout(function () { news.textContent = text; }, 50);
  }

  // A mark that answers to clicks, Enter and Space.
  function asButton(el, label) {
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", label);
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); el.click(); }
    });
  }

  // For anyone who opens the console.
  try {
    console.log(
      "%cHalf Delta Research%c\nPrecise about uncertainty.\n\n" +
      "                       ___...---\n" +
      "                  _.-'\n" +
      "      ---...___.-'        <- the fixed point is in the middle\n\n" +
      "Reading the source? Good habit. We do the same every time a number looks too nice.\n" +
      "Two things to try on this page: the old code (↑ ↑ ↓ ↓ ← → ← → B A), and a little persistence with the gorilla.\n\n" +
      "✦ Where it started: GoiDev67, the spark. His mark remembers.",
      "font: 600 15px Georgia, serif;", "font: 12px ui-monospace, Menlo, monospace;"
    );
  } catch (e) { /* no console, no message */ }

  // ---------------------------------------------------------------------
  // The vane turns toward the pointer. Seen from the side, a turn about the
  // vertical pole is a horizontal squash, so the arrow is scaled in x.
  var vane = document.querySelector(".mark-vane svg");
  var arrow = document.querySelector(".vane-arrow");
  if (vane && arrow) {
    var pending = null;
    var turn = function () {
      var p = pending;
      pending = null;
      if (!p || reduce.matches) return;
      var box = vane.getBoundingClientRect();
      var dx = p.x - (box.left + box.width / 2);
      var s = dx / Math.sqrt(dx * dx + 60 * 60);
      if (Math.abs(s) < 0.06) s = s < 0 ? -0.06 : 0.06;
      arrow.style.transform = "scaleX(" + s.toFixed(3) + ")";
    };
    var aim = function (ev) {
      var first = !pending;
      pending = { x: ev.clientX };
      if (first) window.requestAnimationFrame(turn);
    };
    window.addEventListener("pointermove", aim, { passive: true });
    window.addEventListener("pointerdown", aim, { passive: true });
    var settle = function () { if (reduce.matches) arrow.style.transform = ""; };
    if (reduce.addEventListener) reduce.addEventListener("change", settle);
  }

  // ---------------------------------------------------------------------
  // Five quick clicks on the gorilla drop a banana. At most five bananas.
  var gorilla = document.querySelector(".mark-gorilla");
  var basket = gorilla && gorilla.querySelector(".bananas");
  if (gorilla && basket) {
    asButton(gorilla, "Gorilla’s mark, a friendly gorilla");
    var clicks = 0, last = 0, dropped = 0;
    var spots = [[58, 62, 0], [4, 66, -18], [36, 74, 12], [66, 30, 24], [-2, 30, -30]];
    var BANANA =
      '<svg viewBox="0 0 28 28" focusable="false">' +
      '<path class="peel" d="M5 6c-1 9 5 17 16 17 2 0 4-1 4-2-9 0-15-6-17-15Z"/>' +
      '<path class="stem" d="M5 6 4 3.5 7 3.2 8 6"/>' +
      "</svg>";

    var drop = function () {
      if (dropped >= spots.length) { say("That’s the whole bunch."); return; }
      var spot = spots[dropped++];
      var b = document.createElement("span");
      b.className = "banana";
      b.innerHTML = BANANA;
      b.style.left = spot[0] + "%";
      b.style.top = spot[1] + "%";
      b.firstChild.style.transform = "rotate(" + spot[2] + "deg)";
      basket.appendChild(b);
      say(dropped === 1 ? "A banana drops." : "Another banana.");
    };

    var poke = function () {
      var now = Date.now();
      clicks = now - last < 1500 ? clicks + 1 : 1;
      last = now;
      if (clicks >= 5) { clicks = 0; drop(); }
    };

    gorilla.addEventListener("click", poke);
  }

  // ---------------------------------------------------------------------
  // GoiDev67's mark opens a line on where it all started, and lights the
  // fixed point of the Half Delta mark for a moment.
  var goi = document.querySelector(".mark-goidev");
  var origin = document.getElementById("origin");
  var delta = document.querySelector(".delta-mark");
  if (goi && origin) {
    asButton(goi, "GoiDev67’s mark, a grin between angle brackets");
    goi.setAttribute("aria-expanded", "false");
    goi.setAttribute("aria-controls", "origin");
    var unlit = null;
    goi.addEventListener("click", function () {
      var open = origin.hidden;
      origin.hidden = !open;
      origin.classList.toggle("on", open);
      goi.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open || !delta) return;
      delta.classList.add("lit");
      window.clearTimeout(unlit);
      unlit = window.setTimeout(function () { delta.classList.remove("lit"); }, 2400);
    });
  }

  // ---------------------------------------------------------------------
  // The old cheat code: the point slides up the curve to full delta, waits,
  // and slides back to half.
  var mark = document.querySelector(".delta-mark");
  var curve = mark && mark.querySelector(".sig");
  var ring = mark && mark.querySelector(".ring");
  var note = document.querySelector(".delta-note");
  var CODE = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
  var at = 0, busy = false;

  if (mark && curve && ring && curve.getTotalLength) {
    var total = curve.getTotalLength();
    var place = function (t) {
      var p = curve.getPointAtLength(total * t);
      ring.setAttribute("cx", p.x.toFixed(2));
      ring.setAttribute("cy", p.y.toFixed(2));
    };
    var glide = function (from, to, ms, done) {
      if (reduce.matches) { place(to); done(); return; }
      var start = null;
      var step = function (now) {
        if (start === null) start = now;
        var k = Math.min(1, (now - start) / ms);
        var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        place(from + (to - from) * e);
        if (k < 1) window.requestAnimationFrame(step); else done();
      };
      window.requestAnimationFrame(step);
    };
    var fullDelta = function () {
      if (busy) return;
      busy = true;
      glide(0.5, 1, 900, function () {
        if (note) { note.textContent = "Δ = 1. Briefly."; note.classList.add("on"); }
        say("Full delta. Back to half in a moment.");
        window.setTimeout(function () {
          if (note) note.classList.remove("on");
          glide(1, 0.5, 1100, function () { place(0.5); busy = false; });
        }, 2600);
      });
    };

    document.addEventListener("keydown", function (ev) {
      var k = (ev.key || "").toLowerCase();
      if (k === CODE[at]) {
        at++;
        if (at === CODE.length) { at = 0; fullDelta(); }
      } else {
        // A third "up" keeps the first two.
        at = k !== CODE[0] ? 0 : (at === 2 ? 2 : 1);
      }
    });
  }
})();
