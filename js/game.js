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

function randomShape(rng) {
  let x = rand(rng) * TOTAL_WEIGHT;
  for (const s of SHAPES) { x -= s.weight; if (x < 0) return s.id; }
  return SHAPES[SHAPES.length - 1].id;
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
    score: 0, points: startPoints, combo: 0, bestCombo: 0,
    trayRefreshes: 0, boardRefreshes: 0,
    moves: 0, lines: 0, stuck: false, over: false,
  };
  state.tray = state.tray.map(() => randomShape(rng));
  ensureMove(state);
  return state;
}

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
export const boardCost = (state) => Math.round(CFG.boardCostBase * CFG.boardCostGrowth ** state.boardRefreshes);

function updateStatus(state) {
  if (anyMove(state)) { state.stuck = false; return; }
  const canPay = state.points >= trayCost(state) || state.points >= boardCost(state);
  state.stuck = canPay;
  state.over = !canPay;
}

// 새 판을 시작하거나 유료 리프레시 직후에는 최소 한 수가 있도록 보장한다.
function ensureMove(state) {
  for (let i = 0; i < 50 && !anyMove(state); i++) {
    state.tray = state.tray.map(() => randomShape(state.rng));
  }
}

export function place(state, slot, r, c) {
  const shapeId = state.tray[slot];
  if (state.over || shapeId == null || !canPlace(state, shapeId, r, c)) return null;
  const shape = SHAPES[shapeId];
  const placed = shape.cells.map(([dr, dc]) => idx(r + dr, c + dc));
  for (const i of placed) state.board[i] = shape.color;

  const { rows, cols } = linesIfPlaced(state, shapeId, r, c);
  const cleared = new Set();
  for (const row of rows) for (let i = 0; i < CFG.size; i++) cleared.add(idx(row, i));
  for (const col of cols) for (let i = 0; i < CFG.size; i++) cleared.add(idx(i, col));
  for (const i of cleared) state.board[i] = 0;

  const lineCount = rows.length + cols.length;
  let gain = 0;
  if (lineCount > 0) {
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    const lineMult = CFG.lineMult[Math.min(lineCount, CFG.lineMult.length - 1)];
    const comboMult = Math.min(CFG.comboMaxMult, 1 + CFG.comboStep * (state.combo - 1));
    gain = Math.round(cleared.size * CFG.pointsPerCell * lineMult * comboMult);
    state.lines += lineCount;
  } else {
    state.combo = 0;
  }

  state.score += placed.length + gain;
  state.points += gain;
  state.moves += 1;
  state.tray[slot] = randomShape(state.rng); // 놓은 자리에 즉시 새 블럭
  updateStatus(state);

  return { shapeId, placed, cleared: [...cleared], rows, cols, lineCount, gain, combo: state.combo };
}

export function refreshTray(state) {
  const cost = trayCost(state);
  if (state.over || state.points < cost) return false;
  state.points -= cost;
  state.trayRefreshes += 1;
  state.tray = state.tray.map(() => randomShape(state.rng));
  ensureMove(state);
  updateStatus(state);
  return true;
}

export function refreshBoard(state) {
  const cost = boardCost(state);
  if (state.over || state.points < cost) return false;
  state.points -= cost;
  state.boardRefreshes += 1;
  state.board = makeBoard(state.rng);
  state.combo = 0;
  ensureMove(state);
  updateStatus(state);
  return true;
}

export function giveUp(state) {
  state.stuck = false;
  state.over = true;
}
