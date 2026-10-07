// 효과음·배경음. audio/*.wav 를 미리 읽어 Web Audio로 재생한다 (겹쳐 재생, 피치·볼륨 조절 가능).
// 파일을 못 읽는 환경에서는 조용히 넘어간다. 규칙(game.js)과는 무관.
//
// 설정: 'all'(효과음+음악) | 'sfx'(효과음만) | 'off'
// 배경음: config.js의 BGM_URL이 비어 있지 않으면 첫 터치 뒤 반복 재생한다. Suno 등으로 만든 mp3를 audio/bgm.mp3로 넣고 주소를 적으면 된다.

const NAMES = ['place', 'clear1', 'clear2', 'clear3', 'clear4', 'laser', 'bolt', 'bomb', 'chain', 'mega', 'fuse', 'charge', 'combo',
  'levelup', 'perfect', 'refresh', 'stuck', 'gameover', 'record', 'achieve', 'mission', 'login', 'pass'];

let ac = null, master = null;
const buffers = {};
let mode = 'all';
let loaded = false;
let bgm = null, bgmReady = false, bgmWanted = false;

export function setMode(m) {
  mode = m;
  if (bgm) { if (m === 'all' && bgmWanted) bgm.play().catch(() => {}); else bgm.pause(); }
}
export const getMode = () => mode;

function ctx() {
  if (ac) return ac;
  try {
    ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0.9;
    // 가벼운 컴프레서: 여러 소리가 겹쳐도 찌그러지지 않게
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp).connect(ac.destination);
  } catch { ac = null; }
  return ac;
}

// 파일을 모두 읽어 둔다. 첫 사용자 조작 뒤에 부르는 것이 좋다 (자동재생 정책).
export async function preload(base = 'audio/', bgmUrl = '') {
  if (loaded || !ctx()) return;
  loaded = true;
  await Promise.allSettled(NAMES.map(async (n) => {
    const res = await fetch(`${base}${n}.wav`);
    if (!res.ok) return;
    buffers[n] = await ac.decodeAudioData(await res.arrayBuffer());
  }));
  // 배경음 (선택, config.js의 BGM_URL)
  if (bgmUrl) {
    try {
      bgm = new Audio(bgmUrl);
      bgm.loop = true; bgm.volume = 0.35; bgm.preload = 'auto';
      bgmReady = true;
      if (bgmWanted && mode === 'all') bgm.play().catch(() => {});
    } catch { /* 없음 */ }
  }
}

export function resume() {
  if (ctx() && ac.state === 'suspended') ac.resume().catch(() => {});
}

// 재생. rate: 피치(1이 기본), gain: 볼륨 배율, delay: 초
export function play(name, { rate = 1, gain = 1, delay = 0 } = {}) {
  if (mode === 'off' || !ctx()) return;
  const buf = buffers[name];
  if (!buf) return;
  try {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start(ac.currentTime + delay);
  } catch { /* 무시 */ }
}

export function startBgm() {
  bgmWanted = true;
  if (bgmReady && mode === 'all') bgm.play().catch(() => {});
}
export const hasBgm = () => bgmReady;
export const isLoaded = (name) => !!buffers[name];
