# BLOCK FILL

8×8 보드에 블럭을 끼워 넣어 줄을 지우고, 친구들과 점수를 겨루는 브라우저 퍼즐 게임.

- 하단 블럭 3개 중 하나를 보드에 놓으면 그 자리에 새 블럭이 생깁니다.
- 가로·세로 줄을 채우면 지워지고, 지운 칸 수만큼 포인트를 얻습니다.
- 포인트로 하단 블럭 3개를 교체할 수 있고, 쓸 때마다 비싸집니다.
- 로그인하면 친구·전체·주간 랭킹과 일일 도전에 참여합니다.

자세한 규칙은 [design/plan.md](design/plan.md).

## 실행

빌드 과정이 없습니다. 폴더를 정적 서버로 열면 됩니다.

```bash
python3 -m http.server 8000   # http://localhost:8000
node tests/game.test.mjs      # 규칙 테스트
```

서버 설정 전에도 게스트로 플레이할 수 있습니다 (기록은 기기에만 저장).

## 온라인 기능 켜기 (Supabase)

1. https://supabase.com 에서 무료 프로젝트를 만듭니다.
2. **SQL Editor**에 `supabase/schema.sql` 내용을 붙여 넣고 실행합니다.
3. **Authentication → Sign In / Providers → Email**에서 **Confirm email을 끕니다.**
   (게임은 아이디를 `아이디@blockfill-game.com` 형태의 계정으로 바꿔 가입시키므로 확인 메일을 받을 수 없습니다.)
4. **Project Settings → API**의 `Project URL`과 `anon public` 키를 `js/config.js`의 `ONLINE.url`, `ONLINE.anonKey`에 넣습니다.
   - anon 키는 공개되어도 되는 키입니다. `service_role` 키는 절대 넣지 마세요.

> 이 연동은 실제 Supabase 프로젝트에 연결해 확인하기 전 상태입니다. 처음 연결한 뒤 가입 → 점수 등록 → 친구 추가 → 랭킹 순서로 한 번 점검하세요.
> 닉네임 변경 기능은 `supabase/migrations/001_set_nickname.sql`을 SQL Editor에서 한 번 실행해야 켜집니다 (schema.sql을 처음부터 실행했다면 이미 포함).
> 가입 시 "Email address is invalid" 오류가 나면 `ONLINE.emailDomain`을 본인 소유 도메인으로 바꾸세요 (사용자가 생긴 뒤에는 바꾸면 안 됩니다).

## 배포 (GitHub Pages)

저장소 **Settings → Pages → Branch: main / root** 로 지정하면 `https://<계정>.github.io/<저장소>/` 에 올라갑니다.

## 업데이트해도 사용자 정보가 유지되는 구조

| 데이터 | 위치 | 보존 방법 |
|---|---|---|
| 계정, 점수, 친구, 연속 출석 | Supabase DB | 게임 파일 배포와 분리. `schema.sql`은 다시 실행해도 데이터를 지우지 않음 |
| 진행 중인 판, 설정, 미전송 점수 | 브라우저 `localStorage` (`blockfill.save`) | 버전 번호 + `migrate()`로 새 구조에 맞춰 이전 |

지켜야 할 규칙은 [CLAUDE.md](CLAUDE.md)에 정리했습니다.

## 알려진 한계

- 점수는 브라우저에서 계산해 서버로 보내므로, 작정하면 조작할 수 있습니다. 친구끼리 겨루는 용도로는 충분하지만, 공개 대회 수준의 신뢰가 필요하면 서버에서 플레이 기록을 재검증하는 기능을 추가해야 합니다.
- 암호 찾기 기능이 없습니다 (이메일을 받지 않기 때문). 필요하면 실제 이메일 가입으로 바꿔야 합니다.
