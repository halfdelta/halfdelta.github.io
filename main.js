/*
 * The fixed point, v3: five shapes through one point.
 *
 * One seamless loop. Every shape passes through the fixed point and morphs
 * smoothly into the next:
 *
 *   S         delta: the S-curve N((x - k) / s), steepening; every member
 *             passes through (k, 1/2), and faint copies build a fan
 *   bell      gamma, the slope of delta: a normal curve standing on the axis,
 *             its peak right above the fixed point
 *   smile     vega: the volatility smile, lowest at the fixed point
 *   spiral    the Cornu (Euler) spiral; its arms wind toward (1/2, 1/2) and
 *             (-1/2, -1/2), then unwind
 *   infinity  a lemniscate that crosses itself at the fixed point, then
 *             unwinds into the wide S, and the loop goes on
 *
 * A dot slides freely along whatever is on screen at a calm, steady speed.
 * It eases through tight turns and turns back gently before it would leave
 * the screen. Its position on the path carries over from shape to shape, so
 * it never jumps. When a morph is about to carry its stretch of path off
 * screen, it heads back toward the fixed point.
 *
 * How the shapes blend: each shape is one closed path of four strands,
 * resampled evenly along their length, so any two shapes can be blended
 * point by point:
 *
 *   AL -> AR   one side (the S, the bell's hump, the smile, the spiral, the
 *              infinity's outer arcs)
 *   BR -> BL   the other side, which meets itself at the fixed point at the
 *              BR/BL join (the open curves retraced, the bell's baseline,
 *              the infinity's inner arcs)
 *
 * The BR/BL join is the fixed point in every shape, so the point never moves.
 * Open curves (the S, the smile, the spiral) are retraced: B runs back along
 * A. At each end, A turns back in a hairpin, and B rides just beside A for a
 * stretch before rejoining it. Each hairpin turns the same way as the end of
 * the shape it blends with, so no blend pinches into a cusp. Where two
 * neighbours disagree, the hairpin swaps direction off screen during a hold.
 * Every shape keeps clear of the lower-right quarter, where the label sits.
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

  // ---------------------------------------------------------------------
  // Timeline, in seconds. A shape name holds that shape; a pair morphs from
  // the first to the second. The last step unwinds back into the first.
  var SEQUENCE = [
    ["S", 7],                 // the S steepens, the fan builds
    ["S", "bell", 3.5],
    ["bell", 4],
    ["bell", "smile", 3.5],
    ["smile", 4],
    ["smile", "spiral", 3.5],
    ["spiral", 5.5],          // winds up, holds, unwinds
    ["spiral", "infinity", 3.5],
    ["infinity", 5],
    ["infinity", "S", 6]      // unwinds into the wide S: the seam
  ];
  var FADE_IN = 1.2;          // first appearance only

  // The dot: cruising speed (px/s, scaled to the screen), how quickly it
  // eases to a new speed or direction (s), and how much it slows in turns.
  var SPEED_MIN = 90, SPEED_MAX = 190, SPEED_PER_PX = 0.14;
  var EASE = 1.0;
  var TURN_SLOW = 18;
  var TRAIL = 48;             // frames of trace behind the dot

  // The S: width at the start and narrowest, in svg units (1/1000 of the
  // page width). It never reaches a step.
  var S0 = 640, SMIN = 34;
  var GHOST_RATIO = 0.86;     // a faint copy each time the S narrows by this factor

  var N = 160;                // points per strand
  // ---------------------------------------------------------------------

  var steps = [], LOOP = 0;
  (function () {
    var t = 0;
    for (var i = 0; i < SEQUENCE.length; i++) {
      var s = SEQUENCE[i], d = s[s.length - 1];
      steps.push({ from: s[0], to: s.length === 3 ? s[1] : null, start: t, dur: d });
      t += d;
    }
    LOOP = t;
  })();

  var W = 0, H = 0, cx = 0, cy = 0, amp = 0, unit = 0, dpr = 1;
  var colors = { ink: "#16202C", signal: "#2747C9", paper: "#ECEEEA", ghost: 0.2 };

  var shapes = {};            // precomputed strands for the fixed shapes
  var shape = [];             // the current closed path, 4N points
  var target = null;          // the shape being morphed into, if any
  var pathLen = 1;

  var clock = 0, tau = 0;
  var v = 0.25, spd = 0, dir = 1;  // dot: parameter on the path, speed (px/s), heading
  var ghosts = [], nextGhost = 0;
  var trail = [];
  var last = 0, raf = 0, running = false;

  // --- maths -----------------------------------------------------------

  // Normal CDF through erf (Abramowitz and Stegun 7.1.26).
  function cdf(z) {
    var x = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  function clamp01(p) { return p < 0 ? 0 : p > 1 ? 1 : p; }
  function smoother(p) { p = clamp01(p); return p * p * p * (p * (6 * p - 15) + 10); }
  function steepEase(p) { p = clamp01(p); var q = 1 - p * p; return 1 - q * q * q; }

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

  // Half a turn about the fixed point, run the other way.
  function mirror(strand) {
    var out = [];
    for (var i = strand.length - 1; i >= 0; i--) out.push([2 * cx - strand[i][0], 2 * cy - strand[i][1]]);
    return out;
  }

  // An open half-curve as the A and B strands of one side. poly runs from
  // the fixed point out to the end of the curve. A follows it and begins a
  // hairpin turn of radius rho, to its right (side 1) or left (side -1). B finishes the turn, rides
  // beside A at 2 rho, eases back onto it over a length `merge`, and follows
  // it home.
  function hairpin(poly, rho, merge, side) {
    side = side || 1;
    var m = poly.length, i, len = [0];
    for (i = 1; i < m; i++) len.push(len[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    var total = len[m - 1];
    function normal(i) {
      var a = poly[Math.max(0, i - 1)], b = poly[Math.min(m - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l, -side * dy / l, side * dx / l];   // tangent, normal on `side`
    }
    var E = poly[m - 1], F = normal(m - 1);
    var ccx = E[0] + rho * F[2], ccy = E[1] + rho * F[3];
    function turn(th) {
      return [ccx + rho * (-F[2] * Math.cos(th) + F[0] * Math.sin(th)),
              ccy + rho * (-F[3] * Math.cos(th) + F[1] * Math.sin(th))];
    }
    var A = poly.slice(), B = [];
    for (i = 1; i <= 16; i++) A.push(turn((Math.PI / 2) * i / 16));
    for (i = 0; i <= 16; i++) B.push(turn(Math.PI / 2 + (Math.PI / 2) * i / 16));
    for (i = m - 2; i >= 0; i--) {
      var s = total - len[i];
      var w = s < merge ? 0.5 + 0.5 * Math.cos(Math.PI * s / merge) : 0;
      if (w > 0) {
        var G = normal(i);
        B.push([poly[i][0] + 2 * rho * w * G[2], poly[i][1] + 2 * rho * w * G[3]]);
      } else {
        B.push([poly[i][0], poly[i][1]]);
      }
    }
    return [resample(A, N), resample(B, N)];
  }

  // Four strands from the right half and a mirrored left half.
  function fromHalves(right, left) {
    return [mirror(left[0]), right[0], right[1], mirror(left[1])];
  }

  // --- the shapes --------------------------------------------------------

  function box(el, fw, fh) {
    var r = el && el.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? [r.width, r.height] : [fw, fh];
  }

  // The S of width s (svg units). Its hairpins sit off screen, past each
  // edge, so on screen it is a single line.
  // The S keeps its right hairpin turning clockwise. Its left hairpin turns
  // the way the next shape needs: counter-clockwise like the infinity's left
  // loop (side 1), or clockwise like the bell's left foot (side -1). Both
  // hairpins are off screen, so switching between them is invisible.
  var sCache = {};
  function buildS(s, leftSide) {
    var key = leftSide + ":" + s.toFixed(2);
    if (sCache.key === key) return sCache.strands;
    var sp = Math.max(s * unit, 0.3), rho = 0.35 * amp, merge = 8 * rho;
    // Each half runs just past its own screen edge, then turns.
    function half(reach) {
      var poly = [], m = 260, end = reach + merge;
      for (var i = 0; i <= m; i++) {
        var q = i / m, x = cx + end * q * q;
        poly.push([x, cy + amp - 2 * amp * cdf((x - cx) / sp)]);
      }
      return poly;
    }
    sCache.key = key;
    sCache.strands = fromHalves(hairpin(half(W + 20 - cx), rho, merge, 1),
                                hairpin(half(cx + 20), rho, merge, leftSide));
    return sCache.strands;
  }

  // Gamma: a normal curve standing on the axis, its peak right above the
  // fixed point, its feet rounded. A is the hump (left foot to right foot),
  // B the baseline back through the fixed point.
  function buildBell() {
    var L = Math.min(2.1 * amp, W - cx - 24), r = Math.max(4, 0.05 * amp);
    L = Math.max(L - r, 40);
    var sig = L / 3, Hh = amp, eL = Math.exp(-L * L / (2 * sig * sig));
    function hump(x) { return 2 * r + (Hh - 2 * r) * (Math.exp(-x * x / (2 * sig * sig)) - eL) / (1 - eL); }
    function P(x, y) { return [cx + x, cy - y]; }
    var AL = [], AR = [], BR = [], BL = [], i, k = 24, m = 200, ph, x;
    for (i = 0; i <= k; i++) { ph = Math.PI - (Math.PI / 2) * i / k; AL.push(P(-L + r * Math.cos(ph), r + r * Math.sin(ph))); }
    for (i = 1; i <= m; i++) { x = -L + L * i / m; AL.push(P(x, hump(x))); }
    for (i = 0; i <= m; i++) { x = L * i / m; AR.push(P(x, hump(x))); }
    for (i = 1; i <= k; i++) { ph = Math.PI / 2 - (Math.PI / 2) * i / k; AR.push(P(L + r * Math.cos(ph), r + r * Math.sin(ph))); }
    for (i = 0; i <= k; i++) { ph = -(Math.PI / 2) * i / k; BR.push(P(L + r * Math.cos(ph), r + r * Math.sin(ph))); }
    for (i = 1; i <= m; i++) BR.push(P(L - L * i / m, 0));
    for (i = 0; i <= m; i++) BL.push(P(-L * i / m, 0));
    for (i = 1; i <= k; i++) { ph = -Math.PI / 2 - (Math.PI / 2) * i / k; BL.push(P(-L + r * Math.cos(ph), r + r * Math.sin(ph))); }
    return [resample(AL, N), resample(AR, N), resample(BR, N), resample(BL, N)];
  }

  // Vega: the volatility smile, a parabola whose lowest point is the fixed
  // point, its arms rising out of the screen. Like the S, it is retraced,
  // with its hairpins off screen. The left hairpin can turn either way (see
  // the S).
  function buildSmile(leftSide) {
    var Xs = Math.max(0.45 * W, 1.6 * amp), rho = 0.35 * amp, merge = 4 * rho;
    var M = merge + 20, step = 3;
    // Each arm runs until it is M past the edge of the screen, then turns.
    function arm(sign) {
      var pts = [], x = 0, y = 0;
      do {
        y = amp * (x / Xs) * (x / Xs);
        pts.push([cx + x, cy + sign * y]);
        x += step;
      } while (cy - y > -M && (sign < 0 ? cx + x < W + M : cx - x > -M));
      return pts;
    }
    // The left arm is built turned half a circle, as fromHalves expects.
    return fromHalves(hairpin(arm(-1), rho, merge, 1), hairpin(arm(1), rho, merge, leftSide));
  }

  // The Cornu spiral (x, y) = (S(t), C(t)), Fresnel integrals, mirrored so
  // it leaves the fixed point straight up and turns clockwise, like the
  // infinity. Each arm winds toward (1/2, 1/2) in its own quarter.
  var TM_LO = 1.0, TM_HI = 2.9;    // spiral length: a curl, fully wound
  var FRESNEL = (function () {
    var pts = [[0, 0]], x = 0, y = 0, TM = TM_HI, n = 1400, dt = TM / n;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) * dt, a = Math.PI * t * t / 2;
      x += Math.sin(a) * dt;
      y += Math.cos(a) * dt;
      pts.push([x, y]);
    }
    return pts;
  })();

  // The spiral with arms of length tm (TM_LO: a hook, TM_HI: wound twice).
  // It meets the other shapes as a hook and winds up only while it holds,
  // so no blend ever has to drag a coil around.
  var spCache = { tm: -1, strands: null }, boxes = null;
  function buildSpiral(tm) {
    if (Math.abs(tm - spCache.tm) < 0.002 && spCache.strands) return spCache.strands;
    var n = Math.max(8, Math.round((FRESNEL.length - 1) * tm / TM_HI));
    var pts = FRESNEL.slice(0, n + 1);
    function half(bw, bh) {
      var ky = bh / 0.78, kx = Math.min(bw / 0.72, 1.4 * ky);
      var poly = pts.map(function (p) { return [cx + kx * p[0], cy - ky * p[1]]; });
      // A wide turn while it is a hook, so blends with the other shapes'
      // round ends stay smooth; a tight one once it is wound.
      var rho = 1.5 + (0.1 * ky - 1.5) * (TM_HI - tm) / (TM_HI - TM_LO);
      return hairpin(poly, rho, 5 * rho + 10);
    }
    spCache.tm = tm;
    spCache.strands = fromHalves(half(boxes.r[0], boxes.r[1]), half(boxes.l[0], boxes.l[1]));
    return spCache.strands;
  }

  // The infinity: one loop of a lemniscate of Bernoulli turned 45 degrees,
  // r^2 = sin 2phi, scaled to a unit box, placed in each quarter. Outer arcs
  // leave the fixed point vertically, inner arcs horizontally.
  var LOBE_MAX = Math.sqrt(2 * Math.pow(Math.sin(Math.PI / 3), 3) * Math.cos(Math.PI / 3));
  function lobePoint(phi) {
    var r = Math.sqrt(Math.max(0, Math.sin(2 * phi)));
    return [r * Math.cos(phi) / LOBE_MAX, r * Math.sin(phi) / LOBE_MAX];
  }
  var UNIT = (function () {
    var outer = [], inner = [], k, m = 300;
    for (k = 0; k <= m; k++) {
      var s = 1 - Math.cos(Math.PI / 2 * k / m);
      outer.push(lobePoint(Math.PI / 2 - (Math.PI / 4) * s));
      inner.push(lobePoint((Math.PI / 4) * (1 - s)));
    }
    return [outer, inner];
  })();

  function buildInfinity(rb, lb) {
    function place(pts, sx, sy) {
      return pts.map(function (p) { return [cx + sx * p[0], cy + sy * p[1]]; });
    }
    return [
      resample(place(UNIT[0], -lb[0], lb[1]).reverse(), N),
      resample(place(UNIT[0], rb[0], -rb[1]), N),
      resample(place(UNIT[1], rb[0], -rb[1]), N),
      resample(place(UNIT[1], -lb[0], lb[1]).reverse(), N)
    ];
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

    var rb = box(lobeR, Math.min(2 * amp, W - cx - 24), Math.min(amp, W - cx - 24));
    var lb = box(lobeL, Math.min(2 * amp, cx - 10), Math.min(amp, cx - 10));
    sCache.key = "";
    spCache.tm = -1;
    boxes = { r: rb, l: lb };
    shapes.bell = buildBell();
    shapes.smileIn = buildSmile(-1);   // turns like the bell
    shapes.smileOut = buildSmile(1);   // turns like the spiral
    shapes.infinity = buildInfinity(rb, lb);
    trail.length = 0;
  }

  // --- the timeline ------------------------------------------------------

  function stepAt(t) {
    for (var i = 0; i < steps.length; i++) if (t < steps[i].start + steps[i].dur) return i;
    return steps.length - 1;
  }

  // Width of the S: steepens while it holds, relaxes as it opens into the
  // bell (so its sharp shoulders don't carry over), and is wide again at the
  // end of the loop.
  function widthAt(t) {
    var st = steps[stepAt(t)], p = (t - st.start) / st.dur;
    if (st.from === "S" && !st.to) return S0 * Math.pow(SMIN / S0, steepEase(p));
    if (st.from === "S") return SMIN * Math.pow(S0 / SMIN, 0.6 * smoother(p));
    return S0;
  }

  // Length of the spiral's arms: it winds up over the first 40% of its hold,
  // stays wound, and unwinds to a hook over the last 40%.
  function spiralAt(t) {
    var st = steps[stepAt(t)];
    if (st.from !== "spiral" || st.to) return TM_LO;
    var p = (t - st.start) / st.dur;
    var w = p < 0.4 ? smoother(p / 0.4) : p > 0.6 ? smoother((1 - p) / 0.4) : 1;
    return TM_LO + (TM_HI - TM_LO) * w;
  }

  // Mix two sets of strands by f, into new arrays.
  function mix(P, Q, f) {
    if (f <= 0) return P;
    if (f >= 1) return Q;
    return P.map(function (strand, k) {
      return strand.map(function (a, i) {
        var b = Q[k][i];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      });
    });
  }

  // While the S or the smile holds, its off-screen left hairpin swaps
  // direction to suit the next shape.
  function swapAt(st, t) {
    return smoother(((t - st.start) / st.dur - 0.3) / 0.4);
  }

  function strandsOf(name, t) {
    var st = steps[stepAt(t)], holding = !st.to && st.from === name;
    if (name === "S") {
      var w = widthAt(t);
      if (holding) return mix(buildS(w, 1), buildS(w, -1), swapAt(st, t));
      return buildS(w, st.from === "S" ? -1 : 1);
    }
    if (name === "smile") {
      if (holding) return mix(shapes.smileIn, shapes.smileOut, swapAt(st, t));
      return st.from === "smile" ? shapes.smileOut : shapes.smileIn;
    }
    if (name === "spiral") return buildSpiral(spiralAt(t));
    return shapes[name];
  }

  // Blend two shapes by e into `shape` and measure its length.
  function blend(P, Q, e) {
    var k = 0, len = 0, prev = null;
    shape.length = 4 * N;
    for (var p = 0; p < 4; p++) {
      for (var i = 0; i < N; i++) {
        var a = P[p][i], b = Q[p][i];
        var o = shape[k] || (shape[k] = [0, 0]);
        o[0] = a[0] + (b[0] - a[0]) * e;
        o[1] = a[1] + (b[1] - a[1]) * e;
        if (prev) len += Math.hypot(o[0] - prev[0], o[1] - prev[1]);
        prev = o;
        k++;
      }
    }
    pathLen = Math.max(len, 1);
  }

  // Point on a set of strands at parameter u (wraps at 1).
  function pointOf(S, u) {
    u -= Math.floor(u);
    var t = u * 4, part = Math.min(3, Math.floor(t));
    var f = (t - part) * (N - 1), i = Math.min(N - 2, Math.floor(f));
    var a = S[part][i], b = S[part][i + 1], g = f - i;
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
  }

  // Point on the closed path at parameter u (wraps at 1).
  function at(u) {
    u -= Math.floor(u);
    var t = u * 4, part = Math.min(3, Math.floor(t));
    var f = (t - part) * (N - 1), i = Math.min(N - 2, Math.floor(f));
    var a = shape[part * N + i], b = shape[part * N + i + 1], g = f - i;
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
  }

  function onScreen(p, m) {
    return p[0] > m && p[0] < W - m && p[1] > m && p[1] < H - m;
  }

  // --- motion ------------------------------------------------------------

  // Path parameter per pixel differs from strand to strand, so the dot's
  // speed is kept in pixels and converted where it stands. A strand folded
  // to a point is crossed at once.
  function density(u) {
    var h = 0.002, p1 = at(u - h), p2 = at(u + h);
    return Math.max(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / (2 * h), 0.02 * pathLen);
  }

  function moveDot(dt) {
    var cruise = Math.min(SPEED_MAX, Math.max(SPEED_MIN, SPEED_PER_PX * W));
    var here = at(v), dens = density(v);

    // Ease through tight turns.
    var du = 12 / dens;
    var a = at(v - du), b = at(v + du);
    var t1x = here[0] - a[0], t1y = here[1] - a[1], t2x = b[0] - here[0], t2y = b[1] - here[1];
    var turnAngle = Math.abs(Math.atan2(t1x * t2y - t1y * t2x, t1x * t2x + t1y * t2y));
    var speed = cruise / (1 + TURN_SLOW * turnAngle / 12);

    // Turn back, gently, before leaving the screen. If a morph has carried
    // the dot off screen, head for the nearer visible part, quickly.
    if (!onScreen(here, 0)) {
      var ahead = 0, behind = 0, step = 8 / dens;
      for (var s = 1; s < 400; s++) {
        if (!ahead && onScreen(at(v + s * step), 20)) ahead = s;
        if (!behind && onScreen(at(v - s * step), 20)) behind = s;
        if (ahead && behind) break;
      }
      if (ahead || behind) dir = (!behind || (ahead && ahead <= behind)) ? 1 : -1;
      speed *= 4;
    } else if (target && !onScreen(pointOf(target, v), 20)) {
      // A morph is about to carry this part of the path off screen: head
      // for the fixed point (u = 0.75), the one place every shape keeps.
      var toPin = 0.75 - v;
      toPin -= Math.round(toPin);
      dir = toPin >= 0 ? 1 : -1;
      speed *= 2.2;
    } else {
      var look = (0.45 * Math.abs(spd) * EASE + 24) / dens;
      if (!onScreen(at(v + dir * look), 14) && onScreen(at(v - dir * look), 14)) dir = -dir;
    }

    spd += (dir * speed - spd) * (1 - Math.exp(-dt / EASE));
    v += spd * dt / dens;
  }

  // --- frame -------------------------------------------------------------

  function step(dt) {
    clock += dt;
    tau += dt;
    if (tau >= LOOP) {
      tau -= LOOP;
      ghosts.length = 0;
      nextGhost = S0 * GHOST_RATIO;
    }
    var st = steps[stepAt(tau)];
    if (st.from === "S" && !st.to) {
      var w = widthAt(tau);
      while (w <= nextGhost && nextGhost > SMIN) {
        ghosts.push(nextGhost);
        nextGhost *= GHOST_RATIO;
      }
    }
  }

  // A full S-curve of width s (svg units), for the fan.
  function curve(s) {
    var sp = Math.max(s * unit, 0.3);
    var x0 = Math.max(0, cx - 4.2 * sp), x1 = Math.min(W, cx + 4.2 * sp);
    var n = Math.min(220, Math.max(24, Math.ceil((x1 - x0) / 2)));
    function y(x) { return cy + amp - 2 * amp * cdf((x - cx) / sp); }
    ctx.beginPath();
    ctx.moveTo(0, y(0));
    for (var i = 0; i <= n; i++) { var x = x0 + (x1 - x0) * i / n; ctx.lineTo(x, y(x)); }
    ctx.lineTo(W, y(W));
    ctx.stroke();
  }

  function draw(dt) {
    ctx.clearRect(0, 0, W, H);
    if (!unit || !amp || !shapes.infinity) return;

    var a = Math.min(1, clock / FADE_IN);
    var st = steps[stepAt(tau)], p = (tau - st.start) / st.dur;
    var e = st.to ? smoother(p) : 0;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // The fan belongs to the S: it fades as the S opens into the bell.
    var g = st.from === "S" ? (st.to ? Math.pow(1 - e, 1.5) : 1) : 0;
    if (g > 0.002 && ghosts.length) {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      ctx.globalAlpha = a * colors.ghost * g;
      for (var i = 0; i < ghosts.length; i++) curve(ghosts[i]);
    }

    // The live shape, drawn through the midpoints with quadratic segments.
    var P = strandsOf(st.from, tau), Q = st.to ? strandsOf(st.to, tau) : null;
    blend(P, Q || P, e);
    // Where the dot should be heading: the shape now forming, or, late in a
    // hold, the next one.
    target = Q;
    var left = st.start + st.dur - tau, k2 = (stepAt(tau) + 1) % steps.length;
    if (!Q && left < 2) {
      var nx = steps[k2];
      target = strandsOf(nx.to, nx.start + nx.dur - 0.001);
    }
    var n4 = shape.length, q0 = shape[n4 - 1], q1 = shape[0];
    ctx.strokeStyle = colors.signal;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2);
    for (var k = 0; k < n4; k++) {
      q0 = shape[k];
      q1 = shape[(k + 1) % n4];
      ctx.quadraticCurveTo(q0[0], q0[1], (q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2);
    }
    ctx.stroke();

    // The dot and its trace.
    moveDot(dt);
    var d = at(v);
    trail.push(d);
    if (trail.length > TRAIL) trail.shift();
    ctx.lineWidth = 2.5;
    for (var j = 1; j < trail.length; j++) {
      ctx.globalAlpha = a * 0.45 * (j / trail.length) * (j / trail.length);
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
    draw(dt);
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
    v = 0.25;
    spd = 0;
    dir = 1;
    ghosts.length = 0;
    nextGhost = S0 * GHOST_RATIO;
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
