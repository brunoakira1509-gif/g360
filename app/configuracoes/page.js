'use client';
import { useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import { supabase } from '@/lib/supabase/client';
import {
  applyAccessibilityPreferences,
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  readAccessibilityPreferences,
  saveAccessibilityPreferences,
} from '@/lib/accessibility';

export default function Configuracoes() {
  const [preferences, setPreferences] = useState(DEFAULT_ACCESSIBILITY_PREFERENCES);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteAccepted, setDeleteAccepted] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    try {
      const saved = readAccessibilityPreferences();
      setPreferences(saved);
      applyAccessibilityPreferences(saved);
    } catch (error) {
      console.error('Could not load accessibility preferences:', error);
      setMessage('Não foi possível carregar as preferências salvas neste navegador.');
    }
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) { setMessage('Não foi possível carregar os dados da conta. Atualize a página e tente novamente.'); return; }
      setEmail(user?.email || '');
    });
  }, []);

  function updatePreferences(changes) {
    try {
      const next = saveAccessibilityPreferences({ ...preferences, ...changes });
      setPreferences(next);
      applyAccessibilityPreferences(next);
      setMessage('Preferência salva neste dispositivo.');
    } catch (error) {
      console.error('Could not save accessibility preferences:', error);
      setMessage('Não foi possível salvar a preferência neste navegador.');
    }
  }

  async function exportData() {
    setBusy(true);
    setMessage('Preparando o arquivo com seus dados...');
    try {
      const { data: series, error: seriesError } = await supabase.from('series').select('id,name,kind,dims,created_at');
      if (seriesError) throw seriesError;
      const facts = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from('facts')
          .select('series_id,period,d1,d2,d3,value,cnt')
          .order('series_id').order('period').order('d1').order('d2').order('d3')
          .range(offset, offset + 999);
        if (error) throw error;
        facts.push(...(data || []));
        if (!data?.length || data.length < 1000) break;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({ series, facts }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'meus-dados.json';
      link.click();
      URL.revokeObjectURL(url);
      setMessage('Download dos seus dados iniciado.');
    } catch (error) {
      console.error('Could not export account data:', error);
      setMessage('Não foi possível baixar os dados. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(event) {
    event.preventDefault();
    if (!email || deleteEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setMessage('O e-mail informado não corresponde ao e-mail da conta.');
      return;
    }
    if (deletePhrase !== 'EXCLUIR MINHA CONTA' || !deleteAccepted) {
      setMessage('Conclua todas as confirmações para continuar.');
      return;
    }
    setBusy(true);
    setMessage('Excluindo sua conta...');
    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: deleteEmail, phrase: deletePhrase, accepted: deleteAccepted }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir a conta.');
      await supabase.auth.signOut();
      location.href = '/login';
    } catch (error) {
      console.error('Could not delete account:', error);
      setMessage(error.message || 'Não foi possível excluir a conta. Tente novamente.');
      setBusy(false);
    }
  }

  function openDeleteDialog() {
    setMessage('');
    setDeleteEmail('');
    setDeletePhrase('');
    setDeleteAccepted(false);
    dialog.current?.showModal();
  }

  return <>
    <AppHeader active="configuracoes"/>
    <main className="dashboard">
      <section className="page-intro">
        <p className="eyebrow">PREFERÊNCIAS DA CONTA</p>
        <h1>Configurações</h1>
        <p className="m">Ajuste a leitura do sistema e gerencie seus dados.</p>
      </section>

      <section className="card">
        <p className="eyebrow">ACESSIBILIDADE</p>
        <h2>Preferências de leitura</h2>
        <p className="m">As opções ficam salvas apenas neste navegador e dispositivo.</p>
        <div className="settings-grid">
          <div className="settings-option">
            <div><label htmlFor="large-text">Texto maior</label><p>Aumenta o tamanho do texto em todo o sistema.</p></div>
            <input id="large-text" type="checkbox" checked={preferences.textSize === 'large'}
              onChange={event => updatePreferences({ textSize: event.target.checked ? 'large' : 'normal' })}/>
          </div>
          <div className="settings-option">
            <div><label htmlFor="high-contrast">Alto contraste</label><p>Deixa textos, bordas e fundos mais contrastantes.</p></div>
            <input id="high-contrast" type="checkbox" checked={preferences.highContrast}
              onChange={event => updatePreferences({ highContrast: event.target.checked })}/>
          </div>
          <div className="settings-option">
            <div><label htmlFor="reduced-motion">Reduzir animações</label><p>Reduz transições e animações da interface.</p></div>
            <input id="reduced-motion" type="checkbox" checked={preferences.reducedMotion}
              onChange={event => updatePreferences({ reducedMotion: event.target.checked })}/>
          </div>
        </div>
      </section>

      <section className="card">
        <p className="eyebrow">SEUS DADOS</p>
        <h2>Baixar ou excluir dados</h2>
        <p className="m">Conta: {email || 'carregando...'}</p>
        <div className="settings-actions">
          <button type="button" className="secondary-button" disabled={busy || !email} onClick={exportData}>Baixar meus dados</button>
          <button type="button" className="ghost danger-ghost" disabled={!email} onClick={openDeleteDialog}>Excluir conta</button>
        </div>
      </section>

      {message && <p className="status-message" role="status">{message}</p>}

      <dialog className="delete-dialog" ref={dialog} aria-labelledby="delete-account-title">
        <form onSubmit={deleteAccount}>
          <h2 id="delete-account-title">Excluir sua conta?</h2>
          <p className="danger-note"><b>Esta ação é permanente.</b> Sua conta, séries e dados associados serão apagados e não poderão ser recuperados.</p>
          <p>Para confirmar, conclua todas as etapas:</p>
          <label className="settings-option">
            <span>Entendo que a exclusão é permanente e não pode ser desfeita.</span>
            <input type="checkbox" checked={deleteAccepted} onChange={event => setDeleteAccepted(event.target.checked)} required/>
          </label>
          <label>E-mail da conta
            <input type="email" autoComplete="email" value={deleteEmail} onChange={event => setDeleteEmail(event.target.value)} required/>
          </label>
          <label>Digite <b>EXCLUIR MINHA CONTA</b>
            <input value={deletePhrase} onChange={event => setDeletePhrase(event.target.value)} required/>
          </label>
          <p className="m small">A solicitação também exige uma sessão autenticada com a verificação em duas etapas da conta.</p>
          <div className="settings-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => dialog.current?.close()}>Cancelar</button>
            <button className="danger-action" disabled={busy || !deleteAccepted || deletePhrase !== 'EXCLUIR MINHA CONTA' || deleteEmail.trim().toLowerCase() !== email.trim().toLowerCase()}>
              {busy ? 'Excluindo...' : 'Excluir conta permanentemente'}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  </>;
}
