// 기기 저장소. 버전 번호를 두고 구조가 바뀌면 단계별로 이전한다.
// 규칙: 저장 키를 바꾸거나 통째로 지우지 않는다. 새 필드는 migrate()에서 채운다.
const KEY = 'blockfill.save';
export const SCHEMA = 4;

const defaults = () => ({
  schema: SCHEMA,
  settings: { mute: false, helpShown: false }, // helpShown: 게임 방법을 한 번 보여 줬는가
  local: { best: 0, games: 0, streak: 0, lastPlay: null,
    history: [],        // 최근 판 기록 [{ score, date, mode, lines, combo, moves, refresh }] 최신순
    achievements: {} }, // { 업적id: 달성 날짜 }
  current: { classic: null, daily: null }, // 진행 중인 판
  dailyDone: {},                            // { 'YYYY-MM-DD': 점수 }
  pending: [],                              // 전송하지 못한 점수
  missions: { date: null, progress: {}, done: {} }, // 오늘의 미션 진행 (날짜가 바뀌면 초기화)
});

// 예) schema 1 → 2로 올릴 때:
//   if (data.schema < 2) { data.local.newField = 0; data.schema = 2; }
export function migrate(data) {
  const base = defaults();
  if (!data || typeof data !== 'object') return base;
  if (!data.schema) data.schema = 1;
  // 빠진 필드를 기본값으로 채운다 (기존 값은 그대로 둔다).
  for (const k of Object.keys(base)) {
    if (data[k] == null) data[k] = base[k];
    else if (typeof base[k] === 'object' && !Array.isArray(base[k])) data[k] = { ...base[k], ...data[k] };
  }
  if (data.schema < 2) { // v1.5: 개인 기록·업적
    data.local.history ??= [];
    data.local.achievements ??= {};
    data.schema = 2;
  }
  if (data.schema < 3) { // v1.6: 첫 실행 안내
    data.settings.helpShown ??= false;
    data.schema = 3;
  }
  if (data.schema < 4) { // v1.9: 오늘의 미션
    data.missions ??= { date: null, progress: {}, done: {} };
    data.schema = 4;
  }
  data.schema = SCHEMA;
  return data;
}

let cache = null;
let memoryOnly = false;

export function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = migrate(raw ? JSON.parse(raw) : null);
  } catch {
    memoryOnly = true; // 사생활 보호 모드 등: 저장 없이 진행
    cache = defaults();
  }
  return cache;
}

export function save() {
  if (!cache || memoryOnly) return;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 용량 초과 등은 무시 */ }
}

// 한국 시간 기준 날짜 (일일 도전과 출석을 모두 같은 기준으로 맞춘다)
export const todayKST = (offsetDays = 0) =>
  new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

export function touchStreak() {
  const d = load();
  const today = todayKST();
  if (d.local.lastPlay === today) return d.local.streak;
  d.local.streak = d.local.lastPlay === todayKST(-1) ? d.local.streak + 1 : 1;
  d.local.lastPlay = today;
  save();
  return d.local.streak;
}
