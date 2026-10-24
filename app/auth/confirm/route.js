import { NextResponse } from 'next/server';
import { sb } from '@/lib/supabase/server';

export async function GET(request) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const code = params.get('code');
  const next = params.get('next');
  const destination = next === '/set-password' || next === '/reset-password' ? next : '/';
  const supabase = await sb();

  const result = tokenHash && ['invite', 'recovery'].includes(type)
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error('Link de autenticação inválido') };

  if (result.error) {
    return NextResponse.redirect(new URL('/login?error=link-invalid', request.url));
  }
  return NextResponse.redirect(new URL(destination, request.url));
}
