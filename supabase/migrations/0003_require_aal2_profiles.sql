-- Restrict profile reads to sessions that completed the second factor.
drop policy if exists "exige 2fa profiles" on public.profiles;
create policy "exige 2fa profiles" on public.profiles
  as restrictive for select to authenticated
  using ((auth.jwt()->>'aal') = 'aal2');
