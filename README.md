# Painel: setup

1. **Supabase** (supabase.com): crie um projeto. No SQL Editor, aplique as migrations em ordem: `supabase/migrations/0001_base.sql`, `0002_hardening.sql` e `0003_require_aal2_profiles.sql`.
2. **Bloqueie cadastro público:** Authentication > Sign In / Providers > desligue "Allow new users to sign up".
3. **Primeiro admin:** Authentication > Users > Add user (marque auto-confirm). Depois rode no SQL Editor:
   `update public.profiles set role='admin' where email='seu@email.com';`
4. **Chaves:** Project Settings > API: use a Project URL e a chave publishable/anon no cliente. Configure `SUPABASE_SERVICE_ROLE_KEY` somente como variável secreta do servidor; nunca use prefixo `NEXT_PUBLIC_` nela.
5. **IA local:** sugestões de colunas usam regras no navegador, sem chave ou envio da planilha. O chat local aparece ao abrir uma série e usa WebGPU; cada dispositivo baixa o modelo na primeira utilização. Navegadores sem WebGPU continuam com importação, gráficos e sugestões automáticas, mas sem o chat.
6. **E-mail:** em Supabase > Authentication > URL Configuration, defina a URL do app e permita os redirects `/auth/confirm?next=/set-password` e `/auth/confirm?next=/reset-password` nos ambientes usados. Em Authentication > Email Templates, configure os links descritos em `docs/SEGURANCA_E_RECUPERACAO.md`. Configure SMTP de produção para entrega confiável dos convites e links de recuperação.
7. **GitHub/Vercel:** suba esta pasta (o `.gitignore` exclui `.env.local`). Cadastre na Vercel `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` e `SUPABASE_SERVICE_ROLE_KEY` em Environment Variables; marque a chave de serviço como secreta.
8. **Local:** copie `.env.example` para `.env.local`, preencha as variáveis e execute `npm install` e `npm run dev`.

## Convites e recuperação de senha
- O administrador envia um convite Supabase para o e-mail da pessoa; ela confirma o e-mail, define uma senha própria e então configura o 2FA obrigatório.
- Na tela de login, **Esqueci minha senha** envia o link de recuperação pelo Supabase. O endereço de retorno permitido deve incluir `/auth/confirm`.
- Configure os modelos de convite e recuperação para usar `token_hash`; as URLs exatas estão no guia de segurança. Sem essa configuração, os links podem não completar o fluxo no app.

## 2FA, LGPD e recuperação
- O 2FA (app autenticador) é obrigatório para todos. Conferir em Authentication > MFA que TOTP está habilitado.
- Perdeu o celular? Um admin usa "Resetar 2FA" na tela de administração. Se for o único admin, rode no SQL Editor: `delete from auth.mfa_factors where user_id = (select id from auth.users where email='seu@email.com');`
- Escolha a região São Paulo (sa-east-1) no Supabase e gru1 na Vercel. Preencha os campos [entre colchetes] em `app/privacidade/page.js`.

## IA local e privacidade
- As sugestões automáticas usam nomes e tipos de coluna no navegador. O chat local analisa um resumo dos fatos agregados da série selecionada, sem enviar perguntas ou fatos a uma API de IA.
- O modelo WebGPU é baixado do Hugging Face na primeira utilização e armazenado pelo navegador. É necessário um navegador e dispositivo compatíveis, além de conexão para o download inicial; o modelo pode consumir bastante memória e espaço.
- Sem WebGPU, importação, gráficos e sugestões automáticas continuam disponíveis. Respostas de modelos pequenos podem ser imprecisas; valide resultados nos dados e gráficos.

## Migrations
Para uma instalação nova, rode em ordem no SQL Editor: `supabase/migrations/0001_base.sql`, `0002_hardening.sql` e `0003_require_aal2_profiles.sql`. A migration 0001 contém comandos `DROP TABLE ... CASCADE`: revise e faça backup antes de executá-la em um projeto com dados. Não reaplique migrations já executadas; use uma nova migration para mudanças futuras. Desfazer: `supabase/rollback/` (rollback pode remover controles de segurança). Plano completo: `docs/SEGURANCA_E_RECUPERACAO.md`.
