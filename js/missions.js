// 오늘의 미션: 날짜로 정해지는 목표 3개. 달성할 때마다 그날 일반 모드 시작 포인트가 늘어난다.
// DOM을 쓰지 않는 순수 로직. 진행 상황은 storage의 data.missions에 저장한다.
import { CFG } from './config.js';
import { seedFromString, rand } from './game.js';

// kind: 누적(sum) 또는 한 판 최대(max). tiers: [목표값, ...] 중 날짜로 하나 고른다.
const POOL = [
  { id: 'lines', kind: 'sum', tiers: [12, 20, 30], text: (n) => `줄 ${n}개 지우기` },
  { id: 'double', kind: 'sum', tiers: [1, 2, 3], text: (n) => `2줄 이상 동시 클리어 ${n}회` },
  { id: 'combo3', kind: 'sum', tiers: [1, 2, 3], text: (n) => `3콤보 ${n}회 만들기` },
  { id: 'score', kind: 'max', tiers: [600, 1000, 1500], text: (n) => `한 판에 ${n.toLocaleString('ko-KR')}점 넘기기` },
  { id: 'level', kind: 'max', tiers: [3, 4, 5], text: (n) => `한 판에 레벨 ${n} 도달` },
  { id: 'games', kind: 'sum', tiers: [2, 3, 4], text: (n) => `${n}판 끝까지 하기` },
  { id: 'big', kind: 'sum', tiers: [1, 2], text: (n) => `한 번에 16칸 이상 지우기 ${n}회` },
  { id: 'daily', kind: 'sum', tiers: [1], text: () => '오늘의 도전 끝까지 하기' },
  { id: 'bomb', kind: 'sum', tiers: [2, 4, 6], text: (n) => `폭탄 ${n}개 터뜨리기` },
];

// 날짜 문자열(YYYY-MM-DD) → 그날의 미션 3개. 모두에게 같다.
export function missionsFor(date) {
  const rng = { s: seedFromString(`mission-${date}`) };
  const pool = POOL.slice();
  const out = [];
  while (out.length < 3 && pool.length) {
    const t = pool.splice(Math.floor(rand(rng) * pool.length), 1)[0];
    const target = t.tiers[Math.floor(rand(rng) * t.tiers.length)];
    out.push({ id: t.id, kind: t.kind, target, text: t.text(target) });
  }
  return out;
}

export const emptyProgress = (date) => ({ date, progress: {}, done: {} });

// 날짜가 바뀌었으면 진행 상황을 초기화한다.
export function ensureDay(m, date) {
  if (!m || m.date !== date) return emptyProgress(date);
  m.progress ??= {}; m.done ??= {};
  return m;
}

function bump(m, missions, id, value, kind) {
  const mission = missions.find((x) => x.id === id);
  if (!mission || m.done[id]) return null;
  m.progress[id] = kind === 'max' ? Math.max(m.progress[id] || 0, value) : (m.progress[id] || 0) + value;
  if (m.progress[id] >= mission.target) { m.done[id] = true; return mission; }
  return null;
}

// 블럭을 놓은 뒤 호출. 새로 달성한 미션 목록을 돌려준다.
export function onPlace(m, missions, ev, state, mode) {
  const got = [];
  const add = (x) => { if (x) got.push(x); };
  if (ev.lineCount > 0) add(bump(m, missions, 'lines', ev.lineCount, 'sum'));
  if (ev.lineCount >= 2) add(bump(m, missions, 'double', 1, 'sum'));
  if (ev.combo === 3) add(bump(m, missions, 'combo3', 1, 'sum'));
  if (ev.cleared.length >= 16) add(bump(m, missions, 'big', 1, 'sum'));
  if (ev.bombs?.length) add(bump(m, missions, 'bomb', ev.bombs.length, 'sum'));
  if (mode === 'classic') {
    add(bump(m, missions, 'score', state.score, 'max'));
    add(bump(m, missions, 'level', state.level ?? 1, 'max'));
  }
  return got;
}

// 판이 끝난 뒤 호출.
export function onFinish(m, missions, state, mode) {
  const got = [];
  const add = (x) => { if (x) got.push(x); };
  add(bump(m, missions, 'games', 1, 'sum'));
  if (mode === 'daily') add(bump(m, missions, 'daily', 1, 'sum'));
  return got;
}

export const doneCount = (m) => Object.keys(m?.done || {}).length;
export const bonusPoints = (m) => doneCount(m) * CFG.missionBonus;
