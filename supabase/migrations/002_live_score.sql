-- 002: 실시간 랭킹. 플레이 중인 점수(live_score)를 프로필에 두고 랭킹이 그 값도 함께 본다.
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행한다. 기존 데이터는 건드리지 않는다.

alter table public.profiles add column if not exists live_score integer not null default 0;
alter table public.profiles add column if not exists live_updated_at timestamptz;

-- 플레이 중 점수 보고 (일반 모드만). 몇 초마다 호출된다.
create or replace function public.report_live(p_score integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  update profiles set live_score = greatest(0, least(coalesce(p_score, 0), 5000000)), live_updated_at = now()
  where id = auth.uid();
end $$;
revoke all on function public.report_live(integer) from public, anon;
grant execute on function public.report_live(integer) to authenticated;

-- 점수 기록 + 최고 점수·연속 출석 갱신. 판이 끝났으므로 live_score는 0으로 되돌린다.
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

-- 랭킹. 역대·이번 주는 끝난 판의 최고 점수와 '지금 플레이 중인 점수'(2일 이내 보고분) 중 큰 값을 쓴다.
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
