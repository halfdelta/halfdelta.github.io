/*
 * The fixed point, v2: an S that becomes infinity and comes back.
 *
 * One seamless loop, 26 seconds:
 *
 *   0-10 s   A family of S-curves y = N((x - k) / s) steepens. Every member
 *            passes through the same point (k, 1/2). A dot drifts at random
 *            along the live curve; faint copies of earlier curves build a fan.
 *  10-14 s   The live curve opens into an infinity sign whose crossing is the
 *            fixed point: its tails wind into two loops while a second strand
 *            peels off the S and swings down to the horizontal. The fan fades.
 *  14-20 s   Infinity. The dot glides around it.
 *  20-26 s   The infinity unwinds into the wide S it started from. The dot
 *            arrives back at the fixed point just as the S settles, and the
 *            loop goes on from there.
 *
 * The live shape is one closed path of four strands, each resampled evenly
 * along its length so the S and the infinity can be blended point by point:
 *
 *   AL  left end -> centre   S left half            | lower-left loop, outer arc
 *   AR  centre -> right end  S right half           | upper-right loop, outer arc
 *   BR  right end -> centre  S right half, reversed | upper-right loop, inner arc
 *   BL  centre -> left end   S left half, reversed  | lower-left loop, inner arc
 *
 * As an S, B lies exactly on A. As infinity, A and B are the two arcs of each
 * loop. Every strand keeps the centre at the same index, so the fixed point
 * never moves. The loops are a lemniscate of Bernoulli turned 45 degrees: it
 * leaves the centre vertically and horizontally, like the steep S and the
 * axis, and stays inside the two quadrants the S-curves already use, so the
 * label quadrant stays clear.
 *
 * Without JavaScript, or with reduced motion, the static SVG (the fan and
 * the infinity) is shown instead.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var field = document.querySelector(".field");
  var fan = document.querySelector(".fan");
  var lobeR = document.querySelector(".lobe-r");
  var lobeL = document.querySelector(".lobe-l");
  var canvas = document.querySelector(".live");
  if (!field || !fan || !canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var dark = window.matchMedia("(prefers-color-scheme: dark)");

  // Timeline, in seconds.
  var T_STEEP = 10;    // the S steepens
  var T_OPEN = 4;      // the S opens into infinity
  var T_INF = 6;       // infinity
  var T_CLOSE = 6;     // infinity unwinds into the wide S
  var T1 = T_STEEP, T2 = T1 + T_OPEN, T3 = T2 + T_INF, LOOP = T3 + T_CLOSE;
  var LAPS = 2;        // full laps the dot makes while the shape is open
  var FADE_IN = 1.2;   // first appearance only

  var GHOST_RATIO = 0.86; // keep a faint copy each time the width shrinks by this factor

  // Curve width at the start and the narrowest it gets, in svg units
  // (1 unit = 1/1000 of the page width). It never reaches a step.
  var S0 = 640;
  var SMIN = 34;

  var N = 160;            // points per strand

  var W = 0, H = 0, cx = 0, cy = 0, amp = 0, unit = 0, dpr = 1;
  var colors = { ink: "#16202C", signal: "#2747C9", paper: "#ECEEEA", ghost: 0.2 };

  var inf = null;               // the four strands of the infinity, on screen
  var shape = [];               // the blended closed path, 4N points
  var dense = [];               // scratch

  var clock = 0;        // time since start, for the first fade-in
  var tau = 0;          // time in the loop
  var walk = 0;         // random walk, svg units from the fixed point
  var dot = 0;          // dot position on the S, eased toward the walk
  var gliding = false;  // true while the dot follows the closed path
  var glideFrom = 0;    // its parameter on the path when the glide starts
  var glideBy = 0;      // and how far it travels
  var ghosts = [];
  var nextGhost = 0;
  var trail = [];       // recent dot positions on screen
  var last = 0;
  var raf = 0;
  var running = false;

  // Normal CDF through erf (Abramowitz and Stegun 7.1.26).
  function cdf(z) {
    var x = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  function gauss() {
    var u = 1 - Math.random();
    var v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp01(p) { return p < 0 ? 0 : p > 1 ? 1 : p; }
  // Starts and ends at rest.
  function smoother(p) { p = clamp01(p); return p * p * p * (p * (6 * p - 15) + 10); }
  // Starts at rest, ends with a long, slow approach.
  function steepEase(p) { p = clamp01(p); var q = 1 - p * p; return 1 - q * q * q; }

  function readColors() {
    var cs = getComputedStyle(root);
    colors.ink = cs.getPropertyValue("--ink").trim() || colors.ink;
    colors.signal = cs.getPropertyValue("--signal").trim() || colors.signal;
    colors.paper = cs.getPropertyValue("--paper").trim() || colors.paper;
    colors.ghost = parseFloat(cs.getPropertyValue("--ghost")) || colors.ghost;
  }

  // Resample a polyline to n points evenly spaced along its length.
  function resample(pts, n, out) {
    var len = [0], i;
    for (i = 1; i < pts.length; i++) {
      len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    var total = len[len.length - 1] || 1;
    out = out || [];
    out.length = n;
    var j = 1;
    for (i = 0; i < n; i++) {
      var d = total * i / (n - 1);
      while (j < pts.length - 1 && len[j] < d) j++;
      var seg = len[j] - len[j - 1] || 1;
      var f = clamp01((d - len[j - 1]) / seg);
      var p = out[i] || (out[i] = [0, 0]);
      p[0] = pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f;
      p[1] = pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f;
    }
    return out;
  }

  // One loop of a lemniscate of Bernoulli turned 45 degrees, r^2 = sin 2phi,
  // scaled to a unit box (y up). Returns [outer, inner]: outer leaves the
  // centre vertically and ends at the tip; inner runs from the tip back to the
  // centre, arriving horizontally. The same curve as the static SVG.
  var LOBE_MAX = Math.sqrt(2 * Math.pow(Math.sin(Math.PI / 3), 3) * Math.cos(Math.PI / 3));
  function lobePoint(phi) {
    var r = Math.sqrt(Math.max(0, Math.sin(2 * phi)));
    return [r * Math.cos(phi) / LOBE_MAX, r * Math.sin(phi) / LOBE_MAX];
  }
  var UNIT = (function () {
    var outer = [], inner = [], k, m = 300;
    for (k = 0; k <= m; k++) {
      // dense near the centre, where r changes fastest
      var s = 1 - Math.cos(Math.PI / 2 * k / m);
      outer.push(lobePoint(Math.PI / 2 - (Math.PI / 4) * s));
      inner.push(lobePoint((Math.PI / 4) * (1 - s)));
    }
    return [outer, inner];
  })();

  function box(el, fw, fh) {
    var r = el && el.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? [r.width, r.height] : [fw, fh];
  }

  // The loop sizes come from the static SVG boxes, which CSS sizes.
  function buildInfinity() {
    var rb = box(lobeR, Math.min(2 * amp, W - cx - 24), Math.min(amp, W - cx - 24));
    var lb = box(lobeL, Math.min(2 * amp, cx - 10), Math.min(amp, cx - 10));
    function place(pts, sx, sy) {
      return pts.map(function (p) { return [cx + sx * p[0], cy + sy * p[1]]; });
    }
    inf = {
      AL: resample(place(UNIT[0], -lb[0], lb[1]).reverse(), N),  // tip -> centre, rising
      AR: resample(place(UNIT[0], rb[0], -rb[1]), N),            // centre -> tip
      BR: resample(place(UNIT[1], rb[0], -rb[1]), N),            // tip -> centre, heading left
      BL: resample(place(UNIT[1], -lb[0], lb[1]).reverse(), N)   // centre -> tip, heading left
    };
  }

  function measure() {
    var f = field.getBoundingClientRect();
    var r = fan.getBoundingClientRect();
    W = f.width;
    H = f.height;
    cx = r.left - f.left + r.width / 2;
    cy = r.top - f.top + r.height / 2;
    amp = r.height / 2;
    unit = r.width / 2000;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildInfinity();
    trail.length = 0;
  }

  function py(p) {
    return cy + amp - 2 * amp * p;
  }

  // Width of the S at loop time t, in svg units. While the shape is open the
  // S is only a blend target. It relaxes as it opens, so the steep S's sharp
  // shoulders don't carry into the loops, and is wide again for the closing.
  function widthAt(t) {
    if (t < T1) return S0 * Math.pow(SMIN / S0, steepEase(t / T1));
    if (t < T2) return SMIN * Math.pow(S0 / SMIN, 0.6 * smoother((t - T1) / T_OPEN));
    return S0;
  }

  // The S of width s as the same four strands, so it can be blended with the
  // infinity point by point. On screen, B lies exactly on A. Off screen, past
  // each edge, A runs on, turns back in a wide hairpin and returns as B, which
  // bends back onto the S. That turn becomes the tip of each loop, so the
  // shape stays smooth at every moment of the blend. The left side is the
  // right side turned half a circle about the fixed point, as the S is.
  var sAL = [], sAR = [], sBR = [], sBL = [];
  function buildS(s) {
    var sp = Math.max(s * unit, 0.3), m = 320, i, q, x, th;
    var rho = 0.35 * amp;
    var xe = W + 20, xe2 = xe + 8 * rho;
    function yAt(x) { return py(cdf((x - cx) / sp)); }
    // Unit tangent and inner normal (below the curve, on screen) at x.
    function frameAt(x) {
      var h = 0.5, dy = (yAt(x + h) - yAt(x - h)) / (2 * h), l = Math.hypot(1, dy);
      return [1 / l, dy / l, -dy / l, 1 / l];
    }
    var yq = yAt(xe2), F = frameAt(xe2);
    var ccx = xe2 + rho * F[2], ccy = yq + rho * F[3];
    function turn(th) {
      return [ccx + rho * (-F[2] * Math.cos(th) + F[0] * Math.sin(th)),
              ccy + rho * (-F[3] * Math.cos(th) + F[1] * Math.sin(th))];
    }

    // A: centre -> past the right edge along the S, then half the turn.
    dense.length = 0;
    for (i = 0; i <= m; i++) {
      q = i / m;
      x = cx + (xe2 - cx) * q * q;
      dense.push([x, yAt(x)]);
    }
    for (i = 1; i <= 24; i++) dense.push(turn((Math.PI / 2) * i / 24));
    resample(dense, N, sAR);

    // B: the rest of the turn, then back alongside the S, closing onto it
    // before the edge, then along the S to the centre.
    dense.length = 0;
    for (i = 0; i <= 24; i++) dense.push(turn(Math.PI / 2 + (Math.PI / 2) * i / 24));
    for (i = 1; i <= 40; i++) {
      x = xe2 - (xe2 - xe) * i / 40;
      var w = 0.5 + 0.5 * Math.cos(Math.PI * i / 40), G = frameAt(x);
      dense.push([x + 2 * rho * w * G[2], yAt(x) + 2 * rho * w * G[3]]);
    }
    for (i = m; i >= 0; i--) {
      q = i / m;
      x = cx + (xe - cx) * q * q;
      if (x < xe) dense.push([x, yAt(x)]);
    }
    resample(dense, N, sBR);

    // Left side: half a turn about the fixed point, run the other way.
    for (i = 0; i < N; i++) {
      var a = sAR[N - 1 - i], b = sBR[N - 1 - i];
      var pa = sAL[i] || (sAL[i] = [0, 0]), pb = sBL[i] || (sBL[i] = [0, 0]);
      pa[0] = 2 * cx - a[0]; pa[1] = 2 * cy - a[1];
      pb[0] = 2 * cx - b[0]; pb[1] = 2 * cy - b[1];
    }
    sAL.length = sBL.length = N;
  }

  // Blend the S with the infinity by e in [0, 1] into `shape`, a closed path
  // of 4N points: AL, AR, BR, BL.
  function blend(e) {
    var S = [sAL, sAR, sBR, sBL], L = [inf.AL, inf.AR, inf.BR, inf.BL];
    var k = 0;
    shape.length = 4 * N;
    for (var p = 0; p < 4; p++) {
      for (var i = 0; i < N; i++) {
        var a = S[p][i], b = L[p][i];
        var o = shape[k] || (shape[k] = [0, 0]);
        o[0] = a[0] + (b[0] - a[0]) * e;
        o[1] = a[1] + (b[1] - a[1]) * e;
        k++;
      }
    }
  }

  // Point on the closed shape at parameter v (wraps at 1). The centre, on
  // the rising strand, is v = 0.25.
  function at(v) {
    v -= Math.floor(v);
    var t = v * 4, part = Math.min(3, Math.floor(t));
    var f = (t - part) * (N - 1), i = Math.min(N - 2, Math.floor(f));
    var a = shape[part * N + i], b = shape[part * N + i + 1], g = f - i;
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
  }

  // Parameter of the point at screen x on the rising strand of the S.
  function paramForX(x) {
    var half = x < cx ? sAL : sAR, base = x < cx ? 0 : 0.25;
    for (var i = 1; i < N; i++) {
      var x0 = half[i - 1][0], x1 = half[i][0];
      if ((x >= x0 && x <= x1) || i === N - 1) {
        var g = x1 === x0 ? 0 : clamp01((x - x0) / (x1 - x0));
        return base + 0.25 * (i - 1 + g) / (N - 1);
      }
    }
    return 0.25;
  }

  // The S-phase dot moves in units of the curve's own width (z), with
  // momentum: a damped, mean-reverting velocity, so it glides like the dot on
  // the infinity instead of jittering, and it does not speed up as the curve
  // steepens. Late in the phase it drifts calmly toward one side (delta near
  // 0 or 1) as the uncertainty resolves.
  var zPos = 0, zVel = 0, zSide = 1;
  var Z_PULL = 0.9, Z_DAMP = 1.8, Z_NOISE = 0.5, Z_END = 1.9;
  function smoothstep(a, b, x) {
    var t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  function restartLoop() {
    walk = 0;
    dot = 0;
    zPos = 0;
    zVel = 0;
    zSide = Math.random() < 0.5 ? -1 : 1;
    gliding = false;
    ghosts.length = 0;
    nextGhost = S0 * GHOST_RATIO;
  }

  function step(dt) {
    clock += dt;
    tau += dt;
    if (tau >= LOOP) {
      // The dot is back at the centre and the S is wide again: carry on.
      tau -= LOOP;
      restartLoop();
    }

    if (tau < T1) {
      // Smooth glide in curve-width units (see restartLoop), kept on screen.
      var target = zSide * Z_END * smoothstep(0.35, 1, tau / T1);
      zVel += (-(zPos - target) * Z_PULL - zVel * Z_DAMP) * dt + Z_NOISE * Math.sqrt(dt) * gauss();
      zPos += zVel * dt;
      var lo = (24 - cx) / unit;
      var hi = (W - 24 - cx) / unit;
      walk = Math.min(hi, Math.max(lo, zPos * widthAt(tau)));
      dot = walk;

      var w = widthAt(tau);
      while (w <= nextGhost && nextGhost > SMIN) {
        ghosts.push(nextGhost);
        nextGhost *= GHOST_RATIO;
      }
    } else if (!gliding) {
      // Hand the dot from the S to the closed path. It glides from rest,
      // makes its laps, and arrives at the centre as the loop ends.
      gliding = true;
      buildS(SMIN);
      glideFrom = paramForX(cx + dot * unit);
      var toCentre = 0.25 - glideFrom;
      glideBy = LAPS + toCentre - Math.floor(toCentre);
    }
  }

  // A full S-curve of width s (svg units), for the fan.
  function curve(s) {
    var sp = Math.max(s * unit, 0.3);
    var x0 = Math.max(0, cx - 4.2 * sp);
    var x1 = Math.min(W, cx + 4.2 * sp);
    var n = Math.min(220, Math.max(24, Math.ceil((x1 - x0) / 2)));
    ctx.beginPath();
    ctx.moveTo(0, py(cdf(-cx / sp)));
    for (var i = 0; i <= n; i++) {
      var x = x0 + (x1 - x0) * i / n;
      ctx.lineTo(x, py(cdf((x - cx) / sp)));
    }
    ctx.lineTo(W, py(cdf((W - cx) / sp)));
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!unit || !amp || !inf) return;

    var a = Math.min(1, clock / FADE_IN);
    var e = 0;
    if (tau >= T1 && tau < T2) e = smoother((tau - T1) / T_OPEN);
    else if (tau >= T2 && tau < T3) e = 1;
    else if (tau >= T3) e = 1 - smoother((tau - T3) / T_CLOSE);

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // The fan of earlier curves fades as the S opens.
    var g = tau < T1 ? 1 : tau < T2 ? Math.pow(1 - e, 1.5) : 0;
    if (g > 0.002 && ghosts.length) {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      ctx.globalAlpha = a * colors.ghost * g;
      for (var i = 0; i < ghosts.length; i++) curve(ghosts[i]);
    }

    // The live shape.
    buildS(widthAt(tau));
    blend(e);
    ctx.strokeStyle = colors.signal;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = a;
    // Drawn through the midpoints with quadratic segments, so it stays smooth.
    var n4 = shape.length, p0 = shape[n4 - 1], p1 = shape[0];
    ctx.beginPath();
    ctx.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    for (var k = 0; k < n4; k++) {
      p0 = shape[k];
      p1 = shape[(k + 1) % n4];
      ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    }
    ctx.stroke();

    // The dot and a short trace of where it has been.
    var d;
    if (gliding) {
      d = at(glideFrom + glideBy * smoother((tau - T1) / (LOOP - T1)));
    } else {
      var sp = Math.max(widthAt(tau) * unit, 0.3);
      d = [cx + dot * unit, py(cdf(dot * unit / sp))];
    }
    trail.push(d);
    if (trail.length > 36) trail.shift();

    ctx.lineWidth = 3;
    for (var j = 1; j < trail.length; j++) {
      ctx.globalAlpha = a * 0.3 * (j / trail.length);
      ctx.beginPath();
      ctx.moveTo(trail[j - 1][0], trail[j - 1][1]);
      ctx.lineTo(trail[j][0], trail[j][1]);
      ctx.stroke();
    }

    ctx.globalAlpha = a;
    ctx.fillStyle = colors.paper;
    ctx.beginPath();
    ctx.arc(d[0], d[1], 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = colors.signal;
    ctx.beginPath();
    ctx.arc(d[0], d[1], 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    step(dt);
    draw();
    raf = window.requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    root.classList.add("js-live");
    readColors();
    measure();
    tau = 0;
    clock = 0;
    restartLoop();
    last = 0;
    raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    window.cancelAnimationFrame(raf);
    root.classList.remove("js-live");
  }

  function onMotionChange() {
    if (reduce.matches) stop();
    else start();
  }

  function listen(mq, fn) {
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else if (mq.addListener) mq.addListener(fn);
  }

  listen(reduce, onMotionChange);
  listen(dark, readColors);
  window.addEventListener("resize", function () {
    if (running) measure();
  });

  if (!reduce.matches) start();
})();
