// Hawkinsville 3D scan, opened from the research mosaic. Nothing loads until a visitor asks:
// the dialog fetches a thinned copy of the lab's public LiDAR + HD-map release (see
// scripts/prepare-scan.py), draws only when the view changes, and offers a short quiz
// that flies to each stretch the route survey flagged.
(() => {
  const trigger = document.querySelector('[data-scan-open]');
  const dialog = document.querySelector('#scan-dialog');
  if (!trigger || !dialog || typeof dialog.showModal !== 'function' || !('DecompressionStream' in window) || !window.WebGLRenderingContext) return;
  const canvas = dialog.querySelector('.scan-canvas');
  const markers = dialog.querySelector('.scan-markers');
  const panel = dialog.querySelector('.scan-panel');
  const status = dialog.querySelector('.scan-status');
  const modeButtons = [...dialog.querySelectorAll('[data-scan-mode]')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  trigger.hidden = false;

  const FOV = 50 * Math.PI / 180;
  const view = { target: [0, 0, 0], distance: 1000, azimuth: -2, elevation: 0.9 };
  let home = null, scan = null, spots = [], categories = {}, loading = null;
  let mode = 'explore', selected = -1, quiz = null, frameRequested = false, tween = null;
  let gl = null, program = null, at = null, un = null; // created on first open

  // ---- loading -------------------------------------------------------------
  async function gunzip(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return buffer; // already decoded by the server
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  async function load() {
    setup();
    const [binary, json] = await Promise.all([
      fetch('assets/hawkinsville-scan.bin.gz').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(gunzip),
      fetch('assets/hawkinsville-spots.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ]);
    const header = new DataView(binary);
    if (String.fromCharCode(...new Uint8Array(binary, 0, 4)) !== 'HKV1') throw new Error('Unexpected scan format');
    const count = header.getUint32(4, true), lineCount = header.getUint32(8, true);
    const origin = [0, 1, 2].map(i => header.getFloat32(12 + i * 4, true));
    const step = [0, 1, 2].map(i => header.getFloat32(24 + i * 4, true));
    let offset = 36;
    const positions = new Uint16Array(binary, offset, count * 3); offset += count * 6;
    const attributes = new Uint8Array(binary, offset, count); offset += count;
    const lines = new Uint16Array(binary.slice(offset, offset + lineCount * 6));
    // Centre the scene on the scan so coordinates stay small.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
    const center = [0, 1, 2].map(k => origin[k] + (lo[k] + hi[k]) / 2 * step[k]);
    const shift = [0, 1, 2].map(k => origin[k] - center[k]);
    const world = q => [0, 1, 2].map(k => shift[k] + q[k] * step[k]);
    // Lane lines become dense dots, so they read clearly at any zoom.
    const dots = [];
    for (let i = 0; i + 5 < lines.length; i += 6) {
      const a = world([lines[i], lines[i + 1], lines[i + 2]]), b = world([lines[i + 3], lines[i + 4], lines[i + 5]]);
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.6));
      for (let j = 0; j < n; j++) dots.push(...[0, 1, 2].map(k => a[k] + (b[k] - a[k]) * j / n + (k === 2 ? 0.15 : 0)));
    }
    scan = {
      count, shift, step,
      points: buffer(positions),
      attributes: buffer(attributes),
      lineCount: dots.length / 3,
      lines: buffer(new Float32Array(dots)),
      radius: Math.hypot((hi[0] - lo[0]) * step[0], (hi[1] - lo[1]) * step[1]) / 2,
    };
    categories = Object.fromEntries(json.categories.map(c => [c.key, c]));
    spots = json.spots.map(s => ({ ...s, world: world(s.position), span: s.span * step[0] }));
    home = { target: [0, 0, 0], distance: scan.radius * 1.42, azimuth: -1.95, elevation: 1.0 };
    Object.assign(view, home, { target: [...home.target] });
    buildMarkers();
    status.hidden = true;
    resize();
  }
  function buffer(data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  // ---- rendering ------------------------------------------------------------
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  function setup() {
    gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `
      attribute vec3 aPos;
      attribute float aAttr;
      uniform mat4 uMatrix;
      uniform vec3 uShift;
      uniform vec3 uStep;
      uniform float uLine;
      uniform float uPixels;
      varying vec3 vColor;
      void main() {
        vec3 p = uLine > 0.5 ? aPos : uShift + aPos * uStep;
        gl_Position = uMatrix * vec4(p, 1.0);
        float level = mod(aAttr, 16.0) / 15.0;
        float bucket = floor(aAttr / 16.0);
        // Road surface in grey with bright paint; trees and buildings in cool grey by height.
        vec3 ground = mix(vec3(0.17, 0.19, 0.22), vec3(1.0), pow(level, 1.5));
        vec3 above = mix(vec3(0.27, 0.33, 0.38), vec3(0.6, 0.68, 0.74), min(bucket / 6.0, 1.0));
        vColor = uLine > 0.5 ? vec3(0.95, 0.22, 0.3) : mix(ground, above, step(0.5, bucket));
        // World-space dot sizes follow each layer's spacing: fine paint, coarser road and roadside.
        float size = uLine > 0.5 ? 0.45 : bucket > 0.5 ? 1.9 : level > 0.36 ? 0.65 : 1.7;
        gl_PointSize = clamp(size * uPixels / gl_Position.w, 2.0, 11.0);
      }`));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }`));
    gl.linkProgram(program);
    at = { pos: gl.getAttribLocation(program, 'aPos'), attr: gl.getAttribLocation(program, 'aAttr') };
    un = Object.fromEntries(['uMatrix', 'uShift', 'uStep', 'uLine', 'uPixels'].map(n => [n, gl.getUniformLocation(program, n)]));
  }

  function eye() {
    const c = Math.cos(view.elevation);
    return [view.target[0] + view.distance * c * Math.cos(view.azimuth), view.target[1] + view.distance * c * Math.sin(view.azimuth), view.target[2] + view.distance * Math.sin(view.elevation)];
  }
  function matrix() {
    const e = eye(), t = view.target;
    let z = [e[0] - t[0], e[1] - t[1], e[2] - t[2]];
    const zl = Math.hypot(...z); z = z.map(v => v / zl);
    let x = [-z[1], z[0], 0]; // up is +z
    const xl = Math.hypot(...x) || 1; x = x.map(v => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const viewMatrix = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
    const near = Math.max(0.5, view.distance / 200), far = view.distance * 6 + scan.radius * 2;
    const f = 1 / Math.tan(FOV / 2), aspect = canvas.width / canvas.height;
    const p = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += p[k * 4 + r] * viewMatrix[c * 4 + k];
      out[c * 4 + r] = sum;
    }
    return out;
  }
  function draw() {
    frameRequested = false;
    if (!scan || !canvas.width) return;
    const m = matrix();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.043, 0.055, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.uniformMatrix4fv(un.uMatrix, false, m);
    gl.uniform3fv(un.uShift, scan.shift);
    gl.uniform3fv(un.uStep, scan.step);
    gl.uniform1f(un.uPixels, canvas.height / (2 * Math.tan(FOV / 2)));
    gl.uniform1f(un.uLine, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, scan.points);
    gl.enableVertexAttribArray(at.pos);
    gl.vertexAttribPointer(at.pos, 3, gl.UNSIGNED_SHORT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, scan.attributes);
    gl.enableVertexAttribArray(at.attr);
    gl.vertexAttribPointer(at.attr, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, scan.count);
    gl.uniform1f(un.uLine, 1);
    gl.disableVertexAttribArray(at.attr);
    gl.vertexAttrib1f(at.attr, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, scan.lines);
    gl.vertexAttribPointer(at.pos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, scan.lineCount);
    placeMarkers(m);
  }
  function requestDraw() {
    if (!frameRequested) { frameRequested = true; requestAnimationFrame(draw); }
  }
  function resize() {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    requestDraw();
  }

  // ---- spot markers -----------------------------------------------------------
  function buildMarkers() {
    markers.replaceChildren(...spots.map((spot, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scan-marker';
      button.addEventListener('click', () => (mode === 'explore' ? select(i) : null));
      return button;
    }));
    labelMarkers();
  }
  // During the quiz the highlighted stretch is unnamed, so neither its number nor its label gives the answer away.
  function labelMarkers() {
    [...markers.children].forEach((button, i) => {
      const quizzing = mode === 'quiz';
      button.textContent = quizzing ? '?' : String(i + 1);
      button.setAttribute('aria-label', quizzing ? 'Highlighted stretch' : `Spot ${i + 1}: ${spots[i].note}`);
      button.tabIndex = quizzing ? -1 : 0;
    });
  }
  function placeMarkers(m) {
    const box = canvas.getBoundingClientRect();
    [...markers.children].forEach((button, i) => {
      const [x, y, z] = spots[i].world;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      const show = cw > 0 && (mode === 'explore' || (quiz && quiz.order[quiz.index] === i));
      button.hidden = !show;
      if (!show) return;
      button.style.transform = `translate(${(cx / cw + 1) / 2 * box.width}px, ${(1 - cy / cw) / 2 * box.height}px) translate(-50%, -50%)`;
      button.classList.toggle('is-selected', i === selected || (quiz && quiz.order[quiz.index] === i));
    });
  }

  // ---- camera -------------------------------------------------------------------
  function flyTo(goal) {
    cancelAnimationFrame(tween);
    const from = { target: [...view.target], distance: view.distance, azimuth: view.azimuth, elevation: view.elevation };
    let turn = goal.azimuth - from.azimuth;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    if (reducedMotion.matches) {
      Object.assign(view, goal, { target: [...goal.target], azimuth: from.azimuth + turn });
      return requestDraw();
    }
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / 900), e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      view.target = from.target.map((v, k) => v + (goal.target[k] - v) * e);
      view.distance = from.distance * (goal.distance / from.distance) ** e;
      view.azimuth = from.azimuth + turn * e;
      view.elevation = from.elevation + (goal.elevation - from.elevation) * e;
      draw();
      if (t < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }
  const framing = spot => ({ target: [...spot.world], distance: Math.min(240, Math.max(70, spot.span * 0.8)), azimuth: view.azimuth, elevation: 0.7 });
  function orbit(dx, dy) {
    cancelAnimationFrame(tween);
    view.azimuth -= dx * 0.006;
    view.elevation = Math.min(1.45, Math.max(0.08, view.elevation + dy * 0.006));
    requestDraw();
  }
  function zoom(factor) {
    cancelAnimationFrame(tween);
    view.distance = Math.min(scan.radius * 4, Math.max(12, view.distance * factor));
    requestDraw();
  }
  function pan(dx, dy) {
    cancelAnimationFrame(tween);
    const k = view.distance * 0.0016, c = Math.cos(view.azimuth), s = Math.sin(view.azimuth);
    view.target[0] += (dx * s - dy * c) * k;
    view.target[1] += (-dx * c - dy * s) * k;
    requestDraw();
  }

  // ---- explore and quiz panels ----------------------------------------------------
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const action = (label, handler, primary = false) => {
    const button = el('button', primary ? 'scan-action is-primary' : 'scan-action', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  };
  function spotCard(spot) {
    const label = el('p', 'scan-category', categories[spot.cat]?.label || spot.cat);
    label.style.setProperty('--dot', categories[spot.cat]?.color || '#fff');
    return [label, el('h3', '', spot.note), el('p', '', spot.desc)];
  }
  function showExplore() {
    panel.replaceChildren(el('p', 'scan-hint', 'Bright points are painted lane markings; red dots are the HD map’s lane lines. Pick a numbered spot to read what the route survey found.'));
  }
  function select(i) {
    selected = i;
    panel.replaceChildren(...spotCard(spots[i]), action('Back to the whole route', () => { selected = -1; showExplore(); flyTo(home); }));
    flyTo(framing(spots[i]));
  }
  function setMode(next) {
    mode = next;
    selected = -1;
    quiz = null;
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.scanMode === next));
    labelMarkers();
    if (next === 'explore') { showExplore(); flyTo(home); }
    else panel.replaceChildren(el('h3', '', 'Spot the challenge'), el('p', '', 'For each highlighted stretch, guess what makes it hard for an automated vehicle. Tip: painted lines show up bright in LiDAR.'), action('Start the quiz', startQuiz, true));
    requestDraw();
  }
  function startQuiz() {
    const order = spots.map((_, i) => i).sort(() => Math.random() - 0.5);
    quiz = { order, index: 0, score: 0 };
    ask();
  }
  function ask() {
    const spot = spots[quiz.order[quiz.index]];
    const options = el('div', 'scan-options');
    for (const category of Object.values(categories)) options.append(action(category.label, () => answer(category.key)));
    panel.replaceChildren(el('p', 'scan-progress', `Spot ${quiz.index + 1} of ${quiz.order.length}`), el('h3', '', 'What makes this stretch hard?'), options);
    flyTo(framing(spot));
    requestDraw();
  }
  function answer(key) {
    const spot = spots[quiz.order[quiz.index]];
    const right = key === spot.cat;
    if (right) quiz.score++;
    const last = quiz.index === quiz.order.length - 1;
    panel.replaceChildren(el('p', right ? 'scan-result is-right' : 'scan-result', right ? 'Correct' : `Not quite: it’s “${categories[spot.cat]?.label}”`), ...spotCard(spot).slice(1), action(last ? 'See your score' : 'Next spot', () => {
      if (last) finish();
      else { quiz.index++; ask(); }
    }, true));
    panel.querySelector('.is-primary').focus({ preventScroll: true });
  }
  function finish() {
    const { score, order } = quiz;
    quiz = null;
    panel.replaceChildren(el('h3', '', `You spotted ${score} of ${order.length}.`), el('p', '', score === order.length ? 'A perfect read of the route.' : 'Rural roads hide their difficulty in small details: missing paint, narrow shoulders, and grade changes.'), action('Try again', startQuiz, true), action('Explore freely', () => setMode('explore')));
    flyTo(home);
  }

  // ---- input -------------------------------------------------------------------------
  const pointers = new Map();
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, button: event.button, shift: event.shiftKey });
  });
  canvas.addEventListener('pointermove', event => {
    const last = pointers.get(event.pointerId);
    if (!last || !scan) return;
    const dx = event.clientX - last.x, dy = event.clientY - last.y;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      last.x = event.clientX; last.y = event.clientY;
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 0 && after > 0) zoom(before / after);
      return;
    }
    last.x = event.clientX; last.y = event.clientY;
    if (last.button === 2 || last.shift) pan(dx, dy); else orbit(dx, dy);
  });
  const release = event => pointers.delete(event.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => {
    if (!scan) return;
    event.preventDefault();
    zoom(Math.exp(event.deltaY * 0.0012));
  }, { passive: false });
  canvas.addEventListener('dblclick', () => scan && flyTo(home));
  canvas.addEventListener('keydown', event => {
    if (!scan) return;
    const moves = { ArrowLeft: () => orbit(-25, 0), ArrowRight: () => orbit(25, 0), ArrowUp: () => orbit(0, 20), ArrowDown: () => orbit(0, -20), '+': () => zoom(0.8), '=': () => zoom(0.8), '-': () => zoom(1.25), '0': () => flyTo(home) };
    if (!moves[event.key]) return;
    event.preventDefault();
    moves[event.key]();
  });
  for (const button of modeButtons) button.addEventListener('click', () => scan && setMode(button.dataset.scanMode));
  dialog.querySelector('[data-scan-reset]').addEventListener('click', () => scan && flyTo(home));
  dialog.querySelector('.scan-close').addEventListener('click', () => dialog.close());
  // The dialog's content fills it, so a click on the dialog element itself is on the backdrop.
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => cancelAnimationFrame(tween));
  new ResizeObserver(() => dialog.open && resize()).observe(canvas);

  trigger.addEventListener('click', () => {
    dialog.showModal();
    if (!loading) {
      status.hidden = false;
      status.textContent = 'Loading the scan (about 450 KB)…';
      loading = load().then(() => setMode('explore')).catch(() => {
        status.textContent = 'The 3D scan could not be loaded. Please try again later.';
        loading = null;
      });
    } else resize();
  });
})();
