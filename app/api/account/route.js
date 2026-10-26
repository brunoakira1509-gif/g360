import { NextResponse } from 'next/server';
import { currentUser, service } from '@/lib/supabase/server';

export async function DELETE(request) {
  const { user, role } = await currentUser();
  if (!role) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  let confirmation;
  try { confirmation = await request.json(); } catch {
    return NextResponse.json({ error: 'Confirmações inválidas.' }, { status: 400 });
  }
  if (confirmation?.accepted !== true || confirmation?.phrase !== 'EXCLUIR MINHA CONTA'
    || String(confirmation?.email || '').trim().toLowerCase() !== String(user.email || '').trim().toLowerCase()) {
    return NextResponse.json({ error: 'Confirme o aviso, digite EXCLUIR MINHA CONTA e informe o e-mail da conta.' }, { status: 400 });
  }
  const sv = service();
  if (role === 'admin') {
    const { count } = await sv.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true);
    if (count === null) return NextResponse.json({ error: 'Não foi possível verificar as contas administradoras. Tente novamente.' }, { status: 500 });
    if (count <= 1) return NextResponse.json({ error: 'Você é a única pessoa administradora ativa. Crie outra conta administradora antes de excluir esta conta.' }, { status: 400 });
  }
  const { error: auditError } = await sv.from('audit_log').insert({ action: 'account_deleted' });
  if (auditError) return NextResponse.json({ error: 'Não foi possível registrar a exclusão com segurança. Tente novamente.' }, { status: 500 });
  const { error } = await sv.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: 'Não foi possível excluir a conta. Tente novamente ou fale com o suporte.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
