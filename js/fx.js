// 캔버스 파티클 이펙트. 보드 위에 겹쳐 그린다. 규칙(game.js)과는 무관하며, 꺼도 게임은 그대로 돈다.
// 좌표는 모두 캔버스 기준 픽셀. 호출하는 쪽(main.js)이 칸 위치를 넘겨준다.

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

export function createFX(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let parts = [];          // 살아 있는 파티클
  let fever = 0;           // 0~3: 콤보 열기 단계. 0이면 테두리 불꽃 없음
  let feverBox = null;     // 보드 사각형 {x, y, w, h} (캔버스 좌표)
  let raf = 0, last = 0, hue = 0;
  let reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize(w, h) {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = w; H = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function add(p) { parts.push(p); kick(); }
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // ---------- 파티클 종류 ----------
  // shard: 색 조각. 중력·회전. spark: 작은 빛점(가산 합성, 꼬리). ring: 퍼지는 원.
  // beam: 줄을 따라가는 빛줄기. flash: 화면 번쩍. confetti: 팔랑이는 종이. ray: 방사형 빛살. ember: 테두리 불씨.
  function shard(x, y, color, power) {
    const a = rnd(0, TAU), sp = rnd(60, 260) * power;
    add({ t: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * power, g: 700, size: rnd(4, 10) * Math.min(1.6, power),
      color, rot: rnd(0, TAU), vr: rnd(-12, 12), life: 0, ttl: rnd(0.5, 0.9) });
  }
  function spark(x, y, color, power, speed = 1) {
    const a = rnd(0, TAU), sp = rnd(200, 520) * power * speed;
    add({ t: 'spark', x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 200, drag: 0.9, size: rnd(1.5, 3.5),
      color, life: 0, ttl: rnd(0.3, 0.6) });
  }
  function ring(x, y, color, r0, r1, ttl = 0.5, width = 6) { add({ t: 'ring', x, y, color, r0, r1, width, life: 0, ttl }); }
  function beam(x, y, w, h, color) { add({ t: 'beam', x, y, w, h, color, life: 0, ttl: 0.45 }); }
  function flash(color, alpha = 0.35, ttl = 0.3) { add({ t: 'flash', color, alpha, life: 0, ttl }); }
  function confetti(x, y, color, power = 1) {
    add({ t: 'confetti', x, y, vx: rnd(-220, 220) * power, vy: rnd(-520, -220) * power, g: 520, w: rnd(5, 9), h: rnd(8, 14),
      color, rot: rnd(0, TAU), vr: rnd(-9, 9), ph: rnd(0, TAU), life: 0, ttl: rnd(1.2, 2) });
  }
  function ray(x, y, color, angle, len) { add({ t: 'ray', x, y, color, angle, len, life: 0, ttl: 0.6 }); }
  function ember(x, y, color) {
    add({ t: 'spark', x, y, px: x, py: y, vx: rnd(-40, 40), vy: rnd(-140, -60), g: -60, drag: 0.98, size: rnd(1.2, 2.6), color, life: 0, ttl: rnd(0.5, 1) });
  }

  // ---------- 장면별 연출 ----------
  const PALETTE = ['#ff5d6c', '#ffb020', '#ffd23f', '#4cd97b', '#4fd1ff', '#6c7bff', '#c36bff', '#ff6fb5', '#ffffff'];

  // 줄 클리어 폭발. cells: [{x, y, color}], lines: [{x, y, w, h}] (줄의 사각형), power: 1(한 줄)~3+(여러 줄·콤보)
  function explode({ cells, lines, center, u, power = 1 }) {
    if (reduce) return;
    const p = Math.min(3, power);
    const perCell = cells.length > 24 ? 4 : 7;
    for (const c of cells) {
      for (let k = 0; k < perCell * Math.min(2, p); k++) shard(c.x, c.y, c.color, 0.7 + p * 0.35);
      for (let k = 0; k < 3 + p * 2; k++) spark(c.x, c.y, k % 2 ? c.color : '#fff', 0.6 + p * 0.3);
    }
    for (const l of lines) {
      beam(l.x, l.y, l.w, l.h, '#fff');
      ring(l.x + l.w / 2, l.y + l.h / 2, '#fff', u * 0.4, Math.max(l.w, l.h) * 0.8, 0.45, 4 + p * 2);
    }
    if (p >= 2) {
      flash('#fff', 0.18 + p * 0.07, 0.25 + p * 0.05);
      ring(center.x, center.y, '#ffb020', u, u * 9, 0.7, 10);
      for (let k = 0; k < 10 * p; k++) spark(center.x, center.y, PALETTE[k % PALETTE.length], 1.2 + p * 0.3, 1.4);
    }
    if (p >= 3) {
      for (let k = 0; k < 40; k++) confetti(center.x + rnd(-u * 3, u * 3), center.y, PALETTE[k % PALETTE.length], 1.1);
      for (let k = 0; k < 16; k++) ray(center.x, center.y, '#fff', (k / 16) * TAU, u * 6);
    }
  }

  // 블럭이 보드에 닿을 때 작은 먼지
  function land(cells, color) {
    if (reduce) return;
    for (const c of cells) for (let k = 0; k < 3; k++) {
      add({ t: 'shard', x: c.x + rnd(-6, 6), y: c.y + 8, vx: rnd(-50, 50), vy: rnd(-90, -30), g: 500, size: rnd(2, 4), color, rot: 0, vr: rnd(-4, 4), life: 0, ttl: 0.3 });
    }
  }

  // 레벨업: 방사형 빛살 + 큰 원 + 종이
  function levelUp(center, u) {
    if (reduce) return;
    flash('#4fd1ff', 0.25, 0.4);
    for (let k = 0; k < 24; k++) ray(center.x, center.y, k % 2 ? '#4fd1ff' : '#fff', (k / 24) * TAU + rnd(-0.1, 0.1), u * rnd(5, 8));
    ring(center.x, center.y, '#4fd1ff', u, u * 10, 0.8, 12);
    ring(center.x, center.y, '#fff', u * 0.5, u * 7, 0.6, 5);
    for (let k = 0; k < 60; k++) confetti(center.x + rnd(-u * 4, u * 4), center.y + rnd(-u, u), PALETTE[k % PALETTE.length], 1.2);
    for (let k = 0; k < 40; k++) spark(center.x, center.y, PALETTE[k % PALETTE.length], 1.6, 1.3);
  }

  // 보드를 완전히 비웠을 때: 불꽃놀이 3발
  function perfect(center, u) {
    if (reduce) return;
    flash('#ffd23f', 0.45, 0.5);
    const shots = [[0, 0], [-u * 3, -u * 2], [u * 3, u * 1.5]];
    shots.forEach(([dx, dy], i) => setTimeout(() => {
      const color = PALETTE[(i * 3) % PALETTE.length];
      ring(center.x + dx, center.y + dy, color, u * 0.3, u * 6, 0.7, 8);
      for (let k = 0; k < 70; k++) spark(center.x + dx, center.y + dy, k % 3 ? color : '#fff', 1.6, 1.5);
      for (let k = 0; k < 20; k++) shard(center.x + dx, center.y + dy, color, 1.8);
      kick();
    }, i * 260));
    for (let k = 0; k < 90; k++) confetti(center.x + rnd(-u * 4, u * 4), center.y - u * 3, PALETTE[k % PALETTE.length], 1.3);
  }

  // 콤보 열기: 0이면 끔. 보드 테두리에서 불씨가 계속 피어오른다.
  function setFever(level, box) {
    fever = reduce ? 0 : Math.max(0, Math.min(3, level));
    feverBox = box;
    if (fever) kick();
  }

  // ---------- 프레임 ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, W, H);
    hue = (hue + dt * 120) % 360;

    if (fever && feverBox) {
      const { x, y, w, h } = feverBox;
      // 테두리 빛 (단계가 높을수록 두껍고 색이 돈다)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 2 + fever * 2;
      ctx.strokeStyle = `hsla(${fever >= 3 ? hue : 30 + fever * 10}, 100%, 60%, ${0.25 + fever * 0.15})`;
      ctx.shadowBlur = 10 + fever * 8; ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();
      ctx.restore();
      // 불씨
      const rate = fever * 14 * dt;
      for (let k = 0; k < rate + (Math.random() < rate % 1 ? 1 : 0); k++) {
        const side = Math.random();
        const px = side < 0.5 ? x + Math.random() * w : (side < 0.75 ? x : x + w);
        const py = side < 0.5 ? (Math.random() < 0.5 ? y : y + h) : y + Math.random() * h;
        ember(px, py, fever >= 3 ? `hsl(${(hue + Math.random() * 60) % 360} 100% 65%)` : (Math.random() < 0.5 ? '#ffb020' : '#ff5d6c'));
      }
    }

    const alive = [];
    for (const p of parts) {
      p.life += dt;
      if (p.life >= p.ttl) continue;
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
        case 'beam': {
          const grow = Math.min(1, k * 3);
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          const horiz = p.w >= p.h;
          const g = horiz ? ctx.createLinearGradient(p.x, 0, p.x + p.w, 0) : ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, p.color); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.shadowBlur = 24; ctx.shadowColor = '#ffb020';
          if (horiz) ctx.fillRect(p.x + (p.w * (1 - grow)) / 2, p.y, p.w * grow, p.h);
          else ctx.fillRect(p.x, p.y + (p.h * (1 - grow)) / 2, p.w, p.h * grow);
          ctx.restore();
          break;
        }
        case 'flash':
          ctx.save(); ctx.globalAlpha = p.alpha * a; ctx.fillStyle = p.color; ctx.fillRect(0, 0, W, H); ctx.restore();
          break;
        case 'confetti':
          p.vy += p.g * dt; p.vx *= 0.99; p.x += (p.vx + Math.sin(p.life * 9 + p.ph) * 60) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          ctx.save(); ctx.globalAlpha = Math.min(1, a * 2); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.scale(Math.cos(p.life * 7 + p.ph), 1);
          ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
          break;
        case 'ray': {
          const len = p.len * Math.min(1, k * 2.5);
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          ctx.strokeStyle = p.color; ctx.lineWidth = 3 * a + 0.5; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.angle) * len, p.y + Math.sin(p.angle) * len); ctx.stroke();
          ctx.restore();
          break;
        }
      }
      alive.push(p);
    }
    parts = alive;
    if (parts.length || fever) raf = requestAnimationFrame(frame);
    else { raf = 0; ctx.clearRect(0, 0, W, H); }
  }

  return { resize, explode, land, levelUp, perfect, setFever, get count() { return parts.length; } };
}
