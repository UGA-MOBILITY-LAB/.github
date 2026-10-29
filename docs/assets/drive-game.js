// A small driving game at the foot of the home page, in two modes. Dodge traffic: steer a UGA research
// vehicle between lanes. Follow the leader: hold a safe gap behind a car that speeds up and brakes.
// Rain, fog, and nightfall shrink what the sensors can see, and autopilot (lane changes, or adaptive
// cruise control when following) can drive until it struggles. The game starts only when asked,
// pauses when scrolled away, and handles keys only while it has focus.
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
  const playButtons = [...game.querySelectorAll('[data-play]')];
  const pedalButtons = [...game.querySelectorAll('[data-pedal]')];
  const pedalGroup = game.querySelector('.drive-game-pedals');
  const leftButton = game.querySelector('[data-steer="-1"]');
  const rightButton = game.querySelector('[data-steer="1"]');
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
    { name: 'Rain', label: 'Rain · sensors 62%', range: 0.62, plan: 0.2, rain: 1, phrase: ' in the rain' },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08 },
    { name: 'Fog', label: 'Fog · sensors 36%', range: 0.36, plan: 0.34, fog: 1, phrase: ' in fog' },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08 },
    { name: 'Night', label: 'Night · sensors 55%', range: 0.55, plan: 0.16, night: 1, phrase: ' at night' },
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
  let play = 'dodge'; // dodge or follow
  let pedal = 'one'; // one-pedal (strong regenerative braking) or two-pedal (coasting)
  let autopilot = false;
  let speed, distance, roadOffset, elapsed, spawnTimer, lastFreeLane, lastBlocked, egoLane = 1, egoX = 0;
  let sweep, planClock, hudClock, last = 0;
  let range = 1, fog = 0, rain = 0, night = 0;
  // Night is drawn on an offscreen layer so the headlight beam can be cut out of the darkness.
  const shade = document.createElement('canvas');
  const shadeCtx = shade.getContext('2d');
  let obstacles = [], trees = [], drops = [];
  const bestKeys = { dodge: 'uga-drive-best', follow: 'uga-follow-best' };
  const best = { dodge: readBest('dodge'), follow: readBest('follow') };
  let lastRun = null;

  function readBest(which) {
    try { return Number(localStorage.getItem(bestKeys[which])) || 0; } catch { return 0; }
  }
  function saveBest(which, value) {
    try { localStorage.setItem(bestKeys[which], String(value)); } catch { /* storage unavailable */ }
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
    if (play === 'follow') resetFollow();
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
    const now = condition();
    const ease = 1 - Math.exp(-dt * 2.5);
    range += (now.range - range) * ease;
    fog += ((now.fog || 0) - fog) * ease;
    rain += ((now.rain || 0) - rain) * ease;
    night += ((now.night || 0) - night) * ease;
    planClock = Math.max(0, planClock - dt);
    if (play === 'follow') return updateFollow(dt);
    speed = Math.min(640, 300 + elapsed * 7);
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

  // ---- Follow the leader ------------------------------------------------------------
  // A chase view from behind your car. Keep the lead car between 1 and 3 seconds ahead (the white band
  // on the road). Distances are in metres and speeds in metres per second; the view compresses depth
  // so a realistic gap still reads clearly.
  const CAMERA = 2.4, BEHIND = 6.5, DEPTH = 0.55, CAR = 4.5, SENSOR = 150;
  let follow = null;
  const pedals = { throttle: new Set(), brake: new Set() };
  function press(name, source) {
    if (mode !== 'running' || play !== 'follow') return;
    takeOver();
    pedals[name].add(source);
  }
  function lift(name, source) { pedals[name].delete(source); }
  function tap(name) {
    press(name, 'tap');
    setTimeout(() => lift(name, 'tap'), 350);
  }
  function releasePedals() {
    pedals.throttle.clear();
    pedals.brake.clear();
  }
  function sprout(tree) {
    tree.x = (Math.random() < 0.5 ? -1 : 1) * (8.5 + Math.random() * 26);
    tree.h = 5 + Math.random() * 8;
    tree.dark = Math.random() < 0.5;
    return tree;
  }
  function resetFollow() {
    follow = {
      v: 20, a: 0, gap: 40, travelled: 0, pocket: 0, lost: 0, seenGap: 40, seenLead: 20,
      lead: { v: 20, a: 0, target: 22, next: 4, brakeIn: 8, braking: 0, decel: 0 },
      trees: Array.from({ length: 70 }, (_, i) => sprout({ z: 4 + i * 4.3 })),
    };
  }

  // Adaptive cruise control: the Intelligent Driver Model on what the sensor last reported. It only
  // sees the lead within the (weather-shortened) sensor range and updates less often in bad weather.
  function cruise(brakeMax) {
    const f = follow;
    if (planClock <= 0) {
      planClock = condition().plan;
      const visible = f.gap <= SENSOR * range;
      f.seenGap = visible ? f.gap : Infinity;
      f.seenLead = visible ? f.lead.v : f.v;
    }
    const v = f.v, a = 1.4, b = 2.8;
    const desired = 5 + v * 1.7 + v * (v - f.seenLead) / (2 * Math.sqrt(a * b));
    const spacing = Number.isFinite(f.seenGap) ? (desired / Math.max(f.seenGap, 0.5)) ** 2 : 0;
    return Math.max(-brakeMax, Math.min(2.6, a * (1 - (v / 29) ** 4 - spacing)));
  }

  function updateFollow(dt) {
    const f = follow, lead = f.lead;
    // The lead car changes speed every few seconds and sometimes brakes hard, more often over time.
    lead.next -= dt;
    if (lead.next <= 0) { lead.target = 12 + Math.random() * 18; lead.next = 3.5 + Math.random() * 4; }
    lead.brakeIn -= dt;
    if (lead.brakeIn <= 0) {
      lead.braking = 0.8 + Math.random() * 1.6;
      lead.decel = 4 + Math.random() * 2.5 + Math.min(1.5, elapsed / 100);
      lead.brakeIn = Math.max(4.5, 12 - elapsed * 0.05) + Math.random() * 5;
    }
    if (lead.braking > 0) { lead.braking -= dt; lead.a = -lead.decel; }
    else lead.a = Math.max(-2.2, Math.min(1.3, (lead.target - lead.v) * 0.6));
    lead.v = Math.max(0, Math.min(33, lead.v + lead.a * dt));
    // Your car: accelerator or brake, otherwise the pedal feel (regenerative braking or coasting).
    const brakeMax = 6.5 * (1 - 0.3 * rain);
    let a;
    if (autopilot) a = cruise(brakeMax);
    else if (pedals.brake.size) a = -brakeMax;
    else if (pedals.throttle.size) a = 2.6 * (1 - (f.v / 38) ** 2);
    else a = pedal === 'one' ? -1.9 : -0.35;
    f.v = Math.max(0, Math.min(38, f.v + a * dt));
    f.a = a;
    f.gap += (lead.v - f.v) * dt;
    f.travelled += f.v * dt;
    for (const tree of f.trees) {
      tree.z -= f.v * dt;
      if (tree.z < 2) { tree.z += 300; sprout(tree); }
    }
    const headway = f.gap / Math.max(f.v, 0.5);
    if (headway >= 1 && headway <= 3 && f.gap > 2) f.pocket += f.v * dt;
    f.lost = f.gap > 150 ? f.lost + dt : 0;
    if (!reducedMotion.matches) sweep += dt * 5;
    if (rain > 0.02) {
      for (const d of drops) {
        d.y += (900 + f.v * 25) * dt;
        d.x -= 60 * dt;
        if (d.y > height) { d.y = -d.l; d.x = Math.random() * (width + 60); }
      }
    }
    if (f.gap <= 0) crash();
    else if (f.lost > 5) crash('lost');
  }

  function drawRain() {
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

  function drawFollow(flash) {
    const f = follow, lead = f.lead;
    const horizon = height * 0.36, focal = height * 1.15;
    // d is metres ahead of your rear bumper; z is the compressed depth from the camera.
    const depth = d => BEHIND + d * DEPTH;
    const sy = d => horizon + focal * CAMERA / depth(d);
    const sx = (x, d) => width / 2 + focal * x / depth(d);
    const top = (d, h) => horizon + focal * (CAMERA - h) / depth(d);
    const quad = (x0, x1, d0, d1, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sx(x0, d0), sy(d0));
      ctx.lineTo(sx(x0, d1), sy(d1));
      ctx.lineTo(sx(x1, d1), sy(d1));
      ctx.lineTo(sx(x1, d0), sy(d0));
      ctx.closePath();
      ctx.fill();
    };
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#b4c1cd');
    sky.addColorStop(1, '#e2e7ec');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    ctx.fillStyle = '#2b3a30';
    ctx.fillRect(0, horizon, width, height - horizon);
    const near = -BEHIND / DEPTH + 0.5, far = 700;
    quad(-6, 6, near, far, '#2a2d32');
    quad(-5.4, 5.4, near, far, '#34373d');
    quad(-5.3, -5.15, near, far, '#e6e9ed');
    quad(5.15, 5.3, near, far, '#e6e9ed');
    for (let d = -(f.travelled % 12) - 12; d < 420; d += 12) {
      if (d + 3.5 > near) for (const lx of [-1.8, 1.8]) quad(lx - 0.08, lx + 0.08, Math.max(d, near), d + 3.5, '#e6e9ed');
    }
    // The safe band: 1 to 3 seconds ahead of your front bumper at your current speed.
    const bandNear = CAR + Math.max(4, f.v), bandFar = CAR + Math.max(10, f.v * 3);
    quad(-1.7, 1.7, bandNear, bandFar, 'rgba(255,255,255,.12)');
    quad(-1.7, -1.6, bandNear, bandFar, 'rgba(255,255,255,.45)');
    quad(1.6, 1.7, bandNear, bandFar, 'rgba(255,255,255,.45)');
    for (const t of [...f.trees].sort((a, b) => b.z - a.z)) {
      const d = t.z - BEHIND;
      if (depth(d) < 1) continue;
      const bx = sx(t.x, d), by = sy(d), ty = top(d, t.h), w = focal * t.h * 0.33 / depth(d);
      ctx.fillStyle = t.dark ? '#1f3025' : '#27392c';
      ctx.beginPath();
      ctx.moveTo(bx, ty);
      ctx.lineTo(bx - w, by);
      ctx.lineTo(bx + w, by);
      ctx.closePath();
      ctx.fill();
    }
    // Both cars are seen from behind; brake lights come on when a car slows hard.
    const rear = (d, body, glass, braking) => {
      const x0 = sx(-0.92, d), x1 = sx(0.92, d), yb = sy(d), yt = top(d, 1.45), w = x1 - x0, h = yb - yt;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(x0 - w * 0.04, yb - h * 0.05, w * 1.08, h * 0.09);
      ctx.fillStyle = '#111316';
      ctx.fillRect(x0 + w * 0.04, yb - h * 0.14, w * 0.17, h * 0.14);
      ctx.fillRect(x1 - w * 0.21, yb - h * 0.14, w * 0.17, h * 0.14);
      ctx.fillStyle = body;
      shape(x0, yt + h * 0.06, w, h * 0.8, w * 0.08);
      ctx.fill();
      ctx.fillStyle = glass;
      shape(x0 + w * 0.13, yt + h * 0.12, w * 0.74, h * 0.28, w * 0.04);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(x0, yt + h * 0.7, w, h * 0.12);
      ctx.fillStyle = '#f4f5f7';
      ctx.fillRect(x0 + w * 0.4, yt + h * 0.57, w * 0.2, h * 0.09);
      const lights = () => {
        ctx.fillStyle = braking ? '#ff3b3b' : '#a3122c';
        ctx.fillRect(x0 + w * 0.04, yt + h * 0.48, w * 0.2, h * 0.1);
        ctx.fillRect(x1 - w * 0.24, yt + h * 0.48, w * 0.2, h * 0.1);
        if (braking) ctx.fillRect(x0 + w * 0.42, yt + h * 0.07, w * 0.16, h * 0.035);
      };
      if (braking) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = Math.min(24, w * 0.25); }
      lights();
      ctx.shadowBlur = 0;
      return { x0, yt, w, h, lights };
    };
    const leadCar = rear(CAR + Math.max(f.gap, 0.3), '#cfd4da', '#1c1f23', lead.a < -1.5);
    if (f.gap <= SENSOR * range) {
      const bx = leadCar.x0 - 6, by = leadCar.yt - 4, bw = leadCar.w + 12, bh = leadCar.h + 8, c = Math.min(12, bw / 3);
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [px, py, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
        ctx.moveTo(px + dx * c, py);
        ctx.lineTo(px, py);
        ctx.lineTo(px, py + dy * c);
      }
      ctx.stroke();
      const label = `car ${Math.min(0.99, 0.6 + 0.36 * range).toFixed(2)} · ${Math.round(f.gap)} m`;
      ctx.font = `600 13px ${font}`;
      ctx.fillStyle = 'rgba(0,0,0,.72)';
      ctx.fillRect(bx, by - 20, ctx.measureText(label).width + 10, 18);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 5, by - 11);
    }
    if (fog > 0.02) {
      // Fog thickens with distance and hides everything past the sensor range.
      const reach = CAR + SENSOR * range, clearY = sy(reach * 0.45), hazeY = sy(reach);
      const haze = ctx.createLinearGradient(0, clearY, 0, horizon - 20);
      haze.addColorStop(0, 'rgba(222,226,231,0)');
      haze.addColorStop(Math.min(0.99, (clearY - hazeY) / (clearY - horizon + 20)), `rgba(222,226,231,${0.9 * fog})`);
      haze.addColorStop(1, `rgba(222,226,231,${0.97 * fog})`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, clearY);
    }
    if (night > 0.02) {
      // Darkness except your headlight beam, with tail lights glowing through.
      const reach = CAR + SENSOR * range;
      shadeCtx.globalCompositeOperation = 'source-over';
      shadeCtx.clearRect(0, 0, width, height);
      shadeCtx.fillStyle = `rgba(4,7,14,${0.9 * night})`;
      shadeCtx.fillRect(0, 0, width, height);
      shadeCtx.globalCompositeOperation = 'destination-out';
      const light = shadeCtx.createLinearGradient(0, sy(CAR), 0, sy(reach));
      light.addColorStop(0, 'rgba(0,0,0,.95)');
      light.addColorStop(1, 'rgba(0,0,0,0)');
      shadeCtx.fillStyle = light;
      shadeCtx.beginPath();
      shadeCtx.moveTo(sx(-1.2, CAR), sy(CAR));
      shadeCtx.lineTo(sx(-7, reach), sy(reach));
      shadeCtx.lineTo(sx(7, reach), sy(reach));
      shadeCtx.lineTo(sx(1.2, CAR), sy(CAR));
      shadeCtx.closePath();
      shadeCtx.fill();
      shadeCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(shade, 0, 0, width, height);
      ctx.globalAlpha = night;
      ctx.shadowColor = '#ff3b3b';
      ctx.shadowBlur = Math.min(20, leadCar.w * 0.3);
      leadCar.lights();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    // Your UGA research vehicle, with a roof-mounted LiDAR.
    const you = rear(0, '#ba0c2f', '#16181b', f.a < -1.5);
    ctx.fillStyle = '#0d0f12';
    ctx.beginPath();
    ctx.ellipse(you.x0 + you.w / 2, you.yt + you.h * 0.05, you.w * 0.12, you.h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    if (rain > 0.02) drawRain();
    if (flash) {
      ctx.fillStyle = 'rgba(186,12,47,.35)';
      ctx.fillRect(0, 0, width, height);
    }
  }

  function followHud(now) {
    const f = follow, headway = f.gap / Math.max(f.v, 0.5);
    const state = headway < 1 ? 'too close' : headway > 3 ? 'too far' : 'safe gap';
    hud.distance.textContent = `${(f.pocket / 1609.34).toFixed(2)} mi`;
    hud.speed.textContent = `${Math.round(f.v * 2.23694)} mph`;
    hud.condition.textContent = now.label;
    hud.condition.classList.toggle('is-alert', now.name !== 'Clear');
    hud.mode.textContent = `${autopilot ? 'Cruise · ' : ''}${headway > 9.9 ? '9.9+' : headway.toFixed(1)} s · ${state}`;
    hud.mode.classList.toggle('is-alert', state !== 'safe gap');
  }

  // Switching modes happens between runs, from the controls on the start card.
  function seedStill() {
    for (const [index, kind, share] of [[0, vehicles[0], 0.12], [2, vehicles[2], 0.02], [1, vehicles[1], -0.2]]) {
      const o = { lane: index, kind, jitter: 0.5 };
      sizeVehicle(o);
      o.y = height * share;
      obstacles.push(o);
    }
  }
  function choosePlay(next) {
    if (next === play || mode === 'running') return;
    play = next;
    for (const b of playButtons) b.setAttribute('aria-pressed', String(b.dataset.play === next));
    pedalGroup.hidden = next !== 'follow';
    leftButton.innerHTML = next === 'follow' ? 'Brake' : '<span aria-hidden="true">←</span> Left';
    rightButton.innerHTML = next === 'follow' ? 'Speed up' : 'Right <span aria-hidden="true">→</span>';
    mode = 'ready';
    reset();
    if (next === 'dodge') seedStill();
    syncAutopilot();
    shareButton.hidden = true;
    message.textContent = 'Ready to drive?';
    detail.textContent = `${next === 'follow' ? 'Keep the car ahead in the white band, 1 to 3 seconds away.' : 'Avoid traffic as rain, fog, and night roll in.'}${best[next] ? ` Your best: ${best[next].toFixed(2)} mi.` : ''}`;
    startButton.textContent = 'Start driving';
    updateHud();
    draw();
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
    if (rain > 0.02) drawRain();
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
    if (play === 'follow') return drawFollow(flash);
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
    if (play === 'follow') return followHud(now);
    hud.distance.textContent = `${miles(distance).toFixed(2)} mi`;
    hud.speed.textContent = `${Math.round(mph(speed))} mph`;
    hud.condition.textContent = now.label;
    hud.condition.classList.toggle('is-alert', now.name !== 'Clear');
    hud.mode.textContent = autopilot ? (now.name === 'Clear' ? 'Autopilot driving' : 'Autopilot · be ready to take over') : 'You are driving';
    hud.mode.classList.toggle('is-alert', autopilot && now.name !== 'Clear');
  }

  function syncAutopilot() {
    autopilotButton.setAttribute('aria-pressed', String(autopilot));
    autopilotButton.textContent = `${play === 'follow' ? 'Cruise control' : 'Autopilot'} ${autopilot ? 'on' : 'off'}`;
    if (speed !== undefined) updateHud();
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
    if (mode !== 'running' || play !== 'dodge') return;
    takeOver();
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
    shareButton.hidden = true;
    last = 0;
    updateHud();
    canvas.focus({ preventScroll: true });
    announce(autopilot ? 'Driving on autopilot.' : play === 'follow' ? 'Following. Hold the up arrow to speed up and the down arrow to brake.' : 'Driving. Use the left and right arrow keys to change lanes.');
    requestAnimationFrame(loop);
  }
  function pause() {
    if (mode !== 'running') return;
    mode = 'paused';
    releasePedals();
    showOverlay('Paused', 'Resume', `${(play === 'follow' ? follow.pocket / 1609.34 : miles(distance)).toFixed(2)} mi so far.`);
    announce('Paused.');
  }
  function crash(reason = 'crash') {
    mode = 'over';
    releasePedals();
    const reached = play === 'follow' ? follow.pocket / 1609.34 : miles(distance);
    const record = reached > best[play];
    if (record) { best[play] = reached; saveBest(play, best[play]); }
    const now = condition();
    const driver = autopilot ? (play === 'follow' ? 'Cruise control' : 'Autopilot') : 'You';
    const what = reason === 'lost' ? `${driver === 'You' ? 'You' : driver} fell too far behind` : play === 'follow' ? `${driver} rear-ended the lead car` : `${driver === 'You' ? 'You' : driver} crashed`;
    const at = play === 'follow' ? follow.v * 2.23694 : mph(speed);
    const title = record ? `New best: ${reached.toFixed(2)} mi` : `${play === 'follow' ? 'Run over' : 'Crashed'} at ${reached.toFixed(2)} mi`;
    const note = `${what}${now.phrase || ''}${reason === 'lost' ? '' : ` at ${Math.round(at)} mph`}. Best: ${best[play].toFixed(2)} mi.`;
    lastRun = { miles: reached, phrase: now.phrase || '', autopilot, play };
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
    const text = lastRun.play === 'follow'
      ? `${lastRun.autopilot ? 'Cruise control held' : 'I held'} a safe gap for ${lastRun.miles.toFixed(2)} mi${lastRun.phrase} in the UGA Mobility Lab driving game. Can you out-drive the autopilot?`
      : `${lastRun.autopilot ? 'Autopilot drove' : 'I drove'} ${lastRun.miles.toFixed(2)} mi${lastRun.phrase} in the UGA Mobility Lab driving game. Can you out-drive the autopilot?`;
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
  // The left and right controls steer when dodging; when following, they are held as brake and accelerator.
  for (const button of [leftButton, rightButton]) {
    const direction = Number(button.dataset.steer);
    const pedalName = direction < 0 ? 'brake' : 'throttle';
    let pointer = false;
    button.addEventListener('pointerdown', () => { if (play === 'follow') { pointer = true; press(pedalName, 'button'); } });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, () => { if (pointer) { pointer = false; lift(pedalName, 'button'); } });
    button.addEventListener('click', () => {
      if (play === 'dodge') steer(direction);
      else if (!pointer) tap(pedalName); // keyboard activation: a short press
    });
  }
  let canvasPedal = null;
  canvas.addEventListener('pointerdown', event => {
    const box = canvas.getBoundingClientRect();
    const left = event.clientX - box.left < box.width / 2;
    if (play === 'dodge') return steer(left ? -1 : 1);
    canvasPedal = left ? 'brake' : 'throttle';
    press(canvasPedal, 'canvas');
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(type, () => { if (canvasPedal) { lift(canvasPedal, 'canvas'); canvasPedal = null; } });
  game.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || !event.target.closest('.drive-game-stage')) return;
    const key = event.key.toLowerCase();
    if (event.target.closest('button') && (key === ' ' || key === 'enter')) return;
    if (key === 't') toggleAutopilot();
    else if (key === ' ' && event.target === canvas) mode === 'running' ? pause() : start();
    else if ((key === 'p' || key === 'escape') && mode === 'running') pause();
    else if (mode === 'running' && play === 'dodge' && (key === 'arrowleft' || key === 'a')) steer(-1);
    else if (mode === 'running' && play === 'dodge' && (key === 'arrowright' || key === 'd')) steer(1);
    else if (mode === 'running' && play === 'follow' && (key === 'arrowup' || key === 'w')) press('throttle', 'key');
    else if (mode === 'running' && play === 'follow' && (key === 'arrowdown' || key === 's')) press('brake', 'key');
    else return;
    event.preventDefault();
  });
  game.addEventListener('keyup', event => {
    const key = event.key.toLowerCase();
    if (key === 'arrowup' || key === 'w') lift('throttle', 'key');
    if (key === 'arrowdown' || key === 's') lift('brake', 'key');
  });
  canvas.addEventListener('blur', releasePedals);
  for (const button of playButtons) button.addEventListener('click', () => choosePlay(button.dataset.play));
  for (const button of pedalButtons) {
    button.addEventListener('click', () => {
      pedal = button.dataset.pedal;
      for (const b of pedalButtons) b.setAttribute('aria-pressed', String(b === button));
    });
  }
  new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting) pause();
  }, { threshold: 0.25 }).observe(screen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  new ResizeObserver(layout).observe(canvas);

  // A still first frame: a little traffic ahead and the best distance so far.
  reset();
  layout();
  seedStill();
  draw();
  if (best.dodge) detail.textContent = `Your best: ${best.dodge.toFixed(2)} mi.`;
})();
