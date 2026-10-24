-- 0002: validação no banco, rate limit e menor privilégio
create table if not exists public.rate_events (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null, at timestamptz not null default now());
create index if not exists rate_events_idx on public.rate_events(owner, action, at desc);
alter table public.rate_events enable row level security;
drop policy if exists "rate" on public.rate_events;
create policy "rate" on public.rate_events for all using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "exige 2fa" on public.rate_events;
create policy "exige 2fa" on public.rate_events as restrictive for all to authenticated using ((auth.jwt()->>'aal') = 'aal2');
revoke all on public.rate_events from anon;

-- Rate limit genérico: devolve false quando passou do limite na janela
create or replace function public.hit(p_action text, p_max int, p_secs int) returns boolean
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  delete from rate_events where owner = auth.uid() and at < now() - interval '1 day';
  insert into rate_events(action) values (p_action);
  select count(*) into n from rate_events where owner = auth.uid() and action = p_action and at > now() - make_interval(secs => p_secs);
  return n <= p_max;
end $$;

-- Validação e sanitização no banco (vale mesmo se alguém burlar o navegador)
alter table public.facts drop constraint if exists facts_valid;
alter table public.facts add constraint facts_valid check (
  char_length(d1) <= 120 and char_length(d2) <= 120 and char_length(d3) <= 120
  and period ~ '^[0-9A-Za-zÀ-ÿ _./:-]{1,40}$' and abs(value) < 1e15) not valid;
alter table public.series drop constraint if exists series_name_clean;
alter table public.series add constraint series_name_clean check (name !~ '[[:cntrl:]]') not valid;

create or replace function public.import_facts(p_series uuid, p_period text, p_rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if not public.hit('import', 120, 3600) then raise exception 'Muitas importações. Tente novamente mais tarde.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50000 then
    raise exception 'Dados inválidos (máx. 50.000 linhas por período)'; end if;
  delete from facts where series_id = p_series and period = p_period;
  if (select count(*) from facts where owner = auth.uid()) + jsonb_array_length(p_rows)
     > (select quota_rows from profiles where id = auth.uid()) then
    raise exception 'Cota de linhas da conta excedida'; end if;
  insert into facts(series_id, period, d1, d2, d3, value, cnt)
  select p_series, p_period,
    left(regexp_replace(coalesce(d1,''), '[[:cntrl:]]', '', 'g'), 120),
    left(regexp_replace(coalesce(d2,''), '[[:cntrl:]]', '', 'g'), 120),
    left(regexp_replace(coalesce(d3,''), '[[:cntrl:]]', '', 'g'), 120),
    sum(value), sum(cnt)::int
  from jsonb_to_recordset(p_rows) as x(d1 text, d2 text, d3 text, value numeric, cnt int)
  group by 1,2,3,4,5;
  get diagnostics n = row_count; return n;
end $$;

-- Menor privilégio: só usuário logado executa as funções
revoke execute on function public.import_facts(uuid,text,jsonb), public.totals(uuid), public.compare(uuid,text,text,int), public.hit(text,int,int) from public, anon;
grant execute on function public.import_facts(uuid,text,jsonb), public.totals(uuid), public.compare(uuid,text,text,int), public.hit(text,int,int) to authenticated;
