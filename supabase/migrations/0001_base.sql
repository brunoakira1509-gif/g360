-- v2: guarda DADOS AGREGADOS (não a planilha). Pode rodar mesmo se já rodou a v1.
drop table if exists public.dashboards, public.datasets cascade;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now());
alter table public.profiles add column if not exists quota_rows int not null default 200000;

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) <= 120),
  kind text not null default 'valores' check (kind in ('valores','despesas','votos','outro')),
  dims text[] not null default '{}' check (cardinality(dims) <= 3),
  created_at timestamptz not null default now());
create index if not exists series_owner on public.series(owner);

-- Uma linha = um período + até 3 dimensões (ex.: categoria, UF, município) + valor somado
create table if not exists public.facts (
  series_id uuid not null references public.series(id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period text not null check (char_length(period) <= 40),
  d1 text not null default '', d2 text not null default '', d3 text not null default '',
  value numeric not null,
  cnt int not null default 1,
  primary key (series_id, period, d1, d2, d3));
create index if not exists facts_owner on public.facts(owner);

create table if not exists public.ai_log (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now());
create index if not exists ai_log_idx on public.ai_log(owner, at desc);

alter table public.profiles enable row level security;
alter table public.series   enable row level security;
alter table public.facts    enable row level security;
alter table public.ai_log   enable row level security;

create or replace function public.is_active() returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and active) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and active and role = 'admin') $$;

drop policy if exists "ler perfil" on public.profiles;
create policy "ler perfil" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "series" on public.series;
create policy "series" on public.series for all using (owner = auth.uid() and public.is_active()) with check (owner = auth.uid() and public.is_active());
drop policy if exists "facts" on public.facts;
create policy "facts" on public.facts for all using (owner = auth.uid() and public.is_active())
  with check (owner = auth.uid() and public.is_active() and exists (select 1 from public.series s where s.id = series_id and s.owner = auth.uid()));
drop policy if exists "ai_log" on public.ai_log;
create policy "ai_log" on public.ai_log for all using (owner = auth.uid()) with check (owner = auth.uid());

-- Importa um período inteiro de uma vez (substitui o período se já existir) e respeita a cota
create or replace function public.import_facts(p_series uuid, p_period text, p_rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if jsonb_array_length(p_rows) > 50000 then raise exception 'Muitas linhas agregadas neste período (máx. 50.000)'; end if;
  delete from facts where series_id = p_series and period = p_period;
  if (select count(*) from facts where owner = auth.uid()) + jsonb_array_length(p_rows)
     > (select quota_rows from profiles where id = auth.uid()) then
    raise exception 'Cota de linhas da conta excedida'; end if;
  insert into facts(series_id, period, d1, d2, d3, value, cnt)
  select p_series, p_period, coalesce(d1,''), coalesce(d2,''), coalesce(d3,''), sum(value), sum(cnt)::int
  from jsonb_to_recordset(p_rows) as x(d1 text, d2 text, d3 text, value numeric, cnt int)
  group by 1,2,3,4,5;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.totals(p_series uuid) returns table(period text, total numeric, linhas bigint)
language sql stable security invoker set search_path = public
as $$ select period, sum(value), count(*) from facts where series_id = p_series group by period order by period $$;

create or replace function public.compare(p_series uuid, p_a text, p_b text, p_dim int) returns table(k text, a numeric, b numeric)
language sql stable security invoker set search_path = public
as $$ select case p_dim when 1 then d1 when 2 then d2 else d3 end,
  coalesce(sum(value) filter (where period = p_a), 0), coalesce(sum(value) filter (where period = p_b), 0)
  from facts where series_id = p_series and period in (p_a, p_b) group by 1 $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public
as $$ begin insert into public.profiles(id,email) values (new.id,new.email); return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

revoke all on public.profiles, public.series, public.facts, public.ai_log from anon;
revoke insert, update, delete on public.profiles from authenticated;

-- Registro de ações do admin (só o servidor escreve; só admin lê)
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid, action text not null, target text);
alter table public.audit_log enable row level security;
drop policy if exists "audit admin" on public.audit_log;
create policy "audit admin" on public.audit_log for select using (public.is_admin());
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;

-- LGPD: registro da ciência da política de privacidade
alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists terms_at timestamptz;
create or replace function public.accept_terms(v text) returns void language sql security definer set search_path = public
as $$ update public.profiles set terms_version = v, terms_at = now() where id = auth.uid() $$;
revoke execute on function public.accept_terms(text) from anon, public;
grant execute on function public.accept_terms(text) to authenticated;

-- 2FA OBRIGATÓRIO NO BANCO: sem sessão aal2 (senha + código) nenhuma tabela de dados responde
drop policy if exists "exige 2fa" on public.series;  create policy "exige 2fa" on public.series  as restrictive for all to authenticated using ((auth.jwt()->>'aal') = 'aal2');
drop policy if exists "exige 2fa" on public.facts;   create policy "exige 2fa" on public.facts   as restrictive for all to authenticated using ((auth.jwt()->>'aal') = 'aal2');
drop policy if exists "exige 2fa" on public.ai_log;  create policy "exige 2fa" on public.ai_log  as restrictive for all to authenticated using ((auth.jwt()->>'aal') = 'aal2');
drop policy if exists "exige 2fa" on public.audit_log; create policy "exige 2fa" on public.audit_log as restrictive for all to authenticated using ((auth.jwt()->>'aal') = 'aal2');

-- PRIMEIRO ADMIN (troque o e-mail, depois de criar o usuário em Authentication > Users):
-- update public.profiles set role = 'admin' where email = 'seu@email.com';
