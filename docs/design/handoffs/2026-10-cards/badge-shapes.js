(function () {
  function roundedPoly(V, r, steps) {
    var pts = [], n = V.length;
    for (var i = 0; i < n; i++) {
      var P = V[i], A = V[(i + n - 1) % n], C = V[(i + 1) % n];
      var ax = A[0] - P[0], ay = A[1] - P[1], cx = C[0] - P[0], cy = C[1] - P[1];
      var la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy);
      ax /= la; ay /= la; cx /= lc; cy /= lc;
      var th = Math.acos(ax * cx + ay * cy), d = r / Math.tan(th / 2), h = r / Math.sin(th / 2);
      var bx = ax + cx, by = ay + cy, lb = Math.hypot(bx, by); bx /= lb; by /= lb;
      var O = [P[0] + bx * h, P[1] + by * h];
      var t1 = [P[0] + ax * d, P[1] + ay * d], t2 = [P[0] + cx * d, P[1] + cy * d];
      var a1 = Math.atan2(t1[1] - O[1], t1[0] - O[0]), a2 = Math.atan2(t2[1] - O[1], t2[0] - O[0]);
      var da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      for (var s = 0; s <= steps; s++) { var a = a1 + da * s / steps; pts.push([O[0] + Math.cos(a) * r, O[1] + Math.sin(a) * r]); }
    }
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
    return 'polygon(' + pts.map(function (p) { return ((p[0] - x0) / (x1 - x0) * 100).toFixed(2) + '% ' + ((p[1] - y0) / (y1 - y0) * 100).toFixed(2) + '%'; }).join(', ') + ')';
  }
  var TRI_AR = 0.92;
  var SHAPES = [
    { id: 'hex', name: 'Hex', clip: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)', ar: 42 / 38, ic: 0.47, pad: 0 },
    { id: 'shield', name: 'Shield', clip: 'polygon(50% 0, 100% 12%, 100% 58%, 50% 100%, 0 58%, 0 12%)', ar: 1.12, ic: 0.44, pad: 0.1 },
    { id: 'round', name: 'Round', clip: 'circle(50% at 50% 50%)', ar: 1, ic: 0.46, pad: 0 },
    { id: 'octagon', name: 'Octagon', clip: 'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)', ar: 1, ic: 0.46, pad: 0 },
    { id: 'diamond', name: 'Diamond', clip: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)', ar: 1.1, ic: 0.34, pad: 0 },
    { id: 'chamfer', name: 'Chamfer', clip: 'polygon(20% 0, 100% 0, 100% 80%, 80% 100%, 0 100%, 0 20%)', ar: 1, ic: 0.46, pad: 0 },
    { id: 'triangle', name: 'Triangle', clip: roundedPoly([[50, 0], [100, 100 * TRI_AR], [0, 100 * TRI_AR]], 12, 8), ar: TRI_AR, ic: 0.36, pad: 0, padTop: 0.2 },
    { id: 'square', name: 'Square', clip: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', ar: 1, ic: 0.5, pad: 0 },
    { id: 'invtri', name: 'Inv Triangle', clip: roundedPoly([[0, 0], [100, 0], [50, 100 * TRI_AR]], 12, 8), ar: TRI_AR, ic: 0.36, pad: 0.2 },
    { id: 'banner', name: 'Pennant', clip: 'polygon(0 0, 100% 0, 100% 74%, 50% 100%, 0 74%)', ar: 1.18, ic: 0.46, pad: 0.14 }
  ];
  var FRAMES = [
    { id: 'single', name: 'Single', sub: 'One rim' },
    { id: 'double', name: 'Double', sub: 'Rim · gap · rim' },
    { id: 'heavy', name: 'Heavy', sub: 'Thick rim' },
    { id: 'bevel', name: 'Bevel', sub: 'Rim + gloss' }
  ];
  var MARKERS = [
    { id: 'none', name: 'None' },
    { id: 'roman', name: 'Numeral' },
    { id: 'pips', name: 'Pips' },
    { id: 'tab', name: 'Tab' }
  ];
  var LABELS = [
    { id: 'below', name: 'Below' },
    { id: 'ribbon', name: 'Ribbon' },
    { id: 'none', name: 'None' }
  ];
  window.BGM_BADGE = { SHAPES: SHAPES, FRAMES: FRAMES, MARKERS: MARKERS, LABELS: LABELS };
})();
