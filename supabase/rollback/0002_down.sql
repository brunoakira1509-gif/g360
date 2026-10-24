-- Desfaz a 0002 (volta ao import_facts da 0001)
alter table public.facts drop constraint if exists facts_valid;
alter table public.series drop constraint if exists series_name_clean;
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
drop function if exists public.hit(text,int,int);
drop table if exists public.rate_events;
