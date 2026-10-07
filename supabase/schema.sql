-- 블록 필 DB 구조. Supabase 대시보드 → SQL Editor에 붙여 넣고 실행한다.
-- 여러 번 실행해도 기존 데이터가 지워지지 않도록 작성되어 있다.
-- 규칙: 이 파일에 drop table / truncate / delete 를 넣지 않는다.
--       구조 변경은 supabase/migrations/ 에 "alter table ... add column if not exists" 로 추가한다.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login_id text unique not null,
  nickname text not null,
  friend_code text unique not null,
  best_score integer not null default 0,
  games_played integer not null default 0,
  streak integer not null default 0,
  last_play_date date,
  live_score integer not null default 0,   -- 플레이 중인 점수 (실시간 랭킹, migrations/002)
  live_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  score integer not null check (score >= 0),
  mode text not null default 'classic' check (mode in ('classic', 'daily')),
  daily_date date,
  created_at timestamptz not null default now()
);
create index if not exists scores_user_mode_idx on public.scores (user_id, mode, score desc);
create index if not exists scores_created_idx on public.scores (created_at);
create unique index if not exists scores_daily_once_idx on public.scores (user_id, daily_date) where mode = 'daily';

create table if not exists public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

-- 접근 권한: 직접 쓰기는 막고, 아래 함수로만 기록한다.
alter table public.profiles enable row level security;
alter table public.scores enable row level security;
alter table public.friendships enable row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists scores_read_own on public.scores;
create policy scores_read_own on public.scores for select to authenticated using (user_id = auth.uid());
drop policy if exists friendships_read_own on public.friendships;
create policy friendships_read_own on public.friendships for select to authenticated using (user_id = auth.uid());

-- 가입 시 프로필 자동 생성 (친구 코드 6자리 발급)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_login text := coalesce(new.raw_user_meta_data ->> 'login_id', split_part(new.email, '@', 1));
begin
  loop
    v_code := upper(substr(md5(random()::text || new.id::text), 1, 6));
    exit when not exists (select 1 from profiles where friend_code = v_code);
  end loop;
  insert into profiles (id, login_id, nickname, friend_code)
  values (new.id, v_login, coalesce(nullif(new.raw_user_meta_data ->> 'nickname', ''), v_login), v_code)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- 점수 기록 + 최고 점수·연속 출석 갱신
create or replace function public.submit_score(p_score integer, p_mode text, p_daily_date date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_score < 0 or p_score > 5000000 then raise exception 'INVALID_SCORE'; end if;

  if p_mode = 'daily' then
    insert into scores (user_id, score, mode, daily_date)
    values (auth.uid(), p_score, 'daily', coalesce(p_daily_date, v_today))
    on conflict (user_id, daily_date) where mode = 'daily' do nothing;
  else
    insert into scores (user_id, score, mode) values (auth.uid(), p_score, 'classic');
  end if;

  update profiles set
    best_score = case when p_mode = 'classic' then greatest(best_score, p_score) else best_score end,
    games_played = games_played + 1,
    streak = case
      when last_play_date = v_today then streak
      when last_play_date = v_today - 1 then streak + 1
      else 1 end,
    last_play_date = v_today,
    live_score = case when p_mode = 'classic' then 0 else live_score end,
    live_updated_at = case when p_mode = 'classic' then now() else live_updated_at end
  where id = auth.uid();
end $$;

-- 닉네임 변경 (2~12자). migrations/001_set_nickname.sql 과 같은 내용
create or replace function public.set_nickname(p_nick text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_nick text := btrim(p_nick);
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if char_length(v_nick) < 2 or char_length(v_nick) > 12 then raise exception 'INVALID_NICKNAME'; end if;
  update profiles set nickname = v_nick where id = auth.uid();
  return v_nick;
end $$;
grant execute on function public.set_nickname(text) to authenticated;

-- 플레이 중 점수 보고 (실시간 랭킹). migrations/002 와 같은 내용
create or replace function public.report_live(p_score integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  update profiles set live_score = greatest(0, least(coalesce(p_score, 0), 5000000)), live_updated_at = now()
  where id = auth.uid();
end $$;
grant execute on function public.report_live(integer) to authenticated;

-- 랭킹. p_scope: global | friends, p_period: all | week | daily
create or replace function public.leaderboard(p_scope text, p_period text, p_limit integer default 100)
returns table (rank bigint, user_id uuid, nickname text, score integer, is_me boolean)
language sql stable security definer set search_path = public as $$
  with pool as (
    select p.id, p.nickname, p.live_score, p.live_updated_at from profiles p
    where p_scope = 'global'
       or p.id = auth.uid()
       or p.id in (select f.friend_id from friendships f where f.user_id = auth.uid())
  ),
  best as (
    select pool.id, pool.nickname, greatest(
      coalesce((
        select max(sc.score) from scores sc
        where sc.user_id = pool.id
          and case p_period
            when 'daily' then sc.mode = 'daily' and sc.daily_date = (now() at time zone 'Asia/Seoul')::date
            when 'week' then sc.mode = 'classic'
              and sc.created_at >= date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
            else sc.mode = 'classic'
          end
      ), 0),
      case when p_period <> 'daily' and pool.live_updated_at > now() - interval '2 days' then pool.live_score else 0 end
    ) as top
    from pool
  )
  select rank() over (order by b.top desc), b.id, b.nickname, b.top, b.id = auth.uid()
  from best b where b.top > 0
  order by b.top desc
  limit greatest(1, least(p_limit, 200));
$$;

-- 친구 코드로 서로 친구 맺기
create or replace function public.add_friend(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_friend profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into v_friend from profiles where friend_code = upper(trim(p_code));
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_friend.id = auth.uid() then raise exception 'SELF'; end if;
  insert into friendships (user_id, friend_id) values (auth.uid(), v_friend.id), (v_friend.id, auth.uid())
  on conflict do nothing;
  return v_friend.nickname;
end $$;

create or replace function public.list_friends()
returns table (friend_id uuid, nickname text, best_score integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.nickname, p.best_score
  from friendships f join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
  order by p.best_score desc;
$$;

create or replace function public.remove_friend(p_friend uuid)
returns void language sql security definer set search_path = public as $$
  delete from friendships
  where (user_id = auth.uid() and friend_id = p_friend)
     or (user_id = p_friend and friend_id = auth.uid());
$$;

revoke all on function public.submit_score(integer, text, date) from public, anon;
revoke all on function public.leaderboard(text, text, integer) from public, anon;
revoke all on function public.report_live(integer) from public, anon;
revoke all on function public.add_friend(text) from public, anon;
revoke all on function public.list_friends() from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.submit_score(integer, text, date) to authenticated;
grant execute on function public.leaderboard(text, text, integer) to authenticated;
grant execute on function public.add_friend(text) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
