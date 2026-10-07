// 게임 규칙(순수 로직). 화면 코드에 의존하지 않으므로 node로 바로 테스트할 수 있다.
import { CFG } from './config.js';
import { SHAPES, TOTAL_WEIGHT } from './shapes.js';

export const STATE_VERSION = 1;
export const STONE = 8; // 기본 블럭 색 번호

// 시드 고정 난수(mulberry32). 상태가 정수 하나라 저장·복원이 쉽다.
export function rand(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 레벨: 지운 줄 수로 정해진다 (1부터).
export const levelOf = (state) => Math.min(CFG.level.max, 1 + Math.floor(state.lines / CFG.level.linesPerLevel));
export const linesToNextLevel = (state) =>
  levelOf(state) >= CFG.level.max ? 0 : CFG.level.linesPerLevel - (state.lines % CFG.level.linesPerLevel);
export const scoreMult = (level) => 1 + CFG.level.scoreBonus * (level - 1);

// 레벨이 오를수록 작은 블럭은 줄고 큰 블럭은 는다.
export function shapeWeight(shape, level) {
  const k = level - 1, n = shape.cells.length;
  if (n <= 3) return shape.weight * Math.max(CFG.level.smallFloor, 1 - CFG.level.smallDecay * k);
  if (n >= 5) return shape.weight * (1 + CFG.level.bigGrowth * k);
  return shape.weight;
}

function randomShape(rng, level = 1) {
  if (level <= 1) {
    let x = rand(rng) * TOTAL_WEIGHT;
    for (const s of SHAPES) { x -= s.weight; if (x < 0) return s.id; }
    return SHAPES[SHAPES.length - 1].id;
  }
  const ws = SHAPES.map((s) => shapeWeight(s, level));
  let x = rand(rng) * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < SHAPES.length; i++) { x -= ws[i]; if (x < 0) return SHAPES[i].id; }
  return SHAPES[SHAPES.length - 1].id;
}

// 빈 칸에 기본 블럭을 떨어뜨린다. 줄을 완성시키는 자리는 피한다. 떨어진 칸 번호를 돌려준다.
function dropStones(state, count) {
  const empties = [];
  state.board.forEach((v, i) => { if (!v) empties.push(i); });
  for (let i = empties.length - 1; i > 0; i--) { // 셔플 (난수는 state.rng만)
    const j = Math.floor(rand(state.rng) * (i + 1));
    [empties[i], empties[j]] = [empties[j], empties[i]];
  }
  const dropped = [];
  for (const i of empties) {
    if (dropped.length >= count) break;
    state.board[i] = STONE;
    if (hasFullLine(state.board)) { state.board[i] = 0; continue; }
    dropped.push(i);
  }
  return dropped;
}

const idx = (r, c) => r * CFG.size + c;

function lineFull(board, line, isRow) {
  for (let i = 0; i < CFG.size; i++) {
    if (!board[isRow ? idx(line, i) : idx(i, line)]) return false;
  }
  return true;
}

function hasFullLine(board) {
  for (let i = 0; i < CFG.size; i++) {
    if (lineFull(board, i, true) || lineFull(board, i, false)) return true;
  }
  return false;
}

function makeBoard(rng) {
  const n = CFG.size * CFG.size;
  for (;;) {
    const board = new Array(n).fill(0);
    let placed = 0;
    while (placed < CFG.prefill) {
      const i = Math.floor(rand(rng) * n);
      if (!board[i]) { board[i] = STONE; placed++; }
    }
    if (!hasFullLine(board)) return board;
  }
}

export function newGame({ mode = 'classic', seed, startPoints = 0, dailyDate = null } = {}) {
  const rng = { s: (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0 };
  const state = {
    v: STATE_VERSION, mode, dailyDate, rng,
    board: makeBoard(rng),
    tray: [0, 0, 0],
    trayBombs: [null, null, null], // 슬롯별 폭탄이 붙은 칸 번호(shape.cells의 인덱스) 또는 null
    bombs: [],                     // 보드 위 폭탄 칸 번호
    bombGauge: 0, bombCharges: 0,  // 지운 줄 누적, 다음 블럭에 붙일 폭탄 수
    level: 1,
    score: 0, points: startPoints, combo: 0, bestCombo: 0,
    trayRefreshes: 0,
    moves: 0, lines: 0, stuck: false, over: false,
  };
  for (let i = 0; i < 3; i++) newPiece(state, i);
  ensureMove(state);
  return state;
}

// 옛 저장 판(폭탄 없음)도 돌아가게 빠진 필드를 채운다.
function ensureBombFields(state) {
  state.trayBombs ??= [null, null, null];
  state.bombs ??= [];
  state.bombGauge ??= 0;
  state.bombCharges ??= 0;
}

// 슬롯에 새 블럭을 뽑는다. 충전된 폭탄이 있으면 블럭의 한 칸에 붙인다.
function newPiece(state, slot) {
  ensureBombFields(state);
  const id = randomShape(state.rng, state.level ?? 1);
  state.tray[slot] = id;
  if (state.bombCharges > 0) {
    state.bombCharges -= 1;
    state.trayBombs[slot] = Math.floor(rand(state.rng) * SHAPES[id].cells.length);
  } else {
    state.trayBombs[slot] = null;
  }
}
export const bombLinesLeft = (state) => Math.max(0, CFG.bomb.linesPerBomb - (state.bombGauge ?? 0));

export function canPlace(state, shapeId, r, c) {
  const shape = SHAPES[shapeId];
  if (!shape) return false;
  for (const [dr, dc] of shape.cells) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= CFG.size || cc >= CFG.size) return false;
    if (state.board[idx(rr, cc)]) return false;
  }
  return true;
}

export function shapeFits(state, shapeId) {
  for (let r = 0; r < CFG.size; r++) {
    for (let c = 0; c < CFG.size; c++) if (canPlace(state, shapeId, r, c)) return true;
  }
  return false;
}

export const anyMove = (state) => state.tray.some((id) => id != null && shapeFits(state, id));

// 이 위치에 놓으면 지워질 줄 (미리보기용)
export function linesIfPlaced(state, shapeId, r, c) {
  const board = state.board.slice();
  for (const [dr, dc] of SHAPES[shapeId].cells) board[idx(r + dr, c + dc)] = 1;
  const rows = [], cols = [];
  for (let i = 0; i < CFG.size; i++) {
    if (lineFull(board, i, true)) rows.push(i);
    if (lineFull(board, i, false)) cols.push(i);
  }
  return { rows, cols };
}

export const trayCost = (state) => Math.round(CFG.trayCostBase * CFG.trayCostGrowth ** state.trayRefreshes);

function updateStatus(state) {
  if (anyMove(state)) { state.stuck = false; return; }
  const canPay = state.points >= trayCost(state);
  state.stuck = canPay;
  state.over = !canPay;
}

// 새 판을 시작하거나 유료 리프레시 직후에는 최소 한 수가 있도록 보장한다.
function ensureMove(state) {
  for (let i = 0; i < 50 && !anyMove(state); i++) {
    for (let s = 0; s < 3; s++) newPiece(state, s);
  }
}

export function place(state, slot, r, c) {
  const shapeId = state.tray[slot];
  if (state.over || shapeId == null || !canPlace(state, shapeId, r, c)) return null;
  ensureBombFields(state);
  const shape = SHAPES[shapeId];
  const placed = shape.cells.map(([dr, dc]) => idx(r + dr, c + dc));
  for (const i of placed) state.board[i] = shape.color;
  const bombCell = state.trayBombs[slot];
  const placedBomb = bombCell != null ? placed[bombCell] : null;
  if (placedBomb != null) state.bombs.push(placedBomb);

  // 1차: 꽉 찬 줄. 2차~: 지워진 칸에 폭탄이 있으면 그 줄·칸이 십자로 터진다 (연쇄).
  const { rows, cols } = linesIfPlaced(state, shapeId, r, c);
  const cleared = new Set();
  const waves = []; // [{ cells, rows, cols, bomb }] 터지는 순서. 연출용
  const lineCells = [];
  for (const row of rows) for (let i = 0; i < CFG.size; i++) { const k = idx(row, i); if (!cleared.has(k)) { cleared.add(k); lineCells.push(k); } }
  for (const col of cols) for (let i = 0; i < CFG.size; i++) { const k = idx(i, col); if (!cleared.has(k)) { cleared.add(k); lineCells.push(k); } }
  if (lineCells.length) waves.push({ cells: lineCells, rows: rows.slice(), cols: cols.slice(), bomb: null });
  const exploded = [];
  let bombLines = 0;
  for (let w = 0; w < waves.length; w++) {
    for (const k of waves[w].cells) {
      if (!state.bombs.includes(k) || exploded.includes(k)) continue;
      exploded.push(k);
      const br = Math.floor(k / CFG.size), bc = k % CFG.size;
      const cellsW = [];
      for (let i = 0; i < CFG.size; i++) {
        for (const q of [idx(br, i), idx(i, bc)]) {
          if (!cleared.has(q) && state.board[q]) { cleared.add(q); cellsW.push(q); }
        }
      }
      bombLines += 2;
      waves.push({ cells: cellsW, rows: [br], cols: [bc], bomb: k });
    }
  }
  for (const i of cleared) state.board[i] = 0;
  state.bombs = state.bombs.filter((k) => !cleared.has(k));

  const lineCount = rows.length + cols.length + bombLines;
  const level = state.level ?? levelOf(state); // 옛 저장 판에는 level이 없다
  let gain = 0;
  if (lineCount > 0) {
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    const lineMult = CFG.lineMult[Math.min(lineCount, CFG.lineMult.length - 1)];
    const comboMult = Math.min(CFG.comboMaxMult, 1 + CFG.comboStep * (state.combo - 1));
    gain = Math.round(cleared.size * CFG.pointsPerCell * lineMult * comboMult * scoreMult(level));
    state.lines += lineCount;
    // 폭탄 게이지
    state.bombGauge += lineCount;
    while (state.bombGauge >= CFG.bomb.linesPerBomb) {
      state.bombGauge -= CFG.bomb.linesPerBomb;
      state.bombCharges = Math.min(CFG.bomb.maxCharges, state.bombCharges + 1);
    }
  } else {
    state.combo = 0;
  }

  state.score += placed.length + gain;
  state.points += Math.round(gain * (CFG.pointsRate ?? 1)); // 포인트는 점수보다 천천히 쌓인다
  state.moves += 1;

  // 레벨업: 기본 블럭이 떨어진다
  let levelUp = 0, stones = [];
  state.level = levelOf(state);
  if (state.level > level) {
    levelUp = state.level;
    stones = dropStones(state, Math.min(CFG.level.maxStones, (state.level - 1) * CFG.level.stonesPerLevel));
  }
  newPiece(state, slot); // 놓은 자리에 즉시 새 블럭
  updateStatus(state);

  return { shapeId, placed, cleared: [...cleared], rows, cols, lineCount, gain, combo: state.combo, level: state.level, levelUp, stones,
    waves, bombs: exploded, placedBomb };
}

export function refreshTray(state) {
  const cost = trayCost(state);
  if (state.over || state.points < cost) return false;
  state.points -= cost;
  state.trayRefreshes += 1;
  for (let s = 0; s < 3; s++) newPiece(state, s);
  ensureMove(state);
  updateStatus(state);
  return true;
}

export function giveUp(state) {
  state.stuck = false;
  state.over = true;
}
