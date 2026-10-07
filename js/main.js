// 화면·조작. 규칙은 game.js, 저장은 storage.js, 서버는 online.js가 맡는다.
import { CFG, APP_VERSION, BGM_URL } from './config.js';
import { SHAPES } from './shapes.js';
import * as G from './game.js';
import * as S from './storage.js';
import * as O from './online.js';
import { ACHIEVEMENTS, unlock, addHistory, rankOf } from './achievements.js';
import * as M from './missions.js';
import { createFX } from './fx.js';
import * as A from './audio.js';

const $ = (id) => document.getElementById(id);
const data = S.load();
const N = CFG.size;

let mode = 'classic';
let state = null;
let rivals = [];          // 넘어야 할 상대 [{ nickname, score }]
let passed = new Set();   // 이번 판에서 이미 추월 알림을 띄운 상대
let drag = null;

// ---------- 소리 (js/audio.js, audio/*.wav) ----------
const sfx = (name, opts) => A.play(name, opts);
// 첫 조작 때 오디오를 깨우고 파일을 읽어 둔다 (브라우저 자동재생 정책)
function wakeAudio() {
  A.resume();
  A.preload('audio/', BGM_URL);
  A.startBgm();
}
for (const evn of ['pointerdown', 'keydown', 'touchstart']) addEventListener(evn, wakeAudio, { once: true, passive: true });

// 진동(손맛). 단계별 패턴. 지원하지 않는 기기(아이폰 등)에서는 조용히 무시된다.
const BUZZ = {
  land: 12, clear1: [18, 20, 30], clear2: [25, 25, 50, 25, 35], clear3: [40, 25, 80, 25, 60, 25, 40],
  clear4: [60, 20, 120, 20, 90, 20, 60, 20, 160], perfect: [80, 40, 160, 40, 240], levelUp: [50, 30, 50, 30, 120], refresh: 20,
};
function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch { /* 무시 */ } }

// ---------- 공통 ----------
let toastTimer = 0;
function toast(msg, ms = 1800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const fmt = (n) => Number(n).toLocaleString('ko-KR');
const best = () => Math.max(data.local.best, O.profile?.best_score || 0);

function setText(id, value, bump = false) {
  const el = $(id);
  const text = String(value);
  if (el.textContent === text) return;
  el.textContent = text;
  if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

// ---------- 보드·트레이 그리기 ----------
const cells = [];
for (let i = 0; i < N * N; i++) {
  const d = document.createElement('div');
  d.className = 'cell';
  $('board').appendChild(d);
  cells.push(d);
}

const slots = [];
for (let i = 0; i < 3; i++) {
  const d = document.createElement('div');
  d.className = 'slot';
  d.addEventListener('pointerdown', (e) => onDown(e, i));
  d.addEventListener('pointermove', onMove);
  d.addEventListener('pointerup', onUp);
  d.addEventListener('pointercancel', endDrag);
  $('tray').appendChild(d);
  slots.push(d);
}

function pieceEl(shapeId, bombCell = null) {
  const s = SHAPES[shapeId];
  const el = document.createElement('div');
  el.className = 'piece';
  el.style.width = `calc(var(--u) * ${s.w})`;
  el.style.height = `calc(var(--u) * ${s.h})`;
  s.cells.forEach(([r, c], k) => {
    const p = document.createElement('div');
    p.className = `pc k${s.color}` + (k === bombCell ? ' bomb' : '');
    p.style.left = `calc(var(--u) * ${c})`;
    p.style.top = `calc(var(--u) * ${r})`;
    el.appendChild(p);
  });
  return el;
}

function render(freshSlots = []) {
  const bombSet = new Set(state.bombs || []), hidSet = new Set(state.hidden || []);
  state.board.forEach((v, i) => {
    if (v) cells[i].dataset.c = v; else delete cells[i].dataset.c;
    cells[i].classList.toggle('bomb', bombSet.has(i));
    cells[i].classList.toggle('hid', hidSet.has(i) && !!v);
  });
  slots.forEach((slot, i) => {
    const id = state.tray[i];
    const bomb = state.trayBombs?.[i] ?? null;
    if (slot.dataset.shape !== String(id) || slot.dataset.bomb !== String(bomb) || freshSlots.includes(i)) {
      const el = pieceEl(id, bomb);
      slot.dataset.bomb = String(bomb);
      if (freshSlots.includes(i)) el.classList.add('fresh');
      slot.replaceChildren(el);
      slot.dataset.shape = id;
    }
    slot.classList.toggle('dead', !G.shapeFits(state, id));
  });

  setText('score', fmt(state.score), true);
  setText('best', fmt(Math.max(best(), mode === 'classic' ? state.score : 0)));
  setText('points', fmt(state.points), true);
  setText('modeLabel', mode === 'daily' ? '오늘의 도전' : '점수');
  const lv = state.level ?? G.levelOf(state);
  setText('level', `Lv.${lv}`);
  const toNext = G.linesToNextLevel(state);
  $('levelBar').style.width = toNext ? `${100 * (1 - toNext / CFG.level.linesPerLevel)}%` : '100%';
  $('level').title = toNext ? `다음 레벨까지 ${toNext}줄` : '최고 레벨';
  $('btnMode').textContent = mode === 'daily' ? '일반 모드' : '일일 도전';
  $('btnMode').classList.toggle('on', mode === 'daily');

  const tc = G.trayCost(state);
  // 폭탄 게이지
  const left = G.bombLinesLeft(state), charges = state.bombCharges || 0;
  $('bombGauge').classList.toggle('ready', charges > 0);
  $('bombBar').style.width = `${100 * (1 - left / CFG.bomb.linesPerBomb)}%`;
  $('bombText').textContent = charges > 0 ? (charges > 1 ? `×${charges} 준비` : '준비!') : `${left}줄`;
  setText('trayCost', `${fmt(tc)}P`);
  $('btnTray').disabled = state.over || state.points < tc;
  $('btnTray').classList.toggle('urge', state.stuck);
  $('stuck').hidden = !state.stuck;

  const streak = data.local.streak;
  const bonus = Math.min(streak, CFG.streakBonusMaxDays) * CFG.streakBonusPerDay;
  const mdone = M.doneCount(todayMissions());
  $('streak').textContent = (streak > 0 ? `연속 출석 ${streak}일 · 보너스 +${bonus}P` : '') + (mdone ? ` · 미션 ${mdone}/3 +${mdone * CFG.missionBonus}P` : '');
  updateRival();
}

// ---------- 라이벌 표시 ----------
async function loadRivals() {
  rivals = [];
  if (O.enabled() && O.profile) {
    try {
      const period = mode === 'daily' ? 'daily' : 'all';
      let rows = (await O.leaderboard('friends', period)).filter((r) => !r.is_me);
      if (!rows.length) rows = (await O.leaderboard('global', period)).filter((r) => !r.is_me);
      rivals = rows.map((r) => ({ nickname: r.nickname, score: r.score }));
    } catch { /* 랭킹을 못 불러와도 게임은 계속 */ }
  }
  passed = new Set(rivals.filter((r) => r.score <= state.score).map((r) => r.nickname));
  for (const h of data.local.history) if (h.score <= state.score) passed.add(`own:${h.score}`);
  updateRival();
}

// 전체 1위를 보드 위에 보여 준다 (로그인 상태일 때)
async function loadChampion() {
  const el = $('champ');
  if (!O.enabled() || !O.profile) { el.hidden = false; el.classList.remove('me'); el.textContent = O.enabled() ? '👑 로그인하면 전체 1위가 표시됩니다' : ''; return; }
  try {
    const rows = await O.leaderboard('global', 'all', 1);
    el.hidden = false;
    el.replaceChildren();
    if (!rows.length) { el.textContent = '👑 아직 전체 1위가 없습니다 · 첫 주인공이 되세요!'; el.classList.remove('me'); return; }
    const top = rows[0];
    el.classList.toggle('me', !!top.is_me);
    el.append(top.is_me ? '👑 전체 1위는 바로 나! ' : '👑 전체 1위 ');
    const b = document.createElement('b'); b.textContent = top.nickname;
    el.append(b, ` · ${fmt(top.score)}점`);
  } catch { el.hidden = true; }
}

// 내 역대 기록(일반 모드) 중 지금 점수 바로 위 기록. 넘어설 때 한 번씩 알린다.
function ownTargets(score) {
  const scores = [...new Set(data.local.history.filter((h) => h.mode === 'classic').map((h) => h.score))].sort((a, b) => b - a);
  for (const sc of scores) {
    const key = `own:${sc}`;
    if (sc < score && !passed.has(key) && state.moves > 0) {
      passed.add(key);
      const rank = scores.indexOf(sc) + 1;
      toast(rank === 1 ? '내 최고 기록을 넘었습니다!' : `내 ${rank}위 기록(${fmt(sc)})을 넘었습니다!`);
      sfx('pass');
    }
  }
  const idx = scores.findIndex((sc) => sc >= score);
  return { next: idx >= 0 ? { rank: idx + 1, score: scores[idx] } : null };
}

function updateRival() {
  const el = $('rivalText');
  const score = state.score;
  for (const r of rivals) {
    if (r.score < score && !passed.has(r.nickname)) {
      passed.add(r.nickname);
      toast(`${r.nickname} 님을 추월했습니다!`);
      sfx('pass', { rate: 1.1 });
      el.classList.remove('passed'); void el.offsetWidth; el.classList.add('passed');
    }
  }
  const ahead = rivals.filter((r) => r.score >= score).sort((a, b) => a.score - b.score)[0];
  const own = mode === 'classic' && !rivals.length ? ownTargets(score) : null;
  if (ahead) {
    el.replaceChildren();
    el.append('다음 목표 ');
    const b = document.createElement('b');
    b.textContent = ahead.nickname;
    el.append(b, ` 님까지 ${fmt(ahead.score - score + 1)}점`);
  } else if (rivals.length) {
    el.textContent = '모든 상대를 제쳤습니다. 지금 1위!';
  } else if (own?.next) {
    el.replaceChildren();
    el.append('내 ');
    const b = document.createElement('b');
    b.textContent = `${own.next.rank}위 기록(${fmt(own.next.score)})`;
    el.append(b, `까지 ${fmt(own.next.score - score + 1)}점`);
  } else if (mode === 'classic' && best() > 0) {
    el.textContent = '최고 기록 경신 중!';
  } else {
    el.textContent = !O.enabled() ? '줄을 지워 포인트를 모으고 최고 기록에 도전하세요'
      : O.profile ? '친구를 추가하면 여기에 다음 목표가 표시됩니다' : '로그인하면 친구 기록과 실시간으로 비교됩니다';
  }
}

// ---------- 판 시작·저장 ----------
function persist() {
  data.current[mode] = state.over ? null : state;
  S.save();
}

function startGame(nextMode, forceNew = false) {
  const today = S.todayKST();
  if (nextMode === 'daily' && data.dailyDone[today] != null) {
    toast(`오늘의 도전은 완료했습니다 (${fmt(data.dailyDone[today])}점). 내일 다시 도전하세요!`, 2600);
    if (state) return;
    nextMode = 'classic';
  }
  mode = nextMode;
  const saved = data.current[mode];
  const usable = saved && saved.v === G.STATE_VERSION && !saved.over
    && (mode !== 'daily' || saved.dailyDate === today);
  if (usable && !forceNew) {
    state = saved;
  } else if (mode === 'daily') {
    state = G.newGame({ mode, seed: G.seedFromString(`daily-${today}`), dailyDate: today, startPoints: CFG.startPoints });
  } else {
    const streak = S.touchStreak();
    const startPoints = CFG.startPoints + Math.min(streak, CFG.streakBonusMaxDays) * CFG.streakBonusPerDay + M.bonusPoints(todayMissions());
    state = G.newGame({ mode, startPoints });
  }
  newBestShown = state.score > best();
  persist();
  render([0, 1, 2]);
  setFever(state.combo || 0);
  loadRivals();
}

// ---------- 드래그 앤 드롭 ----------
function clearPreview() {
  for (const c of cells) c.classList.remove('ghost', 'will');
}

function onDown(e, slot) {
  if (drag || !state || state.over) return;
  const id = state.tray[slot];
  drag = { slot, id, pid: e.pointerId, touch: e.pointerType !== 'mouse', target: null };
  $('drag').replaceChildren(pieceEl(id));
  $('drag').style.display = 'block';
  slots[slot].classList.add('dragging');
  slots[slot].setPointerCapture(e.pointerId);
  sfx('place', { rate: 1.8, gain: 0.35 });
  onMove(e);
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  const s = SHAPES[drag.id];
  const origin = cells[0].getBoundingClientRect();
  const u = origin.width;
  const left = e.clientX - (s.w * u) / 2;
  // 터치에서는 손가락에 가리지 않도록 블럭을 위로 띄운다.
  const top = drag.touch ? e.clientY - u * 1.3 - s.h * u : e.clientY - (s.h * u) / 2;
  $('drag').style.transform = `translate(${left}px, ${top}px)`;

  const c = Math.round((left - origin.left) / u);
  const r = Math.round((top - origin.top) / u);
  clearPreview();
  if (G.canPlace(state, drag.id, r, c)) {
    drag.target = { r, c };
    for (const [dr, dc] of s.cells) cells[(r + dr) * N + c + dc].classList.add('ghost');
    const { rows, cols } = G.linesIfPlaced(state, drag.id, r, c);
    for (const row of rows) for (let i = 0; i < N; i++) cells[row * N + i].classList.add('will');
    for (const col of cols) for (let i = 0; i < N; i++) cells[i * N + col].classList.add('will');
  } else {
    drag.target = null;
  }
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  const { slot, target } = drag;
  endDrag();
  if (target) doPlace(slot, target.r, target.c);
}

function endDrag() {
  if (!drag) return;
  slots[drag.slot].classList.remove('dragging');
  $('drag').style.display = 'none';
  clearPreview();
  drag = null;
}

// ---------- 진행 ----------
let newBestShown = false;

// 오늘의 미션 (날짜가 바뀌면 자동 초기화)
function todayMissions() {
  const today = S.todayKST();
  if (data.missions?.date !== today) { data.missions = M.ensureDay(data.missions, today); S.save(); }
  return data.missions;
}
function missionList() { return M.missionsFor(S.todayKST()); }
function announceMissions(got) {
  if (!got.length) return;
  S.save();
  got.forEach((mi, i) => setTimeout(() => {
    toast(`🎯 미션 달성: ${mi.text} (+${CFG.missionBonus}P 시작 보너스)`, 2600);
    sfx('mission');
    render();
  }, 1200 + i * 2700));
}

function checkAchievements(ev) {
  const local = { ...data.local, dailyDone: data.dailyDone };
  const got = unlock(data.local.achievements, { state, ev, local, mode }, S.todayKST());
  if (!got.length) return;
  S.save();
  got.forEach((id, i) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    setTimeout(() => {
      toast(`🏆 업적 달성: ${a.title} — ${a.desc}`, 2400);
      sfx('achieve');
    }, 700 + i * 2500);
  });
}

function flash(list, cls, ms) {
  for (const i of list) cells[i].classList.add(cls);
  setTimeout(() => { for (const i of list) cells[i].classList.remove(cls); }, ms);
}

function showCombo(gain, note, big) {
  const el = $('comboText');
  $('comboGain').textContent = gain;
  $('comboNote').textContent = note;
  el.classList.toggle('big', big);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

// ---------- 이펙트 (캔버스 파티클, js/fx.js) ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const colorOf = (n) => getComputedStyle(document.documentElement).getPropertyValue(`--c${n}`).trim() || '#fff';
const fx = createFX($('fx'));
const FX_PAD = 56; // 캔버스가 보드 밖으로 이만큼 삐져나온다 (조각이 밖으로 튀도록)

function fxLayout() {
  const w = $('boardWrap').getBoundingClientRect();
  fx.resize(w.width + FX_PAD * 2, w.height + FX_PAD * 2);
}

// ---------- 화면 맞춤 ----------
// 보드 칸 크기를 '앱 영역에 남는 높이'로 계산해 px로 고정한다. vh 단위를 쓰면 모바일 주소창이 보였다 숨겨질 때
// 보드가 커졌다 작아지므로, 주소창이 보일 때 높이(svh)로 고정된 #app 안에서 한 번 계산하고 그 값을 유지한다.
let lastFit = '';
function fitLayout() {
  const app = $('app');
  const cs = getComputedStyle(app);
  const innerW = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const innerH = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  // 칸 크기와 무관한 고정 요소들의 높이
  const fixed = ['header', '.stats', '#rival', '.actions', 'footer'].reduce((a, sel) => a + (document.querySelector(sel)?.offsetHeight || 0), 0);
  const stuck = $('stuck').hidden ? 0 : $('stuck').offsetHeight;
  const gaps = parseFloat(cs.rowGap || cs.gap || 10) * (stuck ? 7 : 6);
  const avail = innerH - fixed - stuck - gaps - 8; // 8: 보드 안쪽 여백
  // 보드 8칸 + 트레이 2.7칸이 세로로 들어가야 한다
  const byH = avail / 10.7;
  const byW = (innerW - 8) / 8;
  let cell = Math.floor(Math.min(byW, byH, 55));
  app.classList.toggle('scroll', cell < 30);
  cell = Math.max(30, cell);
  const key = `${cell}:${innerW}:${innerH}`;
  if (key === lastFit) return;
  lastFit = key;
  document.documentElement.style.setProperty('--cell', `${cell}px`);
  fxLayout();
}
fitLayout();
addEventListener('orientationchange', () => setTimeout(fitLayout, 150));
// 1위 줄·막힘 안내 등 높이가 바뀌는 요소가 생기면 다시 맞춘다 (앱 영역 자체는 주소창에 영향받지 않는다)
new ResizeObserver(() => fitLayout()).observe($('app'));
for (const sel of ['#rival', '#stuck', 'header']) new ResizeObserver(() => fitLayout()).observe(document.querySelector(sel));
// 칸 번호 → 캔버스 좌표(중심)
function cellXY(i) {
  const wr = $('boardWrap').getBoundingClientRect();
  const r = cells[i].getBoundingClientRect();
  return { x: r.left - wr.left + FX_PAD + r.width / 2, y: r.top - wr.top + FX_PAD + r.height / 2, u: r.width };
}
function boardBox() {
  const wr = $('boardWrap').getBoundingClientRect(), b = $('board').getBoundingClientRect();
  return { x: b.left - wr.left + FX_PAD, y: b.top - wr.top + FX_PAD, w: b.width, h: b.height };
}
addEventListener('resize', () => { fitLayout(); fxLayout(); });
fxLayout();

// 점수가 보드에서 점수판으로 날아간다
function flyScore(text, from) {
  if (reduceMotion) return;
  const el = document.createElement('div');
  el.className = 'fly';
  el.textContent = text;
  $('flyLayer').appendChild(el);
  const to = $('score').getBoundingClientRect();
  el.style.left = `${from.x}px`; el.style.top = `${from.y}px`;
  const dx = to.left + to.width / 2 - from.x, dy = to.top + to.height / 2 - from.y;
  el.animate([
    { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 1, offset: 0.45 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.5)`, opacity: 0.9 },
  ], { duration: 750, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = () => {
    el.remove();
    const sc = $('score');
    sc.classList.remove('hot'); void sc.offsetWidth; sc.classList.add('hot');
    setTimeout(() => sc.classList.remove('hot'), 500);
  };
}

// 연쇄 파동용 화면 전체 섬광과 CHAIN 문구
const CHAIN_COLORS = ['#ffb020', '#ff5d6c', '#c36bff', '#4fd1ff', '#ffffff'];
function screenBlast(at, chainNo) {
  if (reduceMotion) return;
  const wr = $('boardWrap').getBoundingClientRect();
  const el = $('blastLayer');
  el.style.setProperty('--bx', `${((wr.left + at.x - FX_PAD) / innerWidth * 100).toFixed(1)}%`);
  el.style.setProperty('--by', `${((wr.top + at.y - FX_PAD) / innerHeight * 100).toFixed(1)}%`);
  el.style.setProperty('--bc', CHAIN_COLORS[Math.min(CHAIN_COLORS.length - 1, chainNo)]);
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
}
function chainText(chainNo, hidden, power = 1) {
  const el = $('chainText');
  const big = power >= 2 ? `💣×${power} ${power >= 4 ? 'NUCLEAR' : power >= 3 ? 'MEGA BLAST' : 'DOUBLE BLAST'}` : '';
  const chain = hidden ? `💣 숨은 폭탄! CHAIN ×${chainNo}` : chainNo >= 3 ? `💥 MEGA CHAIN ×${chainNo}` : `💥 CHAIN ×${chainNo}`;
  el.textContent = big ? `${big} · ${chain}` : chain;
  const lv = chainNo + power - 1;
  el.style.fontSize = `${Math.min(56, 28 + lv * 5)}px`;
  el.style.textShadow = `0 0 10px ${CHAIN_COLORS[Math.min(4, lv)]}, 0 0 30px ${CHAIN_COLORS[Math.min(4, lv)]}, 0 3px 0 rgba(0,0,0,.6)`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

// 콤보 단계별 문구·효과 (1: 보통, 2: 더블/콤보, 3: 불타는 중, 4: 광란)
function comboTier(ev) {
  if (ev.lineCount >= 3 || ev.combo >= 6) return 4;
  if (ev.lineCount >= 2 || ev.combo >= 4) return 3;
  if (ev.combo >= 2) return 2;
  return 1;
}
const COMBO_WORDS = { 2: ['COMBO!', 'NICE!', 'GOOD!'], 3: ['🔥 HOT!', '🔥 GREAT!', '🔥 AWESOME!'], 4: ['⚡ ON FIRE!', '💥 UNSTOPPABLE!', '🌈 LEGENDARY!'] };

function setFever(combo) {
  const lv = combo >= 6 ? 3 : combo >= 4 ? 2 : combo >= 2 ? 1 : 0;
  const b = $('board');
  b.classList.remove('fever1', 'fever2', 'fever3');
  if (lv) b.classList.add(`fever${lv}`);
  fx.setFever(lv, boardBox());
}

function shakeBoard(tier) {
  const w = $('boardWrap');
  w.classList.remove('shake', 'big', 'huge', 'hit'); void w.offsetWidth;
  w.classList.add('shake');
  if (tier >= 3) w.classList.add('big');
  if (tier >= 4) w.classList.add('huge');
  if (tier >= 2) w.classList.add('hit');
}

function doPlace(slot, r, c) {
  const before = state.board.slice(); // 지워지기 전 색을 이펙트에 쓴다
  before.charges = state.bombCharges || 0;
  const ev = G.place(state, slot, r, c);
  if (!ev) return;
  persist();
  render([slot]);
  const shapeColor = SHAPES[ev.shapeId].color;
  const stay = ev.placed.filter((i) => !ev.cleared.includes(i));
  flash(stay, 'drop', 200);
  const pp = ev.placed.map(cellXY);
  const impact = { x: pp.reduce((a, q) => a + q.x, 0) / pp.length, y: pp.reduce((a, q) => a + q.y, 0) / pp.length };
  fx.land(stay.map(cellXY), colorOf(shapeColor), impact, pp[0].u);
  if (!ev.lineCount) buzz(BUZZ.land);

  if (ev.lineCount > 0) {
    const tier = Math.min(4, comboTier(ev) + (ev.bombs.length >= 2 ? 2 : ev.bombs.length ? 1 : 0));
    const colors = {};
    for (const i of ev.cleared) {
      colors[i] = colorOf(before[i] || shapeColor);
      cells[i].style.setProperty('--pc', colors[i]);
    }
    const u = cellXY(0).u;
    const pts = ev.cleared.map(cellXY);
    // 놓은 자리에서 먼 칸일수록 늦게 터지고(연쇄 폭발), 폭탄 파동은 0.3초씩 뒤에 터진다
    const WAVE = 0.3;
    let maxDelay = 0;
    const delayOf = {};
    ev.waves.forEach((w, wi) => {
      const origin = w.bomb != null ? cellXY(w.bomb) : impact;
      for (const i of w.cells) {
        const c = cellXY(i);
        const d = wi * WAVE + Math.hypot(c.x - origin.x, c.y - origin.y) / u * 0.035;
        delayOf[i] = d; maxDelay = Math.max(maxDelay, d);
        cells[i].style.setProperty('--d', `${d.toFixed(3)}s`);
      }
    });
    flash(ev.cleared, 'pop', 500 + maxDelay * 1000);
    // 폭탄 파동: 점화 예고 → 화면 섬광 → 십자 레이저·불길 → CHAIN 문구. 파동이 거듭될수록 커진다
    const chainWaves = ev.waves.filter((w) => w.bomb != null);
    ev.waves.forEach((w, wi) => {
      if (w.bomb == null) return;
      const group = w.bombs || [w.bomb];
      const gp = group.map(cellXY);
      const b = { x: gp.reduce((a, q) => a + q.x, 0) / gp.length, y: gp.reduce((a, q) => a + q.y, 0) / gp.length }; // 덩어리 중심
      const chainNo = chainWaves.indexOf(w) + 1;
      const power = w.power || 1;
      // 덩어리의 폭탄 칸들은 자기 파동 시각까지 남아 하얗게 맥동한다 (점화 예고)
      sfx('fuse', { delay: Math.max(0, wi * WAVE - 0.25), gain: 0.8 });
      for (const bi of group) {
        cells[bi].style.setProperty('--d', `${(wi * WAVE).toFixed(3)}s`);
        cells[bi].classList.add('ignite');
        setTimeout(() => cells[bi].classList.remove('ignite'), wi * WAVE * 1000 + 600);
      }
      const bl = group.flatMap((bi) => {
        const q = cellXY(bi);
        return [{ cx: cellXY(Math.floor(bi / N) * N + N / 2).x, cy: q.y, horiz: true, len: u * N }, { cx: q.x, cy: cellXY(Math.floor(N / 2) * N + bi % N).y, horiz: false, len: u * N }];
      });
      setTimeout(() => {
        fx.bombBlast(b, u, bl, w.cells.map((i) => ({ ...cellXY(i), color: colors[i] })), chainNo - 1, w.hidden, power, w.radius || 0);
        screenBlast(b, chainNo + power - 1);
        chainText(chainNo, w.hidden, power);
        if (power >= 3 || chainNo >= 3) sfx('mega', { rate: 1 - Math.min(0.2, (power - 1) * 0.05) });
        else sfx(chainNo >= 2 ? 'chain' : 'bomb', { rate: 1 + chainNo * 0.06 });
        if (power >= 2) sfx('bomb', { rate: 0.85, gain: 0.8, delay: 0.05 });
        buzz(chainNo >= 2 || power >= 2 ? BUZZ.clear4 : BUZZ.clear3);
        shakeBoard(Math.min(4, 2 + chainNo + (power >= 2 ? 1 : 0)));
        const bd = $('board'); bd.classList.remove('punch'); void bd.offsetWidth; bd.classList.add('punch');
      }, wi * WAVE * 1000);
    });
    if (ev.revealed.length) setTimeout(() => toast('💣 기본 블럭 속에 숨어 있던 폭탄이 터졌습니다!', 2000), 300);
    const lines = [
      ...ev.rows.map((row) => { const a = cellXY(row * N), b = cellXY(row * N + N - 1); return { cx: (a.x + b.x) / 2, cy: a.y, horiz: true, len: b.x - a.x + u }; }),
      ...ev.cols.map((col) => { const a = cellXY(col), b = cellXY((N - 1) * N + col); return { cx: a.x, cy: (a.y + b.y) / 2, horiz: false, len: b.y - a.y + u }; }),
    ];
    const center = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    const w0 = ev.waves[0]?.bomb == null ? ev.waves[0] : null; // 1차 파동(꽉 찬 줄)만 일반 폭발로
    if (w0) fx.explode({ impact, cells: w0.cells.map((i) => ({ ...cellXY(i), color: colors[i] })), lines, center, u, power: tier });
    const b = $('board');
    b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');

    const notes = [];
    if (ev.lineCount > 1) notes.push(['더블', '트리플', '쿼드러플'][Math.min(ev.lineCount, 4) - 2] + ` ${ev.lineCount}줄`);
    if (ev.combo > 1) notes.push(`${ev.combo} 콤보`);
    const maxPower = Math.max(0, ...ev.waves.map((w) => w.power || 0));
    if (ev.bombs.length) notes.unshift(maxPower >= 2 ? `💣×${maxPower} 중첩 폭발` : ev.bombs.length >= 2 ? `💣 연쇄 폭발 ×${ev.bombs.length}` : '💣 폭발');
    const word = tier >= 2 ? COMBO_WORDS[tier][(ev.combo + ev.lineCount) % 3] + ' ' : '';
    const el = $('comboText');
    el.classList.remove('t2', 't3', 't4', 'huge');
    if (tier >= 2) el.classList.add(`t${tier}`);
    if (tier >= 4) el.classList.add('huge');
    showCombo(`+${fmt(ev.gain)}`, word + notes.join(' · '), tier >= 3);
    const wr = $('boardWrap').getBoundingClientRect();
    flyScore(`+${fmt(ev.gain)}`, { x: wr.left + center.x - FX_PAD, y: wr.top + center.y - FX_PAD });

    sfx(`clear${tier}`);
    sfx('bolt', { gain: 0.7 });
    ev.rows.concat(ev.cols).forEach((_, i) => sfx('laser', { rate: 1 + i * 0.1, gain: 0.6, delay: 0.05 + i * 0.04 }));
    if (ev.combo >= 2) sfx('combo', { rate: 1 + Math.min(6, ev.combo) * 0.07, delay: 0.12 });
    shakeBoard(tier);
    buzz(BUZZ[`clear${tier}`]);
    setFever(ev.combo);

    // 보드를 완전히 비웠다: 퍼펙트
    if (state.board.every((v) => !v)) {
      setTimeout(() => {
        el.classList.remove('t2', 't3'); el.classList.add('t4', 'huge');
        showCombo('PERFECT!', '보드를 전부 비웠습니다', true);
        fx.perfect(center, u);
        sfx('perfect');
        shakeBoard(4);
        buzz(BUZZ.perfect);
      }, 650);
    }
  } else {
    sfx('place', { rate: 0.9 + Math.random() * 0.2 });
    setFever(0);
  }

  if ((state.bombCharges || 0) > (before.charges || 0)) {
    const g = $('bombGauge');
    g.classList.remove('charged'); void g.offsetWidth; g.classList.add('charged');
    setTimeout(() => { toast('💣 폭탄 충전! 다음 블럭에 붙습니다', 1800); sfx('charge'); }, ev.lineCount ? 900 : 0);
  }

  if (ev.levelUp) {
    const lvEl = $('level');
    lvEl.classList.remove('up'); void lvEl.offsetWidth; lvEl.classList.add('up');
    flash(ev.stones, 'drop', 400);
    setTimeout(() => {
      const mult = G.scoreMult(ev.levelUp);
      const el = $('comboText');
      el.classList.remove('t2', 't3', 't4', 'huge'); el.classList.add('t2');
      showCombo(`LEVEL ${ev.levelUp}`, (ev.stones.length ? `기본 블럭 +${ev.stones.length} · ` : '') + `점수 ×${mult.toFixed(1)}`, true);
      const c = cellXY(Math.floor(N * N / 2) + N / 2);
      fx.levelUp({ x: c.x - c.u / 2, y: c.y - c.u / 2 }, c.u);
      sfx('levelup');
      buzz(BUZZ.levelUp);
      toast(`레벨 ${ev.levelUp}! 큰 블럭이 늘고 기본 블럭이 떨어집니다`, 2000);
    }, ev.lineCount > 0 ? 900 : 0);
  }

  if (mode === 'classic' && !newBestShown && best() > 0 && state.score > best()) {
    newBestShown = true;
    toast('최고 기록 돌파! 어디까지 갈 수 있을까요?');
  }
  checkAchievements(ev);
  announceMissions(M.onPlace(todayMissions(), missionList(), ev, state, mode));
  if (state.over) setTimeout(finish, 500);
  else if (state.stuck) sfx('stuck');
}

function useRefresh() {
  if (!G.refreshTray(state)) return;
  sfx('refresh');
  buzz(BUZZ.refresh);
  persist();
  render([0, 1, 2]);
  if (state.over) setTimeout(finish, 400);
}

async function finish() {
  const prevBest = best();
  const isRecord = mode === 'classic' && state.score > prevBest;
  if (mode === 'classic') {
    data.local.best = Math.max(data.local.best, state.score);
  } else {
    data.dailyDone[state.dailyDate] = state.score;
  }
  data.local.games += 1;
  const ownRank = mode === 'classic' ? rankOf(data.local.history, state.score) : 0;
  addHistory(data.local.history, {
    score: state.score, date: S.todayKST(), mode, lines: state.lines, combo: state.bestCombo, level: state.level ?? 1,
    moves: state.moves, refresh: state.trayRefreshes,
  });
  data.current[mode] = null;
  S.save();
  checkAchievements(null);
  announceMissions(M.onFinish(todayMissions(), missionList(), state, mode));
  const md = M.doneCount(todayMissions());
  $('overMission').textContent = `오늘의 미션 ${md}/3` + (md < 3 ? ' · 달성하면 내일까지 시작 포인트가 늘어납니다' : ' · 모두 달성! 🎉');

  const games = data.local.history.filter((h) => h.mode === 'classic').length;
  $('overOwn').textContent = mode === 'classic' && games > 1
    ? `내 역대 ${ownRank}위 (${games}판 중)` + (ownRank === 1 ? ' 🥇' : ownRank <= 3 ? ' 🏅' : '')
    : '';

  $('overBadge').hidden = !isRecord;
  $('overScore').textContent = fmt(state.score);
  $('overDetail').textContent = `레벨 ${state.level ?? 1} · 지운 줄 ${state.lines} · 최대 콤보 ${state.bestCombo} · 블럭 교체 ${state.trayRefreshes}회`;
  $('btnAgain').textContent = mode === 'daily' ? '일반 모드 하러 가기' : '다시 도전';
  $('overRank').textContent = '';
  $('dlgOver').showModal();
  sfx(isRecord ? 'record' : 'gameover');

  if (!O.enabled() || !O.profile) {
    $('overRank').textContent = O.enabled() ? '로그인하면 이 점수로 친구들과 순위를 겨룰 수 있습니다' : '';
    return;
  }
  const sent = await O.submitScore(state.score, mode, state.dailyDate);
  loadChampion();
  if (!sent) { $('overRank').textContent = '점수를 보관했습니다. 연결되면 자동으로 전송됩니다.'; return; }
  try {
    const period = mode === 'daily' ? 'daily' : 'week';
    const rows = await O.leaderboard('friends', period);
    const me = rows.find((r) => r.is_me);
    const label = mode === 'daily' ? '오늘의 도전' : '이번 주';
    if (me && rows.length > 1) {
      const above = rows.filter((r) => r.score > me.score).pop();
      $('overRank').textContent = `${label} 친구 ${rows.length}명 중 ${me.rank}위`
        + (above ? ` · ${above.nickname} 님과 ${fmt(above.score - me.score)}점 차` : ' · 1위 수성!');
    } else if (me) {
      $('overRank').textContent = '친구를 추가하고 순위를 겨뤄 보세요';
    }
  } catch { /* 순위 표시는 생략 */ }
}

// ---------- 계정 ----------
let signupMode = false;

function needOnline() {
  if (O.enabled()) return true;
  toast('온라인 기능이 아직 연결되지 않았습니다 (README의 서버 설정 참고)', 2600);
  return false;
}

function needLogin() {
  if (!needOnline()) return false;
  if (O.profile) return true;
  openAuth();
  return false;
}

function openAuth() {
  $('authError').textContent = '';
  setSignupMode(false);
  $('dlgAuth').showModal();
  prefillLogin($('authId'), $('authPw'));
}

function setSignupMode(on) {
  signupMode = on;
  $('authTitle').textContent = on ? '회원가입' : '로그인';
  $('authSubmit').textContent = on ? '가입하고 시작' : '로그인';
  $('authSwitch').textContent = on ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입';
  $('nickRow').hidden = !on;
  $('authPw').autocomplete = on ? 'new-password' : 'current-password';
}

function refreshUser() {
  $('btnUser').textContent = O.profile ? O.profile.nickname : '로그인';
  const snd = data.settings.sound || 'all';
  A.setMode(snd);
  $('btnMute').textContent = { all: '🔊', sfx: '🔉', off: '🔇' }[snd];
  $('btnMute').classList.toggle('muted', snd === 'off');
}

async function onLoggedIn() {
  refreshUser();
  const p = O.profile;
  // 다른 기기에서 쌓은 연속 출석을 이어받는다.
  if (p?.last_play_date && p.last_play_date >= S.todayKST(-1) && p.streak > data.local.streak) {
    data.local.streak = p.streak;
    data.local.lastPlay = p.last_play_date;
    S.save();
  }
  await O.flushPending();
  render();
  loadRivals();
  loadChampion();
}

// 로그인·회원가입 공통 처리. 시작 화면과 게임 안 대화창이 같이 쓴다.
async function doAuth({ id, pw, nick, signup, err, btn }) {
  if (!O.validateLoginId(id)) { err.textContent = '아이디는 영문·숫자·밑줄 3~16자로 입력해 주세요.'; return false; }
  if (pw.length < 6) { err.textContent = '암호는 6자 이상이어야 합니다.'; return false; }
  if (signup && (nick.length < 2 || nick.length > 12)) { err.textContent = '닉네임은 2~12자로 입력해 주세요.'; return false; }
  err.textContent = '';
  btn.disabled = true;
  try {
    if (signup) await O.signUp(id, nick, pw); else await O.signIn(id, pw);
    data.settings.lastLoginId = id; S.save(); // 다음 로그인 때 아이디를 미리 채운다
    toast(`${O.profile.nickname} 님, 환영합니다!`);
    sfx('login');
    await onLoggedIn();
    return true;
  } catch (ex) {
    err.textContent = ex.message;
    return false;
  } finally {
    btn.disabled = false;
  }
}

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await doAuth({ id: $('authId').value.trim(), pw: $('authPw').value, nick: $('authNick').value.trim(), signup: signupMode, err: $('authError'), btn: $('authSubmit') });
  if (ok) { $('dlgAuth').close(); $('authPw').value = ''; }
});
$('authSwitch').addEventListener('click', () => setSignupMode(!signupMode));

// ---------- 시작 화면 (로그인 후 게임) ----------
let startSignup = false;
function setStartMode(on) {
  startSignup = on;
  $('startTitle').textContent = on ? '회원가입' : '로그인';
  $('startSubmit').textContent = on ? '가입하고 시작' : '로그인';
  $('startSwitch').textContent = on ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입';
  $('startNickRow').hidden = !on;
  $('startPw').autocomplete = on ? 'new-password' : 'current-password';
  $('startError').textContent = '';
}
function showStart(status = '') {
  const el = $('start');
  el.classList.remove('hide');
  el.hidden = false;
  $('startForm').hidden = !O.enabled();
  $('startStatus').textContent = status || (O.enabled() ? '' : '온라인 기능이 아직 연결되지 않았습니다. 게스트로 플레이할 수 있습니다.');
  $('startGuest').hidden = false;
  $('startGuest').textContent = O.enabled() ? '게스트로 둘러보기 (기록은 이 기기에만 저장)' : '게임 시작';
  setStartMode(false);
  prefillLogin($('startId'), $('startPw'));
}

// 마지막으로 로그인한 아이디를 채우고, 채워졌으면 커서를 암호 칸으로 보낸다
function prefillLogin(idEl, pwEl) {
  const last = data.settings.lastLoginId || '';
  if (!last || idEl.value) return;
  idEl.value = last;
  setTimeout(() => { try { pwEl.focus({ preventScroll: true }); } catch { /* 무시 */ } }, 50);
}
let entered = false;
function enterGame() {
  const el = $('start');
  el.classList.add('hide');
  setTimeout(() => { el.hidden = true; }, 380);
  if (!entered) {
    entered = true;
    // 처음 온 사람(끝낸 판 없음)에게 한 번만 게임 방법을 보여 준다
    if (!data.settings.helpShown && data.local.games === 0 && state.moves === 0) setTimeout(openHelp, 450);
  }
}
$('startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await doAuth({ id: $('startId').value.trim(), pw: $('startPw').value, nick: $('startNick').value.trim(), signup: startSignup, err: $('startError'), btn: $('startSubmit') });
  if (ok) { $('startPw').value = ''; enterGame(); }
});
$('startSwitch').addEventListener('click', () => setStartMode(!startSignup));
$('startGuest').addEventListener('click', enterGame);

$('btnUser').addEventListener('click', () => {
  if (!needLogin()) return;
  const p = O.profile;
  $('userNick').textContent = p.nickname;
  $('userCode').textContent = p.friend_code;
  $('userStats').textContent = `최고 ${fmt(p.best_score)}점 · ${fmt(p.games_played)}판 · 연속 출석 ${p.streak}일`;
  $('nickInput').value = p.nickname;
  $('nickError').textContent = '';
  $('dlgUser').showModal();
});

$('nickForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = $('nickInput').value.trim();
  const err = $('nickError');
  if (nick.length < 2 || nick.length > 12) { err.textContent = '닉네임은 2~12자로 입력해 주세요.'; return; }
  if (nick === O.profile?.nickname) { err.textContent = '지금 닉네임과 같습니다.'; return; }
  err.textContent = '';
  $('btnNick').disabled = true;
  try {
    await O.setNickname(nick);
    $('userNick').textContent = O.profile.nickname;
    refreshUser();
    loadChampion();
    toast(`닉네임을 ${O.profile.nickname}(으)로 바꿨습니다`);
    sfx('achieve');
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    $('btnNick').disabled = false;
  }
});

$('btnLogout').addEventListener('click', async () => {
  await O.signOut();
  loadChampion();
  $('dlgUser').close();
  refreshUser();
  render();
  loadRivals();
  toast('로그아웃했습니다');
  showStart();
});

// ---------- 랭킹 ----------
const rankSel = { scope: 'global', period: 'all' };

function listMessage(listEl, msg) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = msg;
  listEl.replaceChildren(li);
}

async function loadRank() {
  const list = $('rankList');
  listMessage(list, '불러오는 중…');
  try {
    const rows = await O.leaderboard(rankSel.scope, rankSel.period);
    if (!rows.length) { listMessage(list, '아직 기록이 없습니다. 첫 번째 주인공이 되어 보세요!'); return; }
    list.replaceChildren(...rows.map((r) => {
      const li = document.createElement('li');
      if (r.is_me) li.className = 'me';
      const rk = Object.assign(document.createElement('span'), { className: 'rk', textContent: r.rank });
      const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: r.nickname + (r.is_me ? ' (나)' : '') });
      const sc = Object.assign(document.createElement('span'), { className: 'sc', textContent: fmt(r.score) });
      li.append(rk, nm, sc);
      return li;
    }));
  } catch (ex) {
    listMessage(list, ex.message);
  }
}

function bindTabs(id, key) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of $(id).children) b.classList.toggle('on', b === btn);
    rankSel[key] = btn.dataset.v;
    loadRank();
  });
}
bindTabs('rankScope', 'scope');
bindTabs('rankPeriod', 'period');

function openRank(period) {
  if (!needLogin()) return;
  if (period) {
    rankSel.period = period;
    for (const b of $('rankPeriod').children) b.classList.toggle('on', b.dataset.v === period);
  }
  $('dlgRank').showModal();
  loadRank();
  loadChampion();
}
$('btnRank').addEventListener('click', () => openRank());

// ---------- 내 기록·업적 ----------
let recTab = 'history';
const dateShort = (d) => (d || '').slice(5).replace('-', '/');

function loadRecords() {
  const list = $('recList');
  if (recTab === 'missions') {
    const m = todayMissions();
    const list = $('recList');
    $('recSummary').textContent = `${S.todayKST()} · ${M.doneCount(m)}/3 달성 · 시작 보너스 +${M.bonusPoints(m)}P (매일 자정에 새 미션)`;
    list.replaceChildren(...missionList().map((mi) => {
      const li = document.createElement('li');
      const done = !!m.done[mi.id];
      const cur = Math.min(mi.target, m.progress[mi.id] || 0);
      li.className = 'mission' + (done ? ' done' : '');
      const ic = Object.assign(document.createElement('span'), { className: 'ic', textContent: done ? '✅' : '🎯' });
      const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: mi.text });
      const pc = Object.assign(document.createElement('span'), { className: 'pct', textContent: done ? `+${CFG.missionBonus}P` : `${fmt(cur)} / ${fmt(mi.target)}` });
      const bar = document.createElement('span'); bar.className = 'prog';
      const fill = document.createElement('i'); fill.style.width = `${Math.round(100 * cur / mi.target)}%`;
      bar.appendChild(fill);
      li.append(ic, nm, pc, bar);
      return li;
    }));
    return;
  }
  if (recTab === 'history') {
    const hist = data.local.history;
    const classic = hist.filter((h) => h.mode === 'classic');
    const top = [...classic].sort((a, b) => b.score - a.score).slice(0, 5);
    const avg = classic.length ? Math.round(classic.reduce((a, h) => a + h.score, 0) / classic.length) : 0;
    $('recSummary').textContent = classic.length
      ? `일반 모드 ${classic.length}판 · 평균 ${fmt(avg)}점 · 최고 ${fmt(Math.max(best(), top[0]?.score || 0))}점`
      : '아직 끝낸 판이 없습니다. 한 판 끝내면 여기에 기록됩니다.';
    if (!hist.length) { listMessage(list, '첫 판을 끝내고 기록을 남겨 보세요!'); return; }
    const row = (h, rk) => {
      const li = document.createElement('li');
      const r = Object.assign(document.createElement('span'), { className: 'rk', textContent: rk });
      const nm = Object.assign(document.createElement('span'), { className: 'nm' });
      nm.textContent = h.mode === 'daily' ? `오늘의 도전 ${dateShort(h.date)}` : dateShort(h.date);
      const sm = document.createElement('small');
      sm.textContent = `${h.level ? `Lv.${h.level} · ` : ''}줄 ${h.lines} · 콤보 ${h.combo} · 교체 ${h.refresh}회`;
      nm.appendChild(sm);
      const sc = Object.assign(document.createElement('span'), { className: 'sc', textContent: fmt(h.score) });
      li.append(r, nm, sc);
      return li;
    };
    const head = (text) => Object.assign(document.createElement('li'), { className: 'empty', textContent: text });
    list.replaceChildren(head('🏆 개인 TOP 5'), ...top.map((h, i) => row(h, i + 1)),
      head('🕘 최근 판'), ...hist.slice(0, 10).map((h) => row(h, '·')));
  } else {
    const got = data.local.achievements;
    const n = Object.keys(got).length;
    $('recSummary').textContent = `${ACHIEVEMENTS.length}개 중 ${n}개 달성`;
    list.replaceChildren(...ACHIEVEMENTS.map((a) => {
      const li = document.createElement('li');
      li.className = got[a.id] ? '' : 'locked';
      const ic = Object.assign(document.createElement('span'), { className: 'ic', textContent: got[a.id] ? '🏆' : '🔒' });
      const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: a.title });
      const sm = document.createElement('small');
      sm.textContent = a.desc + (got[a.id] ? ` · ${dateShort(got[a.id])}` : '');
      nm.appendChild(sm);
      li.append(ic, nm);
      return li;
    }));
  }
}
$('recTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  for (const b of $('recTabs').children) b.classList.toggle('on', b === btn);
  recTab = btn.dataset.v;
  loadRecords();
});
function openRecords() { $('dlgRecords').showModal(); loadRecords(); }
$('btnRecords').addEventListener('click', openRecords);
$('btnOverRecords').addEventListener('click', openRecords);
$('btnOverRank').addEventListener('click', () => openRank(mode === 'daily' ? 'daily' : 'week'));

// ---------- 친구 ----------
async function loadFriends() {
  const list = $('friendList');
  listMessage(list, '불러오는 중…');
  try {
    const rows = await O.listFriends();
    if (!rows.length) { listMessage(list, '아직 친구가 없습니다. 코드를 주고받아 경쟁을 시작하세요!'); return; }
    list.replaceChildren(...rows.map((f) => {
      const li = document.createElement('li');
      const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: f.nickname });
      const sc = Object.assign(document.createElement('span'), { className: 'sc', textContent: fmt(f.best_score) });
      const rm = Object.assign(document.createElement('button'), { className: 'mini', textContent: '삭제' });
      rm.addEventListener('click', async () => {
        if (!confirm(`${f.nickname} 님을 친구에서 삭제할까요?`)) return;
        try { await O.removeFriend(f.friend_id); loadFriends(); loadRivals(); } catch (ex) { toast(ex.message); }
      });
      li.append(nm, sc, rm);
      return li;
    }));
  } catch (ex) {
    listMessage(list, ex.message);
  }
}

$('btnFriends').addEventListener('click', () => {
  if (!needLogin()) return;
  $('myCode').textContent = O.profile.friend_code;
  $('friendError').textContent = '';
  $('dlgFriends').showModal();
  loadFriends();
});

$('btnAddFriend').addEventListener('click', async () => {
  const code = $('friendCode').value.trim();
  if (code.length !== 6) { $('friendError').textContent = '친구 코드 6자리를 입력해 주세요.'; return; }
  try {
    const nick = await O.addFriend(code);
    $('friendCode').value = '';
    $('friendError').textContent = '';
    toast(`${nick} 님과 친구가 되었습니다!`);
    loadFriends();
    loadRivals();
  } catch (ex) {
    $('friendError').textContent = ex.message;
  }
});

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('복사하지 못했습니다'); }
}
$('btnCopyCode').addEventListener('click', () => copyText(O.profile.friend_code, '친구 코드를 복사했습니다'));
$('btnShare').addEventListener('click', () => {
  const code = O.profile ? ` 친구 코드 ${O.profile.friend_code}` : '';
  copyText(`BLOCK FILL에서 ${fmt(state.score)}점! 내 기록 깰 수 있어?${code}\n${location.href}`, '결과를 복사했습니다');
});

// ---------- 결과 이미지 ----------
function resultImage() {
  const W = 720, H = 1010;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g.roundRect) g.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); }; // 옛 브라우저
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#12131c'); grad.addColorStop(1, '#1d2033');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.fillStyle = '#eef0f8'; g.font = '900 44px system-ui, sans-serif';
  g.fillText('BLOCK', W / 2 - 58, 80);
  g.fillStyle = css('--accent'); g.fillText('FILL', W / 2 + 62, 80);
  g.fillStyle = '#8b90a8'; g.font = '600 24px system-ui, sans-serif';
  g.fillText(mode === 'daily' ? `오늘의 도전 ${state.dailyDate}` : '일반 모드', W / 2, 122);
  g.fillStyle = css('--accent'); g.font = '900 120px system-ui, sans-serif';
  g.fillText(fmt(state.score), W / 2, 250);
  g.fillStyle = '#eef0f8'; g.font = '700 26px system-ui, sans-serif';
  const own = $('overOwn').textContent || (!$('overBadge').hidden ? '최고 기록 갱신! 🎉' : '');
  if (own) g.fillText(own, W / 2, 300);
  // 보드 스냅샷
  const u = 64, ox = (W - u * N) / 2, oy = 340;
  g.fillStyle = '#1c1e2b';
  g.beginPath(); g.roundRect(ox - 10, oy - 10, u * N + 20, u * N + 20, 16); g.fill();
  state.board.forEach((v, i) => {
    const x = ox + (i % N) * u, y = oy + Math.floor(i / N) * u;
    g.fillStyle = v ? (v === G.STONE ? css('--c8') : css(`--c${v}`)) : '#262939';
    g.beginPath(); g.roundRect(x + 3, y + 3, u - 6, u - 6, 8); g.fill();
    if (v) { g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.roundRect(x + 3, y + u - 13, u - 6, 10, 6); g.fill(); }
  });
  g.fillStyle = '#8b90a8'; g.font = '600 22px system-ui, sans-serif';
  g.fillText(`레벨 ${state.level ?? 1} · 지운 줄 ${state.lines} · 최대 콤보 ${state.bestCombo} · 블럭 교체 ${state.trayRefreshes}회`, W / 2, oy + u * N + 50);
  g.fillStyle = '#eef0f8'; g.font = '800 26px system-ui, sans-serif';
  g.fillText('내 기록 깰 수 있어?', W / 2, oy + u * N + 95);
  g.fillStyle = css('--accent2'); g.font = '600 20px system-ui, sans-serif';
  g.fillText(location.origin + location.pathname, W / 2, oy + u * N + 128);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

async function shareImage() {
  const btn = $('btnShareImg');
  btn.disabled = true;
  try {
    const blob = await resultImage();
    const file = new File([blob], `blockfill-${state.score}.png`, { type: 'image/png' });
    const text = `BLOCK FILL에서 ${fmt(state.score)}점! 내 기록 깰 수 있어?`;
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'BLOCK FILL', text });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('이미지를 저장했습니다. 친구에게 보내 보세요!');
    }
  } catch (ex) {
    if (ex?.name !== 'AbortError') toast('이미지를 만들지 못했습니다');
  } finally {
    btn.disabled = false;
  }
}
$('btnShareImg').addEventListener('click', shareImage);

// ---------- 게임 방법 ----------
function openHelp() {
  data.settings.helpShown = true;
  S.save();
  $('dlgHelp').showModal();
}
$('btnHelp').addEventListener('click', () => { $('dlgRecords').close(); openHelp(); });

// ---------- 버튼 ----------
$('btnTray').addEventListener('click', useRefresh);
$('btnGiveUp').addEventListener('click', () => { G.giveUp(state); render(); finish(); });
$('btnMode').addEventListener('click', () => startGame(mode === 'daily' ? 'classic' : 'daily'));
$('btnMute').addEventListener('click', () => {
  const order = ['all', 'sfx', 'off'];
  const next = order[(order.indexOf(data.settings.sound || 'all') + 1) % 3];
  data.settings.sound = next; data.settings.mute = next === 'off'; S.save(); refreshUser();
  toast({ all: '🔊 효과음 + 음악', sfx: '🔉 효과음만', off: '🔇 소리 끔' }[next], 1200);
  if (next !== 'off') sfx('combo', { gain: 0.6 });
});
$('btnAgain').addEventListener('click', () => { $('dlgOver').close(); startGame('classic', mode === 'classic'); });
$('dlgOver').addEventListener('cancel', (e) => e.preventDefault());
for (const b of document.querySelectorAll('[data-close]')) {
  b.addEventListener('click', () => b.closest('dialog').close());
}

// ---------- 새 버전 감지 ----------
// GitHub Pages는 파일을 10분쯤 캐시한다. version.json(캐시 없이 읽음)이 더 새 버전이면
// 모든 파일을 서버에서 다시 받아 캐시를 갈아 끼운 뒤 새로고침한다.
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/config.js', 'js/shapes.js', 'js/game.js', 'js/storage.js', 'js/online.js',
  'js/main.js', 'js/fx.js', 'js/audio.js', 'js/achievements.js', 'js/missions.js', 'vendor/supabase.js'];
const newer = (a, b) => { // a가 b보다 새 버전인가 ("1.10.0" > "1.9.0")
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
async function applyUpdate(version) {
  const btn = $('update');
  btn.disabled = true;
  btn.textContent = '업데이트 중…';
  await Promise.allSettled(ASSETS.map((a) => fetch(a, { cache: 'reload' })));
  try { sessionStorage.setItem('blockfill.updated', version); } catch { /* 무시 */ }
  location.reload();
}
async function checkUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || !newer(version, APP_VERSION)) return;
    let tried = null;
    try { tried = sessionStorage.getItem('blockfill.updated'); } catch { /* 무시 */ }
    const btn = $('update');
    btn.hidden = false;
    btn.onclick = () => applyUpdate(version);
    if (tried !== version && !drag) applyUpdate(version); // 처음 발견했으면 자동으로, 실패했으면 버튼으로
  } catch { /* 오프라인 등 */ }
}

// ---------- 시작 ----------
$('version').textContent = `v${APP_VERSION}`;
$('versionFoot').textContent = `v${APP_VERSION}`;
checkUpdate();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
refreshUser();
startGame('classic');
loadChampion();
// 시작 화면을 먼저 띄우고, 이미 로그인된 기기면 바로 게임으로 들어간다
$('start').hidden = false;
$('startForm').hidden = true;
$('startStatus').textContent = '자동 로그인 확인 중…';
O.init().then((p) => {
  if (p) { onLoggedIn(); enterGame(); } else showStart();
}).catch(() => showStart());

// 검수용 창구 (테스트에서 현재 상태를 읽는다)
globalThis.__blockfill = { get state() { return state; }, get mode() { return mode; }, audio: A };
