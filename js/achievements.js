// 업적 정의와 판정. DOM을 쓰지 않는 순수 로직 (node 테스트 가능).
// ctx: { state, ev(놓기 결과, 없을 수 있음), local(기기 기록), mode }
export const ACHIEVEMENTS = [
  { id: 'first_line', title: '첫 줄', desc: '줄을 처음 지웠다', check: ({ state }) => state.lines >= 1 },
  { id: 'double', title: '더블', desc: '2줄을 동시에 지웠다', check: ({ ev }) => ev?.lineCount >= 2 },
  { id: 'triple', title: '트리플', desc: '3줄을 동시에 지웠다', check: ({ ev }) => ev?.lineCount >= 3 },
  { id: 'big_clear', title: '대청소', desc: '한 번에 16칸 이상 지웠다', check: ({ ev }) => ev?.cleared.length >= 16 },
  { id: 'combo3', title: '3콤보', desc: '3번 연속으로 줄을 지웠다', check: ({ state }) => state.bestCombo >= 3 },
  { id: 'combo5', title: '5콤보', desc: '5번 연속으로 줄을 지웠다', check: ({ state }) => state.bestCombo >= 5 },
  { id: 'score300', title: '300점', desc: '한 판에 300점을 넘겼다', check: ({ state }) => state.score >= 300 },
  { id: 'score1000', title: '1,000점', desc: '한 판에 1,000점을 넘겼다', check: ({ state }) => state.score >= 1000 },
  { id: 'score3000', title: '3,000점', desc: '한 판에 3,000점을 넘겼다', check: ({ state }) => state.score >= 3000 },
  { id: 'bomb1', title: '폭파 전문가', desc: '폭탄을 처음 터뜨렸다', check: ({ ev }) => ev?.bombs?.length >= 1 },
  { id: 'chain2', title: '연쇄 폭발', desc: '폭탄 2개가 연쇄로 터졌다', check: ({ ev }) => ev?.bombs?.length >= 2 },
  { id: 'chain3', title: '대폭발', desc: '폭탄 3개가 연쇄로 터졌다', check: ({ ev }) => ev?.bombs?.length >= 3 },
  { id: 'cluster2', title: '중첩 폭발', desc: '붙어 있는 폭탄 2개를 한꺼번에 터뜨렸다', check: ({ ev }) => ev?.waves?.some((w) => w.power >= 2) },
  { id: 'cluster3', title: '핵폭발', desc: '붙어 있는 폭탄 3개를 한꺼번에 터뜨렸다', check: ({ ev }) => ev?.waves?.some((w) => w.power >= 3) },
  { id: 'level5', title: '레벨 5', desc: '한 판에 레벨 5에 올랐다', check: ({ state }) => (state.level ?? 1) >= 5 },
  { id: 'level10', title: '레벨 10', desc: '한 판에 레벨 10에 올랐다', check: ({ state }) => (state.level ?? 1) >= 10 },
  { id: 'lines20', title: '정리왕', desc: '한 판에 줄 20개를 지웠다', check: ({ state }) => state.lines >= 20 },
  { id: 'pure500', title: '순수 실력', desc: '리프레시 없이 500점을 넘겼다',
    check: ({ state }) => state.score >= 500 && state.trayRefreshes === 0 },
  { id: 'spender', title: '큰손', desc: '한 판에 블럭 교체를 5번 썼다', check: ({ state }) => state.trayRefreshes >= 5 },
  { id: 'games10', title: '단골', desc: '10판을 끝까지 플레이했다', check: ({ local }) => local.games >= 10 },
  { id: 'games50', title: '중독', desc: '50판을 끝까지 플레이했다', check: ({ local }) => local.games >= 50 },
  { id: 'streak3', title: '개근 3일', desc: '3일 연속 접속했다', check: ({ local }) => local.streak >= 3 },
  { id: 'streak7', title: '개근 7일', desc: '7일 연속 접속했다', check: ({ local }) => local.streak >= 7 },
  { id: 'daily', title: '도전자', desc: '오늘의 도전을 끝까지 했다', check: ({ local }) => Object.keys(local.dailyDone || {}).length >= 1 },
];

// 새로 달성한 업적 id 목록을 돌려주고, unlocked에 날짜를 적는다.
export function unlock(unlocked, ctx, today) {
  const got = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;
    let ok = false;
    try { ok = !!a.check(ctx); } catch { ok = false; }
    if (ok) { unlocked[a.id] = today; got.push(a.id); }
  }
  return got;
}

// 개인 기록 목록에 한 판을 추가하고 최신 30판만 남긴다.
export const HISTORY_MAX = 30;
export function addHistory(history, entry) {
  history.unshift(entry);
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  return history;
}

// 점수가 역대 기록 중 몇 위인지 (1부터). history에 이미 들어 있는 판이면 자기 자신은 세지 않는다.
export const rankOf = (history, score) => history.filter((h) => h.mode === 'classic' && h.score > score).length + 1;
