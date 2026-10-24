import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
export async function sb() {
  const c = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => c.getAll(), setAll: l => { try { l.forEach(({ name, value, options }) => c.set(name, value, options)); } catch {} } } });
}
export const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export async function currentUser() {
  const s = await sb(); const { data: { user } } = await s.auth.getUser();
  if (!user) return {};
  const { data: a } = await s.auth.mfa.getAuthenticatorAssuranceLevel();
  if (a?.currentLevel !== 'aal2') return {};
  const { data: p } = await s.from('profiles').select('role,active').eq('id', user.id).single();
  return { s, user, role: p?.active ? p.role : null };
}
