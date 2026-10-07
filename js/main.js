// 화면·조작. 규칙은 game.js, 저장은 storage.js, 서버는 online.js가 맡는다.
import { CFG, APP_VERSION } from './config.js';
import { SHAPES } from './shapes.js';
import * as G from './game.js';
import * as S from './storage.js';
import * as O from './online.js';
import { ACHIEVEMENTS, unlock, addHistory, rankOf } from './achievements.js';

const $ = (id) => document.getElementById(id);
const data = S.load();
const N = CFG.size;

let mode = 'classic';
let state = null;
let rivals = [];          // 넘어야 할 상대 [{ nickname, score }]
let passed = new Set();   // 이번 판에서 이미 추월 알림을 띄운 상대
let drag = null;

// ---------- 소리 ----------
let ac = null;
function beep(freq, dur = 0.08, delay = 0, vol = 0.07) {
  if (data.settings.mute) return;
  try {
    ac ??= new AudioContext();
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  } catch { /* 소리를 낼 수 없는 환경 */ }
}

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

function pieceEl(shapeId) {
  const s = SHAPES[shapeId];
  const el = document.createElement('div');
  el.className = 'piece';
  el.style.width = `calc(var(--u) * ${s.w})`;
  el.style.height = `calc(var(--u) * ${s.h})`;
  for (const [r, c] of s.cells) {
    const p = document.createElement('div');
    p.className = `pc k${s.color}`;
    p.style.left = `calc(var(--u) * ${c})`;
    p.style.top = `calc(var(--u) * ${r})`;
    el.appendChild(p);
  }
  return el;
}

function render(freshSlots = []) {
  state.board.forEach((v, i) => {
    if (v) cells[i].dataset.c = v; else delete cells[i].dataset.c;
  });
  slots.forEach((slot, i) => {
    const id = state.tray[i];
    if (slot.dataset.shape !== String(id) || freshSlots.includes(i)) {
      const el = pieceEl(id);
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

  const tc = G.trayCost(state), bc = G.boardCost(state);
  setText('trayCost', `${fmt(tc)}P`);
  setText('boardCost', `${fmt(bc)}P`);
  $('btnTray').disabled = state.over || state.points < tc;
  $('btnBoard').disabled = state.over || state.points < bc;
  $('btnTray').classList.toggle('urge', state.stuck);
  $('btnBoard').classList.toggle('urge', state.stuck);
  $('stuck').hidden = !state.stuck;

  const streak = data.local.streak;
  const bonus = Math.min(streak, CFG.streakBonusMaxDays) * CFG.streakBonusPerDay;
  $('streak').textContent = streak > 0 ? `연속 출석 ${streak}일 · 시작 보너스 +${bonus}P` : '';
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

// 내 역대 기록(일반 모드) 중 지금 점수 바로 위 기록. 넘어설 때 한 번씩 알린다.
function ownTargets(score) {
  const scores = [...new Set(data.local.history.filter((h) => h.mode === 'classic').map((h) => h.score))].sort((a, b) => b - a);
  for (const sc of scores) {
    const key = `own:${sc}`;
    if (sc < score && !passed.has(key) && state.moves > 0) {
      passed.add(key);
      const rank = scores.indexOf(sc) + 1;
      toast(rank === 1 ? '내 최고 기록을 넘었습니다!' : `내 ${rank}위 기록(${fmt(sc)})을 넘었습니다!`);
      beep(880, 0.1); beep(1175, 0.15, 0.1);
    }
  }
  const idx = scores.findIndex((sc) => sc >= score);
  return { next: idx >= 0 ? { rank: idx + 1, score: scores[idx] } : null };
}

function updateRival() {
  const el = $('rival');
  const score = state.score;
  for (const r of rivals) {
    if (r.score < score && !passed.has(r.nickname)) {
      passed.add(r.nickname);
      toast(`${r.nickname} 님을 추월했습니다!`);
      beep(880, 0.1); beep(1175, 0.15, 0.1);
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
    const startPoints = CFG.startPoints + Math.min(streak, CFG.streakBonusMaxDays) * CFG.streakBonusPerDay;
    state = G.newGame({ mode, startPoints });
  }
  newBestShown = state.score > best();
  persist();
  render([0, 1, 2]);
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
  beep(420, 0.04);
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

function checkAchievements(ev) {
  const local = { ...data.local, dailyDone: data.dailyDone };
  const got = unlock(data.local.achievements, { state, ev, local, mode }, S.todayKST());
  if (!got.length) return;
  S.save();
  got.forEach((id, i) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    setTimeout(() => {
      toast(`🏆 업적 달성: ${a.title} — ${a.desc}`, 2400);
      [660, 880, 1320].forEach((f, k) => beep(f, 0.12, k * 0.08));
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

// ---------- 줄 제거 이펙트 (파편·빛줄기) ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const colorOf = (n) => getComputedStyle(document.documentElement).getPropertyValue(`--c${n}`).trim() || '#fff';

function burst(cleared, colors, rows, cols) {
  if (reduceMotion) return;
  const fx = $('fx');
  const u = cells[0].getBoundingClientRect().width;
  const frag = document.createDocumentFragment();
  // 지워진 줄을 따라 지나가는 빛줄기
  for (const row of rows) {
    const b = document.createElement('div');
    b.className = 'beam';
    Object.assign(b.style, { left: '0', width: `${u * N}px`, top: `${row * u + u * .2}px`, height: `${u * .6}px` });
    frag.appendChild(b);
  }
  for (const col of cols) {
    const b = document.createElement('div');
    b.className = 'beam v';
    Object.assign(b.style, { top: '0', height: `${u * N}px`, left: `${col * u + u * .2}px`, width: `${u * .6}px` });
    frag.appendChild(b);
  }
  // 칸마다 색 파편이 사방으로 튄다
  const per = cleared.length > 24 ? 3 : 5;
  const sparks = [];
  for (const i of cleared) {
    const r = Math.floor(i / N), c = i % N;
    const cx = c * u + u / 2, cy = r * u + u / 2;
    for (let k = 0; k < per; k++) {
      const d = document.createElement('div');
      d.className = 'spark';
      d.style.setProperty('--pc', colors[i]);
      d.style.left = `${cx - 4}px`; d.style.top = `${cy - 4}px`;
      const ang = Math.random() * Math.PI * 2;
      const dist = u * (1 + Math.random() * 2.2);
      sparks.push([d, Math.cos(ang) * dist, Math.sin(ang) * dist + u * .8, 360 * (Math.random() - .5), 450 + Math.random() * 400]);
      frag.appendChild(d);
    }
  }
  fx.appendChild(frag);
  for (const [d, dx, dy, rot, ms] of sparks) {
    d.animate([
      { transform: 'translate(0,0) scale(1.3)', opacity: 1 },
      { transform: `translate(${dx * .6}px, ${dy * .4}px) scale(1)`, opacity: 1, offset: .35 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(.2)`, opacity: 0 },
    ], { duration: ms, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'forwards' }).onfinish = () => d.remove();
  }
  setTimeout(() => { for (const b of fx.querySelectorAll('.beam')) b.remove(); }, 500);
}

function doPlace(slot, r, c) {
  const before = state.board.slice(); // 지워지기 전 색을 이펙트에 쓴다
  const ev = G.place(state, slot, r, c);
  if (!ev) return;
  persist();
  render([slot]);
  flash(ev.placed.filter((i) => !ev.cleared.includes(i)), 'drop', 200);

  if (ev.lineCount > 0) {
    const shapeColor = SHAPES[ev.shapeId].color;
    const colors = {};
    for (const i of ev.cleared) {
      colors[i] = colorOf(before[i] || shapeColor);
      cells[i].style.setProperty('--pc', colors[i]);
    }
    flash(ev.cleared, 'pop', 500);
    burst(ev.cleared, colors, ev.rows, ev.cols);
    const b = $('board');
    b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');

    const notes = [];
    if (ev.lineCount > 1) notes.push(['더블!', '트리플!', '쿼드러플!'][Math.min(ev.lineCount, 4) - 2] + ` ${ev.lineCount}줄`);
    if (ev.combo > 1) notes.push(`${ev.combo} 콤보`);
    const big = ev.lineCount > 1 || ev.combo > 2;
    showCombo(`+${fmt(ev.gain)}`, notes.join(' · '), big);
    for (let i = 0; i < Math.min(ev.lineCount + ev.combo, 6); i++) beep(520 + i * 130, 0.12, i * 0.07);
    const w = $('boardWrap');
    w.classList.remove('shake', 'big'); void w.offsetWidth; w.classList.add('shake');
    if (big) { w.classList.add('big'); navigator.vibrate?.([30, 30, 60]); }
  } else {
    beep(260, 0.05);
  }

  if (ev.levelUp) {
    const lvEl = $('level');
    lvEl.classList.remove('up'); void lvEl.offsetWidth; lvEl.classList.add('up');
    flash(ev.stones, 'drop', 400);
    setTimeout(() => {
      const mult = G.scoreMult(ev.levelUp);
      showCombo(`LEVEL ${ev.levelUp}`, (ev.stones.length ? `기본 블럭 +${ev.stones.length} · ` : '') + `점수 ×${mult.toFixed(1)}`, true);
      [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.14, i * 0.09));
      navigator.vibrate?.(60);
      toast(`레벨 ${ev.levelUp}! 큰 블럭이 늘고 기본 블럭이 떨어집니다`, 2000);
    }, ev.lineCount > 0 ? 800 : 0);
  }

  if (mode === 'classic' && !newBestShown && best() > 0 && state.score > best()) {
    newBestShown = true;
    toast('최고 기록 돌파! 어디까지 갈 수 있을까요?');
  }
  checkAchievements(ev);
  if (state.over) setTimeout(finish, 500);
  else if (state.stuck) beep(180, 0.3);
}

function useRefresh(kind) {
  const ok = kind === 'tray' ? G.refreshTray(state) : G.refreshBoard(state);
  if (!ok) return;
  beep(660, 0.08); beep(990, 0.12, 0.08);
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
    moves: state.moves, refresh: state.trayRefreshes + state.boardRefreshes,
  });
  data.current[mode] = null;
  S.save();
  checkAchievements(null);

  const games = data.local.history.filter((h) => h.mode === 'classic').length;
  $('overOwn').textContent = mode === 'classic' && games > 1
    ? `내 역대 ${ownRank}위 (${games}판 중)` + (ownRank === 1 ? ' 🥇' : ownRank <= 3 ? ' 🏅' : '')
    : '';

  $('overBadge').hidden = !isRecord;
  $('overScore').textContent = fmt(state.score);
  $('overDetail').textContent = `레벨 ${state.level ?? 1} · 지운 줄 ${state.lines} · 최대 콤보 ${state.bestCombo} · 리프레시 ${state.trayRefreshes + state.boardRefreshes}회`;
  $('btnAgain').textContent = mode === 'daily' ? '일반 모드 하러 가기' : '다시 도전';
  $('overRank').textContent = '';
  $('dlgOver').showModal();
  if (isRecord) [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.18, i * 0.12));

  if (!O.enabled() || !O.profile) {
    $('overRank').textContent = O.enabled() ? '로그인하면 이 점수로 친구들과 순위를 겨룰 수 있습니다' : '';
    return;
  }
  const sent = await O.submitScore(state.score, mode, state.dailyDate);
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
  $('btnMute').classList.toggle('muted', data.settings.mute);
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
}

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('authId').value.trim();
  const pw = $('authPw').value;
  const nick = $('authNick').value.trim();
  const err = $('authError');
  if (!O.validateLoginId(id)) { err.textContent = '아이디는 영문·숫자·밑줄 3~16자로 입력해 주세요.'; return; }
  if (pw.length < 6) { err.textContent = '암호는 6자 이상이어야 합니다.'; return; }
  if (signupMode && (nick.length < 2 || nick.length > 12)) { err.textContent = '닉네임은 2~12자로 입력해 주세요.'; return; }
  err.textContent = '';
  $('authSubmit').disabled = true;
  try {
    if (signupMode) await O.signUp(id, nick, pw); else await O.signIn(id, pw);
    $('dlgAuth').close();
    $('authPw').value = '';
    toast(`${O.profile.nickname} 님, 환영합니다!`);
    await onLoggedIn();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    $('authSubmit').disabled = false;
  }
});
$('authSwitch').addEventListener('click', () => setSignupMode(!signupMode));

$('btnUser').addEventListener('click', () => {
  if (!needLogin()) return;
  const p = O.profile;
  $('userNick').textContent = p.nickname;
  $('userCode').textContent = p.friend_code;
  $('userStats').textContent = `최고 ${fmt(p.best_score)}점 · ${fmt(p.games_played)}판 · 연속 출석 ${p.streak}일`;
  $('dlgUser').showModal();
});

$('btnLogout').addEventListener('click', async () => {
  await O.signOut();
  $('dlgUser').close();
  refreshUser();
  render();
  loadRivals();
  toast('로그아웃했습니다');
});

// ---------- 랭킹 ----------
const rankSel = { scope: 'friends', period: 'week' };

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
}
$('btnRank').addEventListener('click', () => openRank());

// ---------- 내 기록·업적 ----------
let recTab = 'history';
const dateShort = (d) => (d || '').slice(5).replace('-', '/');

function loadRecords() {
  const list = $('recList');
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
      sm.textContent = `${h.level ? `Lv.${h.level} · ` : ''}줄 ${h.lines} · 콤보 ${h.combo} · 리프레시 ${h.refresh}회`;
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
  g.fillText(`레벨 ${state.level ?? 1} · 지운 줄 ${state.lines} · 최대 콤보 ${state.bestCombo} · 리프레시 ${state.trayRefreshes + state.boardRefreshes}회`, W / 2, oy + u * N + 50);
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
$('btnTray').addEventListener('click', () => useRefresh('tray'));
$('btnBoard').addEventListener('click', () => useRefresh('board'));
$('btnGiveUp').addEventListener('click', () => { G.giveUp(state); render(); finish(); });
$('btnMode').addEventListener('click', () => startGame(mode === 'daily' ? 'classic' : 'daily'));
$('btnMute').addEventListener('click', () => { data.settings.mute = !data.settings.mute; S.save(); refreshUser(); });
$('btnAgain').addEventListener('click', () => { $('dlgOver').close(); startGame('classic', mode === 'classic'); });
$('dlgOver').addEventListener('cancel', (e) => e.preventDefault());
for (const b of document.querySelectorAll('[data-close]')) {
  b.addEventListener('click', () => b.closest('dialog').close());
}

// ---------- 새 버전 감지 ----------
// GitHub Pages는 파일을 10분쯤 캐시한다. version.json(캐시 없이 읽음)이 더 새 버전이면
// 모든 파일을 서버에서 다시 받아 캐시를 갈아 끼운 뒤 새로고침한다.
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/config.js', 'js/shapes.js', 'js/game.js',
  'js/storage.js', 'js/online.js', 'js/main.js', 'vendor/supabase.js'];
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
O.init().then((p) => { if (p) onLoggedIn(); });
// 처음 온 사람(끝낸 판 없음)에게 한 번만 게임 방법을 보여 준다
if (!data.settings.helpShown && data.local.games === 0 && state.moves === 0) setTimeout(openHelp, 400);

// 검수용 창구 (테스트에서 현재 상태를 읽는다)
globalThis.__blockfill = { get state() { return state; }, get mode() { return mode; } };
