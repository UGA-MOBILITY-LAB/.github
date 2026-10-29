// Ring-road traffic waves on the research page. Twenty-two cars follow each other around a 300 m
// ring: human drivers use the Intelligent Driver Model with a 0.6 s reaction delay, so small
// disturbances grow into stop-and-go waves. Automated vehicles hold the average traffic speed and
// leave a buffer, which absorbs the waves. Runs only after Start and pauses when off-screen.
(() => {
  const section = document.querySelector('#traffic-wave');
  if (!section) return;
  const ring = section.querySelector('.wave-ring');
  const chart = section.querySelector('.wave-chart');
  const ringCtx = ring.getContext('2d');
  const chartCtx = chart.getContext('2d');
  const startButton = section.querySelector('[data-wave-start]');
  const brakeButton = section.querySelector('[data-wave-brake]');
  const avButtons = [...section.querySelectorAll('[data-wave-av]')];
  const stats = section.querySelector('.wave-stats');
  const status = section.querySelector('.wave-status');
  const font = getComputedStyle(section).fontFamily;

  const N = 22, L = 300, CAR = 4.5, DT = 0.05, SPEEDUP = 3, DELAY = 12; // DELAY steps = 0.6 s
  const human = { a: 0.7, b: 1.5, v0: 15, T: 1.0, s0: 2 };
  const HISTORY_SECONDS = 90;
  let x, v, braking, history, cursor, automated = [], running = false, last = 0, clock = 0, sampleClock = 0, statClock = 0;
  let samples = [];

  function noise() {
    // Approximately normal noise (sum of uniforms), for small fluctuations in human driving.
    return (Math.random() + Math.random() + Math.random() - 1.5) * 0.3;
  }
  function reset() {
    x = Float64Array.from({ length: N }, (_, i) => i * L / N + (Math.random() - 0.5) * 0.2);
    v = new Float64Array(N).fill(6.5);
    braking = new Float64Array(N);
    history = Array.from({ length: DELAY + 1 }, () => ({ gap: new Float64Array(N).fill(L / N - CAR), dv: new Float64Array(N), v: new Float64Array(N).fill(6.5) }));
    cursor = 0;
    clock = sampleClock = statClock = 0;
    samples = [];
  }
  function setAutomated(count) {
    automated = Array.from({ length: N }, () => false);
    for (let k = 0; k < count; k++) automated[Math.floor(k * N / count)] = true;
    for (const b of avButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.waveAv) === count));
  }
  const idm = (gap, speed, dv, p) => p.a * (1 - (speed / p.v0) ** 4 - ((p.s0 + speed * p.T + speed * dv / (2 * Math.sqrt(p.a * p.b))) / Math.max(gap, 0.1)) ** 2);

  function step() {
    const gap = new Float64Array(N), dv = new Float64Array(N);
    let flow = 0;
    for (let i = 0; i < N; i++) {
      const lead = (i + 1) % N;
      gap[i] = (((x[lead] - x[i]) % L) + L) % L - CAR;
      dv[i] = v[i] - v[lead];
      flow += v[i] / N;
    }
    // Humans react to what they saw DELAY steps ago.
    cursor = (cursor + 1) % history.length;
    history[cursor] = { gap, dv, v: Float64Array.from(v) };
    const seen = history[(cursor + 1) % history.length];
    for (let i = 0; i < N; i++) {
      let acc = automated[i]
        ? Math.min(0.4 * (flow - v[i]), idm(gap[i], v[i], dv[i], { a: 1.2, b: 2, v0: 15, T: 1.0, s0: 2 }))
        : idm(seen.gap[i], seen.v[i], seen.dv[i], human) + noise();
      if (braking[i] > 0) { acc = -3; braking[i] -= DT; }
      acc = Math.max(-6, Math.min(2, acc));
      v[i] = Math.max(0, v[i] + acc * DT);
    }
    for (let i = 0; i < N; i++) x[i] = (x[i] + v[i] * DT) % L;
    clock += DT;
  }

  // ---- drawing ------------------------------------------------------------
  function size(canvas, context) {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return box;
  }
  const speedColor = speed => {
    // Red when (nearly) stopped, grey once moving at a crawl or faster, so stop-and-go stands out.
    const t = Math.min(1, Math.max(0, (speed - 0.5) / 2.5));
    const mix = (a, b) => Math.round(a + (b - a) * t);
    return `rgb(${mix(186, 150)},${mix(12, 156)},${mix(47, 166)})`;
  };
  function drawRing() {
    const { width, height } = ring.getBoundingClientRect();
    const cx = width / 2, cy = height / 2, r = Math.min(width, height) / 2 - 26;
    ringCtx.clearRect(0, 0, width, height);
    ringCtx.lineWidth = 26;
    ringCtx.strokeStyle = '#e3e6ea';
    ringCtx.beginPath();
    ringCtx.arc(cx, cy, r, 0, Math.PI * 2);
    ringCtx.stroke();
    ringCtx.lineWidth = 1;
    ringCtx.strokeStyle = '#c5cbd2';
    for (const edge of [r - 13, r + 13]) {
      ringCtx.beginPath();
      ringCtx.arc(cx, cy, edge, 0, Math.PI * 2);
      ringCtx.stroke();
    }
    for (let i = 0; i < N; i++) {
      const angle = x[i] / L * Math.PI * 2 - Math.PI / 2;
      ringCtx.save();
      ringCtx.translate(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ringCtx.rotate(angle + Math.PI / 2);
      ringCtx.fillStyle = automated[i] ? '#1d1d1f' : speedColor(v[i]);
      ringCtx.beginPath();
      if (ringCtx.roundRect) ringCtx.roundRect(-8, -4.5, 16, 9, 2.5); else ringCtx.rect(-8, -4.5, 16, 9);
      ringCtx.fill();
      if (automated[i]) {
        ringCtx.fillStyle = '#fff';
        ringCtx.beginPath();
        ringCtx.arc(0, 0, 2.2, 0, Math.PI * 2);
        ringCtx.fill();
      }
      ringCtx.restore();
    }
    ringCtx.fillStyle = '#5d6168';
    ringCtx.font = `600 15px ${font}`;
    ringCtx.textAlign = 'center';
    ringCtx.textBaseline = 'middle';
    const mph = Math.round([...v].reduce((s, value) => s + value, 0) / N * 2.23694);
    ringCtx.fillText(`${mph} mph`, cx, cy - 10);
    ringCtx.font = `15px ${font}`;
    ringCtx.fillText('average speed', cx, cy + 12);
  }
  function drawChart() {
    const { width, height } = chart.getBoundingClientRect();
    const left = 8, top = 8, w = width - 16, h = height - 34;
    chartCtx.clearRect(0, 0, width, height);
    chartCtx.fillStyle = '#f4f5f7';
    chartCtx.fillRect(left, top, w, h);
    const r = Math.max(1.4, Math.min(2.4, w / 380));
    for (const sample of samples) {
      const px = left + w - (clock - sample.t) / HISTORY_SECONDS * w;
      if (px < left) continue;
      for (let i = 0; i < N; i++) {
        chartCtx.fillStyle = sample.auto[i] ? '#1d1d1f' : speedColor(sample.v[i]);
        chartCtx.fillRect(px - r / 2, top + h - sample.x[i] / L * h - r / 2, r, r);
      }
    }
    chartCtx.fillStyle = '#5d6168';
    chartCtx.font = `15px ${font}`;
    chartCtx.textBaseline = 'alphabetic';
    chartCtx.textAlign = 'left';
    chartCtx.fillText('← 90 s ago', left, height - 8);
    chartCtx.textAlign = 'right';
    chartCtx.fillText('now', left + w, height - 8);
  }
  function draw() {
    drawRing();
    drawChart();
  }
  function updateStats() {
    const stopped = [...v].filter(value => value < 0.5).length;
    const mean = [...v].reduce((s, value) => s + value, 0) / N;
    stats.textContent = `${stopped} of ${N} cars stopped · average ${Math.round(mean * 2.23694)} mph`;
  }

  function loop(time) {
    if (!running) return;
    const elapsed = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    let budget = elapsed * SPEEDUP;
    while (budget > 0) {
      step();
      budget -= DT;
      sampleClock += DT;
      if (sampleClock >= 0.5) {
        sampleClock = 0;
        samples.push({ t: clock, x: Float64Array.from(x), v: Float64Array.from(v), auto: [...automated] });
        while (samples.length && clock - samples[0].t > HISTORY_SECONDS) samples.shift();
      }
    }
    statClock += elapsed;
    if (statClock > 0.5) { statClock = 0; updateStats(); }
    draw();
    requestAnimationFrame(loop);
  }
  function play() {
    running = true;
    last = 0;
    startButton.textContent = 'Pause';
    requestAnimationFrame(loop);
  }
  function pause() {
    if (!running) return;
    running = false;
    startButton.textContent = 'Resume';
  }
  function brake(index) {
    braking[index] = 1.5;
    status.textContent = `Car ${index + 1} brakes for a moment.`;
    if (!running) play();
  }

  startButton.addEventListener('click', () => (running ? pause() : play()));
  brakeButton.addEventListener('click', () => {
    const humans = automated.map((auto, i) => (auto ? -1 : i)).filter(i => i >= 0);
    brake(humans[Math.floor(Math.random() * humans.length)]);
  });
  for (const button of avButtons) {
    button.addEventListener('click', () => {
      const count = Number(button.dataset.waveAv);
      setAutomated(count);
      status.textContent = count ? `${count} automated ${count === 1 ? 'vehicle' : 'vehicles'} in the traffic.` : 'Human drivers only.';
      draw();
    });
  }
  // Clicking a car on the ring makes it brake.
  ring.addEventListener('pointerdown', event => {
    const box = ring.getBoundingClientRect();
    const angle = Math.atan2(event.clientY - box.top - box.height / 2, event.clientX - box.left - box.width / 2) + Math.PI / 2;
    const position = (((angle / (Math.PI * 2)) * L) % L + L) % L;
    let nearest = 0, best = Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.min(Math.abs(x[i] - position), L - Math.abs(x[i] - position));
      if (d < best) { best = d; nearest = i; }
    }
    if (best < 8) brake(nearest);
  });
  new IntersectionObserver(entries => { for (const entry of entries) if (!entry.isIntersecting) pause(); }, { threshold: 0.2 }).observe(section);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  new ResizeObserver(() => { size(ring, ringCtx); size(chart, chartCtx); draw(); }).observe(section.querySelector('.wave-stage'));

  reset();
  setAutomated(0);
  updateStats();
})();
