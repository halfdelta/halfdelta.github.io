/*
 * The fixed point, v4: three shapes, drawn out of one point.
 *
 * One seamless loop of three shapes. Every one passes through the fixed point:
 *
 *   S         delta: the S-curve N((x - k) / s), steepening. Each width it
 *             passes leaves a faint copy, a fan through the point.
 *   spiral    the Cornu (Euler) spiral. Its arms wind toward (1/2, 1/2) and
 *             (-1/2, -1/2). It tightens as it grows, leaving earlier
 *             windings behind as afterimages.
 *   infinity  a lemniscate crossing itself at the fixed point. Its loops
 *             breathe outward, leaving a fan of smaller loops.
 *
 * The transition is drawing, not morphing. Before each change the dot glides
 * home to the fixed point and comes to rest there. The old shape is left
 * where it is and fades to a ghost. The new shape is drawn outward from the
 * point along all its strands at once, and the dot rides the tip of one of
 * them, as the pen. When the drawing is done, the dot carries on along the
 * new shape at its usual pace.
 *
 * Every shape is one closed path of four strands, resampled evenly along
 * their length:
 *
 *   AL -> AR   one side (the S, the spiral, the infinity's outer arcs);
 *              the AL/AR join is the fixed point
 *   BR -> BL   the other side (the S and spiral retraced, the infinity's
 *              inner arcs); the BR/BL join is the fixed point too
 *
 * Drawing a shape out of the point means drawing AR and BL forward from
 * their start, and AL and BR backward from their end. Open curves (the S and
 * the spiral) are retraced. At each end, A turns back in a hairpin and B
 * rides beside A until it rejoins it. For the S, this happens off screen.
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
  // Timeline, in seconds. A shape name holds that shape; a pair draws the
  // second out of the fixed point while the first fades. The last step
  // returns to the first: the seam.
  var SEQUENCE = [
    ["S", 8],                    // steepens; the fan builds
    ["S", "spiral", 3.5],
    ["spiral", 7],               // tightens and grows; afterimages
    ["spiral", "infinity", 3.5],
    ["infinity", 6],             // the loops breathe out; a fan of loops
    ["infinity", "S", 4]         // the wide S is drawn out of the point
  ];
  var FADE_IN = 1.2;             // first appearance only
  var GHOST_FADE = 5;            // seconds for a phase's ghosts to fade once it ends
  var OLD_FADE = 4.5;            // seconds for the previous shape to fade away
  // How the previous shape leaves while the next is drawn: "fade" leaves it
  // in place to fade into a ghost; "retract" winds it back into the point.
  var TRANSITION = "fade";

  // The dot: cruising speed (px/s, scaled to the screen), how gently it
  // changes speed or direction (s), how much it slows in turns, its trace.
  var SPEED_MIN = 90, SPEED_MAX = 190, SPEED_PER_PX = 0.14;
  var EASE = 1.0;
  var TURN_SLOW = 18;
  var TRAIL = 96;                // frames of trace behind the dot
  var HOMING = 6;                // seconds before a change when the dot may start home

  // The S: width at the start and narrowest (svg units, 1/1000 of the page
  // width); a faint copy each time it narrows by GHOST_RATIO.
  var S0 = 640, SMIN = 34, GHOST_RATIO = 0.86;
  // The spiral: arm length (Fresnel parameter) and size, from drawn to held.
  var TM_A = 2.1, TM_B = 2.9, K_A = 0.78, K_B = 1.0, SPIRAL_GHOSTS = 9;
  // The infinity: loop size, from drawn to held.
  var INF_A = 0.8, INF_B = 1.0, INF_GHOSTS = 8;

  var N = 160;                   // points per strand
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

  var W = 0, H = 0, cx = 0, cy = 0, amp = 0, unit = 0, dpr = 1, boxes = null;
  var colors = { ink: "#16202C", signal: "#2747C9", paper: "#ECEEEA", ghost: 0.2 };

  var shape = null;              // the live shape: four strands of N points
  var clock = 0, tau = 0, cur = -1, last = 0, raf = 0, running = false;

  var ghosts = [];               // { polys, color, alpha, width, fadeFrom, fadeFor }
  var emitNext = 0;              // when the current phase leaves its next ghost

  // The dot
  var v = 0.25, spd = 0, dir = 1;
  var homing = null;             // { v0, nu0, v1, t0, t1 }
  var lead = null;               // { v1, sign, lambda, c }
  var trail = [];
  var outgoing = null;           // the previous shape, while it retracts

  // --- maths -----------------------------------------------------------

  function cdf(z) {
    var x = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }
  function clamp01(p) { return p < 0 ? 0 : p > 1 ? 1 : p; }
  function smoother(p) { p = clamp01(p); return p * p * p * (p * (6 * p - 15) + 10); }
  function steepEase(p) { p = clamp01(p); var q = 1 - p * p; return 1 - q * q * q; }
  // Cubic Hermite on [0, 1] from 0 to 1 with end slopes m0 and m1.
  function hermite(p, m0, m1) {
    var p2 = p * p, p3 = p2 * p;
    return (-2 * p3 + 3 * p2) + m0 * (p3 - 2 * p2 + p) + m1 * (p3 - p2);
  }
  function lerpPt(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }

  function resample(pts, n) {
    var len = [0], i, out = [];
    for (i = 1; i < pts.length; i++) {
      len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    var total = len[len.length - 1] || 1, j = 1;
    for (i = 0; i < n; i++) {
      var d = total * i / (n - 1);
      while (j < pts.length - 1 && len[j] < d) j++;
      var seg = len[j] - len[j - 1] || 1;
      out.push(lerpPt(pts[j - 1], pts[j], clamp01((d - len[j - 1]) / seg)));
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
  // the fixed point out to the end. A follows it and starts a hairpin turn
  // of radius rho to its right; B finishes the turn, rides beside A at
  // 2 rho, eases back onto it over a length `merge`, and follows it home.
  function hairpin(poly, rho, merge) {
    var m = poly.length, i, len = [0];
    for (i = 1; i < m; i++) len.push(len[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    var total = len[m - 1];
    function normal(i) {
      var a = poly[Math.max(0, i - 1)], b = poly[Math.min(m - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l, -dy / l, dx / l];
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
      var G = w > 0 ? normal(i) : null;
      B.push(G ? [poly[i][0] + 2 * rho * w * G[2], poly[i][1] + 2 * rho * w * G[3]] : [poly[i][0], poly[i][1]]);
    }
    return [resample(A, N), resample(B, N)];
  }

  function fromHalves(right, left) {
    return [mirror(left[0]), right[0], right[1], mirror(left[1])];
  }

  // --- the shapes --------------------------------------------------------

  function box(el, fw, fh) {
    var r = el && el.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? [r.width, r.height] : [fw, fh];
  }

  function sY(x, sp) { return cy + amp - 2 * amp * cdf((x - cx) / sp); }

  // The S of width s (svg units). Each half runs just past its own screen
  // edge, then turns back off screen.
  var sCache = {};
  function buildS(s) {
    var key = s.toFixed(2);
    if (sCache.key === key) return sCache.strands;
    var sp = Math.max(s * unit, 0.3), rho = 0.35 * amp, merge = 8 * rho;
    function half(reach) {
      var poly = [], m = 260, end = reach + merge;
      for (var i = 0; i <= m; i++) {
        var q = i / m, x = cx + end * q * q;
        poly.push([x, sY(x, sp)]);
      }
      return hairpin(poly, rho, merge);
    }
    sCache.key = key;
    sCache.strands = fromHalves(half(W + 20 - cx), half(cx + 20));
    return sCache.strands;
  }

  // The Cornu spiral (x, y) = (S(t), C(t)), Fresnel integrals, mirrored so
  // it leaves the fixed point straight up and turns clockwise. tm is the arm
  // length, k its size (1 fills the infinity's boxes).
  var FRESNEL = (function () {
    var pts = [[0, 0]], x = 0, y = 0, n = 1400, dt = TM_B / n;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) * dt, a = Math.PI * t * t / 2;
      x += Math.sin(a) * dt;
      y += Math.cos(a) * dt;
      pts.push([x, y]);
    }
    return pts;
  })();

  var spCache = {};
  function buildSpiral(tm, k) {
    var key = tm.toFixed(3) + ":" + k.toFixed(3);
    if (spCache.key === key) return spCache.strands;
    var n = Math.max(8, Math.round((FRESNEL.length - 1) * tm / TM_B));
    var pts = FRESNEL.slice(0, n + 1);
    function half(b) {
      var ky = k * b[1] / 0.78, kx = Math.min(k * b[0] / 0.72, 1.4 * ky);
      return hairpin(pts.map(function (p) { return [cx + kx * p[0], cy - ky * p[1]]; }), 1.5, 16);
    }
    spCache.key = key;
    spCache.strands = fromHalves(half(boxes.r), half(boxes.l));
    return spCache.strands;
  }

  // The infinity: one loop of a lemniscate of Bernoulli turned 45 degrees,
  // r^2 = sin 2phi, in each quarter, at size k. Outer arcs leave the fixed
  // point vertically, inner arcs horizontally.
  var LOBE_MAX = Math.sqrt(2 * Math.pow(Math.sin(Math.PI / 3), 3) * Math.cos(Math.PI / 3));
  function lobePoint(phi) {
    var r = Math.sqrt(Math.max(0, Math.sin(2 * phi)));
    return [r * Math.cos(phi) / LOBE_MAX, r * Math.sin(phi) / LOBE_MAX];
  }
  var UNIT = (function () {
    var outer = [], inner = [], m = 300;
    for (var j = 0; j <= m; j++) {
      var s = 1 - Math.cos(Math.PI / 2 * j / m);
      outer.push(lobePoint(Math.PI / 2 - (Math.PI / 4) * s));
      inner.push(lobePoint((Math.PI / 4) * (1 - s)));
    }
    return [outer, inner];
  })();

  var infCache = {};
  function buildInfinity(k) {
    var key = k.toFixed(3);
    if (infCache.key === key) return infCache.strands;
    var rb = boxes.r, lb = boxes.l;
    function place(pts, sx, sy) {
      return pts.map(function (p) { return [cx + k * sx * p[0], cy + k * sy * p[1]]; });
    }
    infCache.key = key;
    infCache.strands = [
      resample(place(UNIT[0], -lb[0], lb[1]).reverse(), N),
      resample(place(UNIT[0], rb[0], -rb[1]), N),
      resample(place(UNIT[1], rb[0], -rb[1]), N),
      resample(place(UNIT[1], -lb[0], lb[1]).reverse(), N)
    ];
    return infCache.strands;
  }

  // Each shape at hold progress p (0 when it has just been drawn, 1 when it
  // is about to give way).
  function widthAt(p) { return S0 * Math.pow(SMIN / S0, steepEase(p)); }
  function shapeAt(name, p) {
    if (name === "S") return buildS(widthAt(p));
    if (name === "spiral") {
      var e = smoother(p);
      return buildSpiral(TM_A + (TM_B - TM_A) * e, K_A + (K_B - K_A) * e);
    }
    return buildInfinity(INF_A + (INF_B - INF_A) * smoother(p));
  }

  // --- reading the live shape -------------------------------------------

  function pointOf(S, u) {
    u -= Math.floor(u);
    var t = u * 4, part = Math.min(3, Math.floor(t));
    var f = (t - part) * (N - 1), i = Math.min(N - 2, Math.floor(f));
    return lerpPt(S[part][i], S[part][i + 1], f - i);
  }
  function at(u) { return pointOf(shape, u); }

  // Path length (px) from u0 to u1 along a shape.
  function arc(S, u0, u1) {
    var n = 120, len = 0, prev = pointOf(S, u0);
    for (var i = 1; i <= n; i++) {
      var p = pointOf(S, u0 + (u1 - u0) * i / n);
      len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    }
    return len;
  }

  function density(u) {
    var h = 0.002, p1 = at(u - h), p2 = at(u + h);
    return Math.max(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / (2 * h), 1);
  }

  function onScreen(p, m) {
    return p[0] > m && p[0] < W - m && p[1] > m && p[1] < H - m;
  }

  function cruise() {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, SPEED_PER_PX * W));
  }

  // --- ghosts ------------------------------------------------------------

  function addGhost(polys, color, alpha, width, fadeFrom, fadeFor) {
    ghosts.push({ polys: polys, color: color, alpha: alpha, width: width,
                  fadeFrom: fadeFrom === undefined ? -1 : fadeFrom, fadeFor: fadeFor || GHOST_FADE });
  }

  function copyOf(polys) { return polys.map(function (s) { return s.slice(); }); }

  function sGhost(s) {
    var sp = Math.max(s * unit, 0.3), pts = [];
    for (var x = 0; x <= W + 4; x += 4) pts.push([x, sY(x, sp)]);
    return [pts];
  }

  // --- the timeline --------------------------------------------------------

  function stepAt(t) {
    for (var i = 0; i < steps.length; i++) if (t < steps[i].start + steps[i].dur) return i;
    return steps.length - 1;
  }

  function enter(k) {
    var st = steps[k];
    if (st.to) {
      // The old shape stays where it is and fades; the phase's ghosts follow.
      for (var i = 0; i < ghosts.length; i++) if (ghosts[i].fadeFrom < 0) ghosts[i].fadeFrom = clock;
      if (shape && TRANSITION === "retract") outgoing = copyOf(shape);
      else if (shape) addGhost(copyOf(shape), "signal", 0.9, 1.5, clock, OLD_FADE);
      shape = shapeAt(st.to, 0);
      // The dot is at rest on the fixed point (it came home). It becomes the
      // pen on one of the two strands leaving the point there: the one with
      // more of itself on screen, or, if they are close, the one that carries
      // on in the direction it arrived from. It stops short of the screen
      // edge, with room to turn back gently afterwards.
      var v1 = homing ? homing.v1 : 0.25 + 0.5 * Math.round((v - 0.25) / 0.5);
      var came = homing ? (homing.v1 >= homing.v0 ? 1 : -1) : dir;
      var room = 24 + 0.5 * cruise();
      var reach = function (sign) {
        var lambda = 0.96;   // stop just short of a tip, so the dot rounds it at its own pace
        for (var f = 1; f <= 80; f++) {
          if (!onScreen(pointOf(shape, v1 + sign * 0.25 * f / 80), room)) { lambda = Math.min(lambda, 0.92 * (f - 1) / 80); break; }
        }
        lambda = Math.max(lambda, 0.02);
        return { sign: sign, lambda: lambda, L: Math.max(arc(shape, v1, v1 + sign * 0.25 * lambda), 1) };
      };
      var ahead = reach(came), back = reach(-came);
      var pick = back.L > 1.25 * ahead.L ? back : ahead;
      v = v1;
      var c = Math.min(2, cruise() * st.dur / pick.L);
      lead = { v1: v1, sign: pick.sign, lambda: pick.lambda, c: c, end: c * pick.L / st.dur };
      homing = null;
    } else {
      // A new hold: the dot carries on from the pen's last stroke.
      if (lead) {
        dir = lead.sign;
        spd = dir * lead.end;
        lead = null;
      }
      homing = null;
      outgoing = null;
      emitNext = st.from === "S" ? S0 * GHOST_RATIO : 1 / (st.from === "spiral" ? SPIRAL_GHOSTS : INF_GHOSTS);
      shape = shapeAt(st.from, 0);
    }
  }

  function step(dt) {
    clock += dt;
    tau += dt;
    if (tau >= LOOP) tau -= LOOP;
    var k = stepAt(tau);
    if (k !== cur) { cur = k; enter(k); }
    var st = steps[k], p = (tau - st.start) / st.dur;

    if (!st.to) {
      shape = shapeAt(st.from, p);
      // Afterimages of the evolving shape.
      if (st.from === "S") {
        var w = widthAt(p);
        while (w <= emitNext && emitNext > SMIN) {
          addGhost(sGhost(emitNext), "ink", 1, 1);
          emitNext *= GHOST_RATIO;
        }
      } else if (p >= emitNext && p < 0.97) {
        addGhost(copyOf(st.from === "spiral" ? [shape[0], shape[1]] : shape), "ink", 0.85, 1);
        emitNext += 1 / (st.from === "spiral" ? SPIRAL_GHOSTS : INF_GHOSTS);
      }
    }

    ghosts = ghosts.filter(function (g) { return g.fadeFrom < 0 || clock - g.fadeFrom < g.fadeFor; });
    moveDot(dt, st, p);
  }

  // --- the dot -------------------------------------------------------------

  function moveDot(dt, st, p) {
    var c = cruise(), vNew;

    // Drawing: the dot rides the tip of its strand.
    if (st.to && lead) {
      vNew = lead.v1 + lead.sign * 0.25 * lead.lambda * hermite(p, 0, lead.c);
      spd = (vNew - v) / Math.max(dt, 1e-3) * density(v);
      v = vNew;
      return;
    }

    var R = st.start + st.dur - tau;

    // Going home: a smooth glide that comes to rest on the fixed point just
    // as the next shape begins. It sets off once the way home is long enough
    // to need the time left, so it never has to hurry.
    if (!homing && R <= HOMING) {
      var best = null;
      for (var j = -2; j <= 2; j++) {
        var cand = 0.25 + 0.5 * (Math.round((v - 0.25) / 0.5) + j);
        if (Math.abs(cand - v) > 0.5) continue;
        var d = arc(shape, v, cand);
        if (!best || d < best.d) best = { v1: cand, d: d };
      }
      if (best && (best.d / R >= 0.6 * c || R <= 1.6)) {
        homing = { v0: v, nu0: spd / density(v), v1: best.v1, t0: tau, t1: st.start + st.dur };
      }
    }
    if (homing) {
      var T = homing.t1 - homing.t0, s = clamp01((tau - homing.t0) / T), span = homing.v1 - homing.v0;
      var m0 = Math.abs(span) > 1e-6 ? homing.nu0 * T / span : 0;
      vNew = homing.v0 + span * hermite(s, Math.max(-3, Math.min(3, m0)), 0);
      spd = (vNew - v) / Math.max(dt, 1e-3) * density(v);
      v = vNew;
      return;
    }

    // Free: slide along the shape, slower in turns, turning back gently
    // before the screen edge.
    var here = at(v), dens = density(v);
    var du = 12 / dens, a = at(v - du), b = at(v + du);
    var t1x = here[0] - a[0], t1y = here[1] - a[1], t2x = b[0] - here[0], t2y = b[1] - here[1];
    var turnAngle = Math.abs(Math.atan2(t1x * t2y - t1y * t2x, t1x * t2x + t1y * t2y));
    var speed = c / (1 + TURN_SLOW * turnAngle / 12);

    if (!onScreen(here, 0)) {
      var ahead = 0, behind = 0, stp = 8 / dens;
      for (var i = 1; i < 400; i++) {
        if (!ahead && onScreen(at(v + i * stp), 20)) ahead = i;
        if (!behind && onScreen(at(v - i * stp), 20)) behind = i;
        if (ahead && behind) break;
      }
      if (ahead || behind) dir = (!behind || (ahead && ahead <= behind)) ? 1 : -1;
      speed *= 3;
    } else {
      var look = (0.45 * Math.abs(spd) * EASE + 24) / dens;
      if (!onScreen(at(v + dir * look), 14) && onScreen(at(v - dir * look), 14)) dir = -dir;
    }
    spd += (dir * speed - spd) * (1 - Math.exp(-dt / EASE));
    v += spd * dt / dens;
  }

  // --- drawing ---------------------------------------------------------------

  // A polyline through its midpoints with quadratic segments.
  function smoothLine(pts) {
    var n = pts.length - 1;
    if (n < 1) return;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < n; i++) {
      var a = pts[i], b = pts[i + 1];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.lineTo(pts[n][0], pts[n][1]);
  }

  // The part of each strand within fraction g of the fixed point.
  function drawShape(S, g) {
    var last = N - 1, span = clamp01(g) * last, whole = Math.floor(span), f = span - whole;
    ctx.beginPath();
    for (var k = 0; k < 4; k++) {
      var str = S[k], pts;
      if (g >= 1) {
        pts = str;
      } else if (k === 1 || k === 3) {
        pts = str.slice(0, whole + 1);
        if (whole < last) pts.push(lerpPt(str[whole], str[whole + 1], f));
      } else {
        pts = str.slice(last - whole);
        if (whole < last) pts.unshift(lerpPt(str[last - whole], str[last - whole - 1], f));
      }
      smoothLine(pts);
    }
    ctx.stroke();
  }

  function readColors() {
    var cs = getComputedStyle(root);
    colors.ink = cs.getPropertyValue("--ink").trim() || colors.ink;
    colors.signal = cs.getPropertyValue("--signal").trim() || colors.signal;
    colors.paper = cs.getPropertyValue("--paper").trim() || colors.paper;
    colors.ghost = parseFloat(cs.getPropertyValue("--ghost")) || colors.ghost;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!shape) return;
    var a = Math.min(1, clock / FADE_IN);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Ghosts: the fan, the afterimages, and the shape that came before.
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i], f = g.fadeFrom < 0 ? 1 : 1 - smoother((clock - g.fadeFrom) / g.fadeFor);
      if (f <= 0) continue;
      ctx.strokeStyle = g.color === "ink" ? colors.ink : colors.signal;
      ctx.lineWidth = g.width;
      ctx.globalAlpha = a * f * (g.color === "ink" ? colors.ghost * g.alpha : g.alpha);
      ctx.beginPath();
      for (var j = 0; j < g.polys.length; j++) {
        var pl = g.polys[j];
        ctx.moveTo(pl[0][0], pl[0][1]);
        for (var q = 1; q < pl.length; q++) ctx.lineTo(pl[q][0], pl[q][1]);
      }
      ctx.stroke();
    }

    var st = steps[cur], p = (tau - st.start) / st.dur;
    if (st.to && outgoing) {
      ctx.strokeStyle = colors.signal;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = a * 0.9;
      drawShape(outgoing, 1 - smoother(p * 1.2));
    }

    // The live shape, whole or still being drawn.
    ctx.strokeStyle = colors.signal;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = a;
    drawShape(shape, st.to ? hermite(clamp01(p), 0, lead ? lead.c : 1) : 1);

    // The dot's trace: a soft wide stroke under a fine one.
    var d = at(v);
    trail.push(d);
    if (trail.length > TRAIL) trail.shift();
    for (var pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? 2.5 : 7;
      for (var t = 1; t < trail.length; t++) {
        var w = t / trail.length;
        ctx.globalAlpha = a * (pass ? 0.6 : 0.1) * w * w;
        ctx.beginPath();
        ctx.moveTo(trail[t - 1][0], trail[t - 1][1]);
        ctx.lineTo(trail[t][0], trail[t][1]);
        ctx.stroke();
      }
    }

    // The dot, with a faint halo.
    ctx.fillStyle = colors.signal;
    ctx.globalAlpha = a * 0.14;
    ctx.beginPath();
    ctx.arc(d[0], d[1], 11, 0, 2 * Math.PI);
    ctx.fill();
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

  function measure() {
    var f = field.getBoundingClientRect();
    // A big change (a rotation, a new window size) starts the drawing afresh;
    // a small one keeps the ghosts, which fade at the next change anyway.
    var big = !W || Math.abs(f.width - W) > 0.1 * W || Math.abs(f.height - H) > 0.1 * H;
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
    boxes = {
      r: box(lobeR, Math.min(2 * amp, W - cx - 24), Math.min(amp, W - cx - 24)),
      l: box(lobeL, Math.min(2 * amp, cx - 10), Math.min(amp, cx - 10))
    };
    sCache.key = spCache.key = infCache.key = "";
    if (big) {
      ghosts.length = 0;
      trail.length = 0;
      homing = lead = shape = outgoing = null;
      cur = -1;
    }
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
    W = 0;
    measure();
    tau = 0;
    clock = 0;
    v = 0.25;
    spd = 0;
    dir = 1;
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
    var f = field.getBoundingClientRect();
    if (running && (Math.abs(f.width - W) > 1 || Math.abs(f.height - H) > 1)) measure();
  });

  if (!reduce.matches) start();
})();
