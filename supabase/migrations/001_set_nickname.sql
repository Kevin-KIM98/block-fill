-- 001: 닉네임 변경 함수. Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행한다.
-- 기존 데이터는 건드리지 않는다 (함수 추가만).
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
