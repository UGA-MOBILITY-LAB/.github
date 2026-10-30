// A small driving game at the foot of the home page. Change lanes and set your speed on a rural Georgia
// road: slower farm and school traffic ahead, faster cars coming up from behind, and rain, fog, and
// nightfall that shrink what the front and rear sensors can see. Autopilot can drive (speed and lanes)
// until it struggles. The game starts only when asked, pauses when scrolled away, and handles keys only
// while it has focus.
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
  const shareButton = game.querySelector('.drive-game-share');
  const autopilotButton = game.querySelector('.drive-game-autopilot');
  const status = game.querySelector('.drive-game-status');
  const hud = {};
  for (const item of game.querySelectorAll('[data-hud]')) hud[item.dataset.hud] = item;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const font = getComputedStyle(game).fontFamily;

  const LANES = 3;
  const METERS_PER_PX = 0.06; // on screen, 1 px is 6 cm of road
  const MPH = 1 / (METERS_PER_PX * 2.23694); // px/s per mph
  const SPEED = { min: 20 * MPH, max: 90 * MPH, start: 45 * MPH, accel: 7 * MPH, brake: 18 * MPH };
  const CONDITION_SECONDS = 9;
  // Each condition scales the sensor range; autopilot also plans less often and drives slower.
  const conditions = [
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08, cruise: 62 },
    { name: 'Rain', label: 'Rain · sensors 62%', range: 0.62, plan: 0.2, cruise: 52, rain: 1, phrase: ' in the rain' },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08, cruise: 62 },
    { name: 'Fog', label: 'Fog · sensors 36%', range: 0.36, plan: 0.34, cruise: 42, fog: 1, phrase: ' in fog' },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08, cruise: 62 },
    { name: 'Night', label: 'Night · sensors 55%', range: 0.55, plan: 0.16, cruise: 52, night: 1, phrase: ' at night' },
  ];
  // Natural speeds in mph: farm and school traffic is slow, cars and pickups often faster than you.
  const vehicles = [
    { type: 'car', color: '#d9dde2', w: 1, h: 1, weight: 5, mph: [50, 80] },
    { type: 'pickup', color: '#6f7a86', w: 1.04, h: 1.14, weight: 3, mph: [45, 70] },
    { type: 'truck', color: '#eef0f2', w: 1.12, h: 1.9, weight: 2, mph: [40, 55] },
    { type: 'tractor', color: '#7a8b3c', w: 1.08, h: 0.9, weight: 1, mph: [15, 22] },
    { type: 'school bus', color: '#e8b21f', w: 1.12, h: 2.1, weight: 1, mph: [30, 40] },
  ];
  const totalWeight = vehicles.reduce((sum, v) => sum + v.weight, 0);

  let width = 0, height = 0, lane = 0, roadX = 0, carW = 0, carH = 0, egoY = 0, treesFor = 0;
  let mode = 'ready'; // ready, running, paused, over
  let autopilot = false;
  let speed = SPEED.start, distance, roadOffset, elapsed, spawnTimer, egoLane = 1, egoX = 0;
  let sweep, planClock, hudClock, last = 0, alongside = [false, false], autoBraking = false;
  let range = 1, fog = 0, rain = 0, night = 0;
  // Night is drawn on an offscreen layer so the headlight beam can be cut out of the darkness.
  const shade = document.createElement('canvas');
  const shadeCtx = shade.getContext('2d');
  let obstacles = [], trees = [], drops = [];
  const pedals = { faster: new Set(), slower: new Set() };
  let best = readBest();
  let lastRun = null;

  function readBest() {
    try { return Number(localStorage.getItem('uga-drive-best')) || 0; } catch { return 0; }
  }
  function saveBest(value) {
    try { localStorage.setItem('uga-drive-best', String(value)); } catch { /* storage unavailable */ }
  }
  const miles = px => px * METERS_PER_PX / 1609.34;
  const mph = pxPerSecond => pxPerSecond / MPH;
  const laneCenter = index => roadX + lane * (index + 0.5);
  const condition = () => conditions[Math.floor(elapsed / CONDITION_SECONDS) % conditions.length];
  const frontRange = () => Math.max(0, egoY - 16) * range;
  const rearRange = () => 460 * range; // px behind your rear bumper, mostly off-screen
  const egoBack = () => egoY + carH;
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
    // Your car sits above the bottom edge so traffic coming up from behind is visible.
    egoY = Math.round(height * 0.58);
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
    speed = SPEED.start;
    distance = 0;
    roadOffset = 0;
    elapsed = 0;
    spawnTimer = 0.4;
    egoLane = 1;
    egoX = laneCenter(1);
    sweep = 0;
    planClock = 0;
    hudClock = 0;
    range = 1;
    fog = rain = night = 0;
    obstacles = [];
    alongside = [false, false];
    autoBraking = false;
    releasePedals();
    drops = Array.from({ length: reducedMotion.matches ? 36 : 90 }, () => ({ x: Math.random() * width, y: Math.random() * height, l: 9 + Math.random() * 11 }));
  }

  // New traffic appears ahead if it is slower than you and behind if it is faster, so you meet it
  // either way. It never fills all three lanes near the top of the road at once.
  function spawn() {
    const kind = pickVehicle();
    const desired = (kind.mph[0] + Math.random() * (kind.mph[1] - kind.mph[0])) * MPH;
    if (Math.abs(desired - speed) < 4 * MPH) return;
    const ahead = desired < speed;
    const o = { kind, jitter: Math.random(), v: desired, desired };
    sizeVehicle(o);
    // Faster traffic starts far enough behind to brake for you if it has to.
    const closing = Math.max(0, desired - speed);
    o.y = ahead ? -o.h - 20 - Math.random() * 60 : height + 40 + Math.min(560, closing * closing / 220) + Math.random() * 60;
    const crowdedTop = new Set(obstacles.filter(x => x.y < height * 0.3).map(x => x.lane));
    const lanes = [0, 1, 2].filter(index => {
      if (ahead && !crowdedTop.has(index) && crowdedTop.size >= 2) return false;
      return !obstacles.some(x => x.lane === index && x.y < o.y + o.h + carH * 1.5 && x.y + x.h > o.y - carH * 1.5);
    });
    if (!lanes.length) return;
    o.lane = lanes[Math.floor(Math.random() * lanes.length)];
    obstacles.push(o);
  }

  // Traffic keeps its lane and follows whatever is ahead of it, you included, with the Intelligent
  // Driver Model. It does not ram you on purpose, but it cannot stop instantly if you cut in or brake.
  const egoLaneNow = () => Math.max(0, Math.min(LANES - 1, Math.round((egoX - roadX) / lane - 0.5)));
  function idm(v, desired, gap, dv) {
    const a = 70, b = 140;
    const wanted = 14 + v * 0.9 + v * dv / (2 * Math.sqrt(a * b));
    return a * (1 - (v / desired) ** 4 - (wanted / Math.max(gap, 1)) ** 2);
  }
  function moveTraffic(dt) {
    const youLane = egoLaneNow();
    for (const o of obstacles) {
      let gap = Infinity, leadV = o.v;
      for (const other of obstacles) {
        if (other === o || other.lane !== o.lane || other.y >= o.y) continue;
        const g = o.y - (other.y + other.h);
        if (g < gap) { gap = g; leadV = other.v; }
      }
      if (o.lane === youLane && egoY < o.y) {
        const g = o.y - egoBack();
        if (g < gap) { gap = g; leadV = speed; }
      }
      const acc = Math.max(-160, idm(o.v, o.desired, gap, o.v - leadV));
      o.v = Math.max(0, o.v + acc * dt);
    }
    for (const o of obstacles) o.y += (speed - o.v) * dt;
    obstacles = obstacles.filter(o => o.y < height + 720 && o.y > -620);
  }

  function detected(o) {
    const ahead = o.y + o.h > egoY - frontRange() && o.y < egoY;
    const behind = o.y >= egoY && o.y < egoBack() + rearRange();
    return ahead || behind;
  }

  // Autopilot: cruise at a weather-dependent speed, follow detected traffic ahead, and change lanes only
  // when its sensors show the target lane clear ahead and behind. It cannot see past its sensor range.
  function drive(dt) {
    const now = condition();
    const target = now.cruise * MPH;
    let gap = Infinity, leadV = target;
    for (const o of obstacles) {
      if (o.lane !== egoLane || o.y >= egoY || !detected(o)) continue;
      const g = egoY - (o.y + o.h);
      if (g < gap) { gap = g; leadV = o.v; }
    }
    const acc = Math.max(-SPEED.brake * (1 - 0.3 * rain), Math.min(SPEED.accel, idm(speed, target, gap, speed - leadV)));
    autoBraking = acc < -SPEED.accel * 0.5;
    speed = Math.max(SPEED.min, Math.min(SPEED.max, speed + acc * dt));
    if (planClock > 0 || Math.abs(egoX - laneCenter(egoLane)) > lane * 0.25) return;
    planClock = now.plan;
    if (gap > carH * 3 || leadV > target - 6 * MPH) return;
    const clear = index => obstacles.every(o => {
      if (o.lane !== index || !detected(o)) return true;
      if (o.y + o.h < egoY) return egoY - (o.y + o.h) > carH * 2.2 && o.v >= speed - 10 * MPH;
      if (o.y > egoBack()) return o.y - egoBack() > carH * 1.2 + Math.max(0, o.v - speed) * 1.4;
      return false;
    });
    const options = [egoLane - 1, egoLane + 1].filter(l => l >= 0 && l < LANES && clear(l));
    if (options.length) egoLane = options[Math.floor(Math.random() * options.length)];
  }

  function hit() {
    const inset = carW * 0.1;
    return obstacles.find(o => {
      const x = laneCenter(o.lane);
      return x + o.w * 0.45 > egoX - carW / 2 + inset && x - o.w * 0.45 < egoX + carW / 2 - inset && o.y + o.h * 0.96 > egoY + carH * 0.06 && o.y + o.h * 0.04 < egoY + carH * 0.94;
    });
  }

  function update(dt) {
    elapsed += dt;
    const now = condition();
    const ease = 1 - Math.exp(-dt * 2.5);
    range += (now.range - range) * ease;
    fog += ((now.fog || 0) - fog) * ease;
    rain += ((now.rain || 0) - rain) * ease;
    night += ((now.night || 0) - night) * ease;
    planClock = Math.max(0, planClock - dt);
    if (autopilot) drive(dt);
    else {
      // You hold your speed unless you press the accelerator or the brake.
      if (pedals.slower.size) speed -= SPEED.brake * (1 - 0.3 * rain) * dt;
      else if (pedals.faster.size) speed += SPEED.accel * dt;
      speed = Math.max(SPEED.min, Math.min(SPEED.max, speed));
    }
    const step = speed * dt;
    distance += step;
    roadOffset = (roadOffset + step) % 56;
    for (const tree of trees) {
      tree.y += step;
      if (tree.y - tree.r > height) { tree.y -= height + 80; placeTree(tree); }
    }
    moveTraffic(dt);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = Math.max(0.45, 1.05 - elapsed * 0.004);
    }
    egoX += (laneCenter(egoLane) - egoX) * (1 - Math.exp(-dt * 16));
    const here = egoLaneNow();
    alongside = [-1, 1].map(side => obstacles.some(o => o.lane === here + side && o.y + o.h > egoY - carH * 0.4 && o.y < egoBack() + carH * 0.6));
    if (!reducedMotion.matches) sweep += dt * 5;
    if (rain > 0.02) {
      for (const d of drops) {
        d.y += (900 + speed) * dt;
        d.x -= 60 * dt;
        if (d.y > height) { d.y = -d.l; d.x = Math.random() * (width + 60); }
      }
    }
    const crashed = hit();
    if (crashed) crash(crashed);
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
    if (y > height + 4 || y + h < -4) return;
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
    // Brake lights while slowing down.
    const braking = mode === 'running' && (autopilot ? autoBraking : pedals.slower.size > 0);
    ctx.fillStyle = braking ? '#ff3b3b' : '#7d0a20';
    ctx.fillRect(x + carW * 0.1, y + carH - 4, carW * 0.24, 3);
    ctx.fillRect(x + carW * 0.66, y + carH - 4, carW * 0.24, 3);
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
    // Blind-spot warnings: a car alongside in the next lane.
    ctx.fillStyle = '#ffb020';
    alongside.forEach((warn, i) => {
      if (!warn) return;
      const side = i === 0 ? x - 7 : x + carW + 7;
      ctx.beginPath();
      ctx.moveTo(side, y + carH * 0.28);
      ctx.lineTo(side + (i === 0 ? -6 : 6), y + carH * 0.4);
      ctx.lineTo(side, y + carH * 0.52);
      ctx.closePath();
      ctx.fill();
    });
  }

  function beam(target) {
    const r = frontRange(), spread = lane * 1.45;
    target.beginPath();
    target.moveTo(egoX - carW * 0.3, egoY + 6);
    target.lineTo(egoX - spread, egoY - r);
    target.lineTo(egoX + spread, egoY - r);
    target.lineTo(egoX + carW * 0.3, egoY + 6);
    target.closePath();
  }

  function drawSensor() {
    const r = frontRange();
    const glow = ctx.createLinearGradient(0, egoY, 0, egoY - r);
    glow.addColorStop(0, 'rgba(255,255,255,.17)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    beam(ctx);
    ctx.fill();
    // A fainter rear sensor field.
    const back = egoBack(), rr = Math.min(rearRange(), height - back);
    if (rr > 4) {
      const rearGlow = ctx.createLinearGradient(0, back, 0, back + rr);
      rearGlow.addColorStop(0, 'rgba(255,255,255,.1)');
      rearGlow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rearGlow;
      ctx.beginPath();
      ctx.moveTo(egoX - carW * 0.3, back - 4);
      ctx.lineTo(egoX - lane * 1.2, back + rr);
      ctx.lineTo(egoX + lane * 1.2, back + rr);
      ctx.lineTo(egoX + carW * 0.3, back - 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(roadX, egoY - r);
    ctx.lineTo(roadX + lane * LANES, egoY - r);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Rear radar: a chevron at the bottom of a lane when traffic is closing in from off-screen behind.
  function drawRadar() {
    for (const o of obstacles) {
      if (o.y < height || o.v <= speed || o.y > egoBack() + rearRange()) continue;
      const urgency = 1 - (o.y - height) / Math.max(1, egoBack() + rearRange() - height);
      const cx = laneCenter(o.lane), by = height - 10;
      ctx.fillStyle = `rgba(255,59,59,${0.35 + 0.6 * Math.max(0, urgency)})`;
      ctx.beginPath();
      ctx.moveTo(cx - 12, by);
      ctx.lineTo(cx, by - 12);
      ctx.lineTo(cx + 12, by);
      ctx.lineTo(cx, by - 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawDetection(o) {
    if (o.y > height || o.y + o.h < 0) return;
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
    const label = `${o.kind.type} ${Math.round(mph(o.v))} mph`;
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
      // Fog hides everything beyond the sensor range, ahead and behind.
      const edge = egoY - frontRange();
      const clear = edge + frontRange() * 0.45;
      const haze = ctx.createLinearGradient(0, clear, 0, edge - 30);
      haze.addColorStop(0, 'rgba(222,226,231,0)');
      haze.addColorStop(1, `rgba(222,226,231,${0.97 * fog})`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, clear);
      const behind = egoBack() + 12;
      const rearHaze = ctx.createLinearGradient(0, behind, 0, height);
      rearHaze.addColorStop(0, 'rgba(222,226,231,0)');
      rearHaze.addColorStop(1, `rgba(222,226,231,${0.85 * fog})`);
      ctx.fillStyle = rearHaze;
      ctx.fillRect(0, behind, width, height - behind);
    }
    if (night > 0.02) {
      // Darkness everywhere except the headlight beam and a glow around the car.
      shadeCtx.globalCompositeOperation = 'source-over';
      shadeCtx.clearRect(0, 0, width, height);
      shadeCtx.fillStyle = `rgba(4,7,14,${0.88 * night})`;
      shadeCtx.fillRect(0, 0, width, height);
      shadeCtx.globalCompositeOperation = 'destination-out';
      const light = shadeCtx.createLinearGradient(0, egoY, 0, egoY - frontRange());
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
      // Other cars' lights stay visible in the dark: tail lights ahead, headlights behind.
      for (const o of obstacles) {
        const x = laneCenter(o.lane) - o.w / 2;
        if (o.y < egoY) {
          ctx.fillStyle = `rgba(255,64,64,${0.9 * night})`;
          ctx.fillRect(x + o.w * 0.08, o.y + o.h - 4, o.w * 0.2, 3);
          ctx.fillRect(x + o.w * 0.72, o.y + o.h - 4, o.w * 0.2, 3);
        } else {
          ctx.fillStyle = `rgba(255,244,204,${0.9 * night})`;
          ctx.fillRect(x + o.w * 0.08, o.y + 1, o.w * 0.22, 3);
          ctx.fillRect(x + o.w * 0.7, o.y + 1, o.w * 0.22, 3);
        }
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
    drawRadar();
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
    if (distance !== undefined) updateHud();
  }
  function toggleAutopilot() {
    autopilot = !autopilot;
    syncAutopilot();
    announce(autopilot ? 'Autopilot on.' : 'Autopilot off. You are driving.');
  }
  function takeOver() {
    if (!autopilot) return;
    autopilot = false;
    syncAutopilot();
    announce('You took over from autopilot.');
  }
  function steer(direction) {
    if (mode !== 'running') return;
    takeOver();
    egoLane = Math.max(0, Math.min(LANES - 1, egoLane + direction));
  }
  // Speed pedals are held: by key, by the on-screen buttons, or briefly by a keyboard click on a button.
  function press(name, source) {
    if (mode !== 'running') return;
    takeOver();
    pedals[name].add(source);
  }
  function lift(name, source) { pedals[name].delete(source); }
  function releasePedals() {
    pedals.faster.clear();
    pedals.slower.clear();
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
    shareButton.hidden = true;
    last = 0;
    updateHud();
    canvas.focus({ preventScroll: true });
    announce(autopilot ? 'Driving on autopilot.' : 'Driving. Left and right arrow keys change lanes; up and down change speed.');
    requestAnimationFrame(loop);
  }
  function pause() {
    if (mode !== 'running') return;
    mode = 'paused';
    releasePedals();
    showOverlay('Paused', 'Resume', `${miles(distance).toFixed(2)} mi so far.`);
    announce('Paused.');
  }
  function crash(other) {
    mode = 'over';
    releasePedals();
    const reached = miles(distance);
    const record = reached > best;
    if (record) { best = reached; saveBest(best); }
    const now = condition();
    const who = autopilot ? 'Autopilot' : 'You';
    const changingLanes = other.lane !== egoLaneNow() || Math.abs(egoX - laneCenter(egoLane)) > lane * 0.2;
    const what = changingLanes ? `${who} side-swiped a ${other.kind.type}`
      : other.y > egoY + carH * 0.45 ? `A ${other.kind.type} hit ${autopilot ? 'the car' : 'you'} from behind`
      : `${who} hit a ${other.kind.type}`;
    const title = record ? `New best: ${reached.toFixed(2)} mi` : `Crashed at ${reached.toFixed(2)} mi`;
    const note = `${what}${now.phrase || ''} at ${Math.round(mph(speed))} mph. Best: ${best.toFixed(2)} mi.`;
    lastRun = { miles: reached, phrase: now.phrase || '', autopilot };
    updateHud();
    draw(true);
    shareButton.hidden = false;
    shareButton.textContent = 'Share score';
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
  // Share a run with the system share sheet where there is one, otherwise copy it.
  shareButton.addEventListener('click', async () => {
    if (!lastRun) return;
    const url = new URL('#drive-game', document.querySelector('link[rel=canonical]')?.href || location.href).href;
    const text = `${lastRun.autopilot ? 'Autopilot drove' : 'I drove'} ${lastRun.miles.toFixed(2)} mi${lastRun.phrase} in the UGA Mobility Lab driving game. Can you out-drive the autopilot?`;
    const flash = label => {
      shareButton.textContent = label;
      setTimeout(() => { shareButton.textContent = 'Share score'; }, 2500);
    };
    try {
      if (navigator.share) await navigator.share({ title: 'Can you out-drive the autopilot?', text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        flash('Copied to clipboard');
        announce('Score copied to the clipboard.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') flash('Could not share');
    }
  });
  autopilotButton.addEventListener('click', toggleAutopilot);
  for (const button of game.querySelectorAll('[data-steer]')) button.addEventListener('click', () => steer(Number(button.dataset.steer)));
  for (const button of game.querySelectorAll('[data-speed]')) {
    const name = Number(button.dataset.speed) > 0 ? 'faster' : 'slower';
    let pointer = false, downAt = 0;
    button.addEventListener('pointerdown', () => { pointer = true; downAt = performance.now(); press(name, 'button'); });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      button.addEventListener(type, () => {
        if (!pointer) return;
        pointer = false;
        // A quick tap still counts as a short press.
        setTimeout(() => lift(name, 'button'), Math.max(0, 400 - (performance.now() - downAt)));
      });
    }
    button.addEventListener('click', event => {
      if (event.detail) return; // a pointer press already held the pedal
      press(name, 'tap'); // keyboard activation: a short press
      setTimeout(() => lift(name, 'tap'), 400);
    });
  }
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
    else if (mode === 'running' && (key === 'arrowup' || key === 'w')) press('faster', 'key');
    else if (mode === 'running' && (key === 'arrowdown' || key === 's')) press('slower', 'key');
    else return;
    event.preventDefault();
  });
  game.addEventListener('keyup', event => {
    const key = event.key.toLowerCase();
    if (key === 'arrowup' || key === 'w') lift('faster', 'key');
    if (key === 'arrowdown' || key === 's') lift('slower', 'key');
  });
  // Losing focus releases keys held on the canvas; on-screen buttons keep their own press.
  canvas.addEventListener('blur', () => { lift('faster', 'key'); lift('slower', 'key'); });
  new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting) pause();
  }, { threshold: 0.25 }).observe(screen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  new ResizeObserver(layout).observe(canvas);

  // A still first frame: slower traffic ahead, a faster car coming up behind, and the best distance.
  reset();
  layout();
  for (const [index, kind, share, mphNow] of [[0, vehicles[0], 0.08, 40], [2, vehicles[2], -0.04, 45], [1, vehicles[3], 0.16, 18], [2, vehicles[1], 0.86, 62]]) {
    const o = { lane: index, kind, jitter: 0.5, v: mphNow * MPH, desired: mphNow * MPH };
    sizeVehicle(o);
    o.y = height * share;
    obstacles.push(o);
  }
  draw();
  if (best) detail.textContent = `Your best: ${best.toFixed(2)} mi.`;
})();
