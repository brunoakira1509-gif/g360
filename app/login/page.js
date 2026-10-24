'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
export default function Login() {
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault(); const f = new FormData(e.target);
    const { error } = await supabase.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) setErr('E-mail ou senha incorretos.'); else location.href = '/';
  }
  return <div className="login card"><h2>Entrar no Painel</h2>
    <p className="m">As contas são convidadas pelo administrador. Confirme seu e-mail antes de entrar.</p>
    <form method="post" onSubmit={go}><input name="email" type="email" placeholder="E-mail" required autoComplete="email"/>
      <input name="password" type="password" placeholder="Senha" required autoComplete="current-password"/>
      <button>Entrar</button>{err && <span style={{color:'#f87171'}}>{err}</span>}</form>
    <p><a href="/forgot-password">Esqueci minha senha</a></p></div>;
}
