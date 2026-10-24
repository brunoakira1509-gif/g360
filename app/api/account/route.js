import { NextResponse } from 'next/server';
import { currentUser, service } from '@/lib/supabase/server';
export async function DELETE() {
  const { user, role } = await currentUser();
  if (!role) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const sv = service();
  if (role === 'admin') {
    const { count } = await sv.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true);
    if (count <= 1) return NextResponse.json({ error: 'Você é o único admin ativo. Crie outro antes de excluir esta conta.' }, { status: 400 });
  }
  await sv.from('audit_log').insert({ action: 'account_deleted' }); // sem dados pessoais
  const { error } = await sv.auth.admin.deleteUser(user.id); // apaga perfil, séries e dados em cascata
  if (error) return NextResponse.json({ error: 'Falha ao excluir' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
