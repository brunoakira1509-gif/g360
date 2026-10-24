'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { strongPw } from '@/lib/validate';

export default function PasswordUpdate({ recovery = false }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setErr('');
    const form = new FormData(e.target);
    const password = form.get('password');
    if (!strongPw(password)) return setErr('Use pelo menos 12 caracteres, com maiúscula, minúscula e número.');
    if (password !== form.get('confirm')) return setErr('As senhas não são iguais.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setErr(error.message);
    }
    if (recovery) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setBusy(false);
        return setErr('Senha alterada, mas não foi possível encerrar a sessão. Saia e entre novamente.');
      }
      location.href = '/login';
      return;
    }
    location.href = '/mfa';
  }

  return <div className="login card"><h2>{recovery ? 'Nova senha' : 'Defina sua senha'}</h2>
    <p className="m">{recovery ? 'Escolha uma nova senha para sua conta.' : 'E-mail confirmado. Crie uma senha para entrar no painel.'}</p>
    <form onSubmit={save}>
      <input name="password" type="password" placeholder="Nova senha (mín. 12 caracteres)" minLength={12} maxLength={128} required autoComplete="new-password"/>
      <input name="confirm" type="password" placeholder="Confirme a senha" minLength={12} maxLength={128} required autoComplete="new-password"/>
      <button disabled={busy}>{busy ? 'Salvando...' : 'Salvar senha'}</button>
    </form>
    {err && <p style={{ color: '#f87171' }}>{err}</p>}
  </div>;
}
