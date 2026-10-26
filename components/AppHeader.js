'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function AppHeader({ active }) {
  const [role, setRole] = useState(null);
  useEffect(() => { (async () => {
    const { data: { user } } = await supabase.auth.getUser(); if (!user) return;
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single(); setRole(p?.role);
  })(); }, []);
  const tab = (href, label, key) => <a href={href} className={active === key ? 'tab active' : 'tab'} aria-current={active === key ? 'page' : undefined}>{label}</a>;
  return <header className="app-header"><a className="brand" href="/analise">Painel <span>G360</span></a>
    <nav className="header-actions" aria-label="Principal">
      {tab('/analise', 'Análise rápida', 'analise')}{tab('/', 'Séries salvas', 'series')}
      {role === 'admin' && tab('/admin', 'Administração', 'admin')}{tab('/privacidade', 'Privacidade', 'privacidade')}
      <button className="ghost" onClick={async () => { await supabase.auth.signOut(); location.href = '/login'; }}>Sair</button>
    </nav></header>;
}
