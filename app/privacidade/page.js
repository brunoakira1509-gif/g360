'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import AppHeader from '@/components/AppHeader';
const V = '2026-10-local-ai';
export default function Privacidade() {
  const [ok, setOk] = useState(null);
  useEffect(() => { (async () => { const { data: { user } } = await supabase.auth.getUser();
    const { data: p } = await supabase.from('profiles').select('terms_version').eq('id', user.id).single(); setOk(p?.terms_version === V); })(); }, []);
  async function accept() { await supabase.rpc('accept_terms', { v: V }); location.href = '/'; }
  return <><AppHeader active="privacidade"/><main style={{ maxWidth: 760 }}><div className="card"><h2>Política de privacidade</h2>
    <p className="m">MODELO: preencha os campos entre colchetes e peça revisão de um advogado antes de usar.</p>
    <p><b>Controlador:</b> [RAZÃO SOCIAL / CNPJ]. <b>Encarregado (DPO):</b> [NOME / E-MAIL].</p>
    <p><b>Dados tratados:</b> dados de conta (e-mail, perfil de acesso, data de ciência desta política) e dados agregados que você importa (período, até 3 agrupamentos e valores somados). A planilha original não é armazenada.</p>
    <p><b>Finalidade e base legal:</b> permitir que você analise e compare seus próprios dados. Base legal: [execução de contrato / legítimo interesse].</p>
    <p><b>Operadores:</b> Supabase (banco e autenticação, região [__]) e Vercel (hospedagem, região [__]). As sugestões de colunas e o chat são executados no navegador; perguntas e dados não são enviados a uma API de IA. Na primeira utilização, o navegador baixa os arquivos do modelo do Hugging Face.</p>
    <p><b>Segurança:</b> HTTPS, criptografia em repouso, senhas com hash, verificação em duas etapas obrigatória, isolamento de dados por conta e registro das ações administrativas.</p>
    <p><b>Seus direitos (art. 18 da LGPD):</b> confirmação e acesso, correção, anonimização ou eliminação, portabilidade (botão "Baixar meus dados"), eliminação (botão "Excluir minha conta"), informação sobre compartilhamento e revogação. Pedidos: [E-MAIL].</p>
    <p><b>Retenção:</b> os dados ficam enquanto a conta existir e são apagados ao excluí-la; backups são sobrescritos em até [__] dias.</p>
    <p><b>Incidentes:</b> comunicaremos a ANPD e os titulares afetados conforme o art. 48.</p>
    <p><b>Sua responsabilidade:</b> não importar dados pessoais identificáveis (CPF, nome, telefone) sem base legal.</p>
    {ok === false && <button onClick={accept}>Li e estou ciente</button>}{ok && <a href="/">Voltar ao painel</a>}</div></main></>;
}
