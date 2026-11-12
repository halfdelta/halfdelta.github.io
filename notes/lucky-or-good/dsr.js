/* DSR calculator for the "Lucky or good?" note. Progressive enhancement:
   the tables in the page carry the argument without it. Same-origin, no libraries. */
(function () {
  "use strict";
  var host = document.getElementById("calc");
  if (!host) return;

  var GE = 0.5772156649015329;
  var NS = [5, 15, 31, 50, 100, 150, 300, 1000];

  function erf(x) { // Abramowitz and Stegun 7.1.26
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function cdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function inv(p) { // Acklam's approximation to the inverse normal CDF
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  function sr0(sd, n) { return sd * ((1 - GE) * inv(1 - 1 / n) + GE * inv(1 - 1 / (n * Math.E))); }
  function dsr(sr, s0, t, g3, g4) {
    if (!(t > 1)) return { v: null, why: "T is 1 or less" };
    var rad = 1 - g3 * sr + (g4 - 1) / 4 * sr * sr;
    if (!(rad > 0)) return { v: null, why: "the value under the square root is not positive" };
    var z = (sr - s0) * Math.sqrt(t - 1) / Math.sqrt(rad);
    return { v: cdf(z), z: z };
  }
  function band(v) { return v == null ? "" : v < 0.80 ? "red" : v < 0.95 ? "amber" : "green"; }

  var controls = [
    ["sr", "Winner's Sharpe", 0, 0.5, 0.005, "Average return divided by its standard deviation, per trade."],
    ["t", "Effective trades T", 10, 600, 5, "From step one, not the raw count."],
    ["v", "Spread of trial Sharpes", 0.01, 0.15, 0.005, "How differently the tried settings performed."],
    ["n", "Settings tried N", 0, 7, 1, "Steps through 5, 15, 31, 50, 100, 150, 300, 1000."],
    ["g3", "Skewness", -3, 5, 0.1, "Positive means a few big winners."],
    ["g4", "Kurtosis", 1, 30, 0.5, "3 is a normal curve. Higher means fatter tails."]
  ];

  var html = '<h3>Try it: DSR calculator</h3><p class="hint">Same formulas as above. Move a slider to see the luck bar and the DSR change. The curve shows the DSR for every winner Sharpe at the other settings. The shading uses the example thresholds 0.80 and 0.95.</p><div class="calc-grid">';
  controls.forEach(function (c) {
    html += '<div><label for="c-' + c[0] + '">' + c[1] + ' <span class="v" id="o-' + c[0] + '"></span></label>' +
      '<input type="range" id="c-' + c[0] + '" min="' + c[2] + '" max="' + c[3] + '" step="' + c[4] + '">' +
      '<div class="hint">' + c[5] + '</div></div>';
  });
  html += '</div><div class="presets">' +
    '<button type="button" data-p="0.20,120,0.05,4,1.5,8">Example from the table</button>' +
    '<button type="button" data-p="0.20,120,0.05,4,0,3">Same, normal-shaped returns</button>' +
    '<button type="button" data-p="0.20,120,0.05,3,1.5,8">Same, N = 50</button>' +
    '<button type="button" data-p="0.12,300,0.03,4,1.5,8">Small edge, many trades</button></div>' +
    '<div class="readout">' +
    '<div class="cell"><div class="k">Luck bar</div><div class="val" id="r-sr0">-</div></div>' +
    '<div class="cell"><div class="k">Gap to the bar</div><div class="val" id="r-gap">-</div></div>' +
    '<div class="cell"><div class="k">z-score</div><div class="val" id="r-z">-</div></div>' +
    '<div class="cell" id="r-cell"><div class="k">DSR</div><div class="val" id="r-dsr">-</div></div></div>' +
    '<p class="verdict-line" id="r-line" aria-live="polite"></p>' +
    '<div class="chart" id="chart"></div>';
  host.innerHTML = html;

  var el = {};
  controls.forEach(function (c) { el[c[0]] = document.getElementById("c-" + c[0]); });
  function text(id, s) { document.getElementById(id).textContent = s; }

  function setVals(a) {
    ["sr", "t", "v", "n", "g3", "g4"].forEach(function (k, i) { el[k].value = a[i]; });
    render();
  }

  function drawChart(s0, t, g3, g4, cur) {
    var W = 640, H = 230, L = 44, R = 14, T = 12, B = 34, pw = W - L - R, ph = H - T - B;
    function x(s) { return L + s / 0.5 * pw; }
    function y(v) { return T + (1 - v) * ph; }
    var g = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="The DSR as a function of the winner\'s Sharpe ratio, with the luck bar marked.">';
    g += '<rect class="band-r" x="' + L + '" y="' + y(0.8) + '" width="' + pw + '" height="' + (y(0) - y(0.8)) + '"/>';
    g += '<rect class="band-a" x="' + L + '" y="' + y(0.95) + '" width="' + pw + '" height="' + (y(0.8) - y(0.95)) + '"/>';
    g += '<rect class="band-g" x="' + L + '" y="' + y(1) + '" width="' + pw + '" height="' + (y(0.95) - y(1)) + '"/>';
    [0, 0.25, 0.5, 0.8, 0.95, 1].forEach(function (v) {
      g += '<line class="grid" x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      g += '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(2) + "</text>";
    });
    [0, 0.1, 0.2, 0.3, 0.4, 0.5].forEach(function (v) {
      g += '<text x="' + x(v) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + v.toFixed(1) + "</text>";
    });
    g += '<text x="' + (L + pw / 2) + '" y="' + (H - 4) + '" text-anchor="middle">winner’s Sharpe ratio</text>';
    if (s0 >= 0 && s0 <= 0.5) {
      g += '<line class="bar" x1="' + x(s0) + '" x2="' + x(s0) + '" y1="' + T + '" y2="' + (T + ph) + '"/>';
      g += '<text class="bar-label" x="' + (x(s0) + 5) + '" y="' + (T + 12) + '">luck bar</text>';
    }
    var pts = [], i, s, r;
    for (i = 0; i <= 200; i++) {
      s = i / 200 * 0.5; r = dsr(s, s0, t, g3, g4);
      if (r.v != null) pts.push(x(s).toFixed(1) + "," + y(r.v).toFixed(1));
    }
    if (pts.length) g += '<polyline class="curve" points="' + pts.join(" ") + '"/>';
    var rc = dsr(cur, s0, t, g3, g4);
    if (rc.v != null) g += '<circle class="dot" cx="' + x(cur) + '" cy="' + y(rc.v) + '" r="5.5"/>';
    g += "</svg>";
    document.getElementById("chart").innerHTML = g;
  }

  function render() {
    var sr = +el.sr.value, t = +el.t.value, sd = +el.v.value, n = NS[+el.n.value],
        g3 = +el.g3.value, g4 = +el.g4.value;
    text("o-sr", sr.toFixed(3)); text("o-t", String(t)); text("o-v", sd.toFixed(3));
    text("o-n", String(n)); text("o-g3", g3.toFixed(1)); text("o-g4", g4.toFixed(1));
    var s0 = sr0(sd, n), res = dsr(sr, s0, t, g3, g4), b = band(res.v);
    text("r-sr0", s0.toFixed(3));
    text("r-gap", (sr - s0 >= 0 ? "+" : "") + (sr - s0).toFixed(3));
    text("r-z", res.v == null ? "-" : res.z.toFixed(2));
    text("r-dsr", res.v == null ? "n/a" : res.v.toFixed(3));
    document.getElementById("r-cell").className = "cell " + b;
    text("r-line", res.v == null ? "Not computable (" + res.why + "): this is no answer, and it would not block." :
      b === "red" ? "Below 0.80: on its own this would be red." :
      b === "amber" ? "Between 0.80 and 0.95: not red, but a caution flag." :
      "0.95 or more: the luck test passes. The verdict is green only if every other check passes too.");
    drawChart(s0, t, g3, g4, sr);
  }

  Object.keys(el).forEach(function (k) { el[k].addEventListener("input", render); });
  Array.prototype.forEach.call(host.querySelectorAll(".presets button"), function (btn) {
    btn.addEventListener("click", function () { setVals(btn.getAttribute("data-p").split(",").map(Number)); });
  });
  setVals([0.20, 120, 0.05, 4, 1.5, 8]);
})();
