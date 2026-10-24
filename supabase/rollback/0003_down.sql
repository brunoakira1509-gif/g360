-- Reverts the aal2 restriction on profile reads and restores the prior exposure.
drop policy if exists "exige 2fa profiles" on public.profiles;
