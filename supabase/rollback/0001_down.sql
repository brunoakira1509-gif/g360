-- ATENÇÃO: apaga TODOS os dados. Faça backup antes.
drop table if exists public.audit_log, public.rate_events, public.ai_log, public.facts, public.series cascade;
drop function if exists public.import_facts(uuid,text,jsonb), public.totals(uuid), public.compare(uuid,text,text,int), public.accept_terms(text), public.is_active(), public.is_admin(), public.hit(text,int,int);
-- profiles e o gatilho de novos usuários foram mantidos de propósito.
