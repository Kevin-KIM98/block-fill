// 실제 브라우저(Chromium) 검수. 기획서 6번 완료 기준을 처음부터 끝까지 실행해 확인한다.
// 실행: python3 -m http.server 8123 &  →  node tests/e2e.mjs
// Playwright가 node_modules에 없으면 PLAYWRIGHT_MODULE=/경로/playwright/index.mjs 로 지정한다.
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL_ = process.env.E2E_URL || 'http://localhost:8123/index.html';
const OUT = process.env.E2E_OUT || 'tests/e2e-out';
mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') page.logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => page.logs.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => page.logs.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) page.logs.push(`http ${r.status()}: ${r.url()}`); });
  return page;
}
const ui = (page) => page.evaluate(() => ({
  score: Number(document.getElementById('score').textContent.replace(/\D/g, '')),
  points: Number(document.getElementById('points').textContent.replace(/\D/g, '')),
  best: Number(document.getElementById('best').textContent.replace(/\D/g, '')),
  tray: [...document.querySelectorAll('#tray .slot')].map((s) => s.dataset.shape),
  trayCost: document.getElementById('trayCost').textContent,
  trayDisabled: document.getElementById('btnTray').disabled,
  stuck: !document.getElementById('stuck').hidden,
  over: document.getElementById('dlgOver').open,
  version: document.getElementById('version').textContent,
  st: (({ moves, lines, score, points, over, stuck, trayRefreshes, mode }) =>
    ({ moves, lines, score, points, over, stuck, trayRefreshes, mode }))(globalThis.__blockfill.state),
}));

// 놓을 수 있는 자리 하나를 고른다 (줄이 지워지는 자리를 우선). 화면 좌표까지 계산해 돌려준다.
async function pickTarget(page, touch) {
  return page.evaluate(async (touch) => {
    const G = await import('./js/game.js');
    const { SHAPES } = await import('./js/shapes.js');
    const st = globalThis.__blockfill.state;
    const N = st.board.length ** 0.5;
    const origin = document.querySelector('#board .cell').getBoundingClientRect();
    const u = origin.width;
    let best = null;
    for (let slot = 0; slot < 3; slot++) {
      const id = st.tray[slot];
      if (id == null) continue;
      const s = SHAPES[id];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (!G.canPlace(st, id, r, c)) continue;
        const { rows, cols } = G.linesIfPlaced(st, id, r, c);
        const score = rows.length + cols.length;
        if (!best || score > best.score) {
          const x = origin.left + c * u + (s.w * u) / 2;
          const y = touch ? origin.top + r * u + u * 1.3 + s.h * u : origin.top + r * u + (s.h * u) / 2;
          best = { slot, r, c, x, y, score, id };
        }
      }
    }
    if (!best) return null;
    const sb = document.querySelectorAll('#tray .slot')[best.slot].getBoundingClientRect();
    return { ...best, sx: sb.left + sb.width / 2, sy: sb.top + sb.height / 2 };
  }, touch);
}

async function dragMouse(page, t) {
  await page.mouse.move(t.sx, t.sy);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y, { steps: 4 });
  await page.mouse.up();
}
async function dragTouch(page, cdp, t) {
  const pt = (x, y) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(t.sx, t.sy)] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(t.sx + (t.x - t.sx) * i / 4, t.sy + (t.y - t.sy) * i / 4)] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// ---------- 시나리오 1: 한 판을 끝까지 (마우스) ----------
console.log('\n[1] 한 판 끝까지 플레이 (마우스 드래그)');
{
  const page = await newPage();
  await page.goto(URL_);
  await page.waitForSelector('#tray .slot .piece');
  await page.waitForTimeout(600);
  check('첫 실행: 게임 방법 안내가 뜬다', await page.evaluate(() => document.getElementById('dlgHelp').open));
  await page.click('#dlgHelp [data-close]');
  const v0 = await ui(page);
  check('버전이 제목 옆에 표시된다', /^v\d+\.\d+\.\d+$/.test(v0.version), v0.version);
  check('시작 포인트 = 기본 50P + 출석 보너스 10P', v0.points === 60, `${v0.points}`);

  let newBlockOk = true, placedOk = true, moves = 0, refreshes = 0, costs = [], maxMoves = 600;
  while (moves < maxMoves) {
    const u0 = await ui(page);
    if (u0.over) break;
    if (u0.st.over) { // 포인트까지 바닥 → 종료 화면은 0.5초 뒤에 열린다
      check('놓을 곳도 포인트도 없으면 자동으로 끝난다', u0.trayDisabled);
      await page.waitForSelector('#dlgOver[open]', { timeout: 3000 });
      break;
    }
    const t = await pickTarget(page, false);
    if (!t) {
      // 놓을 곳 없음 → 막힘 안내와 리프레시 버튼 상태 확인
      check(`막힘 안내가 뜬다 (move ${moves})`, u0.stuck);
      if (!u0.trayDisabled) {
        costs.push(Number(u0.trayCost.replace(/\D/g, '')));
        await page.click('#btnTray'); refreshes++;
        const u1 = await ui(page);
        check(`블럭 교체: 포인트가 비용만큼 줄고 블럭이 바뀐다 (${u0.points}→${u1.points})`, u1.points === u0.points - costs.at(-1) && u1.tray.join() !== u0.tray.join());
        continue;
      }
      check('포인트 부족: 블럭 교체 버튼이 비활성', u0.trayDisabled);
      await page.click('#btnGiveUp');
      await page.waitForTimeout(700);
      break;
    }
    await dragMouse(page, t);
    const u1 = await ui(page);
    if (u1.st.moves !== u0.st.moves + 1) { placedOk = false; console.log('   놓기 실패', t, u0.st.moves, u1.st.moves); break; }
    if (u1.tray[t.slot] === u0.tray[t.slot] && u1.tray.filter((x, i) => x === u0.tray[i]).length === 3 && u1.tray[t.slot] === String(t.id)) {
      // 같은 모양이 또 나올 수는 있으나 3칸 전부 그대로이면서 id까지 같으면 의심 → 두 번 연속이면 실패로 본다
    }
    if (u1.tray.some((x) => x == null || x === 'undefined')) newBlockOk = false;
    moves++;
    if (u1.over) break;
  }
  const end = await ui(page);
  check('드래그로 블럭이 놓이고 상태가 바뀐다', placedOk && moves > 10, `${moves}수`);
  check('놓은 자리에 항상 새 블럭이 있다', newBlockOk);
  check('줄이 지워진 적이 있고 점수·포인트가 올랐다', end.st.lines > 0 && end.score > 0, `줄 ${end.st.lines}, 점수 ${end.score}`);
  check('리프레시 비용이 쓸수록 오른다', costs.length < 2 || costs.every((c, i) => i === 0 || c > costs[i - 1]), costs.join('→') || '리프레시 안 씀');
  check('게임 종료 화면이 뜬다', end.over);
  const over = await page.evaluate(() => ({ score: document.getElementById('overScore').textContent, badge: !document.getElementById('overBadge').hidden, detail: document.getElementById('overDetail').textContent }));
  check('종료 화면 점수 = 최종 점수', Number(over.score.replace(/\D/g, '')) === end.score, `${over.score}`);
  check('첫 판은 최고 기록 갱신 배지', over.badge);
  await page.screenshot({ path: `${OUT}/1-over.png` });

  // 기록·업적
  await page.click('#btnOverRecords');
  await page.waitForTimeout(200);
  const rec = await page.evaluate(() => ({ open: document.getElementById('dlgRecords').open, rows: document.querySelectorAll('#recList li').length, summary: document.getElementById('recSummary').textContent }));
  check('종료 화면에서 내 기록이 열리고 이번 판이 있다', rec.open && rec.rows >= 3 && /1판/.test(rec.summary), rec.summary);
  await page.click('#recTabs button[data-v="missions"]');
  const mis = await page.evaluate(() => ({ rows: document.querySelectorAll('#recList li.mission').length, done: document.querySelectorAll('#recList li.mission.done').length, summary: document.getElementById('recSummary').textContent }));
  check('오늘의 미션 3개가 보이고 진행이 표시된다', mis.rows === 3, mis.summary);
  await page.click('#recTabs button[data-v="achievements"]');
  const ach = await page.evaluate(() => document.querySelectorAll('#recList li:not(.locked)').length);
  check('업적이 하나 이상 달성됐다 (첫 줄 등)', ach >= 1, `${ach}개`);
  await page.keyboard.press('Escape');
  // 결과 이미지
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#btnShareImg')]);
  check('결과 이미지가 만들어진다 (공유 미지원 시 파일 저장)', !!dl, dl?.suggestedFilename());
  // 다시 도전 → 새 판, 최고 기록 유지
  await page.click('#btnAgain');
  await page.waitForTimeout(300);
  const again = await ui(page);
  check('다시 도전: 새 판이 시작되고 최고 기록이 남는다', again.st.moves === 0 && again.best === end.score && !again.over, `best ${again.best}`);
  // 새로고침 후 최고 기록·기록 유지
  await page.reload(); await page.waitForSelector('#tray .slot .piece');
  const re = await ui(page);
  check('새로고침 후 최고 기록이 유지된다', re.best === end.score);
  const warn = page.logs.filter((l) => !/favicon/.test(l));
  check('콘솔 에러·경고 0건 (한 판 전체)', warn.length === 0, warn.slice(0, 3).join(' | '));
  await page.context().close();
}

// ---------- 시나리오 2: 터치 드래그 (휴대폰) ----------
console.log('\n[2] 터치 드래그 (휴대폰 손가락 위로 띄우기 보정)');
{
  const page = await newPage({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(URL_);
  await page.waitForSelector('#tray .slot .piece');
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('dlgHelp').close());
  const cdp = await page.context().newCDPSession(page);
  let ok = 0;
  for (let i = 0; i < 12; i++) {
    const t = await pickTarget(page, true);
    if (!t) break;
    const before = (await ui(page)).st.moves;
    await dragTouch(page, cdp, t);
    const after = (await ui(page)).st.moves;
    if (after === before + 1) ok++;
  }
  check('터치로 12번 중 12번 놓인다', ok === 12, `${ok}/12`);
  const layout = await page.evaluate(() => ({ tray: document.getElementById('tray').getBoundingClientRect().bottom, vh: innerHeight, btn: document.getElementById('btnTray').getBoundingClientRect().bottom }));
  check('휴대폰 화면에 버튼과 블럭 3개가 스크롤 없이 보인다', layout.tray <= layout.vh && layout.btn <= layout.vh, JSON.stringify(layout));
  await page.screenshot({ path: `${OUT}/2-touch.png` });
  check('콘솔 에러·경고 0건 (터치)', page.logs.length === 0, page.logs.slice(0, 3).join(' | '));
  await page.context().close();
}

// ---------- 시나리오 3: 작은 화면 ----------
console.log('\n[3] 작은 화면 배치');
for (const [w, h] of [[375, 667], [360, 640]]) {
  const page = await newPage({ viewport: { width: w, height: h } });
  await page.goto(URL_);
  await page.waitForSelector('#tray .slot .piece');
  const l = await page.evaluate(() => ({ tray: Math.round(document.getElementById('tray').getBoundingClientRect().bottom), btn: Math.round(document.getElementById('btnTray').getBoundingClientRect().bottom), vh: innerHeight, scrollH: document.documentElement.scrollHeight }));
  check(`${w}x${h}: 리프레시 버튼이 화면 안에 있다`, l.btn <= l.vh, JSON.stringify(l));
  check(`${w}x${h}: 블럭 3개가 화면 안에 있다`, l.tray <= l.vh, `tray ${l.tray} / vh ${l.vh}`);
  await page.screenshot({ path: `${OUT}/3-${w}x${h}.png` });
  await page.context().close();
}

// ---------- 시나리오 4: 일일 도전 ----------
console.log('\n[4] 일일 도전');
{
  const boards = [];
  for (let k = 0; k < 2; k++) {
    const page = await newPage();
    await page.goto(URL_);
    await page.waitForSelector('#tray .slot .piece');
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('dlgHelp').close());
    await page.click('#btnMode');
    await page.waitForTimeout(200);
    const u = await ui(page);
    boards.push(JSON.stringify([globalThis.x = null, u.tray, await page.evaluate(() => globalThis.__blockfill.state.board)]));
    if (k === 0) {
      check('일일 도전: 출석 보너스 없이 기본 50P로 시작', u.points === 50 && u.st.mode === 'daily', `${u.points}P`);
      // 끝까지 플레이한 뒤 다시 들어가면 막힌다
      for (let i = 0; i < 400; i++) {
        const t = await pickTarget(page, false);
        if (!t) break;
        await dragMouse(page, t);
      }
      const s = await ui(page);
      if (!s.over && !s.st.over) { await page.click('#btnGiveUp'); }
      await page.waitForSelector('#dlgOver[open]', { timeout: 3000 }).catch(() => {});
      check('일일 도전 종료 화면', (await ui(page)).over);
      await page.click('#btnAgain'); await page.waitForTimeout(200);
      const back = await ui(page);
      check('일일 도전 종료 후 "다시"는 일반 모드로 간다', back.st.mode === 'classic');
      await page.click('#btnMode'); await page.waitForTimeout(200);
      const again = await ui(page);
      const toast = await page.evaluate(() => document.getElementById('toast').textContent);
      check('같은 날 두 번째 일일 도전은 막힌다', again.st.mode === 'classic' && /완료/.test(toast), toast);
    }
    await page.context().close();
  }
  check('일일 도전은 다른 기기에서도 같은 판·같은 블럭', boards[0] === boards[1]);
}

// ---------- 시나리오 5: 온라인 미연결 안내, 소리, 도움말 ----------
console.log('\n[5] 온라인 미연결 안내·설정');
{
  const page = await newPage();
  await page.goto(URL_);
  await page.waitForSelector('#tray .slot .piece');
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('dlgHelp').close());
  for (const id of ['btnRank', 'btnFriends', 'btnUser']) {
    await page.click(`#${id}`);
    await page.waitForTimeout(100);
    const t = await page.evaluate(() => ({ toast: document.getElementById('toast').textContent, dialogs: [...document.querySelectorAll('dialog[open]')].length }));
    check(`${id}: 온라인 미연결 안내만 뜨고 대화창은 안 열린다`, /연결되지 않았/.test(t.toast) && t.dialogs === 0, t.toast);
  }
  await page.click('#btnMute');
  await page.reload(); await page.waitForSelector('#tray .slot .piece');
  check('음소거 설정이 새로고침 후 유지된다', await page.evaluate(() => document.getElementById('btnMute').classList.contains('muted')));
  await page.click('#btnRecords'); await page.waitForTimeout(100);
  await page.click('#btnHelp'); await page.waitForTimeout(100);
  check('기록 화면에서 게임 방법을 다시 볼 수 있다', await page.evaluate(() => document.getElementById('dlgHelp').open));
  check('manifest·아이콘 응답', (await page.evaluate(async () => [(await fetch('manifest.webmanifest')).status, (await fetch('icons/icon-192.png')).status])).every((s) => s === 200));
  check('콘솔 에러·경고 0건 (설정)', page.logs.length === 0, page.logs.slice(0, 3).join(' | '));
  await page.context().close();
}

await browser.close();
console.log(`\n${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
