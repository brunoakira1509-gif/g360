'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import AppHeader from '@/components/AppHeader';
export default function Admin() {
  const [users, setUsers] = useState([]); const [msg, setMsg] = useState('');
  const load = async () => { const { data } = await supabase.from('profiles').select('*').order('created_at'); setUsers(data || []); };
  useEffect(() => { load(); }, []);
  async function create(e) {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const j = await r.json(); setMsg(j.ok ? 'Convite enviado por e-mail.' : j.error); if (j.ok) { e.target.reset(); load(); }
  }
  async function toggle(u) {
    await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: u.id, active: !u.active }) }); load();
  }
  async function reset(u) { if (!confirm('Resetar o 2FA de ' + u.email + '? Ele cadastrará um novo celular no próximo login.')) return;
    await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: u.id }) }); setMsg('2FA resetado.'); }
  return <><AppHeader active="admin"/><main>
    <div className="card"><h3>Criar conta</h3>
      <p className="m">A pessoa receberá um convite para confirmar o e-mail e definir a própria senha.</p>
      <form className="row" onSubmit={create}><input name="email" type="email" placeholder="E-mail" required/>
        <select name="role"><option value="user">Usuário</option><option value="admin">Admin</option></select>
        <button>Enviar convite</button><span className="m">{msg}</span></form></div>
    <div className="card" style={{marginTop:16}}><h3>Contas</h3><table><tbody>
      {users.map(u => <tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td>{u.active ? 'ativa' : 'desativada'}</td>
        <td><button className="ghost" onClick={() => toggle(u)}>{u.active ? 'Desativar' : 'Reativar'}</button> <button className="ghost" onClick={() => reset(u)}>Resetar 2FA</button></td></tr>)}
    </tbody></table></div></main></>;
}
