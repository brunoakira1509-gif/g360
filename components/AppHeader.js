'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { applyAccessibilityPreferences, readAccessibilityPreferences } from '@/lib/accessibility';

export default function AppHeader({ active }) {
  const [role, setRole] = useState(null);
  useEffect(() => {
    try { applyAccessibilityPreferences(readAccessibilityPreferences()); }
    catch (error) { console.error('Could not apply accessibility preferences:', error); }
    (async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) { console.error('Could not load navigation user:', error); return; }
      if (!user) return;
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profileError) { console.error('Could not load navigation role:', profileError); return; }
      setRole(profile?.role);
    })();
  }, []);
  const tab = (href, label, key) => <a href={href} className={active === key ? 'tab active' : 'tab'} aria-current={active === key ? 'page' : undefined}>{label}</a>;
  return <header className="app-header"><a className="brand" href="/">G360 <span>Dados</span></a>
    <nav className="header-actions" aria-label="Principal">
      {tab('/', 'Painel', 'series')}{tab('/analise', 'Analisar planilha', 'analise')}
      {role === 'admin' && tab('/admin', 'Administração', 'admin')}{tab('/configuracoes', 'Configurações', 'configuracoes')}
      {tab('/privacidade', 'Privacidade', 'privacidade')}
      <button className="ghost" onClick={async () => { await supabase.auth.signOut(); location.href = '/login'; }}>Sair</button>
    </nav></header>;
}
