/*
 * The fixed point.
 *
 * A family of S-curves y = N((x - k) / s): as s shrinks the curve steepens
 * toward a step, ever more slowly, and never quite gets there; every member
 * passes through the same point (k, 1/2). A dot follows a random walk in x and
 * is plotted on the live curve, so it moves most where the curve is steepest
 * and drifts toward 0 or 1 as the curve tightens. The cycle then dissolves and
 * starts again.
 *
 * Without JavaScript, or with reduced motion, the static SVG fan is shown.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var field = document.querySelector(".field");
  var fan = document.querySelector(".fan");
  var canvas = document.querySelector(".live");
  if (!field || !fan || !canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var dark = window.matchMedia("(prefers-color-scheme: dark)");

  // Timing, in seconds.
  var RUN = 11;      // curve goes from wide to step
  var HOLD = 3.2;    // the steepest curve and the settled dot stay on screen
  var FADE_IN = 1.2;
  var FADE_OUT = 2.4;
  var CYCLE = RUN + HOLD;
  var GHOST_RATIO = 0.86; // keep a faint copy each time the width shrinks by this factor
  var SMOOTH = 0.16;      // seconds; the dot eases toward the random walk

  // Curve width at the start and the narrowest it gets, in svg units (1 unit =
  // 1/1000 of the page width). It never reaches a step: a sliver of
  // uncertainty always remains.
  var S0 = 640;
  var SMIN = 34;

  var W = 0, H = 0, cx = 0, cy = 0, amp = 0, unit = 0, dpr = 1;
  var colors = { ink: "#16202C", signal: "#2747C9", paper: "#ECEEEA", ghost: 0.2 };

  var tau = 0;          // time in the current cycle
  var walk = 0;         // random walk, svg units from the fixed point
  var dot = 0;          // drawn dot position, eased toward the walk
  var ghosts = [];      // widths of earlier curves this cycle
  var nextGhost = 0;
  var trail = [];       // recent dot positions, svg units
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

  function readColors() {
    var cs = getComputedStyle(root);
    colors.ink = cs.getPropertyValue("--ink").trim() || colors.ink;
    colors.signal = cs.getPropertyValue("--signal").trim() || colors.signal;
    colors.paper = cs.getPropertyValue("--paper").trim() || colors.paper;
    colors.ghost = parseFloat(cs.getPropertyValue("--ghost")) || colors.ghost;
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
  }

  // Geometric interpolation from S0 to SMIN with an ease-out, so the curve
  // steepens quickly at first and ever more slowly as time runs out.
  function width(t) {
    var p = Math.min(1, Math.max(0, t / RUN));
    var e = 1 - Math.pow(1 - p, 3);
    return S0 * Math.pow(SMIN / S0, e);
  }

  function py(p) {
    return cy + amp - 2 * amp * p;
  }

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

  function reset() {
    tau = 0;
    walk = 0;
    dot = 0;
    ghosts.length = 0;
    trail.length = 0;
    nextGhost = S0 * GHOST_RATIO;
  }

  function step(dt) {
    tau += dt;
    if (tau >= CYCLE) reset();

    if (tau < RUN) {
      // Random walk with reflection so the dot stays on screen.
      var vol = 0.2 * S0 / Math.sqrt(RUN);
      walk += vol * Math.sqrt(dt) * gauss();
      var lo = (24 - cx) / unit;
      var hi = (W - 24 - cx) / unit;
      if (walk < lo) walk = 2 * lo - walk;
      if (walk > hi) walk = 2 * hi - walk;

      var w = width(tau);
      while (w <= nextGhost && nextGhost > 0.5) {
        ghosts.push(nextGhost);
        nextGhost *= GHOST_RATIO;
      }
    }

    dot += (walk - dot) * (1 - Math.exp(-dt / SMOOTH));
    trail.push(dot);
    if (trail.length > 40) trail.shift();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!unit || !amp) return;

    var a = Math.min(1, tau / FADE_IN, (CYCLE - tau) / FADE_OUT);
    a = Math.max(0, a);
    var settle = tau > RUN ? Math.min(1, (tau - RUN) / HOLD) : 0;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Earlier curves of this cycle.
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1;
    ctx.globalAlpha = a * colors.ghost * (1 - 0.5 * settle);
    for (var i = 0; i < ghosts.length; i++) curve(ghosts[i]);

    // The live curve.
    var sp = Math.max(width(Math.min(tau, RUN)) * unit, 0.3);
    ctx.strokeStyle = colors.signal;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = a;
    curve(width(Math.min(tau, RUN)));

    // Where the dot has been lately, traced on the live curve.
    if (trail.length > 1) {
      ctx.lineWidth = 3;
      for (var j = 1; j < trail.length; j++) {
        ctx.globalAlpha = a * 0.35 * (j / trail.length);
        ctx.beginPath();
        ctx.moveTo(cx + trail[j - 1] * unit, py(cdf(trail[j - 1] * unit / sp)));
        ctx.lineTo(cx + trail[j] * unit, py(cdf(trail[j] * unit / sp)));
        ctx.stroke();
      }
    }

    // The dot.
    if (trail.length) {
      var dx = cx + dot * unit;
      var dy = py(cdf(dot * unit / sp));
      ctx.globalAlpha = a;
      ctx.fillStyle = colors.paper;
      ctx.beginPath();
      ctx.arc(dx, dy, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = colors.signal;
      ctx.beginPath();
      ctx.arc(dx, dy, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
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
    reset();
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
