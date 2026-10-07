// 온라인 기능(로그인·랭킹·친구). 설정이 비어 있으면 꺼진 상태로 동작한다.
import { ONLINE } from './config.js';
import { load, save } from './storage.js';

let sb = null;
export let profile = null;

export const enabled = () => !!sb;

const toEmail = (loginId) => `${loginId.toLowerCase()}@${ONLINE.emailDomain}`;

export function validateLoginId(id) {
  return /^[a-zA-Z0-9_]{3,16}$/.test(id);
}

function koError(error) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered')) return '이미 사용 중인 아이디입니다.';
  if (m.includes('invalid login')) return '아이디 또는 암호가 맞지 않습니다.';
  if (m.includes('password')) return '암호는 6자 이상이어야 합니다.';
  if (m.includes('failed to fetch') || m.includes('network')) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  return error?.message || '알 수 없는 오류가 발생했습니다.';
}

export async function init() {
  if (!ONLINE.url || !ONLINE.anonKey || !globalThis.supabase) return null;
  sb = globalThis.supabase.createClient(ONLINE.url, ONLINE.anonKey);
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) await fetchProfile();
  } catch { /* 오프라인이면 게스트로 시작 */ }
  return profile;
}

export async function fetchProfile() {
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) { profile = null; return null; }
  const { data, error } = await sb.from('profiles').select('*').eq('id', u.user.id).single();
  if (error) throw new Error(koError(error));
  profile = data;
  return profile;
}

export async function signUp(loginId, nickname, password) {
  const { data, error } = await sb.auth.signUp({
    email: toEmail(loginId),
    password,
    options: { data: { login_id: loginId.toLowerCase(), nickname } },
  });
  if (error) throw new Error(koError(error));
  if (!data.session) throw new Error('가입은 되었지만 로그인되지 않았습니다. Supabase에서 이메일 확인(Confirm email)을 꺼 주세요.');
  return fetchProfile();
}

export async function signIn(loginId, password) {
  const { error } = await sb.auth.signInWithPassword({ email: toEmail(loginId), password });
  if (error) throw new Error(koError(error));
  return fetchProfile();
}

// 닉네임 변경 (서버 함수 set_nickname). 성공하면 profile을 갱신한다.
export async function setNickname(nick) {
  if (!sb || !profile) throw new Error('로그인이 필요합니다.');
  const { data, error } = await sb.rpc('set_nickname', { p_nick: nick });
  if (error) {
    const m = (error.message || '').toUpperCase();
    if (m.includes('INVALID_NICKNAME')) throw new Error('닉네임은 2~12자로 입력해 주세요.');
    if (m.includes('COULD NOT FIND THE FUNCTION') || m.includes('SET_NICKNAME')) throw new Error('서버에 닉네임 변경 함수가 아직 없습니다. supabase/migrations/001_set_nickname.sql을 SQL Editor에서 실행해 주세요.');
    throw new Error(koError(error));
  }
  profile = { ...profile, nickname: data };
  return profile;
}

export async function signOut() {
  await sb.auth.signOut();
  profile = null;
}

// 점수 전송. 실패하면 기기에 보관했다가 다음에 다시 보낸다.
export async function submitScore(score, mode, dailyDate = null) {
  if (!sb || !profile) return false;
  const entry = { uid: profile.id, score, mode, dailyDate };
  const { error } = await sb.rpc('submit_score', { p_score: score, p_mode: mode, p_daily_date: dailyDate });
  if (error) {
    const d = load();
    d.pending.push(entry);
    save();
    return false;
  }
  fetchProfile().catch(() => {});
  return true;
}

export async function flushPending() {
  if (!sb || !profile) return;
  const d = load();
  const mine = d.pending.filter((e) => e.uid === profile.id);
  if (!mine.length) return;
  const failed = [];
  for (const e of mine) {
    const { error } = await sb.rpc('submit_score', { p_score: e.score, p_mode: e.mode, p_daily_date: e.dailyDate });
    if (error) failed.push(e);
  }
  d.pending = d.pending.filter((e) => e.uid !== profile.id).concat(failed);
  save();
}

// scope: 'global' | 'friends', period: 'all' | 'week' | 'daily'
export async function leaderboard(scope, period, limit = 100) {
  const { data, error } = await sb.rpc('leaderboard', { p_scope: scope, p_period: period, p_limit: limit });
  if (error) throw new Error(koError(error));
  return data || [];
}

export async function addFriend(code) {
  const { data, error } = await sb.rpc('add_friend', { p_code: code.trim().toUpperCase() });
  if (error) {
    const m = error.message || '';
    if (m.includes('NOT_FOUND')) throw new Error('해당 친구 코드를 찾을 수 없습니다.');
    if (m.includes('SELF')) throw new Error('자신의 코드는 추가할 수 없습니다.');
    throw new Error(koError(error));
  }
  return data; // 추가된 친구의 닉네임
}

export async function listFriends() {
  const { data, error } = await sb.rpc('list_friends');
  if (error) throw new Error(koError(error));
  return data || [];
}

export async function removeFriend(friendId) {
  const { error } = await sb.rpc('remove_friend', { p_friend: friendId });
  if (error) throw new Error(koError(error));
}
