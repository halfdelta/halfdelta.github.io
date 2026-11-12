/*
 * The city, seen from above at an angle.
 *
 * An axonometric drawing of a city that is generated fresh on every visit:
 * blocks of towers on a street grid, a bay in the lower-right quarter where
 * the name sits, and one slender spire on the shore whose tip is the fixed
 * point (--kx, --ky). The ring and the callout line to the label are the
 * draughtsman's annotation of that point.
 *
 * Towers are boxes (some stacked, stepped or crowned, a few joined by sky
 * bridges, some with a landing ring on the roof) drawn back to front with
 * opaque faces, so near towers hide far ones. Each face carries a facade
 * texture of floors and windows: a handful of small sprites drawn with a
 * shear transform, one per face. With distance the city fades into the
 * paper. In dark mode it is night: the windows glow, the traffic lights up.
 *
 * The traffic is the only thing in the signal colour. Vehicles follow a
 * graph of paths sampled at even spacing: grid lanes along the streets at
 * several altitudes (offset to the right of travel, filleted at corners),
 * three high lanes that all cross above the spire's tip, merge ramps that
 * move a vehicle between lanes sharing a street, and approach and departure
 * spurs that land it on a roof ring and lift it off again. A vehicle is
 * hidden when the line from it towards the camera passes through a tower,
 * so the traffic weaves between and behind the buildings.
 *
 * The camera drifts slowly in azimuth and elevation. The city is drawn into
 * an off-screen buffer a few towers per frame, under a time budget, and
 * swapped in when complete; each frame then costs one blit plus the
 * traffic, and the drift between swaps is sub-pixel.
 *
 * Without JavaScript, the static SVG in the page is shown. With reduced
 * motion, the script draws one still frame of the city and stops. A query
 * string ?seed=N repeats one particular city, for checking.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var field = document.querySelector(".field");
  var canvas = document.querySelector(".live");
  if (!field || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var dark = window.matchMedia("(prefers-color-scheme: dark)");

  // ---------------------------------------------------------------------
  // Tunables. Lengths are in blocks: one block of the grid is one unit.
  var DEG = Math.PI / 180;
  var THETA0 = 35 * DEG, DRIFT_A = 2.2 * DEG, DRIFT_T = 53;   // azimuth and its drift
  var PHI0 = 52 * DEG, PHI_A = 1.3 * DEG, PHI_T = 79;         // elevation and its drift
  var R = 11.2;                  // radius of the city
  var UC = -2.4, VC = -3.6;      // its centre, in view coordinates (u right, v near)
  var HALF = 0.3;                // half-width of a block; streets are 0.4 wide
  var SPIRE_H = 4.4;             // the spire, whose tip is the fixed point
  var H_MAX = 3.6;               // tallest ordinary tower
  var FLOOR = 0.085, BAY = 0.085;// one window module
  var LANE_R = 0.28, LANE_OFF = 0.07, DS = 0.04;
  var LANE_Z = [0.75, 1.1, 1.5, 1.95, 2.45, 3.0];            // grid lane altitudes
  var HIGH_Z = [3.95, 4.15, 4.35], JUNCTION_Z = SPIRE_H + 0.55;
  var HAZE_N = 10;               // haze levels; colours are precomputed per level
  var BUDGET = 4;                // ms per frame for drawing the city buffer
  var TRAIL_N = 21, TRAIL_DT = 1 / 30;
  var FLICKER = 1.4;             // seconds between window changes
  // ---------------------------------------------------------------------

  var seed = (function () {
    var m = /[?&]seed=(\d+)/.exec(location.search);
    return m ? +m[1] : (Math.random() * 4294967296) >>> 0;
  })();
  var rng = mulberry32(seed);

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rnd(a, b) { return a + (b - a) * rng(); }
  function clamp01(p) { return p < 0 ? 0 : p > 1 ? 1 : p; }
  function smooth(p) { p = clamp01(p); return p * p * (3 - 2 * p); }

  // --- the view ----------------------------------------------------------
  // View coordinates: u to the right, v towards the camera (down the
  // screen), z up. At THETA0 the land and water are laid out in (u, v).
  var C0 = Math.cos(THETA0), S0 = Math.sin(THETA0);
  function uOf(x, y) { return x * C0 + y * S0; }
  function vOf(x, y) { return -x * S0 + y * C0; }

  // Water: the lower-right quarter, with a rounded corner by the spire and
  // a shore that leans back under the near land.
  function shoreU(v) { return 0.95 - (v + 2.9) * 0.1 + 0.08 / (v + 2.9); }
  function water(u, v) {
    return v > -2.9 && u > shoreU(v);
  }
  function inCity(u, v, margin) {
    var du = u - UC, dv = v - VC;
    return du * du + dv * dv < (R - margin) * (R - margin);
  }
  function land(u, v, margin) { return inCity(u, v, margin) && !water(u, v); }

  // Haze: 1 near and inside, 0 far away or at the edge of the city.
  function haze(u, v) {
    var d = smooth((v + 11.5) / 7);
    var du = u - UC, dv = v - VC, r = Math.sqrt(du * du + dv * dv) / R;
    var e = smooth((1 - r) / 0.3);
    return d * e;
  }

  // --- the city ----------------------------------------------------------
  var boxes = [];          // { x0, x1, y0, y1, z0, z1, ox, oy, ant, pad, tex }
  var cells = [];          // land blocks: { i, j }
  var shore = [];          // the shoreline, world points [x, y, ...]
  var pads = [];           // roof rings: { x, y, z, busy }

  function box(x0, x1, y0, y1, z0, z1) {
    var b = { x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1,
      ox: (rng() * 9) | 0, oy: (rng() * 40) | 0, tex: (rng() * 6) | 0, ant: 0, pad: null };
    boxes.push(b);
    return b;
  }

  function tower(i, j, h) {
    var w = rnd(0.34, 0.58), d = rnd(0.34, 0.58);
    if (h < 1) { w = rnd(0.46, 0.6); d = rnd(0.4, 0.6); }
    if (h < 0.5) { w = rnd(0.54, 0.6); d = rnd(0.54, 0.6); }
    var cx = i + rnd(-(HALF - w / 2), HALF - w / 2);
    var cy = j + rnd(-(HALF - d / 2), HALF - d / 2);
    var kind = rng();
    var top;
    if (h < 1 || kind < 0.42) {
      top = box(cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, 0, h);
    } else if (kind < 0.68) {           // setback
      var h1 = h * rnd(0.45, 0.65), f = rnd(0.55, 0.75);
      box(cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, 0, h1);
      var ox = rng() < 0.5 ? 0 : (rng() < 0.5 ? -1 : 1) * (w - w * f) / 2;
      var oy = rng() < 0.5 ? 0 : (rng() < 0.5 ? -1 : 1) * (d - d * f) / 2;
      top = box(cx + ox - w * f / 2, cx + ox + w * f / 2, cy + oy - d * f / 2, cy + oy + d * f / 2, h1, h);
    } else if (kind < 0.84) {           // stepped, three tiers
      var a = h * 0.4, b = h * 0.72;
      box(cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, 0, a);
      box(cx - w * 0.4, cx + w * 0.4, cy - d * 0.4, cy + d * 0.4, a, b);
      top = box(cx - w * 0.26, cx + w * 0.26, cy - d * 0.26, cy + d * 0.26, b, h);
    } else {                            // crown and antenna
      box(cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, 0, h);
      top = box(cx - w * 0.2, cx + w * 0.2, cy - d * 0.2, cy + d * 0.2, h, h + rnd(0.15, 0.35));
      top.ant = rnd(0.25, 0.55);
      top = null;
    }
    if (top && h >= 0.7 && (top.x1 - top.x0) >= 0.3 && (top.y1 - top.y0) >= 0.3) top.padOK = true;
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - d / 2, y1: cy + d / 2, h: h };
  }

  function generateCity() {
    boxes.length = cells.length = pads.length = shore.length = 0;
    var N = Math.ceil(R + 6), i, j;
    var grid = {};
    // The core of tall towers sits up and left of the spire.
    var coreX = UC * C0 - (VC - 1) * S0, coreY = UC * S0 + (VC - 1) * C0;
    for (i = -N; i <= N; i++) {
      for (j = -N; j <= N; j++) {
        var u = uOf(i, j), v = vOf(i, j);
        if (!land(u, v, 0.4)) continue;
        cells.push({ i: i, j: j });
        if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;   // the plaza
        if (rng() < 0.07) continue;                            // a park
        var dx = i - coreX, dy = j - coreY;
        var core = Math.exp(-(dx * dx + dy * dy) / 42);
        var r = rng(), r1 = rng();
        var h = 0.22 + 0.55 * r1 * r1 + H_MAX * 0.95 * core * (0.3 + 0.9 * r * r);
        if (rng() < 0.05) h += rnd(0.7, 1.5);                   // a tall one anywhere
        if (water(u + 1.2, v) || water(u, v + 1.2)) h *= 0.55; // the waterfront
        if (v > 4 && rng() < 0.7) h *= 0.7;                     // nearest rows
        if (h > H_MAX) h = H_MAX;
        grid[i + "," + j] = tower(i, j, h);
      }
    }
    // Sky bridges between neighbouring towers of some height.
    for (i = -N; i <= N; i++) {
      for (j = -N; j <= N; j++) {
        var A = grid[i + "," + j];
        if (!A || A.h < 1.5) continue;
        var B = grid[(i + 1) + "," + j], Cc = grid[i + "," + (j + 1)];
        if (B && B.h >= 1.5 && rng() < 0.3) {
          var ya = Math.max(A.y0, B.y0), yb = Math.min(A.y1, B.y1);
          if (yb - ya > 0.16) {
            var zb = Math.min(A.h, B.h) * rnd(0.35, 0.6), ym = (ya + yb) / 2;
            var br = box(A.x1, B.x0, ym - 0.05, ym + 0.05, zb, zb + 0.08);
            br.bridge = true;
          }
        }
        if (Cc && Cc.h >= 1.5 && rng() < 0.3) {
          var xa = Math.max(A.x0, Cc.x0), xb = Math.min(A.x1, Cc.x1);
          if (xb - xa > 0.16) {
            var zc = Math.min(A.h, Cc.h) * rnd(0.35, 0.6), xm = (xa + xb) / 2;
            var br2 = box(xm - 0.05, xm + 0.05, A.y1, Cc.y0, zc, zc + 0.08);
            br2.bridge = true;
          }
        }
      }
    }
    // The spire: three tiers at the origin.
    box(-0.27, 0.27, -0.27, 0.27, 0, SPIRE_H * 0.52);
    box(-0.17, 0.17, -0.17, 0.17, SPIRE_H * 0.52, SPIRE_H * 0.82);
    box(-0.085, 0.085, -0.085, 0.085, SPIRE_H * 0.82, SPIRE_H);
    // The shoreline: along v = -2.9 from the right, round the corner by
    // the spire, then down and back under the near land.
    var k, uu, vv;
    for (k = 0; k <= 40; k++) {
      vv = -2.9 + 0.005 * Math.pow(1.24, k);         // dense round the corner
      uu = shoreU(vv);
      shore.push(uu * C0 - vv * S0, uu * S0 + vv * C0);
    }
  }

  // --- paths -------------------------------------------------------------
  // Every path is a polyline of points DS apart: pts = [x, y, z, ...].
  var paths = [];
  var lanes = [];          // the grid and high lanes, where vehicles start

  function makePath(raw, closed, sp0, sp1) {
    // Resample raw [x,y,z,...] at DS spacing.
    var n = raw.length / 3, out = [], i;
    var total = 0, lens = [0];
    for (i = 1; i < n; i++) {
      var dx = raw[3 * i] - raw[3 * i - 3], dy = raw[3 * i + 1] - raw[3 * i - 2], dz = raw[3 * i + 2] - raw[3 * i - 1];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
      lens.push(total);
    }
    var m = Math.max(2, Math.round(total / DS)), seg = 1;
    for (i = 0; i <= m; i++) {
      var s = total * i / m;
      while (seg < n - 1 && lens[seg] < s) seg++;
      var a = seg - 1, f = lens[seg] > lens[a] ? (s - lens[a]) / (lens[seg] - lens[a]) : 0;
      out.push(raw[3 * a] + (raw[3 * seg] - raw[3 * a]) * f,
               raw[3 * a + 1] + (raw[3 * seg + 1] - raw[3 * a + 1]) * f,
               raw[3 * a + 2] + (raw[3 * seg + 2] - raw[3 * a + 2]) * f);
    }
    var p = { pts: new Float32Array(out), n: m + 1, total: total, ds: total / m, closed: closed,
      sp0: sp0, sp1: sp1, exits: [], hold: 0, end: null };
    paths.push(p);
    return p;
  }

  function at(p, s, out) {
    var f = s / p.ds, i = f | 0;
    if (i >= p.n - 1) i = p.n - 2;
    if (i < 0) i = 0;
    f -= i;
    if (f < 0) f = 0; else if (f > 1) f = 1;
    var q = p.pts, k = 3 * i;
    out[0] = q[k] + (q[k + 3] - q[k]) * f;
    out[1] = q[k + 1] + (q[k + 4] - q[k + 1]) * f;
    out[2] = q[k + 2] + (q[k + 5] - q[k + 2]) * f;
  }
  var tA = [0, 0, 0], tB = [0, 0, 0];
  function tangent(p, s, out) {
    at(p, Math.max(0, s - 0.1), tA); at(p, Math.min(p.total, s + 0.1), tB);
    var dx = tB[0] - tA[0], dy = tB[1] - tA[1], l = Math.sqrt(dx * dx + dy * dy) || 1;
    out[0] = dx / l; out[1] = dy / l; out[2] = 0;
  }

  // A rectilinear loop on the street grid (streets run at i + 0.5), offset
  // to the right of travel, corners filleted.
  function gridLane(z) {
    for (var tries = 0; tries < 60; tries++) {
      // Loops are large and gathered round the core, so that they share streets and cross.
      var big = 6 - tries / 12;
      var w = 3 + ((rng() * big) | 0), h = 3 + ((rng() * big) | 0);
      var u0 = rnd(UC - 5, UC + 3), v0 = rnd(VC - 4, VC + 4);
      var cx = Math.round(u0 * C0 - v0 * S0), cy = Math.round(u0 * S0 + v0 * C0);
      var ax = cx - ((w / 2) | 0) + 0.5, ay = cy - ((h / 2) | 0) + 0.5, bx = ax + w, by = ay + h;
      var verts = [[ax, ay], [bx, ay], [bx, by], [ax, by]];      // counter-clockwise
      // A dent: part of one side pushed inwards by a block.
      if (rng() < 0.6) {
        var side = (rng() * 4) | 0, len = side % 2 ? h : w;
        if (len >= 3) {
          var a = 1 + ((rng() * (len - 2)) | 0), b = a + 1 + ((rng() * (len - a - 1)) | 0);
          var P = verts[side], Q = verts[(side + 1) % 4];
          var dx = Math.sign(Q[0] - P[0]), dy = Math.sign(Q[1] - P[1]);
          var ix = -dy, iy = dx;
          verts.splice(side + 1, 0,
            [P[0] + dx * a, P[1] + dy * a], [P[0] + dx * a + ix, P[1] + dy * a + iy],
            [P[0] + dx * b + ix, P[1] + dy * b + iy], [P[0] + dx * b, P[1] + dy * b]);
        }
      }
      if (rng() < 0.5) verts.reverse();
      // Everything on land, away from the spire?
      var ok = true, i, n = verts.length;
      for (i = 0; i < n && ok; i++) {
        var P2 = verts[i], Q2 = verts[(i + 1) % n];
        var steps = Math.max(1, Math.round(Math.abs(Q2[0] - P2[0]) + Math.abs(Q2[1] - P2[1])) * 2);
        for (var s = 0; s <= steps; s++) {
          var x = P2[0] + (Q2[0] - P2[0]) * s / steps, y = P2[1] + (Q2[1] - P2[1]) * s / steps;
          if (!land(uOf(x, y), vOf(x, y), 1.2) || (Math.abs(x) < 1.6 && Math.abs(y) < 1.6)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // Edge directions, offset corners, fillets.
      var ex = [], ey = [];
      for (i = 0; i < n; i++) {
        var A = verts[i], B = verts[(i + 1) % n];
        ex.push(Math.sign(B[0] - A[0])); ey.push(Math.sign(B[1] - A[1]));
      }
      var raw = [];
      for (i = 0; i < n; i++) {
        var pi = (i + n - 1) % n, V = verts[i], px, py;
        // The right normal of an edge (ex, ey) is (ey, -ex).
        if (ex[pi] === 0) { px = V[0] + ey[pi] * LANE_OFF; py = V[1] - ex[i] * LANE_OFF; }
        else { px = V[0] + ey[i] * LANE_OFF; py = V[1] - ex[pi] * LANE_OFF; }
        var ax2 = ex[pi], ay2 = ey[pi], bx2 = ex[i], by2 = ey[i];
        var cross = ax2 * by2 - ay2 * bx2;
        var ccx = px - ax2 * LANE_R + bx2 * LANE_R, ccy = py - ay2 * LANE_R + by2 * LANE_R;
        var a0 = Math.atan2(py - ay2 * LANE_R - ccy, px - ax2 * LANE_R - ccx);
        for (var q = 0; q <= 8; q++) {
          var ang = a0 + cross * (Math.PI / 2) * q / 8;
          raw.push(ccx + LANE_R * Math.cos(ang), ccy + LANE_R * Math.sin(ang), z);
        }
      }
      raw.push(raw[0], raw[1], raw[2]);
      var p = makePath(raw, true, 0, 0);
      // A gentle rise and fall along the loop.
      var ph = rng() * 6.28, cyc = 1 + ((rng() * 2) | 0);
      for (i = 0; i < p.n; i++) p.pts[3 * i + 2] = z + 0.1 * Math.sin(ph + cyc * 6.2832 * i / (p.n - 1));
      return p;
    }
    return null;
  }

  // A high lane: a closed spline through the junction above the spire and
  // a few points over the land, sailing above every roof.
  function highLane(z) {
    for (var tries = 0; tries < 40; tries++) {
      var a0 = rnd(110, 320) * DEG, spread = rnd(60, 120) * DEG, nC = 4 + ((rng() * 3) | 0);
      var ctrl = [[0, 0]];
      for (var k = 0; k < nC; k++) {
        var ang = a0 + spread * (k / (nC - 1) - 0.5) + rnd(-0.2, 0.2);
        var rad = rnd(3.5, 8.5);
        // Angles in (u, v): 0 is +u, 90 is +v, so the water lies in 0..90.
        var u = rad * Math.cos(ang), v = rad * Math.sin(ang);
        ctrl.push([u * C0 - v * S0, u * S0 + v * C0]);
      }
      var raw = [], n = ctrl.length, ok = true;
      for (var i = 0; i < n && ok; i++) {
        var P0 = ctrl[(i + n - 1) % n], P1 = ctrl[i], P2 = ctrl[(i + 1) % n], P3 = ctrl[(i + 2) % n];
        for (var s = 0; s < 12; s++) {
          var t = s / 12, t2 = t * t, t3 = t2 * t;
          var x = 0.5 * (2 * P1[0] + (-P0[0] + P2[0]) * t + (2 * P0[0] - 5 * P1[0] + 4 * P2[0] - P3[0]) * t2 + (-P0[0] + 3 * P1[0] - 3 * P2[0] + P3[0]) * t3);
          var y = 0.5 * (2 * P1[1] + (-P0[1] + P2[1]) * t + (2 * P0[1] - 5 * P1[1] + 4 * P2[1] - P3[1]) * t2 + (-P0[1] + 3 * P1[1] - 3 * P2[1] + P3[1]) * t3);
          var d = Math.sqrt(x * x + y * y);
          if (d > 1.2 && !land(uOf(x, y), vOf(x, y), 1.0)) { ok = false; break; }
          raw.push(x, y, z + (JUNCTION_Z - z) * smooth(1 - d / 3.2));
        }
      }
      if (!ok) continue;
      raw.push(raw[0], raw[1], raw[2]);
      return makePath(raw, true, 0, 0);
    }
    return null;
  }

  function hermite(P0, M0, P1, M1, n, raw) {
    for (var i = 0; i <= n; i++) {
      var t = i / n, t2 = t * t, t3 = t2 * t;
      var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      for (var k = 0; k < 3; k++) raw.push(h00 * P0[k] + h10 * M0[k] + h01 * P1[k] + h11 * M1[k]);
    }
  }

  // Does this path pass through a box? (Used when building spurs.)
  function collides(raw, skipBox) {
    for (var i = 0; i < raw.length; i += 3) {
      var x = raw[i], y = raw[i + 1], z = raw[i + 2];
      for (var b = 0; b < boxes.length; b++) {
        var B = boxes[b];
        if (B === skipBox) continue;
        if (x > B.x0 - 0.06 && x < B.x1 + 0.06 && y > B.y0 - 0.06 && y < B.y1 + 0.06 && z > B.z0 - 0.05 && z < B.z1 + 0.08) return true;
      }
    }
    return false;
  }

  // A random point on a grid lane between dmin and dmax from (x, y).
  function nearLanePoint(x, y, dmin, dmax) {
    var found = [];
    for (var k = 0; k < lanes.length; k++) {
      var L = lanes[k];
      if (L.high) continue;
      for (var i = 0; i < L.n - 1; i += 5) {
        var dx = L.pts[3 * i] - x, dy = L.pts[3 * i + 1] - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= dmin && d <= dmax) found.push({ lane: L, s: i * L.ds });
      }
    }
    return found.length ? found[(rng() * found.length) | 0] : null;
  }

  function addExit(from, s, to, toS, prob, pad) {
    from.exits.push({ at: s, to: to, toS: toS, prob: prob, pad: pad || null, free: false });
  }

  function generatePaths() {
    paths.length = lanes.length = 0;
    var zs = LANE_Z.slice(), i, k;
    for (i = 0; i < 6; i++) {
      var z = zs.splice((rng() * zs.length) | 0, 1)[0];
      var L = gridLane(z);
      if (L) { L.sp0 = L.sp1 = rnd(1.15, 1.75); lanes.push(L); }
    }
    for (i = 0; i < 3; i++) {
      var Hh = highLane(HIGH_Z[i]);
      if (Hh) { Hh.sp0 = Hh.sp1 = rnd(2.0, 2.6); Hh.high = true; lanes.push(Hh); }
    }
    if (!lanes.length) return;
    var pos = [0, 0, 0], tan = [0, 0, 0], pos2 = [0, 0, 0], tan2 = [0, 0, 0];
    // Roof rings go on flat tops near a lane, with approach and departure spurs.
    var cand = [];
    for (i = 0; i < boxes.length; i++) if (boxes[i].padOK) cand.push(boxes[i]);
    for (i = cand.length - 1; i > 0; i--) { k = (rng() * (i + 1)) | 0; var tmp = cand[i]; cand[i] = cand[k]; cand[k] = tmp; }
    for (k = 0; k < cand.length && pads.length < 14; k++) {
      var own = cand[k], done = false;
      var P = { x: (own.x0 + own.x1) / 2, y: (own.y0 + own.y1) / 2, z: own.z1, busy: false };
      for (var tries = 0; tries < 4 && !done; tries++) {
        var a = nearLanePoint(P.x, P.y, 0.9, 2.6);
        var b = nearLanePoint(P.x, P.y, 0.9, 2.6);
        if (!a || !b) continue;
        at(a.lane, a.s, pos); tangent(a.lane, a.s, tan);
        at(b.lane, b.s, pos2); tangent(b.lane, b.s, tan2);
        var da = Math.hypot(pos[0] - P.x, pos[1] - P.y), db = Math.hypot(pos2[0] - P.x, pos2[1] - P.y);
        var rawA = [], rawB = [];
        hermite(pos, [tan[0] * da * 1.1, tan[1] * da * 1.1, 0], [P.x, P.y, P.z + 0.03], [0, 0, -da * 0.7], 30, rawA);
        hermite([P.x, P.y, P.z + 0.03], [0, 0, db * 0.8], pos2, [tan2[0] * db * 1.1, tan2[1] * db * 1.1, 0], 30, rawB);
        if (collides(rawA, own) || collides(rawB, own)) continue;
        var approach = makePath(rawA, false, a.lane.sp0, 0.45);
        var stop = makePath([P.x, P.y, P.z + 0.03, P.x, P.y, P.z + 0.03], false, 0, 0);
        stop.hold = 1;
        var depart = makePath(rawB, false, 0.45, b.lane.sp0);
        addExit(a.lane, a.s, approach, 0, 0.55, P);
        approach.end = { to: stop, toS: 0, pad: null, free: false };
        stop.end = { to: depart, toS: 0, pad: P, free: true };
        depart.end = { to: b.lane, toS: b.s, pad: null, free: false };
        own.pad = P;
        pads.push(P);
        done = true;
      }
    }
    // Merge ramps where two grid lanes share a street in the same direction.
    var merges = 0;
    for (i = 0; i < lanes.length && merges < 30; i++) {
      var A = lanes[i];
      if (A.high) continue;
      var lastS = -9;
      for (var si = 0; si < A.n; si += 6) {
        var s = si * A.ds;
        if (s - lastS < 2 || s + 1.6 > A.total) continue;
        at(A, s, pos); tangent(A, s, tan);
        for (var j = 0; j < lanes.length; j++) {
          var B = lanes[j];
          if (B === A || B.high) continue;
          var hit = -1;
          for (var bi = 0; bi < B.n; bi++) {
            var ddx = B.pts[3 * bi] - pos[0], ddy = B.pts[3 * bi + 1] - pos[1];
            if (ddx * ddx + ddy * ddy < 0.0016) { hit = bi; break; }
          }
          if (hit < 0) continue;
          var sb = hit * B.ds;
          if (sb + 1.6 > B.total) continue;
          tangent(B, sb, tan2);
          if (tan[0] * tan2[0] + tan[1] * tan2[1] < 0.98) continue;
          // Both lanes must run straight together for the length of the ramp.
          at(A, s + 1.4, pos2); at(B, sb + 1.4, tan2);
          if (Math.hypot(pos2[0] - pos[0], pos2[1] - pos[1]) < 1.35 || Math.hypot(tan2[0] - pos2[0], tan2[1] - pos2[1]) > 0.1) continue;
          var raw = [];
          for (k = 0; k <= 16; k++) {
            var t = k / 16;
            raw.push(pos[0] + (tan2[0] - pos[0]) * t, pos[1] + (tan2[1] - pos[1]) * t,
              pos[2] + (tan2[2] - pos[2]) * smooth(t));
          }
          var ramp = makePath(raw, false, A.sp0, B.sp0);
          ramp.end = { to: B, toS: sb + 1.4, pad: null, free: false };
          addExit(A, s, ramp, 0, 0.35, null);
          merges++;
          lastS = s;
          break;
        }
      }
    }
    // Turn ramps where two grid lanes cross at an intersection.
    var turns = 0;
    for (i = 0; i < lanes.length && turns < 40; i++) {
      var A2 = lanes[i];
      if (A2.high) continue;
      var lastT = -9;
      for (var ai = 0; ai < A2.n; ai += 2) {
        var sa = ai * A2.ds;
        if (sa - lastT < 1.5 || sa < 0.6 || sa + 0.6 > A2.total) continue;
        for (var j2 = 0; j2 < lanes.length; j2++) {
          var B2 = lanes[j2];
          if (B2 === A2 || B2.high) continue;
          var hit2 = -1;
          for (var bj = 0; bj < B2.n; bj++) {
            var ex2 = B2.pts[3 * bj] - A2.pts[3 * ai], ey2 = B2.pts[3 * bj + 1] - A2.pts[3 * ai + 1];
            if (ex2 * ex2 + ey2 * ey2 < 0.0025) { hit2 = bj; break; }
          }
          if (hit2 < 0) continue;
          var sb2 = hit2 * B2.ds;
          if (sb2 < 0.6 || sb2 + 0.6 > B2.total) continue;
          tangent(A2, sa, tan); tangent(B2, sb2, tan2);
          if (Math.abs(tan[0] * tan2[0] + tan[1] * tan2[1]) > 0.2) continue;
          at(A2, sa - 0.35, pos); at(B2, sb2 + 0.35, pos2);
          var rawT = [];
          hermite(pos, [tan[0] * 0.8, tan[1] * 0.8, 0], pos2, [tan2[0] * 0.8, tan2[1] * 0.8, 0], 16, rawT);
          if (collides(rawT, null)) continue;
          var turn = makePath(rawT, false, A2.sp0 * 0.8, B2.sp0 * 0.8);
          turn.end = { to: B2, toS: sb2 + 0.35, pad: null, free: false };
          addExit(A2, sa - 0.35, turn, 0, 0.3, null);
          turns++;
          lastT = sa;
          break;
        }
      }
    }
    for (i = 0; i < paths.length; i++) paths[i].exits.sort(function (a, b) { return a.at - b.at; });
  }

  // --- vehicles ----------------------------------------------------------
  var vehicles = [];       // { p, s, ex, hold, blink, sx, sy, vis, a }
  var trailX, trailY, trailV, trailHead = 0;   // ring buffers, TRAIL_N per vehicle
  var NV = 0;

  function populate(n) {
    vehicles.length = 0;
    NV = n;
    trailX = new Float32Array(n * TRAIL_N);
    trailY = new Float32Array(n * TRAIL_N);
    trailV = new Uint8Array(n * TRAIL_N);
    // Vehicles are spread by lane length; the high lanes are kept sparse.
    var total = 0, i, wt = function (L) { return L.total * (L.high ? 0.3 : 1); };
    for (i = 0; i < lanes.length; i++) total += wt(lanes[i]);
    for (i = 0; i < n; i++) {
      var pick = rng() * total, L = lanes[0];
      for (var k = 0; k < lanes.length; k++) { if (pick < wt(lanes[k])) { L = lanes[k]; break; } pick -= wt(lanes[k]); }
      var s = rng() * L.total, ex = 0;
      while (ex < L.exits.length && L.exits[ex].at < s) ex++;
      vehicles.push({ p: L, s: s, ex: ex, hold: 0, blink: rng() * 6.28, sx: 0, sy: 0, vis: 0, a: 0 });
    }
  }

  function take(veh, e, carry) {
    if (e.pad) e.pad.busy = !e.free;
    veh.p = e.to;
    veh.s = e.toS + carry;
    veh.ex = 0;
    while (veh.ex < veh.p.exits.length && veh.p.exits[veh.ex].at < veh.s) veh.ex++;
    veh.hold = veh.p.hold ? rnd(2.5, 7) : 0;
  }

  function moveVehicles(dt) {
    for (var i = 0; i < NV; i++) {
      var veh = vehicles[i], p = veh.p;
      if (veh.hold > 0) {
        veh.hold -= dt;
        if (veh.hold <= 0) { veh.hold = 0; take(veh, p.end, 0); }
        continue;
      }
      var sp = p.sp0 + (p.sp1 - p.sp0) * (veh.s / p.total);
      veh.s += sp * dt;
      var taken = false;
      while (veh.ex < p.exits.length && veh.s >= p.exits[veh.ex].at) {
        var e = p.exits[veh.ex++];
        if (e.pad && e.pad.busy) continue;
        if (rng() < e.prob) { take(veh, e, veh.s - e.at); taken = true; break; }
      }
      if (taken) continue;
      if (veh.s >= p.total) {
        if (p.closed) { veh.s -= p.total; veh.ex = 0; }
        else take(veh, p.end, veh.s - p.total);
      }
    }
  }

  // --- colours and textures ---------------------------------------------
  var colors = { paper: [236, 238, 234], ink: [22, 32, 44], signal: "#2747C9", night: false, paperStr: "#ECEEEA" };
  var topCol = [], sideA = [], sideB = [], edgeCol = [], groundCol = [], winA = [];
  var textures = [];       // facade sprites for the current theme
  var TEX_BAYS = 16, TEX_FLOORS = 72, BP = 10, FP = 8;

  function hex(s) {
    s = s.trim();
    if (s[0] === "#" && s.length === 7) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    var m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function mixArr(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mix(a, b, t) {
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
  }
  function rgba(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a.toFixed(3) + ")"; }

  function readColors() {
    var cs = getComputedStyle(root);
    colors.paper = hex(cs.getPropertyValue("--paper")) || colors.paper;
    colors.ink = hex(cs.getPropertyValue("--ink")) || colors.ink;
    colors.signal = cs.getPropertyValue("--signal").trim() || colors.signal;
    colors.night = dark.matches;
    colors.paperStr = mix(colors.paper, colors.paper, 0);
    var P = colors.paper, I = colors.ink, white = [255, 255, 255];
    var top = colors.night ? mixArr(P, I, 0.075) : mixArr(P, white, 0.6);
    var sa = colors.night ? mixArr(P, I, 0.04) : mixArr(P, I, 0.075);
    var sb = colors.night ? mixArr(P, I, 0.015) : mixArr(P, I, 0.15);
    var edgeA = colors.night ? 0.3 : 0.62, groundA = colors.night ? 0.1 : 0.2;
    for (var L = 0; L < HAZE_N; L++) {
      var f = L / (HAZE_N - 1);
      topCol[L] = mix(P, top, f);
      sideA[L] = mix(P, sa, f);
      sideB[L] = mix(P, sb, f);
      edgeCol[L] = rgba(I, edgeA * f);
      groundCol[L] = rgba(I, groundA * f);
      winA[L] = f;
    }
    makeTextures();
  }

  function makeTextures() {
    var trng = mulberry32(seed ^ 0x5bd1e995);
    textures.length = 0;
    var I = colors.ink;
    for (var t = 0; t < 6; t++) {
      var c = document.createElement("canvas");
      c.width = TEX_BAYS * BP; c.height = TEX_FLOORS * FP;
      var g = c.getContext("2d");
      for (var f = 0; f < TEX_FLOORS; f++) {
        var pf = trng() < 0.18 ? 0.04 : 0.18 + 0.5 * trng();   // some floors are dark
        if (!colors.night) {
          g.fillStyle = rgba(I, 0.11);
          g.fillRect(0, f * FP, c.width, 1);
        }
        for (var b = 0; b < TEX_BAYS; b++) {
          if (colors.night) {
            if (trng() < pf) {
              g.fillStyle = rgba(I, 0.3 + 0.55 * trng());
              g.fillRect(b * BP + 2, f * FP + 2, BP - 4, FP - 3);
            }
          } else {
            g.fillStyle = rgba(I, trng() < 0.25 ? 0.085 : 0.04);
            g.fillRect(b * BP + 3, f * FP + 3, BP - 5, FP - 4);
          }
        }
      }
      textures.push(c);
    }
  }

  // --- the camera and the buffers ---------------------------------------
  var W = 0, H = 0, dpr = 1, S = 40, kx = 0, ky = 0;
  var front = { c: null, g: null, cos: 1, sin: 0, sinP: 1, cosP: 0, tanP: 1, cx: 0, cy: 0, ready: false };
  var back = { c: null, g: null, cos: 1, sin: 0, sinP: 1, cosP: 0, tanP: 1, cx: 0, cy: 0, ready: false };
  var job = { i: 0, order: null, key: null, level: null, n: 0 };
  // Box geometry as flat arrays, and view extents for the occlusion test.
  var bx0, bx1, by0, by1, bz0, bz1, uMin, uMax, vMax;
  var cellU, cellV, cellL;

  function setCamera(cam, theta, phi) {
    cam.cos = Math.cos(theta); cam.sin = Math.sin(theta);
    cam.sinP = Math.sin(phi); cam.cosP = Math.cos(phi); cam.tanP = Math.tan(phi);
    cam.cx = kx;
    cam.cy = ky + SPIRE_H * S * cam.cosP;
  }

  function measure() {
    var f = field.getBoundingClientRect();
    W = Math.max(1, Math.round(f.width)); H = Math.max(1, Math.round(f.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cs = getComputedStyle(root);
    kx = parseFloat(cs.getPropertyValue("--kx")) / 100 * W;
    ky = parseFloat(cs.getPropertyValue("--ky")) / 100 * H;
    S = Math.max(26, Math.min(74, Math.min(W / 14.5, H / 13.5)));
    if (!front.c) { front.c = document.createElement("canvas"); back.c = document.createElement("canvas"); }
    var list = [canvas, front.c, back.c];
    for (var i = 0; i < 3; i++) { list[i].width = Math.round(W * dpr); list[i].height = Math.round(H * dpr); }
    front.g = front.c.getContext("2d", { alpha: false });
    back.g = back.c.getContext("2d", { alpha: false });
    front.ready = false;
    var n = Math.round(90 + 110 * clamp01((W * H) / (1440 * 900)));
    if (NV !== n) populate(n);
  }

  function prepareBoxes() {
    var n = boxes.length;
    bx0 = new Float32Array(n); bx1 = new Float32Array(n); by0 = new Float32Array(n); by1 = new Float32Array(n);
    bz0 = new Float32Array(n); bz1 = new Float32Array(n);
    uMin = new Float32Array(n); uMax = new Float32Array(n); vMax = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var b = boxes[i];
      bx0[i] = b.x0; bx1[i] = b.x1; by0[i] = b.y0; by1[i] = b.y1; bz0[i] = b.z0; bz1[i] = b.z1;
    }
    job.order = new Int32Array(n); job.key = new Float32Array(n); job.level = new Uint8Array(n);
    for (i = 0; i < n; i++) job.order[i] = i;
    cellU = new Float32Array(cells.length * 4); cellV = new Float32Array(cells.length * 4); cellL = new Uint8Array(cells.length);
  }

  function extents(cam) {
    var c = cam.cos, s = cam.sin;
    for (var i = 0; i < boxes.length; i++) {
      var a = bx0[i] * c, b = bx1[i] * c, d = by0[i] * s, e = by1[i] * s;
      uMin[i] = Math.min(a, b) + Math.min(d, e);
      uMax[i] = Math.max(a, b) + Math.max(d, e);
      var f = -bx0[i] * s, g = -bx1[i] * s, h = by0[i] * c, k = by1[i] * c;
      vMax[i] = Math.max(f, g) + Math.max(h, k);
    }
  }

  function startJob(theta, phi) {
    setCamera(back, theta, phi);
    var c = back.cos, s = back.sin, n = boxes.length, i;
    for (i = 0; i < n; i++) {
      var xc = (bx0[i] + bx1[i]) / 2, yc = (by0[i] + by1[i]) / 2;
      var u = xc * c + yc * s, v = -xc * s + yc * c;
      job.key[i] = v + bz0[i] * 0.01;
      job.level[i] = Math.round(haze(u, v) * (HAZE_N - 1));
    }
    sortByKey(job.order, job.key, n);
    for (i = 0; i < cells.length; i++) {
      var ci = cells[i].i, cj = cells[i].j;
      cellU[4 * i] = (ci - HALF) * c + (cj - HALF) * s; cellV[4 * i] = -(ci - HALF) * s + (cj - HALF) * c;
      cellU[4 * i + 1] = (ci + HALF) * c + (cj - HALF) * s; cellV[4 * i + 1] = -(ci + HALF) * s + (cj - HALF) * c;
      cellU[4 * i + 2] = (ci + HALF) * c + (cj + HALF) * s; cellV[4 * i + 2] = -(ci + HALF) * s + (cj + HALF) * c;
      cellU[4 * i + 3] = (ci - HALF) * c + (cj + HALF) * s; cellV[4 * i + 3] = -(ci - HALF) * s + (cj + HALF) * c;
      cellL[i] = Math.round(haze(ci * c + cj * s, -ci * s + cj * c) * (HAZE_N - 1));
    }
    job.i = -1;              // -1: the ground is still to draw
    job.n = n;
  }

  function sortByKey(order, key, n) {
    // Insertion sort: the order barely changes between jobs.
    for (var i = 1; i < n; i++) {
      var o = order[i], k = key[o], j = i - 1;
      while (j >= 0 && key[order[j]] > k) { order[j + 1] = order[j]; j--; }
      order[j + 1] = o;
    }
  }

  function drawGround(cam) {
    var g = cam.g, i, L;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = colors.paperStr;
    g.fillRect(0, 0, W, H);
    g.lineWidth = 0.7; g.lineJoin = "round";
    var sp = cam.sinP;
    for (L = 1; L < HAZE_N; L++) {
      g.beginPath();
      var any = false;
      for (i = 0; i < cells.length; i++) {
        if (cellL[i] !== L) continue;
        any = true;
        g.moveTo(cam.cx + cellU[4 * i] * S, cam.cy + cellV[4 * i] * S * sp);
        g.lineTo(cam.cx + cellU[4 * i + 1] * S, cam.cy + cellV[4 * i + 1] * S * sp);
        g.lineTo(cam.cx + cellU[4 * i + 2] * S, cam.cy + cellV[4 * i + 2] * S * sp);
        g.lineTo(cam.cx + cellU[4 * i + 3] * S, cam.cy + cellV[4 * i + 3] * S * sp);
        g.closePath();
      }
      if (any) { g.strokeStyle = groundCol[L]; g.stroke(); }
    }
    // The shore, and two faint contours out in the water.
    for (var k = 0; k < 3; k++) {
      g.beginPath();
      var off = [0, 0.45, 1.2][k];
      for (i = 0; i < shore.length; i += 2) {
        var u = shore[i] * cam.cos + shore[i + 1] * cam.sin + off, v = -shore[i] * cam.sin + shore[i + 1] * cam.cos + off;
        if (i === 0) g.moveTo(cam.cx + u * S, cam.cy + v * S * sp); else g.lineTo(cam.cx + u * S, cam.cy + v * S * sp);
      }
      g.strokeStyle = rgba(colors.ink, [0.32, 0.1, 0.05][k] * (colors.night ? 0.8 : 1));
      g.stroke();
    }
  }

  // Draw box i into the back buffer.
  function drawBox(cam, i) {
    var L = job.level[i];
    if (L < 1) return;
    var g = cam.g, c = cam.cos, s = cam.sin, sp = cam.sinP, cp = cam.cosP;
    var x0 = bx0[i], x1 = bx1[i], y0 = by0[i], y1 = by1[i], z0 = bz0[i], z1 = bz1[i];
    // Screen x and ground y of the four corners (00, 10, 11, 01).
    var X00 = cam.cx + (x0 * c + y0 * s) * S, Y00 = cam.cy + (-x0 * s + y0 * c) * S * sp;
    var X10 = cam.cx + (x1 * c + y0 * s) * S, Y10 = cam.cy + (-x1 * s + y0 * c) * S * sp;
    var X11 = cam.cx + (x1 * c + y1 * s) * S, Y11 = cam.cy + (-x1 * s + y1 * c) * S * sp;
    var X01 = cam.cx + (x0 * c + y1 * s) * S, Y01 = cam.cy + (-x0 * s + y1 * c) * S * sp;
    var hb = z0 * S * cp, ht = z1 * S * cp;
    // Visible side faces: the x0 face if sin > 0 (else x1), the y1 face if cos > 0 (else y0).
    var fx = s > 0 ? 0 : 1, fy = c > 0 ? 1 : 0;
    // N = near corner (fx, fy); A = (fx, 1-fy); B = (1-fx, fy); F = far.
    var NX = fx ? (fy ? X11 : X10) : (fy ? X01 : X00), NY = fx ? (fy ? Y11 : Y10) : (fy ? Y01 : Y00);
    var AX = fx ? (fy ? X10 : X11) : (fy ? X00 : X01), AY = fx ? (fy ? Y10 : Y11) : (fy ? Y00 : Y01);
    var BX = fx ? (fy ? X01 : X00) : (fy ? X11 : X10), BY = fx ? (fy ? Y01 : Y00) : (fy ? Y11 : Y10);
    var FX = fx ? (fy ? X00 : X01) : (fy ? X10 : X11), FY = fx ? (fy ? Y00 : Y01) : (fy ? Y10 : Y11);
    var xFaceBright = Math.abs(s) > Math.abs(c);
    // Top.
    g.fillStyle = topCol[L];
    g.beginPath();
    g.moveTo(NX, NY - ht); g.lineTo(AX, AY - ht); g.lineTo(FX, FY - ht); g.lineTo(BX, BY - ht); g.closePath();
    g.fill();
    // The x face (N-A) and the y face (N-B).
    g.fillStyle = xFaceBright ? sideA[L] : sideB[L];
    g.beginPath();
    g.moveTo(NX, NY - hb); g.lineTo(AX, AY - hb); g.lineTo(AX, AY - ht); g.lineTo(NX, NY - ht); g.closePath();
    g.fill();
    g.fillStyle = xFaceBright ? sideB[L] : sideA[L];
    g.beginPath();
    g.moveTo(NX, NY - hb); g.lineTo(BX, BY - hb); g.lineTo(BX, BY - ht); g.lineTo(NX, NY - ht); g.closePath();
    g.fill();
    // Facades.
    var b = boxes[i], hpx = ht - hb;
    if (hpx > 4 && winA[L] > 0.12 && !b.bridge) {
      var floors = Math.min(TEX_FLOORS, Math.max(1, Math.round((z1 - z0) / FLOOR)));
      var oy = Math.min(b.oy, TEX_FLOORS - floors);
      g.globalAlpha = winA[L];
      facade(g, b, NX, NY - ht, AX, AY - ht, y1 - y0, floors, oy, hpx);
      facade(g, b, NX, NY - ht, BX, BY - ht, x1 - x0, floors, oy, hpx);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1;
    }
    // Edges.
    g.strokeStyle = edgeCol[L];
    g.lineWidth = 0.75;
    g.beginPath();
    g.moveTo(NX, NY - ht); g.lineTo(AX, AY - ht); g.lineTo(FX, FY - ht); g.lineTo(BX, BY - ht); g.closePath();
    g.moveTo(NX, NY - ht); g.lineTo(NX, NY - hb);
    g.moveTo(AX, AY - ht); g.lineTo(AX, AY - hb); g.lineTo(NX, NY - hb); g.lineTo(BX, BY - hb); g.lineTo(BX, BY - ht);
    if (b.ant) {
      var tx = (X00 + X11) / 2, ty = (Y00 + Y11) / 2;
      g.moveTo(tx, ty - ht); g.lineTo(tx, ty - ht - b.ant * S * cp);
    }
    g.stroke();
    if (b.pad) {
      var px = (X00 + X11) / 2, py = (Y00 + Y11) / 2 - ht, pr = 0.13 * S;
      g.beginPath();
      g.ellipse(px, py, pr, pr * sp, 0, 0, 6.2832);
      g.moveTo(px + pr * 0.45, py);
      g.ellipse(px, py, pr * 0.45, pr * 0.45 * sp, 0, 0, 6.2832);
      g.stroke();
    }
  }

  // Draw a facade sprite onto the face whose top edge runs from (ax, ay)
  // to (bx, by), hpx tall on screen and w blocks wide.
  function facade(g, b, ax, ay, bx, by, w, floors, oy, hpx) {
    if (Math.abs(bx - ax) < 2.5) return;
    var cols = Math.min(TEX_BAYS, Math.max(1, Math.round(w / BAY)));
    var ox = Math.min(b.ox, TEX_BAYS - cols);
    g.setTransform(dpr * (bx - ax), dpr * (by - ay), 0, dpr, dpr * ax, dpr * ay);
    g.drawImage(textures[b.tex], ox * BP, oy * FP, cols * BP, floors * FP, 0, 0, 1, hpx);
  }

  // Advance the city buffer within the time budget; true when complete.
  function runJob(budget) {
    var t0 = performance.now();
    if (job.i < 0) { drawGround(back); job.i = 0; }
    while (job.i < job.n) {
      drawBox(back, job.order[job.i++]);
      if ((job.i & 15) === 0 && performance.now() - t0 > budget) return false;
    }
    return true;
  }

  function swap() {
    var t = front; front = back; back = t;
    front.ready = true;
    extents(front);
  }

  // --- traffic -----------------------------------------------------------
  var pos = [0, 0, 0];
  function projectVehicles() {
    var cam = front, c = cam.cos, s = cam.sin, sp = cam.sinP, cp = cam.cosP, tp = cam.tanP;
    var dx = -s, dy = c, nb = boxes.length;
    for (var i = 0; i < NV; i++) {
      var veh = vehicles[i];
      at(veh.p, veh.s, pos);
      var x = pos[0], y = pos[1], z = pos[2];
      var u = x * c + y * s, v = -x * s + y * c;
      veh.sx = cam.cx + u * S; veh.sy = cam.cy + v * S * sp - z * S * cp;
      veh.a = haze(u, v);
      // Occlusion: does the line towards the camera pass through a box?
      var vis = 1;
      for (var b = 0; b < nb; b++) {
        if (uMin[b] > u || uMax[b] < u || vMax[b] < v) continue;
        var t1 = (bx0[b] - x) / dx, t2 = (bx1[b] - x) / dx, txn = t1 < t2 ? t1 : t2, txf = t1 < t2 ? t2 : t1;
        var t3 = (by0[b] - y) / dy, t4 = (by1[b] - y) / dy, tyn = t3 < t4 ? t3 : t4, tyf = t3 < t4 ? t4 : t3;
        var tn = txn > tyn ? txn : tyn, tf = txf < tyf ? txf : tyf;
        if (tn < 0) tn = 0;
        if (tf <= tn) continue;
        if (z + tn * tp < bz1[b] && z + tf * tp > bz0[b]) { vis = 0; break; }
      }
      veh.vis = vis;
    }
  }

  function recordTrail() {
    trailHead = (trailHead + 1) % TRAIL_N;
    for (var i = 0; i < NV; i++) {
      var k = i * TRAIL_N + trailHead, veh = vehicles[i];
      trailX[k] = veh.sx; trailY[k] = veh.sy; trailV[k] = veh.vis;
    }
  }

  var BANDS = [0.6, 0.3, 0.1];
  function drawTraffic(g, t) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.strokeStyle = colors.signal;
    g.fillStyle = colors.signal;
    g.lineCap = "round";
    g.lineWidth = colors.night ? 1.3 : 1.1;
    var night = colors.night, per = TRAIL_N / 3;
    for (var i = 0; i < NV; i++) {
      var veh = vehicles[i];
      if (veh.a < 0.06) continue;
      var base = i * TRAIL_N;
      for (var b = 0; b < 3; b++) {
        g.globalAlpha = BANDS[b] * veh.a;
        g.beginPath();
        var pen = false;
        for (var j = b * per; j <= (b + 1) * per && j < TRAIL_N; j++) {
          var k = base + ((trailHead - j + TRAIL_N * 2) % TRAIL_N);
          if (!trailV[k]) { pen = false; continue; }
          if (pen) g.lineTo(trailX[k], trailY[k]); else g.moveTo(trailX[k], trailY[k]);
          pen = true;
        }
        g.stroke();
      }
      if (!veh.vis) continue;
      var r = night ? 1.7 : 1.5;
      if (veh.hold > 0) r *= 0.75 + 0.35 * Math.sin(t * 5 + veh.blink);
      g.globalAlpha = veh.a;
      g.beginPath(); g.arc(veh.sx, veh.sy, r, 0, 6.2832); g.fill();
      if (night) {
        g.globalAlpha = 0.22 * veh.a;
        g.beginPath(); g.arc(veh.sx, veh.sy, r * 2.8, 0, 6.2832); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // --- the loop ----------------------------------------------------------
  var clock = 0, last = 0, raf = 0, running = false, trailAcc = 0, flickerAcc = 0;

  // Begin drawing the next city buffer with the camera where the drift has it now.
  function restartJob() {
    startJob(THETA0 + DRIFT_A * Math.sin(6.2832 * clock / DRIFT_T),
             PHI0 + PHI_A * Math.sin(6.2832 * clock / PHI_T + 1.7));
  }

  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    clock += dt;
    if (runJob(BUDGET)) { swap(); restartJob(); }
    flickerAcc += dt;
    if (flickerAcc > FLICKER) {
      flickerAcc = 0;
      var b = boxes[(rng() * boxes.length) | 0];
      b.ox = (rng() * 9) | 0; b.oy = (rng() * 40) | 0;
    }
    moveVehicles(dt);
    if (front.ready) {
      projectVehicles();
      trailAcc += dt;
      if (trailAcc >= TRAIL_DT) { trailAcc = trailAcc > 0.1 ? 0 : trailAcc - TRAIL_DT; recordTrail(); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(front.c, 0, 0);
      drawTraffic(ctx, clock);
    }
    raf = window.requestAnimationFrame(frame);
  }

  // One still frame: the whole city at once, with half a second of trails.
  function still() {
    restartJob();
    runJob(1e9);
    swap();
    for (var k = 0; k < TRAIL_N; k++) {
      moveVehicles(TRAIL_DT);
      projectVehicles();
      recordTrail();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(front.c, 0, 0);
    drawTraffic(ctx, 0);
  }

  function build() {
    rng = mulberry32(seed);
    generateCity();
    generatePaths();
    prepareBoxes();
  }

  function start() {
    root.classList.add("js-live");
    measure();
    if (reduce.matches) { stop(); still(); return; }
    if (running) return;
    running = true;
    last = 0;
    restartJob();
    raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    window.cancelAnimationFrame(raf);
  }

  function listen(mq, fn) {
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else if (mq.addListener) mq.addListener(fn);
  }

  // Start only once the page has loaded: WebKit can run a deferred script
  // before the stylesheet applies, and measuring then gives the unstyled
  // layout (the canvas sized to it, the colours unset). A ResizeObserver on
  // the field re-measures whenever its size really changes.
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    readColors();
    start();
  }
  function remeasure() {
    if (!booted) return;
    var f = field.getBoundingClientRect();
    if (Math.abs(f.width - W) > 1 || Math.abs(f.height - H) > 1) { stop(); start(); }
  }

  build();
  listen(reduce, function () { stop(); if (booted) start(); });
  listen(dark, function () { if (!booted) return; readColors(); if (reduce.matches) start(); else restartJob(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else if (booted) start();
  });
  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(remeasure, 120);
  }
  window.addEventListener("resize", onResize);
  if (window.ResizeObserver) new window.ResizeObserver(onResize).observe(field);
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
})();
