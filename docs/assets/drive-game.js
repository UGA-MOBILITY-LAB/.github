// A small driving game at the foot of the home page: steer a UGA research vehicle while rain, fog,
// and nightfall shrink what its sensors can see, or let autopilot drive and take over when it struggles.
// It starts only when asked, pauses when scrolled away, and handles keys only while it has focus.
(() => {
  const game = document.querySelector('#drive-game');
  if (!game) return;
  const canvas = game.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const screen = game.querySelector('.drive-game-screen');
  const overlay = game.querySelector('.drive-game-overlay');
  const message = game.querySelector('.drive-game-message');
  const detail = game.querySelector('.drive-game-detail');
  const startButton = game.querySelector('.drive-game-start');
  const autopilotButton = game.querySelector('.drive-game-autopilot');
  const status = game.querySelector('.drive-game-status');
  const hud = {};
  for (const item of game.querySelectorAll('[data-hud]')) hud[item.dataset.hud] = item;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const font = getComputedStyle(game).fontFamily;

  const LANES = 3;
  const METERS_PER_PX = 0.06; // 300 px/s on screen is about 40 mph
  const TRAFFIC = 0.6; // other traffic closes in at 60% of your speed
  const CONDITION_SECONDS = 9;
  // Each condition scales the sensor range; autopilot also plans less often as perception degrades.
  const conditions = [
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08 },
    { name: 'Rain', label: 'Rain · sensors 62%', range: 0.62, plan: 0.2, rain: 1 },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08 },
    { name: 'Fog', label: 'Fog · sensors 36%', range: 0.36, plan: 0.34, fog: 1 },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08 },
    { name: 'Night', label: 'Night · sensors 55%', range: 0.55, plan: 0.16, night: 1 },
  ];
  const vehicles = [
    { type: 'car', color: '#d9dde2', w: 1, h: 1, weight: 5 },
    { type: 'pickup', color: '#6f7a86', w: 1.04, h: 1.14, weight: 3 },
    { type: 'truck', color: '#eef0f2', w: 1.12, h: 1.9, weight: 2 },
    { type: 'tractor', color: '#7a8b3c', w: 1.08, h: 0.9, weight: 1 },
    { type: 'school bus', color: '#e8b21f', w: 1.12, h: 2.1, weight: 1 },
  ];
  const totalWeight = vehicles.reduce((sum, v) => sum + v.weight, 0);

  let width = 0, height = 0, lane = 0, roadX = 0, carW = 0, carH = 0, egoY = 0, treesFor = 0;
  let mode = 'ready'; // ready, running, paused, over
  let autopilot = false;
  let speed, distance, roadOffset, elapsed, spawnTimer, lastFreeLane, lastBlocked, egoLane = 1, egoX = 0;
  let sweep, planClock, hudClock, last = 0;
  let range = 1, fog = 0, rain = 0, night = 0;
  // Night is drawn on an offscreen layer so the headlight beam can be cut out of the darkness.
  const shade = document.createElement('canvas');
  const shadeCtx = shade.getContext('2d');
  let obstacles = [], trees = [], drops = [];
  let best = readBest();

  function readBest() {
    try { return Number(localStorage.getItem('uga-drive-best')) || 0; } catch { return 0; }
  }
  function saveBest(value) {
    try { localStorage.setItem('uga-drive-best', String(value)); } catch { /* storage unavailable */ }
  }
  const miles = px => px * METERS_PER_PX / 1609.34;
  const mph = pxPerSecond => pxPerSecond * METERS_PER_PX * 2.23694;
  const laneCenter = index => roadX + lane * (index + 0.5);
  const condition = () => conditions[Math.floor(elapsed / CONDITION_SECONDS) % conditions.length];
  const sensorRange = () => Math.max(0, egoY - 16) * range;
  const announce = text => { status.textContent = text; };

  function layout() {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = box.width;
    height = box.height;
    canvas.width = shade.width = Math.round(width * ratio);
    canvas.height = shade.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    shadeCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    lane = Math.max(72, Math.min(104, width * 0.2));
    roadX = (width - lane * LANES) / 2;
    carW = lane * 0.46;
    carH = carW * 1.85;
    egoY = height - carH - Math.max(24, height * 0.1);
    egoX = laneCenter(egoLane);
    for (const o of obstacles) sizeVehicle(o);
    if (treesFor !== width) plantTrees();
    draw();
  }

  function plantTrees() {
    treesFor = width;
    trees = [];
    const verge = roadX - 16;
    if (verge < 24) return;
    for (let y = -40; y < height + 40; y += 34) {
      for (const side of [0, 1]) if (Math.random() < 0.7) trees.push(placeTree({ side, y }));
    }
  }
  function placeTree(tree) {
    const verge = roadX - 16;
    tree.r = Math.min(verge / 2 - 2, 8 + Math.random() * 10);
    const offset = tree.r + 4 + Math.random() * Math.max(0, verge - 2 * tree.r - 4);
    tree.x = tree.side ? roadX + lane * LANES + 16 + offset : roadX - 16 - offset;
    return tree;
  }

  function sizeVehicle(o) {
    o.w = carW * o.kind.w;
    o.h = carH * o.kind.h;
  }
  function pickVehicle() {
    let roll = Math.random() * totalWeight;
    return vehicles.find(v => (roll -= v.weight) < 0) || vehicles[0];
  }

  function reset() {
    speed = 300;
    distance = 0;
    roadOffset = 0;
    elapsed = 0;
    spawnTimer = 0.5;
    lastFreeLane = null;
    lastBlocked = [];
    egoLane = 1;
    egoX = laneCenter(1);
    sweep = 0;
    planClock = 0;
    hudClock = 0;
    range = 1;
    fog = rain = night = 0;
    obstacles = [];
    drops = Array.from({ length: reducedMotion.matches ? 36 : 90 }, () => ({ x: Math.random() * width, y: Math.random() * height, l: 9 + Math.random() * 11 }));
  }

  // Traffic arrives in rows that block one or two of the three lanes, never all of them. A two-lane
  // block leaves open a lane the previous row also left open, and the row after it keeps that lane
  // open, so there is always a way through.
  function spawnRow() {
    const any = list => list[Math.floor(Math.random() * list.length)];
    let lanes;
    if (Math.random() < Math.min(0.55, 0.25 + elapsed / 160)) {
      const free = lastFreeLane ?? any([0, 1, 2].filter(l => !lastBlocked.includes(l)));
      lanes = [0, 1, 2].filter(l => l !== free);
      lastFreeLane = free;
    } else {
      lanes = [any([0, 1, 2].filter(l => l !== lastFreeLane))];
      lastFreeLane = null;
    }
    lastBlocked = lanes;
    for (const index of lanes) {
      const o = { lane: index, kind: pickVehicle(), jitter: Math.random() };
      sizeVehicle(o);
      o.y = -o.h - 12 - Math.random() * carH * 0.4;
      obstacles.push(o);
    }
  }

  function detected(o) {
    return o.y + o.h > egoY - sensorRange() && o.y < egoY + carH;
  }

  // Autopilot keeps its lane until detected traffic is too close, then moves to the clearer
  // adjacent lane. It cannot see past the sensor range, and it replans less often in bad weather.
  function drive() {
    if (planClock > 0) return;
    planClock = condition().plan;
    if (Math.abs(egoX - laneCenter(egoLane)) > lane * 0.25) return;
    const clearance = index => {
      let gap = Infinity;
      for (const o of obstacles) if (o.lane === index && detected(o)) gap = Math.min(gap, egoY - (o.y + o.h));
      return gap;
    };
    const beside = index => obstacles.some(o => o.lane === index && o.y + o.h > egoY - carH * 0.5 && o.y < egoY + carH * 1.15);
    const here = clearance(egoLane);
    if (here > speed * TRAFFIC * 0.65 + carH * 0.4) return;
    const options = [egoLane - 1, egoLane + 1].filter(l => l >= 0 && l < LANES && !beside(l) && clearance(l) > here);
    if (options.length) egoLane = options.sort((a, b) => clearance(b) - clearance(a))[0];
  }

  function crashed() {
    const inset = carW * 0.1;
    return obstacles.some(o => {
      const x = laneCenter(o.lane);
      return x + o.w * 0.45 > egoX - carW / 2 + inset && x - o.w * 0.45 < egoX + carW / 2 - inset && o.y + o.h * 0.96 > egoY + carH * 0.06 && o.y + o.h * 0.04 < egoY + carH * 0.94;
    });
  }

  function update(dt) {
    elapsed += dt;
    speed = Math.min(640, 300 + elapsed * 7);
    const now = condition();
    const ease = 1 - Math.exp(-dt * 2.5);
    range += (now.range - range) * ease;
    fog += ((now.fog || 0) - fog) * ease;
    rain += ((now.rain || 0) - rain) * ease;
    night += ((now.night || 0) - night) * ease;
    planClock = Math.max(0, planClock - dt);
    const step = speed * dt;
    distance += step;
    roadOffset = (roadOffset + step) % 56;
    for (const tree of trees) {
      tree.y += step;
      if (tree.y - tree.r > height) { tree.y -= height + 80; placeTree(tree); }
    }
    for (const o of obstacles) o.y += step * TRAFFIC;
    obstacles = obstacles.filter(o => o.y < height + 20);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnRow();
      spawnTimer = Math.max(0.72, 1.3 - elapsed * 0.006);
    }
    if (autopilot) drive();
    egoX += (laneCenter(egoLane) - egoX) * (1 - Math.exp(-dt * 16));
    if (!reducedMotion.matches) sweep += dt * 5;
    if (rain > 0.02) {
      for (const d of drops) {
        d.y += (900 + speed) * dt;
        d.x -= 60 * dt;
        if (d.y > height) { d.y = -d.l; d.x = Math.random() * (width + 60); }
      }
    }
    if (crashed()) crash();
  }

  function shape(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawVehicle(o) {
    const { w, h } = o;
    const x = laneCenter(o.lane) - w / 2, y = o.y;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    shape(x + 3, y + 5, w, h, w * 0.2);
    ctx.fill();
    if (o.kind.type === 'tractor') {
      ctx.fillStyle = '#16181b';
      ctx.fillRect(x - w * 0.08, y + h * 0.5, w * 0.24, h * 0.42);
      ctx.fillRect(x + w * 0.84, y + h * 0.5, w * 0.24, h * 0.42);
      ctx.fillRect(x + w * 0.08, y + h * 0.04, w * 0.14, h * 0.24);
      ctx.fillRect(x + w * 0.78, y + h * 0.04, w * 0.14, h * 0.24);
      ctx.fillStyle = o.kind.color;
      shape(x + w * 0.22, y, w * 0.56, h, 5);
      ctx.fill();
      ctx.fillStyle = '#2a2e24';
      ctx.fillRect(x + w * 0.3, y + h * 0.52, w * 0.4, h * 0.3);
      return;
    }
    ctx.fillStyle = o.kind.color;
    shape(x, y, w, h, Math.min(w * 0.2, 10));
    ctx.fill();
    ctx.fillStyle = '#1c1f23';
    if (o.kind.type === 'truck') {
      ctx.fillStyle = '#b9bfc6';
      shape(x, y, w, h * 0.22, 6);
      ctx.fill();
      ctx.fillStyle = '#1c1f23';
      ctx.fillRect(x + w * 0.15, y + h * 0.05, w * 0.7, h * 0.07);
      ctx.fillStyle = '#d3d7dc';
      ctx.fillRect(x + w * 0.08, y + h * 0.27, w * 0.84, h * 0.69);
      return;
    }
    if (o.kind.type === 'school bus') {
      ctx.fillRect(x + w * 0.12, y + h * 0.03, w * 0.76, h * 0.06);
      ctx.fillStyle = '#f6d36b';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + w * 0.2, y + h * (0.2 + i * 0.18), w * 0.6, h * 0.05);
      return;
    }
    shape(x + w * 0.14, y + h * 0.2, w * 0.72, h * 0.2, 4);
    ctx.fill();
    if (o.kind.type === 'pickup') {
      ctx.fillStyle = '#4f5862';
      ctx.fillRect(x + w * 0.12, y + h * 0.52, w * 0.76, h * 0.42);
    } else {
      shape(x + w * 0.16, y + h * 0.72, w * 0.68, h * 0.12, 3);
      ctx.fill();
    }
  }

  function drawEgo() {
    const x = egoX - carW / 2, y = egoY;
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    shape(x + 3, y + 5, carW, carH, carW * 0.22);
    ctx.fill();
    ctx.fillStyle = '#ba0c2f';
    shape(x, y, carW, carH, carW * 0.22);
    ctx.fill();
    ctx.fillStyle = '#16181b';
    shape(x + carW * 0.14, y + carH * 0.2, carW * 0.72, carH * 0.19, 4);
    ctx.fill();
    shape(x + carW * 0.16, y + carH * 0.74, carW * 0.68, carH * 0.11, 3);
    ctx.fill();
    ctx.fillStyle = '#fff4cc';
    ctx.fillRect(x + carW * 0.1, y + 1, carW * 0.22, 3);
    ctx.fillRect(x + carW * 0.68, y + 1, carW * 0.22, 3);
    // Roof-mounted LiDAR with a rotating sweep.
    const cx = egoX, cy = y + carH * 0.55;
    ctx.fillStyle = '#0d0f12';
    circle(cx, cy, carW * 0.17);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * carW * 0.15, cy + Math.sin(sweep) * carW * 0.15);
    ctx.stroke();
  }

  function beam(target) {
    const r = sensorRange(), spread = lane * 1.45;
    target.beginPath();
    target.moveTo(egoX - carW * 0.3, egoY + 6);
    target.lineTo(egoX - spread, egoY - r);
    target.lineTo(egoX + spread, egoY - r);
    target.lineTo(egoX + carW * 0.3, egoY + 6);
    target.closePath();
  }

  function drawSensor() {
    const r = sensorRange();
    const glow = ctx.createLinearGradient(0, egoY, 0, egoY - r);
    glow.addColorStop(0, 'rgba(255,255,255,.17)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    beam(ctx);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(roadX, egoY - r);
    ctx.lineTo(roadX + lane * LANES, egoY - r);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawDetection(o) {
    const x = laneCenter(o.lane) - o.w / 2 - 5, y = o.y - 5, w = o.w + 10, h = o.h + 10, c = Math.min(12, w / 3);
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(px + dx * c, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + dy * c);
    }
    ctx.stroke();
    const confidence = Math.min(0.99, 0.6 + 0.36 * range + o.jitter * 0.04);
    const label = `${o.kind.type} ${confidence.toFixed(2)}`;
    ctx.font = `600 13px ${font}`;
    const labelWidth = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(x, y - 20, labelWidth, 18);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 5, y - 11);
  }

  function drawWeather() {
    if (rain > 0.02) {
      ctx.fillStyle = `rgba(8,12,18,${0.2 * rain})`;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = `rgba(214,224,236,${0.5 * rain})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 3, d.y + d.l);
      }
      ctx.stroke();
    }
    if (fog > 0.02) {
      // Fog hides everything beyond the sensor range.
      const edge = egoY - sensorRange();
      const clear = edge + sensorRange() * 0.45;
      const haze = ctx.createLinearGradient(0, clear, 0, edge - 30);
      haze.addColorStop(0, 'rgba(222,226,231,0)');
      haze.addColorStop(1, `rgba(222,226,231,${0.97 * fog})`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, clear);
    }
    if (night > 0.02) {
      // Darkness everywhere except the headlight beam and a glow around the car.
      shadeCtx.globalCompositeOperation = 'source-over';
      shadeCtx.clearRect(0, 0, width, height);
      shadeCtx.fillStyle = `rgba(4,7,14,${0.88 * night})`;
      shadeCtx.fillRect(0, 0, width, height);
      shadeCtx.globalCompositeOperation = 'destination-out';
      const light = shadeCtx.createLinearGradient(0, egoY, 0, egoY - sensorRange());
      light.addColorStop(0, 'rgba(0,0,0,.95)');
      light.addColorStop(1, 'rgba(0,0,0,0)');
      shadeCtx.fillStyle = light;
      beam(shadeCtx);
      shadeCtx.fill();
      const cy = egoY + carH / 2;
      const halo = shadeCtx.createRadialGradient(egoX, cy, carH * 0.3, egoX, cy, carH * 1.3);
      halo.addColorStop(0, 'rgba(0,0,0,.9)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      shadeCtx.fillStyle = halo;
      shadeCtx.fillRect(egoX - carH * 1.4, cy - carH * 1.4, carH * 2.8, carH * 2.8);
      shadeCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(shade, 0, 0, width, height);
      // Tail lights stay visible in the dark.
      ctx.fillStyle = `rgba(255,64,64,${0.9 * night})`;
      for (const o of obstacles) {
        const x = laneCenter(o.lane) - o.w / 2;
        ctx.fillRect(x + o.w * 0.08, o.y + o.h - 4, o.w * 0.2, 3);
        ctx.fillRect(x + o.w * 0.72, o.y + o.h - 4, o.w * 0.2, 3);
      }
    }
  }

  function draw(flash = false) {
    if (!width) return;
    ctx.fillStyle = '#25322a';
    ctx.fillRect(0, 0, width, height);
    for (const t of trees) {
      ctx.fillStyle = '#1a261e';
      circle(t.x + 2, t.y + 3, t.r);
      ctx.fillStyle = '#2f4536';
      circle(t.x, t.y, t.r);
      ctx.fillStyle = '#3c5844';
      circle(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.45);
    }
    const roadWidth = lane * LANES;
    ctx.fillStyle = '#2a2d32';
    ctx.fillRect(roadX - 8, 0, roadWidth + 16, height);
    ctx.fillStyle = '#34373d';
    ctx.fillRect(roadX, 0, roadWidth, height);
    ctx.fillStyle = '#e6e9ed';
    ctx.fillRect(roadX + 4, 0, 3, height);
    ctx.fillRect(roadX + roadWidth - 7, 0, 3, height);
    for (let i = 1; i < LANES; i++) {
      for (let y = roadOffset - 56; y < height; y += 56) ctx.fillRect(roadX + lane * i - 1.5, y, 3, 26);
    }
    drawSensor();
    for (const o of obstacles) drawVehicle(o);
    drawEgo();
    for (const o of obstacles) if (detected(o)) drawDetection(o);
    drawWeather();
    if (flash) {
      ctx.fillStyle = 'rgba(186,12,47,.35)';
      ctx.fillRect(0, 0, width, height);
    }
  }

  function updateHud() {
    const now = condition();
    hud.distance.textContent = `${miles(distance).toFixed(2)} mi`;
    hud.speed.textContent = `${Math.round(mph(speed))} mph`;
    hud.condition.textContent = now.label;
    hud.condition.classList.toggle('is-alert', now.name !== 'Clear');
    hud.mode.textContent = autopilot ? (now.name === 'Clear' ? 'Autopilot driving' : 'Autopilot · be ready to take over') : 'You are driving';
    hud.mode.classList.toggle('is-alert', autopilot && now.name !== 'Clear');
  }

  function syncAutopilot() {
    autopilotButton.setAttribute('aria-pressed', String(autopilot));
    autopilotButton.textContent = autopilot ? 'Autopilot on' : 'Autopilot off';
    if (speed !== undefined) updateHud();
  }
  function toggleAutopilot() {
    autopilot = !autopilot;
    syncAutopilot();
    announce(autopilot ? 'Autopilot on.' : 'Autopilot off. You are driving.');
  }
  function steer(direction) {
    if (mode !== 'running') return;
    if (autopilot) {
      autopilot = false;
      syncAutopilot();
      announce('You took over from autopilot.');
    }
    egoLane = Math.max(0, Math.min(LANES - 1, egoLane + direction));
  }

  function showOverlay(title, action, note) {
    message.textContent = title;
    detail.textContent = note;
    startButton.textContent = action;
    overlay.hidden = false;
    if (game.contains(document.activeElement)) startButton.focus({ preventScroll: true });
  }
  function start() {
    if (mode === 'running') return;
    if (mode !== 'paused') reset();
    mode = 'running';
    overlay.hidden = true;
    last = 0;
    updateHud();
    canvas.focus({ preventScroll: true });
    announce(autopilot ? 'Driving on autopilot.' : 'Driving. Use the left and right arrow keys to change lanes.');
    requestAnimationFrame(loop);
  }
  function pause() {
    if (mode !== 'running') return;
    mode = 'paused';
    showOverlay('Paused', 'Resume', `${miles(distance).toFixed(2)} mi so far.`);
    announce('Paused.');
  }
  function crash() {
    mode = 'over';
    const reached = miles(distance);
    const record = reached > best;
    if (record) { best = reached; saveBest(best); }
    const now = condition();
    const cause = now.name === 'Clear' ? '' : ` in ${now.name.toLowerCase()}`;
    const title = record ? `New best: ${reached.toFixed(2)} mi` : `Crashed at ${reached.toFixed(2)} mi`;
    const note = `${autopilot ? 'Autopilot crashed' : 'You crashed'}${cause} at ${Math.round(mph(speed))} mph. Best: ${best.toFixed(2)} mi.`;
    updateHud();
    draw(true);
    showOverlay(title, 'Drive again', note);
    announce(`${title}. ${note}`);
  }
  function loop(time) {
    if (mode !== 'running') return;
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
    last = time;
    update(dt);
    if (mode !== 'running') return;
    draw();
    hudClock += dt;
    if (hudClock > 0.1) { hudClock = 0; updateHud(); }
    requestAnimationFrame(loop);
  }

  startButton.addEventListener('click', start);
  autopilotButton.addEventListener('click', toggleAutopilot);
  for (const button of game.querySelectorAll('[data-steer]')) button.addEventListener('click', () => steer(Number(button.dataset.steer)));
  canvas.addEventListener('pointerdown', event => {
    const box = canvas.getBoundingClientRect();
    steer(event.clientX - box.left < box.width / 2 ? -1 : 1);
  });
  game.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || !event.target.closest('.drive-game-stage')) return;
    const key = event.key.toLowerCase();
    if (event.target.closest('button') && (key === ' ' || key === 'enter')) return;
    if (key === 't') toggleAutopilot();
    else if (key === ' ' && event.target === canvas) mode === 'running' ? pause() : start();
    else if ((key === 'p' || key === 'escape') && mode === 'running') pause();
    else if (mode === 'running' && (key === 'arrowleft' || key === 'a')) steer(-1);
    else if (mode === 'running' && (key === 'arrowright' || key === 'd')) steer(1);
    else return;
    event.preventDefault();
  });
  new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting) pause();
  }, { threshold: 0.25 }).observe(screen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  new ResizeObserver(layout).observe(canvas);

  // A still first frame: a little traffic ahead and the best distance so far.
  reset();
  layout();
  for (const [index, kind, share] of [[0, vehicles[0], 0.12], [2, vehicles[2], 0.02], [1, vehicles[1], -0.2]]) {
    const o = { lane: index, kind, jitter: 0.5 };
    sizeVehicle(o);
    o.y = height * share;
    obstacles.push(o);
  }
  draw();
  if (best) detail.textContent = `Your best: ${best.toFixed(2)} mi.`;
})();
