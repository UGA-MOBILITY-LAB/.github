// A small driving game at the foot of the home page. Change lanes and set your speed through towns,
// farmland, a river bridge, downtown, and pine forest: traffic lights, pedestrians, cyclists, slower
// vehicles ahead and faster ones coming up behind, and rain, fog, and nightfall that shrink what the
// sensors can see. Autopilot can drive (speed, lanes, lights) until it struggles. The game starts only
// when asked, pauses when scrolled away, and handles keys only while it has focus.
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

  // ---- world rules ------------------------------------------------------------------------------
  // Positions along the road ("s") are in screen pixels and grow in the direction of travel.
  const LANES = 3;
  const METERS_PER_PX = 0.06;
  const MPH = 1 / (METERS_PER_PX * 2.23694); // px/s per mph
  const SPEED = { max: 90 * MPH, start: 40 * MPH, accel: 7 * MPH, brake: 18 * MPH };
  const CONDITION_SECONDS = 9;
  const conditions = [
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08, cruise: 62 },
    { name: 'Rain', label: 'Rain · sensors 62%', range: 0.62, plan: 0.2, cruise: 52, rain: 1, phrase: ' in the rain' },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08, cruise: 62 },
    { name: 'Fog', label: 'Fog · sensors 36%', range: 0.36, plan: 0.34, cruise: 42, fog: 1, phrase: ' in fog' },
    { name: 'Clear', label: 'Clear · full sensor range', range: 1, plan: 0.08, cruise: 62 },
    { name: 'Night', label: 'Night · sensors 55%', range: 0.55, plan: 0.16, cruise: 52, night: 1, phrase: ' at night' },
  ];
  // Vehicles either keep a pace relative to the speed limit or have their own speed range in mph.
  const KINDS = {
    car: { w: 1, h: 1, colors: ['#d9dde2', '#f4f5f7', '#2b2f36', '#3b5b8c', '#6d7f8f', '#7c3a43', '#56704e'], pace: [0.85, 1.2] },
    SUV: { w: 1.08, h: 1.12, colors: ['#e3e6ea', '#1f2328', '#5b6874', '#7a5c46', '#3f4d5c'], pace: [0.85, 1.12] },
    pickup: { w: 1.04, h: 1.14, colors: ['#6f7a86', '#8f3a2f', '#e6e8eb', '#26303a'], pace: [0.85, 1.15] },
    van: { w: 1.06, h: 1.32, colors: ['#f2f3f5', '#d8dce1'], pace: [0.85, 1.05] },
    taxi: { w: 1, h: 1, colors: ['#f2c230'], pace: [0.9, 1.15] },
    motorcycle: { w: 0.42, h: 0.62, colors: ['#1d1d1f', '#3b5b8c', '#7c3a43'], pace: [0.95, 1.3] },
    truck: { w: 1.12, h: 1.9, colors: ['#eef0f2'], pace: [0.75, 1] },
    tractor: { w: 1.08, h: 0.9, colors: ['#7a8b3c'], mph: [15, 22] },
    'school bus': { w: 1.12, h: 2.1, colors: ['#e8b21f'], mph: [28, 38] },
    'city bus': { w: 1.12, h: 2.3, colors: ['#2d6aa6'], mph: [18, 28] },
    cyclist: { w: 0.34, h: 0.62, colors: ['#1f7a8c', '#c2410c', '#4338ca', '#15803d'], mph: [9, 15] },
  };
  // Scenery and traffic by stretch of road. Urban stretches have signalled intersections.
  const ZONES = {
    town: { name: 'Small town', where: 'in town', limit: 35, verge: '#2c342f', spawn: 1, urban: true, gap: 2300, mix: { car: 5, SUV: 3, van: 1.5, pickup: 1.5, 'school bus': 0.8 } },
    farm: { name: 'Farmland', where: 'by the farms', limit: 55, verge: '#3b472c', spawn: 1.15, mix: { car: 3, pickup: 4, truck: 2, tractor: 2.5, SUV: 1 } },
    bridge: { name: 'River bridge', where: 'on the bridge', limit: 50, verge: '#2f5d7c', spawn: 1, mix: { car: 5, truck: 2, pickup: 2, SUV: 2 } },
    downtown: { name: 'Downtown', where: 'downtown', limit: 25, verge: '#2a2f35', spawn: 0.85, urban: true, gap: 1800, jaywalk: true, mix: { car: 5, taxi: 2, 'city bus': 1, van: 1.5, motorcycle: 1, SUV: 2 } },
    forest: { name: 'Pine forest', where: 'in the forest', limit: 50, verge: '#1f2b23', spawn: 1.05, mix: { car: 4, pickup: 3, truck: 2, SUV: 2, motorcycle: 0.6 } },
    rural: { name: 'Rural road', where: 'on a rural road', limit: 55, verge: '#25322a', spawn: 1, mix: { car: 5, pickup: 3, truck: 2, tractor: 1.2, 'school bus': 0.6, SUV: 2 } },
  };
  const PLAYLIST = [['town', 5200], ['farm', 5600], ['bridge', 2400], ['downtown', 6200], ['forest', 5000], ['rural', 5200]];
  // Signals: our direction is green, then yellow, then red while the cross street goes and people walk.
  const CYCLE = 16, GREEN = 7.5, YELLOW = 10;
  const CROSS = { near: 40, far: 150 }; // cross street, ahead of the stop line
  const WALK = { from: 6, to: 34 }; // crosswalk, between the stop line and the cross street

  let width = 0, height = 0, lane = 0, roadX = 0, roadW = 0, carW = 0, carH = 0, egoY = 0;
  let mode = 'ready'; // ready, running, paused, over
  let autopilot = false;
  let speed, distance, elapsed, spawnTimer, cyclistTimer, jayTimer, egoLane = 1, egoX = 0;
  let sweep, planClock, hudClock, last = 0, alongside = [false, false], autoBraking = false;
  let range = 1, fog = 0, rain = 0, night = 0;
  let zones = [], zoneEnd = 0, playIndex = 0, intersections = [], decor = [], nextDecor = { L: 0, R: 0 };
  let traffic = [], walkers = [], crossing = [], drops = [];
  const shade = document.createElement('canvas');
  const shadeCtx = shade.getContext('2d');
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
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const between = ([a, b]) => a + Math.random() * (b - a);
  const laneCenter = index => roadX + lane * (index + 0.5);
  const toY = s => egoY - (s - distance); // screen y of a road position
  const condition = () => conditions[Math.floor(elapsed / CONDITION_SECONDS) % conditions.length];
  const frontRange = () => Math.max(0, egoY - 16) * range;
  // Signals are large and lit, so they are seen farther away, and at night as well as by day.
  const lightRange = () => Math.max(0, egoY - 16) * 2.2 * (night > 0.5 ? 1 : range);
  const rearRange = () => 460 * range;
  const announce = text => { status.textContent = text; };
  const egoLaneNow = () => Math.max(0, Math.min(LANES - 1, Math.round((egoX - roadX) / lane - 0.5)));
  const objX = o => laneCenter(o.lane) + (o.dx || 0);

  // ---- the road ahead: zones, intersections, scenery --------------------------------------------------
  function addZone() {
    const [type, length] = PLAYLIST[playIndex];
    playIndex = (playIndex + 1) % PLAYLIST.length;
    const zone = { type, start: zoneEnd, end: zoneEnd + length, ...ZONES[type] };
    zones.push(zone);
    zoneEnd = zone.end;
    if (zone.urban) {
      for (let s = zone.start + (zone.start === 0 ? 1100 : 700); s < zone.end - 450; s += zone.gap * (0.85 + Math.random() * 0.3)) {
        intersections.push({ s, offset: Math.random() * CYCLE, clock: { east: 0, west: 0, walk: 0 } });
      }
    }
  }
  function zoneAt(s) {
    for (const zone of zones) if (s >= zone.start && s < zone.end) return zone;
    return zones[zones.length - 1];
  }
  const nearIntersection = (s, before = 30, after = CROSS.far + 40) => intersections.some(ix => s > ix.s - before && s < ix.s + after);
  function phase(ix) { return (((elapsed + ix.offset) % CYCLE) + CYCLE) % CYCLE; }
  function light(ix) { const t = phase(ix); return t < GREEN ? 'green' : t < YELLOW ? 'yellow' : 'red'; }

  // One scenery item per call on one side of the road, spaced by its size.
  function decorate(side) {
    const s = nextDecor[side], zone = zoneAt(s);
    const verge = roadX - (zone.urban ? 34 : 14);
    if (verge < 12) { nextDecor[side] += 200; return; }
    const edge = side === 'L' ? roadX : roadX + roadW;
    const outward = side === 'L' ? -1 : 1;
    let item = null, step = 40;
    if (zone.urban) {
      const tower = zone.type === 'downtown';
      const depth = Math.min(verge - 4, tower ? 70 + Math.random() * 120 : 34 + Math.random() * 44);
      const length = tower ? 90 + Math.random() * 90 : 50 + Math.random() * 46;
      const palette = tower ? ['#4b5563', '#3f4753', '#5b6472', '#6b7280', '#394150'] : ['#8b939c', '#7d5a4f', '#5f6f7f', '#a6adb5', '#6f665c', '#8a6f5a'];
      if (intersections.some(ix => s < ix.s + CROSS.far + 40 && s + length > ix.s - 14)) { nextDecor[side] += 24; return; }
      item = { kind: tower ? 'tower' : Math.random() < 0.6 ? 'house' : 'shop', s, length, depth, color: pick(palette), x: edge + outward * (34 + depth / 2 + Math.random() * 6), lit: Math.random() };
      step = length + (tower ? 8 : 16) + Math.random() * 18;
    } else if (zone.type === 'farm') {
      if (Math.random() < 0.18) {
        const barn = Math.random() < 0.6;
        const depth = Math.min(verge - 6, barn ? 46 : 26);
        item = { kind: barn ? 'barn' : 'silo', s, length: barn ? 60 : 26, depth, x: edge + outward * (40 + Math.random() * Math.max(0, verge - 60) + depth / 2) };
        step = 200 + Math.random() * 300;
      } else step = 120;
    } else if (zone.type === 'bridge') {
      step = 200;
    } else {
      const dense = zone.type === 'forest';
      const r = Math.min(verge / 2 - 2, (dense ? 9 : 8) + Math.random() * (dense ? 8 : 10));
      item = { kind: 'tree', s, r, dark: dense || Math.random() < 0.3, x: edge + outward * (14 + r + Math.random() * Math.max(0, verge - 2 * r - 6)) };
      step = (dense ? 12 : 22) + Math.random() * (dense ? 14 : 38);
    }
    if (item) decor.push(item);
    nextDecor[side] += step;
  }
  function extendWorld() {
    const ahead = distance + egoY + 300;
    while (zoneEnd < ahead + 2500) addZone();
    for (const side of ['L', 'R']) while (nextDecor[side] < ahead) decorate(side);
    const behind = distance - (height - egoY) - 260;
    decor = decor.filter(d => d.s + (d.length || d.r * 2 || 60) > behind);
    intersections = intersections.filter(ix => ix.s + CROSS.far > behind - 400);
    zones = zones.filter(zone => zone.end > behind - 2000);
  }

  // ---- traffic --------------------------------------------------------------------------------------
  function makeVehicle(kindName, zone, s, laneIndex) {
    const kind = KINDS[kindName];
    const o = { kindName, kind, lane: laneIndex, s, color: pick(kind.colors), jitter: Math.random() };
    o.w = carW * kind.w;
    o.h = carH * kind.h;
    o.base = kind.mph ? between(kind.mph) * MPH : 0;
    o.pace = kind.pace ? between(kind.pace) : 1;
    o.v = desiredSpeed(o, zone);
    if (kindName === 'cyclist') o.dx = lane * 0.26;
    return o;
  }
  function desiredSpeed(o, zone = zoneAt(o.s)) {
    const limit = zone.limit * MPH;
    return o.base ? Math.min(o.base, limit + 5 * MPH) : limit * o.pace;
  }
  function weighted(mix) {
    const entries = Object.entries(mix);
    let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
    for (const [name, w] of entries) if ((roll -= w) < 0) return name;
    return entries[0][0];
  }
  // New traffic appears ahead if it is slower than you and behind if it is faster. It never fills
  // all three lanes near the top of the road at once, and faster traffic starts far enough back.
  function spawn() {
    const zone = zoneAt(distance + egoY);
    const kindName = weighted(zone.mix);
    const probe = makeVehicle(kindName, zone, 0, 0);
    if (Math.abs(probe.v - speed) < 4 * MPH) return;
    const ahead = probe.v < speed;
    const closing = Math.max(0, probe.v - speed);
    probe.s = ahead ? distance + egoY + probe.h + 20 + Math.random() * 60 : distance + egoY - height - 40 - Math.min(560, closing * closing / 220) - Math.random() * 60;
    if (nearIntersection(probe.s, 60, CROSS.far + 60)) return;
    const crowdedTop = new Set(traffic.filter(o => toY(o.s) < height * 0.3).map(o => o.lane));
    const lanes = [0, 1, 2].filter(index => {
      if (ahead && !crowdedTop.has(index) && crowdedTop.size >= 2) return false;
      return !traffic.some(o => o.lane === index && o.s - o.h < probe.s + carH * 1.5 && o.s > probe.s - probe.h - carH * 1.5);
    });
    if (!lanes.length) return;
    probe.lane = pick(lanes);
    traffic.push(probe);
  }
  function spawnCyclist() {
    const zone = zoneAt(distance + egoY);
    if (!zone.urban) return;
    const o = makeVehicle('cyclist', zone, distance + egoY + carH, 2);
    if (o.v >= speed || nearIntersection(o.s, 40, CROSS.far + 40) || traffic.some(x => x.lane === 2 && Math.abs(x.s - o.s) < carH * 2.5)) return;
    traffic.push(o);
  }
  function spawnJaywalker() {
    const zone = zoneAt(distance + egoY);
    if (!zone.jaywalk) return;
    const s = distance + egoY + 30;
    if (nearIntersection(s, 120, CROSS.far + 120)) return;
    const fromLeft = Math.random() < 0.5;
    walkers.push(makeWalker(s, fromLeft ? roadX - 22 : roadX + roadW + 22, fromLeft ? 1 : -1, 52 + Math.random() * 14));
  }
  function makeWalker(s, x, dir, pace) {
    return { s, x, vx: dir * pace, color: pick(['#c2410c', '#1f7a8c', '#4338ca', '#a16207', '#be185d', '#334155', '#15803d']), step: Math.random() * 6 };
  }
  // Lanes a pedestrian is in or about to step into.
  function walkerLanes(p) {
    const lanes = [];
    for (let i = 0; i < LANES; i++) {
      const left = roadX + lane * i, right = left + lane;
      const reach = p.x + Math.sign(p.vx) * 18;
      if ((p.x > left - 6 && p.x < right + 6) || (reach > left && reach < right)) lanes.push(i);
    }
    return lanes;
  }

  function idm(v, desired, gap, dv) {
    const a = 70, b = 140;
    const wanted = 14 + v * 0.9 + v * dv / (2 * Math.sqrt(a * b));
    return a * (1 - (v / Math.max(desired, 1)) ** 4 - (wanted / Math.max(gap, 1)) ** 2);
  }
  // What a driver at front position s in a lane must react to: the next vehicle, you, a red light,
  // or a pedestrian in the lane. Returns the gap and the speed of whatever is ahead.
  function obstacleAhead(s, laneIndex, self, includeEgo) {
    let gap = Infinity, leadV = 0;
    for (const o of traffic) {
      if (o === self || o.lane !== laneIndex) continue;
      const g = o.s - o.h - s;
      if (g > -4 && g < gap) { gap = g; leadV = o.v; }
    }
    if (includeEgo && egoLaneNow() === laneIndex) {
      const g = distance - carH - s;
      if (g > -4 && g < gap) { gap = g; leadV = speed; }
    }
    for (const ix of intersections) {
      const g = ix.s - s - 3;
      if (g < 0 || g > 600) continue;
      const state = light(ix), v = self ? self.v : speed;
      if ((state === 'red' || (state === 'yellow' && g > v * 1.2)) && g < gap) { gap = g; leadV = 0; }
    }
    for (const p of walkers) {
      if (!walkerLanes(p).includes(laneIndex)) continue;
      const g = p.s - 12 - s;
      if (g > -6 && g < gap) { gap = Math.max(0, g); leadV = 0; }
    }
    return { gap, leadV };
  }
  function moveTraffic(dt) {
    for (const o of traffic) {
      const { gap, leadV } = obstacleAhead(o.s, o.lane, o, true);
      const acc = Math.max(-160, idm(o.v, desiredSpeed(o), gap, o.v - leadV));
      o.v = Math.max(0, o.v + acc * dt);
    }
    for (const o of traffic) o.s += o.v * dt;
    traffic = traffic.filter(o => toY(o.s) < height + 720 && toY(o.s) + o.h > -620);
  }
  // True while you or any vehicle is between the stop line and the far crosswalk.
  function boxBusy(ix) {
    const a = ix.s - 2, b = ix.s + CROSS.far + 36;
    const inside = (front, back) => front > a && back < b;
    return inside(distance, distance - carH) || traffic.some(o => inside(o.s, o.s - o.h));
  }
  function moveWalkers(dt) {
    for (const ix of intersections) {
      const y = toY(ix.s);
      if (y < -260 || y > height + 120) continue;
      const t = phase(ix);
      // People start crossing early in our red phase; the last ones may still be crossing at green.
      if (t > YELLOW + 0.4 && t < YELLOW + 2.6) {
        ix.clock.walk -= dt;
        if (ix.clock.walk <= 0 && !boxBusy(ix)) {
          ix.clock.walk = 0.5 + Math.random() * 1.1;
          const fromLeft = Math.random() < 0.5;
          walkers.push(makeWalker(ix.s + (WALK.from + WALK.to) / 2 + (Math.random() - 0.5) * 12, fromLeft ? roadX - 22 : roadX + roadW + 22, fromLeft ? 1 : -1, 64 + Math.random() * 18));
        }
      }
      // Cross-street traffic while the cross street has green.
      for (const [dir, key] of [[1, 'east'], [-1, 'west']]) {
        if (t > YELLOW + 1 && t < CYCLE - 0.8) {
          ix.clock[key] -= dt;
          if (ix.clock[key] <= 0) {
            ix.clock[key] = 1.4 + Math.random() * 1.4;
            const kindName = pick(['car', 'car', 'SUV', 'van', 'pickup']);
            crossing.push({ ix, dir, s: ix.s + (dir > 0 ? CROSS.near + 28 : CROSS.far - 28), x: dir > 0 ? -carH : width + carH, v: 30 * MPH, kindName, kind: KINDS[kindName], color: pick(KINDS[kindName].colors), jitter: Math.random() });
          }
        }
      }
    }
    for (const p of walkers) { p.x += p.vx * dt; p.step += dt * 8; }
    walkers = walkers.filter(p => p.x > roadX - 40 && p.x < roadX + roadW + 40 && toY(p.s) < height + 80);
    // Cross traffic waits at the edge of your road while the junction is occupied, and does not start
    // across in the last seconds before your light turns green; it also keeps its distance in a queue.
    for (const c of crossing) {
      const outside = c.dir > 0 ? c.x + carH / 2 < roadX - 6 : c.x - carH / 2 > roadX + roadW + 6;
      const atEdge = outside && (c.dir > 0 ? c.x + carH / 2 > roadX - 46 : c.x - carH / 2 < roadX + roadW + 46);
      let go = 30 * MPH;
      if (atEdge && (boxBusy(c.ix) || phase(c.ix) > CYCLE - 2.5 || phase(c.ix) < YELLOW)) go = 0;
      for (const other of crossing) {
        if (other === c || other.ix !== c.ix || other.dir !== c.dir) continue;
        const ahead = (other.x - c.x) * c.dir;
        if (ahead > 0 && ahead < carH * 1.35) go = Math.min(go, other.v);
      }
      c.v = go;
      c.x += c.dir * c.v * dt;
    }
    crossing = crossing.filter(c => c.x > -carH * 2 && c.x < width + carH * 2 && toY(c.s) < height + 120);
  }

  // ---- your car and autopilot --------------------------------------------------------------------------------
  function seen(s) { return s > distance - carH - rearRange() && s < distance + frontRange(); }
  function detected(o) { return seen(o.s) || seen(o.s - o.h); }
  // Autopilot keeps to the weather and the speed limit and stops for red lights and pedestrians it can
  // see. Like a vehicle with an HD map, it knows where stop lines are, so it approaches an intersection
  // slowly enough to stop there until it can see the light is green. In town it also keeps its speed
  // within what it can stop for in the distance it can see. It changes lanes only when its sensors
  // show the target lane clear ahead and behind.
  function drive(dt) {
    const now = condition(), zone = zoneAt(distance);
    const brakeCap = SPEED.brake * (1 - 0.3 * rain);
    let target = Math.min(now.cruise, zone.limit + 3) * MPH;
    if (zone.urban) target = Math.min(target, 0.85 * Math.sqrt(2 * brakeCap * frontRange()));
    let gap = Infinity, leadV = target;
    for (const o of traffic) {
      if (o.lane !== egoLane || o.s - o.h < distance - 4 || !detected(o)) continue;
      const g = o.s - o.h - distance;
      if (g < gap) { gap = g; leadV = o.v; }
    }
    for (const ix of intersections) {
      const g = ix.s - distance - 3;
      if (g < 0 || g > 1200) continue;
      const state = g <= lightRange() ? light(ix) : 'unseen';
      if (state === 'green') continue;
      if (state === 'unseen') { target = Math.min(target, 0.9 * Math.sqrt(2 * brakeCap * Math.max(0, g - 4))); continue; }
      if (state === 'yellow' && speed * speed / (2 * brakeCap) > g) continue; // too close to stop: go on
      if (g < gap) { gap = g; leadV = 0; }
    }
    leadV = Math.min(leadV, target);
    for (const p of walkers) {
      const g = p.s - 12 - distance;
      if (g < -6 || g > frontRange() || !walkerLanes(p).includes(egoLane)) continue;
      if (g < gap) { gap = Math.max(0, g); leadV = 0; }
    }
    const acc = Math.max(-SPEED.brake * (1 - 0.3 * rain), Math.min(SPEED.accel, idm(speed, target, gap, speed - leadV)));
    autoBraking = acc < -SPEED.accel * 0.5;
    speed = Math.max(0, Math.min(SPEED.max, speed + acc * dt));
    if (planClock > 0 || Math.abs(egoX - laneCenter(egoLane)) > lane * 0.25 || nearIntersection(distance, 260, CROSS.far + 30)) return;
    planClock = now.plan;
    if (gap > carH * 3 || leadV > target - 6 * MPH || leadV === 0) return;
    const clear = index => traffic.every(o => {
      if (o.lane !== index || !detected(o)) return true;
      if (o.s - o.h > distance) return o.s - o.h - distance > carH * 2.2 && o.v >= speed - 10 * MPH;
      if (o.s < distance - carH) return distance - carH - o.s > carH * 1.2 + Math.max(0, o.v - speed) * 1.4;
      return false;
    });
    const options = [egoLane - 1, egoLane + 1].filter(l => l >= 0 && l < LANES && clear(l));
    if (options.length) egoLane = pick(options);
  }

  function collision() {
    const inset = carW * 0.1;
    const left = egoX - carW / 2 + inset, right = egoX + carW / 2 - inset, top = egoY + carH * 0.06, bottom = egoY + carH * 0.94;
    const overlaps = (x0, x1, y0, y1) => x1 > left && x0 < right && y1 > top && y0 < bottom;
    for (const o of traffic) {
      const x = objX(o), y = toY(o.s);
      if (overlaps(x - o.w * 0.45, x + o.w * 0.45, y + o.h * 0.04, y + o.h * 0.96)) return { type: 'vehicle', other: o };
    }
    for (const p of walkers) {
      const y = toY(p.s);
      if (overlaps(p.x - 6, p.x + 6, y - 6, y + 6)) return { type: 'walker' };
    }
    for (const c of crossing) {
      const y = toY(c.s);
      if (overlaps(c.x - carH * 0.45, c.x + carH * 0.45, y - carW * 0.45, y + carW * 0.45)) return { type: 'cross', other: c };
    }
    return null;
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
      speed = Math.max(0, Math.min(SPEED.max, speed));
    }
    const before = distance;
    distance += speed * dt;
    // Crossing a stop line on red ends the run.
    for (const ix of intersections) {
      if (before < ix.s && distance >= ix.s && light(ix) === 'red' && phase(ix) > YELLOW + 0.25) return crash({ type: 'red' });
    }
    extendWorld();
    moveTraffic(dt);
    moveWalkers(dt);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = Math.max(0.45, 1.05 - elapsed * 0.004) * zoneAt(distance).spawn;
    }
    cyclistTimer -= dt;
    if (cyclistTimer <= 0) { spawnCyclist(); cyclistTimer = 3.5 + Math.random() * 4; }
    jayTimer -= dt;
    if (jayTimer <= 0) { spawnJaywalker(); jayTimer = 7 + Math.random() * 7; }
    egoX += (laneCenter(egoLane) - egoX) * (1 - Math.exp(-dt * 16));
    const here = egoLaneNow();
    alongside = [-1, 1].map(side => traffic.some(o => o.lane === here + side && o.s > distance - carH - carH * 0.6 && o.s - o.h < distance + carH * 0.4));
    if (!reducedMotion.matches) sweep += dt * 5;
    if (rain > 0.02) {
      for (const d of drops) {
        d.y += (900 + speed) * dt;
        d.x -= 60 * dt;
        if (d.y > height) { d.y = -d.l; d.x = Math.random() * (width + 60); }
      }
    }
    const hit = collision();
    if (hit) crash(hit);
  }

  // ---- drawing ---------------------------------------------------------------------------------------
  function shape(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function rect(x0, y0, x1, y1, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  function drawGround() {
    const sTop = distance + egoY, sBottom = distance - (height - egoY);
    for (const zone of zones) {
      if (zone.end < sBottom || zone.start > sTop) continue;
      const y0 = Math.max(0, toY(Math.min(zone.end, sTop))), y1 = Math.min(height, toY(Math.max(zone.start, sBottom)));
      rect(0, y0, width, y1, zone.verge);
      if (zone.type === 'farm') {
        // Crop rows on both sides.
        for (let s = Math.floor(Math.max(zone.start, sBottom) / 16) * 16; s < Math.min(zone.end, sTop); s += 16) {
          const y = toY(s + 16), color = (s / 16) % 2 ? '#4a5d34' : '#57683c';
          rect(0, Math.max(y0, y), roadX - 12, Math.min(y1, y + 8), color);
          rect(roadX + roadW + 12, Math.max(y0, y), width, Math.min(y1, y + 8), color);
        }
      } else if (zone.type === 'bridge') {
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let s = Math.floor(Math.max(zone.start, sBottom) / 30) * 30; s < Math.min(zone.end, sTop); s += 30) {
          for (let k = 0; k < 6; k++) {
            const x = ((s * 7 + k * 97) % Math.max(1, width + 40)) - 20;
            if (x > roadX - 18 && x < roadX + roadW + 18) continue;
            const y = toY(s) + ((k * 13) % 30);
            ctx.moveTo(x, y);
            ctx.lineTo(x + 14, y);
          }
        }
        ctx.stroke();
      } else if (zone.urban) {
        rect(roadX - 32, y0, roadX - 8, y1, '#a9afb6');
        rect(roadX + roadW + 8, y0, roadX + roadW + 32, y1, '#a9afb6');
      }
    }
  }
  function drawDecor() {
    for (const d of decor) {
      const y = toY(d.s + (d.length || d.r * 2 || 0));
      if (y > height + 10 || y + (d.length || 60) < -10) continue;
      if (d.kind === 'tree') {
        const cy = toY(d.s);
        ctx.fillStyle = '#18231b';
        circle(d.x + 2, cy + 3, d.r);
        ctx.fillStyle = d.dark ? '#24372a' : '#2f4536';
        circle(d.x, cy, d.r);
        ctx.fillStyle = d.dark ? '#2e4635' : '#3c5844';
        circle(d.x - d.r * 0.3, cy - d.r * 0.3, d.r * 0.45);
        continue;
      }
      const x0 = d.x - d.depth / 2, h = d.length;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.fillRect(x0 + 4, y + 5, d.depth, h);
      if (d.kind === 'silo') {
        ctx.fillStyle = '#b8bfc6';
        circle(d.x, y + h / 2, d.depth / 2);
        ctx.fillStyle = '#d5dade';
        circle(d.x - 3, y + h / 2 - 3, d.depth / 4);
        continue;
      }
      ctx.fillStyle = d.kind === 'barn' ? '#8e2f2b' : d.color;
      ctx.fillRect(x0, y, d.depth, h);
      if (d.kind === 'house' || d.kind === 'barn') {
        // A gable roof: two shades either side of the ridge.
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(x0, y, d.depth / 2, h);
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        ctx.fillRect(x0 + d.depth / 2 - 1, y, 2, h);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x0 + 4, y + 4, d.depth - 8, h - 8);
        ctx.fillStyle = 'rgba(0,0,0,.22)';
        for (let k = 0; k < (d.kind === 'tower' ? 3 : 1); k++) ctx.fillRect(x0 + 8 + k * 16, y + 10 + k * 14, 10, 8);
      }
    }
  }
  function drawRoad() {
    rect(roadX - 8, 0, roadX + roadW + 8, height, '#2a2d32');
    rect(roadX, 0, roadX + roadW, height, '#34373d');
    rect(roadX + 4, 0, roadX + 7, height, '#e6e9ed');
    rect(roadX + roadW - 7, 0, roadX + roadW - 4, height, '#e6e9ed');
    ctx.fillStyle = '#e6e9ed';
    const offset = ((distance % 56) + 56) % 56;
    for (let i = 1; i < LANES; i++) for (let y = offset - 56; y < height; y += 56) ctx.fillRect(roadX + lane * i - 1.5, y, 3, 26);
    // Bridge railings and urban bike symbols.
    const sTop = distance + egoY, sBottom = distance - (height - egoY);
    for (const zone of zones) {
      if (zone.end < sBottom || zone.start > sTop) continue;
      const y0 = Math.max(0, toY(Math.min(zone.end, sTop))), y1 = Math.min(height, toY(Math.max(zone.start, sBottom)));
      if (zone.type === 'bridge') {
        rect(roadX - 14, y0, roadX - 8, y1, '#c9ced4');
        rect(roadX + roadW + 8, y0, roadX + roadW + 14, y1, '#c9ced4');
        ctx.fillStyle = '#8f969e';
        for (let s = Math.ceil(Math.max(zone.start, sBottom) / 26) * 26; s < Math.min(zone.end, sTop); s += 26) {
          const y = toY(s);
          ctx.fillRect(roadX - 15, y, 8, 4);
          ctx.fillRect(roadX + roadW + 7, y, 8, 4);
        }
      }
    }
  }
  function drawIntersections() {
    for (const ix of intersections) {
      const top = toY(ix.s + CROSS.far), bottom = toY(ix.s + CROSS.near);
      if (bottom < -40 || top > height + 40) continue;
      rect(0, top, width, bottom, '#34373d');
      // Cross-street centre line.
      ctx.fillStyle = '#e6e9ed';
      const mid = toY(ix.s + (CROSS.near + CROSS.far) / 2);
      for (let x = -20; x < width; x += 46) if (x + 24 < roadX || x > roadX + roadW) ctx.fillRect(x, mid - 1.5, 24, 3);
      // Crosswalks before and after the junction, and the stop line.
      for (const [a, b] of [[WALK.from, WALK.to], [CROSS.far + 4, CROSS.far + 32]]) {
        const y0 = toY(ix.s + b), y1 = toY(ix.s + a);
        for (let x = roadX + 6; x < roadX + roadW - 6; x += 18) ctx.fillRect(x, y0, 9, y1 - y0);
      }
      ctx.fillRect(roadX + 4, toY(ix.s) - 3, roadW - 8, 5);
    }
  }
  // Georgia-style span-wire signals over each lane, with corner poles.
  function drawSignals() {
    for (const ix of intersections) {
      const y = toY(ix.s + (CROSS.near + CROSS.far) / 2);
      if (y < -30 || y > height + 30) continue;
      const state = light(ix), lit = { red: '#ff3b3b', yellow: '#ffc233', green: '#34d399' }[state];
      ctx.strokeStyle = 'rgba(20,22,26,.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(roadX - 20, y);
      ctx.lineTo(roadX + roadW + 20, y);
      ctx.stroke();
      ctx.fillStyle = '#1b1d21';
      circle(roadX - 20, y, 4);
      circle(roadX + roadW + 20, y, 4);
      for (let i = 0; i < LANES; i++) {
        const x = laneCenter(i);
        ctx.fillStyle = '#111315';
        shape(x - 7, y - 14, 14, 28, 3);
        ctx.fill();
        for (const [k, color] of [['red', '#4a1414'], ['yellow', '#4a3a10'], ['green', '#0f3a2a']].entries()) {
          ctx.fillStyle = state === color[0] ? lit : color[1];
          circle(x, y - 8 + k * 8, 3);
        }
      }
      if (state !== 'green') {
        ctx.fillStyle = state === 'red' ? 'rgba(255,59,59,.22)' : 'rgba(255,194,51,.22)';
        ctx.fillRect(roadX + 4, toY(ix.s) - 8, roadW - 8, 5);
      }
    }
  }

  function drawBody(cx, top, o) {
    const { w, h } = o, x = cx - w / 2, y = top, type = o.kindName;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    shape(x + 3, y + 5, w, h, Math.min(w * 0.2, 10));
    ctx.fill();
    if (type === 'cyclist' || type === 'motorcycle') {
      ctx.fillStyle = '#16181b';
      ctx.fillRect(cx - 1.5, y, 3, h);
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(cx - 2.5, y, 5, h * 0.14);
      ctx.fillRect(cx - 2.5, y + h * 0.86, 5, h * 0.14);
      ctx.fillStyle = type === 'motorcycle' ? o.color : '#2a2f36';
      shape(cx - w * 0.45, y + h * 0.3, w * 0.9, h * 0.32, 4);
      ctx.fill();
      ctx.fillStyle = type === 'cyclist' ? o.color : '#0f1114';
      circle(cx, y + h * 0.42, Math.max(3, w * 0.28));
      return;
    }
    if (type === 'tractor') {
      ctx.fillStyle = '#16181b';
      ctx.fillRect(x - w * 0.08, y + h * 0.5, w * 0.24, h * 0.42);
      ctx.fillRect(x + w * 0.84, y + h * 0.5, w * 0.24, h * 0.42);
      ctx.fillRect(x + w * 0.08, y + h * 0.04, w * 0.14, h * 0.24);
      ctx.fillRect(x + w * 0.78, y + h * 0.04, w * 0.14, h * 0.24);
      ctx.fillStyle = o.color;
      shape(x + w * 0.22, y, w * 0.56, h, 5);
      ctx.fill();
      ctx.fillStyle = '#2a2e24';
      ctx.fillRect(x + w * 0.3, y + h * 0.52, w * 0.4, h * 0.3);
      return;
    }
    ctx.fillStyle = o.color;
    shape(x, y, w, h, Math.min(w * 0.2, 10));
    ctx.fill();
    ctx.fillStyle = '#1c1f23';
    if (type === 'truck') {
      ctx.fillStyle = '#b9bfc6';
      shape(x, y, w, h * 0.22, 6);
      ctx.fill();
      ctx.fillStyle = '#1c1f23';
      ctx.fillRect(x + w * 0.15, y + h * 0.05, w * 0.7, h * 0.07);
      ctx.fillStyle = '#d3d7dc';
      ctx.fillRect(x + w * 0.08, y + h * 0.27, w * 0.84, h * 0.69);
      return;
    }
    if (type === 'school bus' || type === 'city bus') {
      ctx.fillRect(x + w * 0.12, y + h * 0.03, w * 0.76, h * 0.06);
      ctx.fillStyle = type === 'school bus' ? '#f6d36b' : '#e8eef4';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + w * 0.2, y + h * (0.2 + i * 0.18), w * 0.6, h * 0.05);
      return;
    }
    if (type === 'van') {
      ctx.fillRect(x + w * 0.14, y + h * 0.06, w * 0.72, h * 0.13);
      ctx.fillStyle = 'rgba(0,0,0,.08)';
      ctx.fillRect(x + w * 0.1, y + h * 0.26, w * 0.8, h * 0.68);
      return;
    }
    shape(x + w * 0.14, y + h * 0.2, w * 0.72, h * 0.2, 4);
    ctx.fill();
    if (type === 'pickup') {
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(x + w * 0.12, y + h * 0.52, w * 0.76, h * 0.42);
      return;
    }
    shape(x + w * 0.16, y + h * 0.72, w * 0.68, h * 0.12, 3);
    ctx.fill();
    if (type === 'taxi') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - w * 0.16, y + h * 0.48, w * 0.32, h * 0.08);
    }
    if (type === 'SUV') {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(x + w * 0.2, y + h * 0.44, 2, h * 0.24);
      ctx.fillRect(x + w * 0.8 - 2, y + h * 0.44, 2, h * 0.24);
    }
  }
  function drawWalker(p) {
    const y = toY(p.s);
    if (y < -12 || y > height + 12) return;
    const swing = Math.sin(p.step) * 4;
    ctx.strokeStyle = '#1f2328';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 2, y);
    ctx.lineTo(p.x - 2 + swing * Math.sign(p.vx), y + 3);
    ctx.moveTo(p.x + 2, y);
    ctx.lineTo(p.x + 2 - swing * Math.sign(p.vx), y - 3);
    ctx.stroke();
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(p.x, y, 4, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a20';
    circle(p.x, y, 3);
  }
  function drawCrossing(c) {
    const y = toY(c.s);
    if (y < -40 || y > height + 40) return;
    ctx.save();
    ctx.translate(c.x, y);
    ctx.rotate(c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    drawBody(0, -carH / 2, { ...c, w: carW, h: carH });
    ctx.restore();
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
    const braking = mode === 'running' && (autopilot ? autoBraking : pedals.slower.size > 0);
    ctx.fillStyle = braking ? '#ff3b3b' : '#7d0a20';
    ctx.fillRect(x + carW * 0.1, y + carH - 4, carW * 0.24, 3);
    ctx.fillRect(x + carW * 0.66, y + carH - 4, carW * 0.24, 3);
    const cx = egoX, cy = y + carH * 0.55;
    ctx.fillStyle = '#0d0f12';
    circle(cx, cy, carW * 0.17);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * carW * 0.15, cy + Math.sin(sweep) * carW * 0.15);
    ctx.stroke();
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
    const back = egoY + carH, rr = Math.min(rearRange(), height - back);
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
    ctx.lineTo(roadX + roadW, egoY - r);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function drawRadar() {
    for (const o of traffic) {
      const y = toY(o.s);
      if (y < height || o.v <= speed || o.s < distance - carH - rearRange()) continue;
      const urgency = 1 - (y - height) / Math.max(1, egoY + carH + rearRange() - height);
      const cx = objX(o), by = height - 10;
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
  function box(x, y, w, h, label) {
    if (y > height || y + h < 0) return;
    const c = Math.min(12, w / 3);
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(px + dx * c, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + dy * c);
    }
    ctx.stroke();
    ctx.font = `600 13px ${font}`;
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(x, y - 20, ctx.measureText(label).width + 10, 18);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 5, y - 11);
  }
  function drawDetections() {
    for (const o of traffic) if (detected(o)) box(objX(o) - o.w / 2 - 5, toY(o.s) - 5, o.w + 10, o.h + 10, `${o.kindName} ${Math.round(mph(o.v))} mph`);
    for (const p of walkers) if (seen(p.s) && p.x > roadX - 30 && p.x < roadX + roadW + 30) box(p.x - 9, toY(p.s) - 10, 18, 20, 'pedestrian');
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
      const edge = egoY - frontRange();
      const clear = edge + frontRange() * 0.45;
      const haze = ctx.createLinearGradient(0, clear, 0, edge - 30);
      haze.addColorStop(0, 'rgba(222,226,231,0)');
      haze.addColorStop(1, `rgba(222,226,231,${0.97 * fog})`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, clear);
      const behind = egoY + carH + 12;
      const rearHaze = ctx.createLinearGradient(0, behind, 0, height);
      rearHaze.addColorStop(0, 'rgba(222,226,231,0)');
      rearHaze.addColorStop(1, `rgba(222,226,231,${0.85 * fog})`);
      ctx.fillStyle = rearHaze;
      ctx.fillRect(0, behind, width, height - behind);
    }
    if (night > 0.02) {
      // Darkness except the headlight beam, the glow around the car, and street lamps in town.
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
      const pool = (x, y, r, strength) => {
        const g = shadeCtx.createRadialGradient(x, y, r * 0.2, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${strength})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        shadeCtx.fillStyle = g;
        shadeCtx.fillRect(x - r, y - r, r * 2, r * 2);
      };
      pool(egoX, egoY + carH / 2, carH * 1.3, 0.9);
      const lamps = [];
      for (let s = Math.floor((distance - (height - egoY)) / 170) * 170; s < distance + egoY + 170; s += 170) {
        if (!zoneAt(s).urban || nearIntersection(s, 10, CROSS.far + 10)) continue;
        for (const x of [roadX - 20, roadX + roadW + 20]) { lamps.push([x, toY(s)]); pool(x, toY(s), 70, 0.7); }
      }
      shadeCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(shade, 0, 0, width, height);
      ctx.fillStyle = `rgba(255,236,190,${0.95 * night})`;
      for (const [x, y] of lamps) circle(x, y, 3);
      // Lit windows downtown, and other road users' lights.
      for (const d of decor) {
        if (d.kind !== 'tower' && d.kind !== 'shop') continue;
        const y = toY(d.s + d.length);
        if (y > height || y + d.length < 0) continue;
        ctx.fillStyle = `rgba(255,214,120,${0.75 * night})`;
        for (let k = 0; k < 6; k++) if ((d.lit * 10 + k * 3.7) % 1 < 0.55) ctx.fillRect(d.x - d.depth / 2 + 6 + (k % 3) * (d.depth / 3), y + 8 + Math.floor(k / 3) * (d.length / 2.4), 5, 4);
      }
      for (const o of traffic) {
        const x = objX(o) - o.w / 2, y = toY(o.s);
        if (o.s - o.h > distance - carH / 2) {
          ctx.fillStyle = `rgba(255,64,64,${0.9 * night})`;
          ctx.fillRect(x + o.w * 0.08, y + o.h - 4, o.w * 0.2, 3);
          ctx.fillRect(x + o.w * 0.72, y + o.h - 4, o.w * 0.2, 3);
        } else {
          ctx.fillStyle = `rgba(255,244,204,${0.9 * night})`;
          ctx.fillRect(x + o.w * 0.08, y + 1, o.w * 0.22, 3);
          ctx.fillRect(x + o.w * 0.7, y + 1, o.w * 0.22, 3);
        }
      }
    }
  }

  function draw(flash = false) {
    if (!width) return;
    drawGround();
    drawDecor();
    drawRoad();
    drawIntersections();
    drawSensor();
    for (const o of traffic) drawBody(objX(o), toY(o.s), o);
    for (const c of crossing) drawCrossing(c);
    for (const p of walkers) drawWalker(p);
    drawEgo();
    drawSignals();
    drawDetections();
    drawWeather();
    drawRadar();
    if (flash) {
      ctx.fillStyle = 'rgba(186,12,47,.35)';
      ctx.fillRect(0, 0, width, height);
    }
  }

  // ---- HUD, controls, and game state ---------------------------------------------------------------
  function updateHud() {
    const now = condition(), zone = zoneAt(distance);
    hud.distance.textContent = `${miles(distance).toFixed(2)} mi`;
    hud.speed.textContent = `${Math.round(mph(speed))} mph`;
    hud.speed.classList.toggle('is-alert', mph(speed) > zone.limit + 10);
    if (hud.zone) hud.zone.textContent = `${zone.name} · limit ${zone.limit}`;
    hud.condition.textContent = now.label;
    hud.condition.classList.toggle('is-alert', now.name !== 'Clear');
    hud.mode.textContent = autopilot ? (now.name === 'Clear' ? 'Autopilot driving' : 'Autopilot · be ready to take over') : 'You are driving';
    hud.mode.classList.toggle('is-alert', autopilot && now.name !== 'Clear');
  }
  function syncAutopilot() {
    autopilotButton.setAttribute('aria-pressed', String(autopilot));
    autopilotButton.innerHTML = `Autopilot<span class="drive-game-state"> ${autopilot ? 'on' : 'off'}</span>`;
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
    roadW = lane * LANES;
    roadX = (width - roadW) / 2;
    carW = lane * 0.46;
    carH = carW * 1.85;
    egoY = Math.round(height * 0.58);
    egoX = laneCenter(egoLane);
    for (const o of traffic) {
      o.w = carW * o.kind.w;
      o.h = carH * o.kind.h;
      if (o.kindName === 'cyclist') o.dx = lane * 0.26;
    }
    if (distance !== undefined) {
      decor = [];
      nextDecor = { L: distance - (height - egoY) - 200, R: distance - (height - egoY) - 200 };
      extendWorld();
    }
    draw();
  }
  function reset() {
    speed = SPEED.start;
    distance = 0;
    elapsed = 0;
    spawnTimer = 0.4;
    cyclistTimer = 1.5;
    jayTimer = 6;
    egoLane = 1;
    egoX = laneCenter(1);
    sweep = 0;
    planClock = 0;
    hudClock = 0;
    range = 1;
    fog = rain = night = 0;
    zones = [];
    zoneEnd = 0;
    playIndex = 0;
    intersections = [];
    decor = [];
    nextDecor = { L: -height, R: -height };
    traffic = [];
    walkers = [];
    crossing = [];
    alongside = [false, false];
    autoBraking = false;
    releasePedals();
    extendWorld();
    drops = Array.from({ length: reducedMotion.matches ? 36 : 90 }, () => ({ x: Math.random() * width, y: Math.random() * height, l: 9 + Math.random() * 11 }));
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
    announce(autopilot ? 'Driving on autopilot.' : 'Driving. Left and right arrow keys change lanes; up and down change speed. Stop for red lights and pedestrians.');
    requestAnimationFrame(loop);
  }
  function pause() {
    if (mode !== 'running') return;
    mode = 'paused';
    releasePedals();
    showOverlay('Paused', 'Resume', `${miles(distance).toFixed(2)} mi so far.`);
    announce('Paused.');
  }
  function crash(hit) {
    mode = 'over';
    releasePedals();
    const reached = miles(distance);
    const record = reached > best;
    if (record) { best = reached; saveBest(best); }
    const now = condition();
    const who = autopilot ? 'Autopilot' : 'You';
    let what;
    if (hit.type === 'red') what = `${who} ran a red light`;
    else if (hit.type === 'walker') what = `${who} didn’t yield to a pedestrian`;
    else if (hit.type === 'cross') what = `${who} hit a car crossing the intersection`;
    else {
      const o = hit.other, name = o.kindName === 'cyclist' ? 'cyclist' : o.kindName;
      const changingLanes = o.lane !== egoLaneNow() || Math.abs(egoX - laneCenter(egoLane)) > lane * 0.2;
      what = changingLanes ? `${who} side-swiped a ${name}`
        : o.s - o.h < distance - carH * 0.55 ? `A ${name} hit ${autopilot ? 'the car' : 'you'} from behind`
        : `${who} hit a ${name}`;
    }
    const title = record ? `New best: ${reached.toFixed(2)} mi` : `${hit.type === 'red' ? 'Pulled over' : 'Crashed'} at ${reached.toFixed(2)} mi`;
    const note = `${what} ${zoneAt(distance).where}${now.phrase || ''}${hit.type === 'red' ? '' : ` at ${Math.round(mph(speed))} mph`}. Best: ${best.toFixed(2)} mi.`;
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

  // A still first frame: a town intersection on red, people crossing, a cyclist, and waiting traffic.
  layout();
  reset();
  intersections = [{ s: 150, offset: YELLOW + 2, clock: { east: 9, west: 9, walk: 9 } }];
  decor = [];
  nextDecor = { L: -height, R: -height };
  extendWorld();
  speed = 0;
  traffic = [
    Object.assign(makeVehicle('car', zones[0], 140, 0), { v: 0 }),
    Object.assign(makeVehicle('cyclist', zones[0], 120, 2), { v: 0 }),
    Object.assign(makeVehicle('SUV', zones[0], 380, 2), { v: 0 }),
    Object.assign(makeVehicle('van', zones[0], -150, 1), { v: 0 }),
  ];
  walkers = [makeWalker(150 + 20, roadX + lane * 0.8, 1, 64), makeWalker(150 + 16, roadX + lane * 2.2, -1, 60)];
  crossing = [{ ix: intersections[0], dir: 1, s: 150 + CROSS.near + 28, x: roadX - lane * 0.9, v: 0, kindName: 'car', kind: KINDS.car, color: '#3b5b8c', jitter: 0.5 }];
  draw();
  if (best) detail.textContent = `Your best: ${best.toFixed(2)} mi.`;
})();
