# BLOCK FILL — 작업 안내

브라우저 블록 퍼즐 게임. 빌드 도구 없이 정적 파일로 동작한다. 기획은 `design/plan.md`.

## 구조
- `index.html`, `css/style.css` — 화면
- `js/config.js` — 밸런스 수치(`CFG`), 서버 설정(`ONLINE`), `APP_VERSION`
- `js/shapes.js` — 블럭 모양
- `js/game.js` — 규칙. DOM을 쓰지 않는 순수 로직 (난수는 `state.rng`만 사용)
- `js/achievements.js` — 업적 정의·판정, 개인 기록 목록. DOM 없음
- `js/missions.js` — 오늘의 미션(날짜 시드로 3개) 정의·진행. DOM 없음
- `js/storage.js` — 기기 저장과 이전(`migrate`)
- `js/online.js` — Supabase 로그인·랭킹·친구
- `js/main.js` — 그리기, 드래그, 대화창
- `js/fx.js` — 캔버스 파티클 이펙트(폭발·충격파·불꽃·콤보 열기). 규칙과 무관
- `supabase/schema.sql` — DB 구조와 함수
- `vendor/supabase.js` — supabase-js 2.117.2 UMD (CDN 미사용)
- `manifest.webmanifest`, `icons/` — 홈 화면 설치(PWA). 서비스 워커는 쓰지 않는다 (업데이트는 `version.json` 방식)

## 명령
- 테스트: `node tests/game.test.mjs`
- 브라우저 검수(E2E): `python3 -m http.server 8123 &` 뒤 `node tests/e2e.mjs` (Playwright 필요. 결과 화면은 `tests/e2e-out/`). 서버를 끌 때 `pkill -f "[h]ttp.server 8123"`처럼 대괄호를 써야 자기 셸이 죽지 않는다
- 실행: `python3 -m http.server 8000`
- 검수 기록: `design/progress.md`에 반복마다 한 줄씩 남긴다

## 반드시 지킬 것 (사용자 데이터 보존)
1. `localStorage` 키 `blockfill.save`의 이름을 바꾸거나 `localStorage.clear()`를 호출하지 않는다.
2. 저장 구조를 바꿀 때는 `storage.js`의 `SCHEMA`를 올리고 `migrate()`에 단계를 추가한다. 기존 값은 유지한다.
3. 진행 중인 판의 구조(`game.js`의 state)를 호환되지 않게 바꾸면 `STATE_VERSION`을 올린다. 이전 판은 버려지고 새 판이 시작된다(기록·계정은 영향 없음).
4. DB는 `drop table`, `truncate`, 조건 없는 `delete`를 쓰지 않는다. 변경은 `supabase/migrations/NNN_설명.sql`에 `alter table ... add column if not exists` 형태로 추가하고 `schema.sql`에도 반영한다.
5. `ONLINE.emailDomain`은 사용자가 생긴 뒤 바꾸지 않는다 (기존 계정이 로그인하지 못하게 된다).
6. 일일 도전은 날짜 시드로 모두 같은 판이 나와야 한다. `shapes.js`의 순서·가중치나 `game.js`의 난수 호출 순서를 바꾸면 그날 이미 플레이한 사람과 판이 달라지므로, 그런 변경은 자정(KST) 직후에 배포한다.

## 관례
- 수치 조정은 `config.js`에서만 한다.
- 규칙을 바꾸면 `tests/game.test.mjs`에 테스트를 추가하고 통과시킨다.
- 화면 문구는 한국어. 사용자 입력은 `textContent`로만 넣는다(`innerHTML` 금지).
- 배포할 때 `APP_VERSION`과 `version.json`을 같이 올린다 (테스트가 둘이 같은지 확인한다). 앱은 `version.json`이 더 새 버전이면 캐시를 갈아 끼우고 새로고침한다.

## 아직 확인되지 않은 것
- Supabase 연동(가입·점수 등록·랭킹·친구)은 실제 프로젝트에 연결해 본 적이 없다. 연결 후 `design/plan.md` 6번의 남은 항목을 점검할 것.
