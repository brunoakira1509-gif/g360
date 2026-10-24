import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
export async function middleware(req) {
  let res = NextResponse.next({ request: req });
  const s = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: {
    getAll: () => req.cookies.getAll(),
    setAll: l => { l.forEach(({ name, value }) => req.cookies.set(name, value)); res = NextResponse.next({ request: req });
      l.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); } } });
  const { data: { user } } = await s.auth.getUser();
  const p = req.nextUrl.pathname, go = u => NextResponse.redirect(new URL(u, req.url));
  const publicPaths = ['/login', '/forgot-password', '/auth/confirm'];
  const passwordPaths = ['/set-password', '/reset-password'];
  if (!user && publicPaths.includes(p)) return res;
  if (!user) return go('/login');
  const { data: a } = await s.auth.mfa.getAuthenticatorAssuranceLevel();
  const ok = a?.currentLevel === 'aal2';
  if (p === '/login') return go(ok ? '/' : '/mfa');
  if (!ok && p !== '/mfa' && p !== '/auth/confirm' && !passwordPaths.includes(p)) return p.startsWith('/api') ? NextResponse.json({ error: '2FA necessário' }, { status: 401 }) : go('/mfa');
  if (ok && p === '/mfa') return go('/');
  return res;
}
export const config = { matcher: ['/((?!_next|favicon.ico).*)'] };
