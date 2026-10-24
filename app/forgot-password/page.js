'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function ForgotPassword() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    const email = new FormData(e.target).get('email');
    const redirectTo = new URL('/auth/confirm?next=/reset-password', window.location.origin).toString();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg('Se houver uma conta com esse e-mail, você receberá instruções para redefinir a senha.');
  }

  return <div className="login card"><h2>Recuperar senha</h2>
    <p className="m">Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha.</p>
    <form onSubmit={send}><input name="email" type="email" placeholder="E-mail" required autoComplete="email"/>
      <button disabled={busy}>{busy ? 'Enviando...' : 'Enviar link'}</button>
    </form>
    {err && <p style={{ color: '#f87171' }}>{err}</p>}
    {msg && <p className="m">{msg}</p>}
    <p><a href="/login">Voltar para entrar</a></p></div>;
}
