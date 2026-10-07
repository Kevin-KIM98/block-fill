// 게임 설정값. 밸런스 조정은 이 파일에서만 한다.
// 배포할 때 version.json의 값도 같이 올린다 (앱이 새 버전을 알아채는 기준).
export const APP_VERSION = '1.5.0';

export const CFG = {
  size: 8,                 // 보드 한 변의 칸 수
  prefill: 14,             // 시작 시 깔리는 기본 블럭 칸 수
  pointsPerCell: 10,       // 클리어된 칸당 포인트
  lineMult: [0, 1, 1.5, 2, 3, 4, 5], // 동시에 지운 줄 수에 따른 배수
  comboStep: 0.25,         // 연속 클리어 1회당 추가 배수
  comboMaxMult: 3,
  trayCostBase: 50,        // 하단 블럭 리프레시 시작 비용
  trayCostGrowth: 1.5,     // 사용할 때마다 곱해지는 값
  boardCostBase: 200,      // 메인 보드 리프레시 시작 비용
  boardCostGrowth: 2,
  streakBonusPerDay: 10,   // 연속 출석 1일당 시작 포인트
  streakBonusMaxDays: 7,
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
