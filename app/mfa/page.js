'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
export default function Mfa() {
  const [step, setStep] = useState('load'), [qr, setQr] = useState(null), [fid, setFid] = useState(''), [secret, setSecret] = useState(''), [err, setErr] = useState(''), [notice, setNotice] = useState('');
  const started = useRef(false);
  async function enroll() {
    setErr('');
    setNotice('');
    setStep('load');
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const verified = factors?.totp?.find(factor => factor.status === 'verified');
      if (verified) {
        setFid(verified.id);
        setStep('verify');
        return;
      }
      for (const factor of factors?.totp || []) {
        if (factor.status === 'unverified') {
          const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
          if (unenrollError) throw unenrollError;
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Painel G360 ${Date.now()}`,
        issuer: 'Painel G360',
      });
      if (error) throw error;
      setFid(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep('enroll');
    } catch (error) {
      setErr(error.message || 'Não foi possível iniciar o autenticador. Atualize a página e tente novamente.');
      setStep('error');
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      await enroll();
    })();
  }, []);
  async function go(e) {
    e.preventDefault();
    setErr('');
    const code = new FormData(e.target).get('code').trim();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fid, code });
    if (error) setErr('Não foi possível verificar esse código. Confira se a conta correta está no app e se a data e hora do celular estão automáticas.');
    else location.href = '/';
  }
  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setNotice('Chave copiada. Trate-a como uma senha e não compartilhe.');
    } catch {
      setNotice('Não foi possível copiar. Toque e segure a chave para copiá-la manualmente.');
    }
  }
  return <div className="login card"><h2>Verificação em duas etapas</h2>
    {step === 'load' && <p className="m">Preparando o cadastro do autenticador...</p>}
    {step === 'enroll' && <><p className="m">1. No Google Authenticator, toque em + e escolha “Ler código QR”. Escaneie este QR exibido no computador.</p>
      <img src={qr} alt="QR code do autenticador" width={240} height={240} style={{ display: 'block', background: '#fff', borderRadius: 8, padding: 10, margin: '12px auto' }}/>
      <p className="m">Se a leitura não adicionar uma conta: no Google Authenticator toque em + → “Inserir uma chave de configuração”. Digite o nome da conta que preferir, cole esta chave e selecione “Baseada em tempo”.</p>
      <p className="m"><code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{secret}</code> <button type="button" className="ghost" onClick={copySecret}>Copiar chave</button></p>
      <p className="m">2. Quando a conta aparecer no app, digite aqui o código atual de 6 dígitos.</p></>}
    {step === 'verify' && <p className="m">Digite o código de 6 dígitos do seu app autenticador.</p>}
    {step !== 'load' && step !== 'error' && <form onSubmit={go}><input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required autoComplete="one-time-code"/><button>Confirmar</button></form>}
    {step === 'error' && <button onClick={enroll}>Tentar configurar novamente</button>}
    {err && <p style={{ color: '#f87171' }}>{err}</p>}
    {notice && <p className="m">{notice}</p>}
    <button className="ghost" style={{ marginTop: 10 }} onClick={async () => { await supabase.auth.signOut(); location.href = '/login'; }}>Sair</button></div>;
}
