// 게임 설정값. 밸런스 조정은 이 파일에서만 한다.
// 배포할 때 version.json의 값도 같이 올린다 (앱이 새 버전을 알아채는 기준).
export const APP_VERSION = '2.3.0';

export const CFG = {
  size: 8,                 // 보드 한 변의 칸 수
  prefill: 10,             // 시작 시 깔리는 기본 블럭 칸 수 (14는 초반 급사가 잦았다)
  pointsPerCell: 10,       // 클리어된 칸당 점수
  pointsRate: 0.6,         // 얻은 점수 중 포인트로 적립되는 비율 (리프레시가 늘 공짜가 되지 않게)
  startPoints: 50,         // 모든 판의 시작 포인트 (블럭 교체 한 번은 보장)
  lineMult: [0, 1, 1.5, 2, 3, 4, 5], // 동시에 지운 줄 수에 따른 배수
  comboStep: 0.25,         // 연속 클리어 1회당 추가 배수
  comboMaxMult: 3,
  trayCostBase: 50,        // 하단 블럭 리프레시 시작 비용
  trayCostGrowth: 1.6,     // 사용할 때마다 곱해지는 값
  streakBonusPerDay: 10,   // 연속 출석 1일당 시작 포인트
  streakBonusMaxDays: 7,
  missionBonus: 20,        // 오늘의 미션 1개 달성당 그날 일반 모드 시작 포인트 보너스
  // 폭탄: 줄을 linesPerBomb개 지울 때마다 다음 블럭 한 칸에 폭탄이 붙는다.
  // 폭탄 칸이 지워지면 그 칸의 가로줄·세로줄 전체가 십자로 터지고(줄 2개로 계산), 십자에 걸린 다른 폭탄도 연쇄로 터진다.
  bomb: {
    linesPerBomb: 4, maxCharges: 3,
    hiddenInPrefill: 2,   // 시작 기본 블럭 중 숨겨진 폭탄 수
    hiddenInDrop: 0.35,   // 레벨업 때 떨어지는 기본 블럭 하나가 숨겨진 폭탄일 확률
  },
  // 레벨(난이도 곡선): 줄을 지울수록 오른다. 레벨이 오르면 기본 블럭이 떨어지고 큰 블럭이 늘고 점수 배수가 붙는다.
  level: {
    linesPerLevel: 6,      // 이만큼 줄을 지울 때마다 레벨 +1
    max: 12,
    stonesPerLevel: 1,     // 레벨업 때 떨어지는 기본 블럭 = min(maxStones, (레벨-1) × 이 값)
    maxStones: 6,
    smallDecay: 0.1,       // 레벨 1당 작은 블럭(1~3칸) 비중 감소율
    smallFloor: 0.25,      // 작은 블럭 비중 하한
    bigGrowth: 0.12,       // 레벨 1당 큰 블럭(5칸 이상) 비중 증가율
    scoreBonus: 0.1,       // 레벨 1당 줄 클리어 점수 배수 +10%
  },
};

// 온라인(로그인·랭킹) 설정. Supabase 프로젝트를 만든 뒤 두 값을 채우면 켜진다.
// anon key는 공개되어도 되는 키다. service_role 키는 절대 넣지 말 것.
export const ONLINE = {
  url: '',
  anonKey: '',
  // 아이디를 내부적으로 "아이디@도메인" 형태의 계정으로 바꿔 저장한다.
  // 한번 정하면 바꾸지 말 것 (바꾸면 기존 사용자가 로그인하지 못한다).
  emailDomain: 'blockfill-game.com',
};
