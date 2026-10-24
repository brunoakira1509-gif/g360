import { NextResponse } from 'next/server';
import { isUuid, isEmail, strongPw, body } from '@/lib/validate';
import { currentUser, service } from '@/lib/supabase/server';
export async function POST(req) {
  const { s, role, user } = await currentUser();
  if (role !== 'admin') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  const { data: okRate } = await s.rpc('hit', { p_action: 'admin_create', p_max: 20, p_secs: 3600 });
  if (!okRate) return NextResponse.json({ error: 'Muitas criações de conta. Tente mais tarde.' }, { status: 429 });
  const { email, role: r } = await body(req);
  if (!isEmail(email) || !['user', 'admin'].includes(r))
    return NextResponse.json({ error: 'E-mail ou perfil inválido' }, { status: 400 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null);
  if (!siteUrl) return NextResponse.json({ error: 'Configure NEXT_PUBLIC_SITE_URL no ambiente do servidor' }, { status: 500 });
  const sv = service();
  const redirectTo = new URL('/auth/confirm?next=/set-password', siteUrl).toString();
  const { data, error } = await sv.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (r === 'admin') {
    const { error: profileError } = await sv.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
    if (profileError) {
      const { error: cleanupError } = await sv.auth.admin.deleteUser(data.user.id);
      if (cleanupError) console.error('Falha ao remover conta após erro ao definir perfil admin:', cleanupError);
      return NextResponse.json({ error: 'Convite criado, mas não foi possível atribuir o perfil admin. Verifique o cadastro antes de reenviar.' }, { status: 500 });
    }
  }
  const { error: auditError } = await sv.from('audit_log').insert({ actor: user.id, action: 'invite_user:' + r, target: email });
  if (auditError) return NextResponse.json({ error: 'Convite enviado, mas não foi possível registrar a auditoria.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
export async function PATCH(req) {
  const { role, user } = await currentUser();
  if (role !== 'admin') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  const { id, active } = await body(req);
  if (!isUuid(id)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 });
  if (id === user.id) return NextResponse.json({ error: 'Você não pode desativar a si mesmo' }, { status: 400 });
  const sv = service();
  await sv.from('profiles').update({ active: !!active }).eq('id', id);
  await sv.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
  await sv.from('audit_log').insert({ actor: user.id, action: active ? 'reactivate_user' : 'deactivate_user', target: id });
  return NextResponse.json({ ok: true });
}
export async function PUT(req) {
  const { role, user } = await currentUser();
  if (role !== 'admin') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  const { id } = await body(req);
  if (!isUuid(id)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 });
  const sv = service();
  const { data } = await sv.auth.admin.mfa.listFactors({ userId: id });
  for (const x of data?.factors || []) await sv.auth.admin.mfa.deleteFactor({ id: x.id, userId: id });
  await sv.from('audit_log').insert({ actor: user.id, action: 'reset_mfa', target: id });
  return NextResponse.json({ ok: true });
}
