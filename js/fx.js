// 캔버스 파티클 이펙트. 보드 위에 겹쳐 그린다. 규칙(game.js)과는 무관하며, 꺼도 게임은 그대로 돈다.
// 좌표는 모두 캔버스 기준 픽셀. 호출하는 쪽(main.js)이 칸 위치를 넘겨준다.
//
// 연출 방향: "내 블럭이 줄을 공격한다".
//   놓은 자리(impact)에서 번개가 줄로 내리꽂히고 → 레이저가 줄을 따라 쓸고 지나가며 → 칸이 가까운 순서로 연쇄 폭발한다.
//   콤보가 커지면 불기둥·폭죽(로켓이 올라가 터짐)·레이저 방사가 더해진다.

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 강도 조절 (1이 기본). 과하면 줄이고 약하면 올린다.
export const INTENSITY = { particles: 1, shake: 1 };

export function createFX(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let parts = [];          // 살아 있는 파티클
  let fever = 0;           // 0~3: 콤보 열기 단계
  let feverBox = null;     // 보드 사각형 {x, y, w, h}
  let raf = 0, last = 0, hue = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize(w, h) {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = w; H = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function add(p) { p.life = 0; p.delay ??= 0; parts.push(p); kick(); }
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  const n = (k) => Math.round(k * INTENSITY.particles);

  // ---------- 파티클 생성 ----------
  // shard: 색 조각(중력·회전) / spark: 빛점(가산, 꼬리) / ring: 충격파 / flash: 화면 번쩍 / ray: 빛살
  // flame: 불꽃(위로 오르며 노랑→빨강) / laser: 줄을 쓸고 가는 빔 / bolt: 번개 / rocket: 폭죽 로켓(터지면 spark 뭉치)
  const shard = (x, y, color, power, delay = 0) => {
    const a = rnd(0, TAU), sp = rnd(80, 300) * power;
    add({ t: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140 * power, g: 900, size: rnd(3, 7) * Math.min(1.3, power),
      color, rot: rnd(0, TAU), vr: rnd(-14, 14), ttl: rnd(0.3, 0.55), delay });
  };
  const spark = (x, y, color, power, speed = 1, delay = 0, g = 220) => {
    const a = rnd(0, TAU), sp = rnd(220, 560) * power * speed;
    add({ t: 'spark', x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g, drag: 0.9, size: rnd(1.5, 3.5), color, ttl: rnd(0.3, 0.65), delay });
  };
  const ring = (x, y, color, r0, r1, ttl = 0.5, width = 6, delay = 0) => add({ t: 'ring', x, y, color, r0, r1, width, ttl, delay });
  const flash = (color, alpha = 0.35, ttl = 0.3) => add({ t: 'flash', color, alpha, ttl });
  const ray = (x, y, color, angle, len, delay = 0) => add({ t: 'ray', x, y, color, angle, len, ttl: 0.6, delay });
  const flame = (x, y, power = 1, delay = 0) =>
    add({ t: 'flame', x, y, vx: rnd(-30, 30), vy: rnd(-160, -70) * power, size: rnd(6, 14) * power, ttl: rnd(0.35, 0.7), delay, ph: rnd(0, TAU) });
  const laser = (x, y, angle, len, color, delay = 0, width = 10) => add({ t: 'laser', x, y, angle, len, color, width, ttl: 0.42, delay });
  const bolt = (x1, y1, x2, y2, color, delay = 0) => add({ t: 'bolt', x1, y1, x2, y2, color, ttl: 0.22, delay, seed: Math.random() });
  const rocket = (x, y, color, power = 1, delay = 0) =>
    add({ t: 'rocket', x, y, vx: rnd(-80, 80), vy: rnd(-620, -480) * Math.min(1.3, power), g: 560, color, ttl: rnd(0.45, 0.65), delay, power });

  function burst(x, y, color, power) { // 폭죽이 터지는 순간
    ring(x, y, '#fff', 4, 70 * power, 0.45, 5);
    ring(x, y, color, 4, 110 * power, 0.7, 8);
    flash(color, 0.12, 0.2);
    const nn = n(70 * power);
    for (let k = 0; k < nn; k++) spark(x, y, k % 4 === 0 ? '#fff' : color, 1.1 * power, 1.3, 0, 300);
    for (let k = 0; k < n(12); k++) spark(x, y, color, 0.5 * power, 0.6, 0.08, 400); // 두 번째 작은 터짐
    for (let k = 0; k < n(14); k++) flame(x + rnd(-14, 14), y + rnd(-14, 14), 1);
  }

  // ---------- 장면 ----------
  const HOT = ['#ff5d6c', '#ffb020', '#ffd23f', '#ff6a3d', '#ffffff'];
  const COOL = ['#4fd1ff', '#6c7bff', '#c36bff', '#4cd97b', '#ffffff'];

  // 줄 클리어 공격.
  // impact: 놓은 블럭 중심 / cells: [{x, y, color}] / lines: [{cx, cy, horiz, len}] / power: 1~4
  function explode({ impact, cells, lines, center, u, power = 1 }) {
    if (reduce) return;
    const p = Math.min(4, power);
    const dist = (c) => Math.hypot(c.x - impact.x, c.y - impact.y);
    const maxD = Math.max(1, ...cells.map(dist));
    const wave = 0.035 * (u / 45); // 칸 하나 멀어질 때마다 늦게 터지는 시간(초)

    // 1) 임팩트: 놓은 자리에서 충격파 + 번개
    ring(impact.x, impact.y, '#fff', 2, u * 1.6, 0.35, 5);
    for (const l of lines) {
      for (let k = 0; k < 2; k++) bolt(impact.x, impact.y, l.cx + rnd(-u, u), l.cy + rnd(-u, u), k ? '#fff' : HOT[1], k * 0.03);
      // 2) 레이저가 줄을 따라 양쪽으로 쓸고 나간다
      const a = l.horiz ? 0 : Math.PI / 2;
      laser(impact.x, impact.y, a, l.len, p >= 3 ? COOL[0] : HOT[1], 0.05, 8 + p * 3);
      laser(impact.x, impact.y, a + Math.PI, l.len, p >= 3 ? COOL[0] : HOT[1], 0.05, 8 + p * 3);
    }
    // 3) 칸이 가까운 순서로 연쇄 폭발
    const perCell = cells.length > 24 ? 2 : 3;
    for (const c of cells) {
      const d = dist(c) / u * wave;
      for (let k = 0; k < n(perCell); k++) shard(c.x, c.y, c.color, 0.8 + p * 0.2, d);
      for (let k = 0; k < n(5 + p * 3); k++) spark(c.x, c.y, k % 3 ? c.color : '#fff', 0.7 + p * 0.3, 1, d);
      for (let k = 0; k < n(3 + p); k++) flame(c.x + rnd(-u * 0.3, u * 0.3), c.y, 0.8 + p * 0.3, d);
      ring(c.x, c.y, c.color, 2, u * 0.9, 0.3, 3, d);
    }
    // 4) 콤보가 크면 전체 연출
    if (p >= 2) {
      flash('#fff', 0.16 + p * 0.06, 0.22 + p * 0.05);
      ring(center.x, center.y, HOT[1], u, u * 9, 0.7, 10, maxD / u * wave);
    }
    if (p >= 3) {
      for (let k = 0; k < 2 + (p - 3) * 2; k++) rocket(center.x + rnd(-u * 2, u * 2), center.y, pick(p >= 4 ? COOL : HOT), 1 + (p - 2) * 0.3, 0.15 + k * 0.12);
      for (let k = 0; k < n(14 * p); k++) spark(center.x, center.y, pick(HOT), 1.3 + p * 0.25, 1.4, maxD / u * wave);
    }
    if (p >= 4) {
      for (let k = 0; k < 12; k++) laser(center.x, center.y, (k / 12) * TAU + hue / 360, u * 7, k % 2 ? COOL[2] : '#fff', 0.1 + k * 0.02, 6);
      for (let k = 0; k < 16; k++) ray(center.x, center.y, '#fff', (k / 16) * TAU, u * 6, 0.1);
    }
  }

  // 폭탄 폭발: 폭탄 자리에서 큰 충격파 + 가로·세로 레이저 + 불기둥 + 칸 연쇄 폭발. wave가 클수록(연쇄) 더 크다
  function bombBlast(at, u, lines, cells, wave = 0, hidden = false) {
    if (reduce) return;
    const p = 2 + Math.min(3, wave);
    const main = ['#ffb020', '#ff5d6c', '#c36bff', '#4fd1ff'][Math.min(3, wave)];
    const sub = ['#ffd23f', '#ff6a3d', '#ff6fb5', '#ffffff'][Math.min(3, wave)];
    if (hidden) { // 숨은 폭탄 공개: 하얀 섬광 + 빠른 링
      flash('#fff', 0.5, 0.25);
      ring(at.x, at.y, '#fff', 2, u * 3, 0.3, 10);
      for (let k = 0; k < n(30); k++) spark(at.x, at.y, '#fff', 1.4, 1.6, 0, 200);
    }
    flash(main, 0.25 + wave * 0.07, 0.35);
    // 충격파 3겹
    ring(at.x, at.y, '#fff', 2, u * 2.5, 0.4, 9);
    ring(at.x, at.y, main, u * 0.5, u * (9 + wave * 2), 0.8, 12 + wave * 3, 0.06);
    ring(at.x, at.y, sub, u * 0.3, u * 6, 0.6, 6, 0.14);
    // 십자 레이저(굵게) + 레이저가 지나간 자리를 따라 불길이 번진다
    for (const l of lines) {
      const a = l.horiz ? 0 : Math.PI / 2;
      for (const dir of [a, a + Math.PI]) {
        laser(at.x, at.y, dir, l.len, main, 0, 16 + wave * 4);
        laser(at.x, at.y, dir, l.len, '#fff', 0.08, 6);
        for (let s = u * 0.5; s < l.len; s += u * 0.45) {
          const fx0 = at.x + Math.cos(dir) * s, fy0 = at.y + Math.sin(dir) * s;
          const d = s / u * 0.03;
          flame(fx0 + rnd(-6, 6), fy0 + rnd(-6, 6), 1.2 + wave * 0.2, d);
          if (Math.random() < 0.6) spark(fx0, fy0, Math.random() < 0.5 ? '#fff' : sub, 0.7, 1, d, 350);
        }
      }
    }
    // 빛살(회전 오프셋) + 중심 빛점 + 불기둥
    for (let k = 0; k < 16; k++) ray(at.x, at.y, k % 2 ? main : '#fff', (k / 16) * TAU + wave * 0.2, u * (4 + wave), k * 0.01);
    for (let k = 0; k < n(50 + p * 20); k++) spark(at.x, at.y, k % 3 ? [main, sub][k % 2] : '#fff', 1.3 + p * 0.2, 1.5, 0, 280);
    for (let k = 0; k < n(30 + wave * 10); k++) flame(at.x + rnd(-u, u), at.y + rnd(-u * 0.5, u * 0.5), 1.5 + wave * 0.2, rnd(0, 0.15));
    for (const c of cells) {
      const d = Math.hypot(c.x - at.x, c.y - at.y) / u * 0.035;
      for (let k = 0; k < n(2); k++) shard(c.x, c.y, c.color, 1, d);
      for (let k = 0; k < n(6); k++) spark(c.x, c.y, k % 2 ? c.color : '#fff', 1, 1, d);
      for (let k = 0; k < n(3); k++) flame(c.x + rnd(-u * 0.3, u * 0.3), c.y, 1, d);
      ring(c.x, c.y, c.color, 2, u * 0.9, 0.3, 3, d);
    }
    // 파동이 거듭될수록 폭죽이 늘고, 3차부터는 레이저 방사까지
    for (let k = 0; k < 1 + wave; k++) rocket(at.x + rnd(-u * 2, u * 2), at.y, k % 2 ? main : sub, 1.2 + wave * 0.15, 0.15 + k * 0.12);
    if (wave >= 2) for (let k = 0; k < 12; k++) laser(at.x, at.y, (k / 12) * TAU + 0.26, u * 6, k % 2 ? sub : '#fff', 0.12 + k * 0.015, 5);
  }

  // 블럭이 보드에 닿을 때: 작은 충격파 + 먼지
  function land(cells, color, impact, u) {
    if (reduce) return;
    if (impact) ring(impact.x, impact.y, color, 2, u * 1.2, 0.25, 3);
    for (const c of cells) for (let k = 0; k < n(3); k++) {
      add({ t: 'shard', x: c.x + rnd(-6, 6), y: c.y + 8, vx: rnd(-60, 60), vy: rnd(-100, -30), g: 520, size: rnd(2, 4), color, rot: 0, vr: rnd(-4, 4), ttl: 0.3 });
    }
  }

  // 레벨업: 빛살 + 폭죽 3발 + 불기둥
  function levelUp(center, u) {
    if (reduce) return;
    flash(COOL[0], 0.25, 0.4);
    for (let k = 0; k < 24; k++) ray(center.x, center.y, k % 2 ? COOL[0] : '#fff', (k / 24) * TAU + rnd(-0.1, 0.1), u * rnd(5, 8));
    ring(center.x, center.y, COOL[0], u, u * 10, 0.8, 12);
    for (let k = 0; k < 3; k++) rocket(center.x + (k - 1) * u * 2.5, center.y + u * 3, COOL[k], 1.2, k * 0.15);
    for (let k = 0; k < n(30); k++) flame(center.x + rnd(-u * 3, u * 3), center.y + u * 3, 1.4, rnd(0, 0.3));
  }

  // 보드를 완전히 비웠을 때: 레이저 십자 + 폭죽 5발
  function perfect(center, u) {
    if (reduce) return;
    flash(HOT[2], 0.45, 0.5);
    for (let k = 0; k < 8; k++) laser(center.x, center.y, (k / 8) * TAU, u * 8, k % 2 ? HOT[2] : '#fff', k * 0.03, 10);
    for (let k = 0; k < 5; k++) rocket(center.x + rnd(-u * 3, u * 3), center.y + u * 2, pick([...HOT, ...COOL]), 1.4, 0.1 + k * 0.16);
    ring(center.x, center.y, '#fff', u, u * 11, 0.9, 14);
  }

  // 콤보 열기: 0이면 끔. 보드 테두리가 타오른다.
  function setFever(level, box) {
    fever = reduce ? 0 : Math.max(0, Math.min(3, level));
    feverBox = box;
    if (fever) kick();
  }

  // ---------- 그리기 ----------
  function drawFlame(p, k) {
    const a = 1 - k;
    const r = p.size * (1 - k * 0.7);
    const h = 55 - k * 45; // 노랑 → 빨강
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.9;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `hsla(${h + 10}, 100%, 85%, 1)`);
    g.addColorStop(0.5, `hsla(${h}, 100%, 55%, .8)`);
    g.addColorStop(1, `hsla(${h - 10}, 100%, 40%, 0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawLaser(p, k) {
    const sweep = Math.min(1, k * 2.8);        // 빠르게 뻗고
    const a = k < 0.5 ? 1 : (1 - k) * 2;       // 뒤늦게 사라진다
    const len = p.len * sweep;
    const ex = p.x + Math.cos(p.angle) * len, ey = p.y + Math.sin(p.angle) * len;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    ctx.globalAlpha = a * 0.55; ctx.strokeStyle = p.color; ctx.lineWidth = p.width * 2.2; ctx.shadowBlur = 24; ctx.shadowColor = p.color;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.globalAlpha = a; ctx.strokeStyle = '#fff'; ctx.lineWidth = p.width * 0.35; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
    if (sweep < 1 && Math.random() < 0.8) spark(ex, ey, Math.random() < 0.5 ? '#fff' : p.color, 0.5, 0.8, 0, 300); // 레이저 끝에서 튀는 불똥
  }
  function drawBolt(p, k) {
    const a = (1 - k) * (0.6 + 0.4 * Math.sin(k * 60 + p.seed * 10)); // 깜빡임
    const segs = 9;
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const pts = [[p.x1, p.y1]];
    for (let i = 1; i < segs; i++) {
      const t = i / segs, j = (Math.sin(i * 12.9898 + p.seed * 78.233 + k * 40) * 43758.5453) % 1;
      const off = (j - 0.5) * L * 0.22;
      pts.push([p.x1 + dx * t + nx * off, p.y1 + dy * t + ny * off]);
    }
    pts.push([p.x2, p.y2]);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, c, al] of [[7, p.color, a * 0.5], [2, '#fff', a]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.globalAlpha = al; ctx.shadowBlur = w === 7 ? 16 : 0; ctx.shadowColor = p.color;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, W, H);
    hue = (hue + dt * 120) % 360;

    if (fever && feverBox) {
      const { x, y, w, h } = feverBox;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 2 + fever * 2;
      ctx.strokeStyle = `hsla(${fever >= 3 ? hue : 30 + fever * 10}, 100%, 60%, ${0.25 + fever * 0.15})`;
      ctx.shadowBlur = 10 + fever * 8; ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();
      ctx.restore();
      // 아래 테두리에서 불꽃이 타오르고, 단계가 높으면 옆면에서도
      const rate = fever * 10 * dt * INTENSITY.particles;
      for (let k = 0; k < rate + (Math.random() < rate % 1 ? 1 : 0); k++) {
        const side = Math.random();
        if (fever < 2 || side < 0.6) flame(x + Math.random() * w, y + h, 0.6 + fever * 0.2);
        else flame(side < 0.8 ? x : x + w, y + Math.random() * h, 0.5 + fever * 0.15);
      }
    }

    const alive = [];
    const list = parts; parts = []; // 그리는 도중 새로 생기는 파티클(로켓 꼬리·폭발)은 parts에 쌓인다
    for (const p of list) {
      if (p.delay > 0) { p.delay -= dt; alive.push(p); continue; }
      p.life += dt;
      if (p.life >= p.ttl) {
        if (p.t === 'rocket') burst(p.x, p.y, p.color, p.power);
        continue;
      }
      const k = p.life / p.ttl, a = 1 - k;
      switch (p.t) {
        case 'shard':
          p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          ctx.save(); ctx.globalAlpha = Math.min(1, a * 1.5); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
          break;
        case 'spark':
          p.px = p.x; p.py = p.y;
          p.vx *= p.drag; p.vy = p.vy * p.drag + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.restore();
          break;
        case 'ring': {
          const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - k) ** 3);
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.9;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.width * a + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'flash':
          ctx.save(); ctx.globalAlpha = p.alpha * a; ctx.fillStyle = p.color; ctx.fillRect(0, 0, W, H); ctx.restore();
          break;
        case 'ray': {
          const len = p.len * Math.min(1, k * 2.5);
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          ctx.strokeStyle = p.color; ctx.lineWidth = 3 * a + 0.5; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.angle) * len, p.y + Math.sin(p.angle) * len); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'flame':
          p.x += (p.vx + Math.sin(p.life * 18 + p.ph) * 25) * dt; p.y += p.vy * dt;
          drawFlame(p, k);
          break;
        case 'laser': drawLaser(p, k); break;
        case 'bolt': drawBolt(p, k); break;
        case 'rocket':
          p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          // 꼬리
          add({ t: 'spark', x: p.x, y: p.y, px: p.x, py: p.y, vx: rnd(-30, 30), vy: rnd(20, 80), g: 100, drag: 0.95, size: 2, color: Math.random() < 0.5 ? '#fff' : p.color, ttl: 0.3 });
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = p.color; ctx.shadowBlur = 18; ctx.shadowColor = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill(); ctx.restore();
          for (let q = 0; q < 2; q++) flame(p.x + rnd(-4, 4), p.y + 6, 0.5);
          break;
      }
      alive.push(p);
    }
    parts = alive.concat(parts);
    if (parts.length || fever) raf = requestAnimationFrame(frame);
    else { raf = 0; ctx.clearRect(0, 0, W, H); }
  }

  return { resize, explode, bombBlast, land, levelUp, perfect, setFever, get count() { return parts.length; } };
}
