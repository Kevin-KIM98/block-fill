// 실행: node tests/game.test.mjs
import assert from 'node:assert/strict';
import { CFG, APP_VERSION } from '../js/config.js';
import { SHAPES } from '../js/shapes.js';
import * as G from '../js/game.js';
import { migrate, SCHEMA } from '../js/storage.js';
import { ACHIEVEMENTS, unlock, addHistory, rankOf, HISTORY_MAX } from '../js/achievements.js';
import { readFileSync } from 'node:fs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const N = CFG.size;
const shapeByName = (n) => SHAPES.find((s) => s.name === n).id;
const empty = (extra = {}) => {
  const s = G.newGame({ seed: 1 });
  s.board.fill(0);
  return Object.assign(s, extra);
};

test('version.json과 config.js의 APP_VERSION이 같다 (배포 시 둘 다 올릴 것)', () => {
  const v = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8')).version;
  assert.equal(v, APP_VERSION);
});

test('모양 목록에 중복이 없고 모두 5x5 안에 들어간다', () => {
  const keys = new Set(SHAPES.map((s) => JSON.stringify(s.cells)));
  assert.equal(keys.size, SHAPES.length);
  assert.ok(SHAPES.length >= 20);
  for (const s of SHAPES) assert.ok(s.w <= 5 && s.h <= 5);
});

test('모양(기본형)마다 고유한 색이 있고, 회전형은 같은 색이며, 기본 블럭 색과 겹치지 않는다', () => {
  const byBase = new Map();
  for (const s of SHAPES) {
    const base = s.name.replace(/_\d+$/, '');
    if (byBase.has(base)) assert.equal(byBase.get(base), s.color, `${base} 회전형 색 불일치`);
    byBase.set(base, s.color);
    assert.notEqual(s.color, G.STONE);
    assert.ok(Number.isInteger(s.color) && s.color >= 1);
  }
  assert.equal(new Set(byBase.values()).size, byBase.size, '기본형끼리 색이 겹침');
});

test('테트리스 7종(ㅡ·ㅁ·ㅜ·S·Z·ㄱ·ㄴ)이 전체 뽑기 비중의 60% 이상이다', () => {
  const tetris = new Set(['i4', 'o2', 't4', 's4', 'z4', 'l4', 'j4']);
  const total = SHAPES.reduce((a, s) => a + s.weight, 0);
  const share = SHAPES.filter((s) => tetris.has(s.name.replace(/_\d+$/, ''))).reduce((a, s) => a + s.weight, 0) / total;
  assert.ok(share >= 0.6, `테트리스 비중 ${(share * 100).toFixed(0)}%`);
  // ㄱ·ㄴ(L·J)은 네 방향 모두 나온다
  for (const b of ['l4', 'j4', 't4']) assert.equal(SHAPES.filter((s) => s.name.startsWith(b + '_')).length, 4);
});

test('새 판: 기본 블럭이 깔리고, 완성된 줄이 없고, 놓을 수 있다', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = G.newGame({ seed });
    assert.equal(s.board.filter(Boolean).length, CFG.prefill);
    assert.equal(s.tray.length, 3);
    assert.ok(G.anyMove(s));
    assert.equal(s.over, false);
  }
});

test('같은 시드는 같은 판을 만든다 (일일 도전)', () => {
  const a = G.newGame({ seed: G.seedFromString('daily-2026-10-07') });
  const b = G.newGame({ seed: G.seedFromString('daily-2026-10-07') });
  assert.deepEqual(a.board, b.board);
  assert.deepEqual(a.tray, b.tray);
  const c = G.newGame({ seed: G.seedFromString('daily-2026-10-08') });
  assert.notDeepEqual([a.board, a.tray], [c.board, c.tray]);
});

test('블럭을 놓으면 그 칸에 새 블럭이 생기고 나머지는 그대로다', () => {
  const s = empty();
  s.tray = [shapeByName('dot_0'), shapeByName('o2_0'), shapeByName('i3_0')];
  const before = s.tray.slice();
  const ev = G.place(s, 1, 0, 0);
  assert.ok(ev);
  assert.equal(s.tray[0], before[0]);
  assert.equal(s.tray[2], before[2]);
  assert.ok(s.tray[1] != null);
  assert.equal(s.board.filter(Boolean).length, 4);
  assert.equal(s.score, 4);
});

test('겹치거나 보드 밖이면 놓을 수 없다', () => {
  const s = empty();
  s.tray = [shapeByName('o2_0'), shapeByName('o2_0'), shapeByName('o2_0')];
  G.place(s, 0, 0, 0);
  s.tray[0] = shapeByName('o2_0');
  assert.equal(G.place(s, 0, 1, 1), null);
  assert.equal(G.place(s, 0, N - 1, N - 1), null);
  assert.equal(G.place(s, 0, -1, 0), null);
});

test('가로줄이 차면 지워지고 칸 수 x 10 포인트를 얻는다', () => {
  const s = empty();
  for (let c = 0; c < N - 1; c++) s.board[c] = 1;
  s.tray[0] = shapeByName('dot_0');
  const ev = G.place(s, 0, 0, N - 1);
  assert.equal(ev.lineCount, 1);
  assert.equal(ev.cleared.length, N);
  assert.equal(ev.gain, N * CFG.pointsPerCell);
  assert.equal(s.points, 80);
  assert.equal(s.score, 81);
  assert.equal(s.board.filter(Boolean).length, 0);
});

test('가로·세로 동시 클리어는 배수가 붙는다', () => {
  const s = empty();
  for (let i = 1; i < N; i++) { s.board[i] = 1; s.board[i * N] = 1; }
  s.tray[0] = shapeByName('dot_0');
  const ev = G.place(s, 0, 0, 0);
  assert.equal(ev.lineCount, 2);
  assert.equal(ev.cleared.length, 15);
  assert.equal(ev.gain, Math.round(15 * 10 * CFG.lineMult[2]));
});

test('연속 클리어는 콤보 배수가 오르고, 끊기면 초기화된다', () => {
  const s = empty();
  const fillRow = (r) => { for (let c = 0; c < N - 1; c++) s.board[r * N + c] = 1; };
  fillRow(0); fillRow(1);
  s.tray[0] = shapeByName('dot_0');
  const a = G.place(s, 0, 0, N - 1);
  s.tray[0] = shapeByName('dot_0');
  const b = G.place(s, 0, 1, N - 1);
  assert.equal(a.combo, 1);
  assert.equal(b.combo, 2);
  assert.equal(b.gain, Math.round(80 * (1 + CFG.comboStep)));
  s.tray[0] = shapeByName('dot_0');
  G.place(s, 0, 4, 4);
  assert.equal(s.combo, 0);
});

test('리프레시 비용은 쓸 때마다 오른다', () => {
  const s = empty({ points: 100000 });
  const tray = [], board = [];
  for (let i = 0; i < 4; i++) { tray.push(G.trayCost(s)); assert.ok(G.refreshTray(s)); }
  for (let i = 0; i < 4; i++) { board.push(G.boardCost(s)); assert.ok(G.refreshBoard(s)); }
  assert.deepEqual(tray, [50, 75, 113, 169]);
  assert.deepEqual(board, [200, 400, 800, 1600]);
  assert.equal(s.points, 100000 - 407 - 3000);
});

test('포인트가 모자라면 리프레시되지 않는다', () => {
  const s = empty({ points: 49 });
  const tray = s.tray.slice();
  assert.equal(G.refreshTray(s), false);
  assert.equal(G.refreshBoard(s), false);
  assert.deepEqual(s.tray, tray);
  assert.equal(s.points, 49);
  assert.equal(s.trayRefreshes, 0);
});

test('보드 리프레시는 기본 블럭 판으로 되돌린다', () => {
  const s = empty({ points: 200 });
  s.board.fill(1, 0, 40);
  assert.ok(G.refreshBoard(s));
  assert.equal(s.board.filter(Boolean).length, CFG.prefill);
  assert.equal(s.points, 0);
  assert.ok(G.anyMove(s));
});

// 체스판 무늬로 채우면 1칸 블럭 말고는 들어갈 곳이 없다.
function checker(s) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) s.board[r * N + c] = (r + c) % 2 ? 1 : 0;
}

test('놓을 곳이 없고 포인트도 없으면 게임 종료', () => {
  const s = empty();
  checker(s);
  s.tray = [shapeByName('dot_0'), shapeByName('o3_0'), shapeByName('o3_0')];
  s.rng = { s: 12345 };
  let guard = 0;
  // 1칸 블럭이 다시 나오면 계속 놓는다. 포인트는 0이므로 막히면 바로 종료다.
  while (!s.over && guard++ < 200) {
    const slot = s.tray.findIndex((id) => G.shapeFits(s, id));
    assert.notEqual(slot, -1);
    const i = s.board.findIndex((v) => !v);
    s.points = 0;
    assert.ok(G.place(s, slot, Math.floor(i / N), i % N));
  }
  assert.equal(s.over, true);
  assert.equal(s.stuck, false);
  assert.equal(G.place(s, 0, 0, 0), null);
});

test('놓을 곳이 없어도 포인트가 있으면 리프레시로 이어 간다', () => {
  const s = empty({ points: 60 });
  checker(s);
  s.board[0] = 0; s.board[1] = 0;
  s.tray = [shapeByName('i2_0'), shapeByName('o3_0'), shapeByName('o3_0')];
  // 새 블럭이 무엇이 나오든 판정이 맞는지 확인한다.
  G.place(s, 0, 0, 0);
  if (!G.anyMove(s)) {
    assert.equal(s.stuck, true);
    assert.equal(s.over, false);
    assert.ok(G.refreshTray(s));
    assert.equal(s.points, 10);
  }
  G.giveUp(s);
  assert.equal(s.over, true);
});

test('무작위 1000판: 규칙이 깨지지 않는다', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const s = G.newGame({ seed });
    let guard = 0;
    while (!s.over && guard++ < 5000) {
      if (s.stuck) {
        const ok = G.refreshTray(s) || G.refreshBoard(s);
        assert.ok(ok, 'stuck 상태면 리프레시를 살 수 있어야 한다');
        continue;
      }
      let done = false;
      for (let slot = 0; slot < 3 && !done; slot++) {
        for (let i = 0; i < N * N && !done; i++) {
          if (G.canPlace(s, s.tray[slot], Math.floor(i / N), i % N)) {
            assert.ok(G.place(s, slot, Math.floor(i / N), i % N));
            done = true;
          }
        }
      }
      assert.ok(done, 'stuck도 over도 아니면 놓을 곳이 있어야 한다');
      assert.ok(s.points >= 0);
      for (let l = 0; l < N; l++) {
        let row = 0, col = 0;
        for (let k = 0; k < N; k++) { row += s.board[l * N + k] ? 1 : 0; col += s.board[k * N + l] ? 1 : 0; }
        assert.ok(row < N && col < N, '꽉 찬 줄이 남아 있으면 안 된다');
      }
    }
    assert.ok(s.over, '판이 끝나야 한다');
  }
});

test('저장 데이터 이전: 옛 데이터의 값은 유지하고 빠진 필드만 채운다', () => {
  const old = { local: { best: 4321 }, settings: { mute: true } };
  const m = migrate(JSON.parse(JSON.stringify(old)));
  assert.equal(m.schema, SCHEMA);
  assert.equal(m.local.best, 4321);
  assert.equal(m.local.streak, 0);
  assert.equal(m.settings.mute, true);
  assert.deepEqual(m.pending, []);
  assert.deepEqual(m.local.history, []);
  assert.deepEqual(m.local.achievements, {});
  assert.equal(migrate(null).local.best, 0);
  // schema 1 → 2: 기존 값은 그대로, 기록·업적 필드만 생긴다
  const v1 = { schema: 1, local: { best: 9, games: 3, streak: 2, lastPlay: '2026-10-01' } };
  const m2 = migrate(v1);
  assert.equal(m2.schema, SCHEMA);
  assert.equal(m2.settings.helpShown, false);
  assert.equal(m2.local.games, 3);
  assert.deepEqual(m2.local.history, []);
});

test('업적: 조건을 만족하면 한 번만 달성되고 날짜가 남는다', () => {
  const got = {};
  const s = empty({ lines: 1, bestCombo: 3, score: 350 });
  const local = { games: 0, streak: 0, dailyDone: {} };
  const first = unlock(got, { state: s, ev: { lineCount: 2, cleared: new Array(16) }, local, mode: 'classic' }, '2026-10-07');
  assert.deepEqual(first.sort(), ['big_clear', 'combo3', 'double', 'first_line', 'score300'].sort());
  assert.equal(got.double, '2026-10-07');
  // 같은 조건을 다시 넣어도 또 달성되지 않는다
  assert.deepEqual(unlock(got, { state: s, ev: { lineCount: 2, cleared: new Array(16) }, local, mode: 'classic' }, '2026-10-08'), []);
  // ev가 없어도(판 종료 시) 오류 없이 판정한다
  assert.deepEqual(unlock(got, { state: s, ev: null, local: { games: 10, streak: 0, dailyDone: {} }, mode: 'classic' }, '2026-10-08'), ['games10']);
  assert.ok(ACHIEVEMENTS.every((a) => a.id && a.title && a.desc && typeof a.check === 'function'));
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

test('개인 기록: 최신순으로 쌓이고 상한을 넘지 않으며 순위를 계산한다', () => {
  const h = [];
  for (let i = 1; i <= HISTORY_MAX + 5; i++) addHistory(h, { score: i * 10, mode: 'classic' });
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[0].score, (HISTORY_MAX + 5) * 10); // 가장 최근 판이 맨 앞
  assert.equal(rankOf(h, 10 ** 9), 1);
  assert.equal(rankOf(h, h[0].score - 5), 2);
  addHistory(h, { score: 10 ** 9, mode: 'daily' }); // 일일 도전 점수는 일반 순위에 끼지 않는다
  assert.equal(rankOf(h, 10 ** 9 - 1), 1);
});

test('진행 중인 판은 JSON으로 저장했다가 그대로 이어진다', () => {
  const a = G.newGame({ seed: 77 });
  const b = JSON.parse(JSON.stringify(a));
  const spot = (s) => { for (let i = 0; i < N * N; i++) if (G.canPlace(s, s.tray[0], Math.floor(i / N), i % N)) return i; return -1; };
  for (let k = 0; k < 5; k++) {
    const i = spot(a);
    if (i < 0) break;
    G.place(a, 0, Math.floor(i / N), i % N);
    G.place(b, 0, Math.floor(i / N), i % N);
  }
  assert.deepEqual(a, b);
});

console.log(`\n${passed}개 테스트 통과`);
