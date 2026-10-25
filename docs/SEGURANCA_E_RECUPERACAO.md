# Segurança e recuperação (preencha os [__] com a sua realidade)

## 1. Segredos fora do código
- Só em Vercel > Settings > Environment Variables (marque "Sensitive"), separando Production e Preview. Nunca em código, chat, print ou e-mail.
- GitHub > Settings > Code security: ligue Secret scanning e Push protection.
- Rotação a cada 90 dias e após qualquer suspeita: service_role (Supabase > Project Settings > API). Atualize na Vercel e faça redeploy.

## 2. Migrations e rollback
- Arquivos numerados em `supabase/migrations`. Nunca edite um já aplicado: crie o próximo (0003...).
- Cada migration tem desfazer em `supabase/rollback`. Para voltar, rode os `_down` do mais novo para o mais antigo.
- Antes de aplicar em produção: backup (Database > Backups) e teste num projeto Supabase de teste.
- Regra de ouro: primeiro adicione (compatível com o app antigo), depois remova.
- App: Vercel > Deployments > escolha uma versão anterior > Promote to Production (volta em segundos).

## 3. Backup e recuperação
- Metas: RPO (perda máxima de dados) [__ h]; RTO (tempo máximo fora do ar) [__ h]. Sugestão: RPO 24 h (backup diário) ou minutos com PITR; RTO 4 h.
- Supabase: backups diários nos planos pagos; PITR (restaurar a qualquer instante da janela) é um complemento pago. Sem backup no plano gratuito: exporte toda semana (`pg_dump`) e guarde criptografado fora do Supabase.
- Restauração: (1) pause o acesso; (2) restaure o backup/PITR em projeto novo; (3) valide contagem de linhas e login; (4) troque as variáveis na Vercel para o projeto restaurado; (5) comunique os usuários.
- Teste a restauração num projeto separado a cada trimestre. Backup nunca testado não é backup.

## 4. Incidente de segurança
1. Conter: desative as contas afetadas, rotacione as chaves e, se preciso, faça logout geral rotacionando o JWT secret no Supabase.
2. Avaliar: `audit_log`, logs do Supabase e da Vercel (o que foi acessado, por quem, quando).
3. Comunicar: encarregado (DPO) avalia e comunica ANPD e titulares (LGPD art. 48). A ANPD fixou prazo curto (3 dias úteis na norma de 2024); confirme a norma vigente.
4. Corrigir, documentar e revisar o que falhou.

## 5. Rotina
Semanal: ver logs. Mensal: revisar contas e admins. Trimestral: teste de restauração e rotação de chaves.

## 6. Criptografia e vínculo com o Supabase
- A comunicação com a API do Supabase deve usar HTTPS; não configure endpoints HTTP. Para conexões diretas ao PostgreSQL, use SSL e verifique no painel do projeto se a exigência de SSL está habilitada.
- A criptografia dos dados em repouso e dos backups é gerenciada pela plataforma Supabase. Confira no painel e na documentação vigente do plano/região do projeto; este repositório não controla nem consegue comprovar essa configuração.
- Criptografia gerenciada pelo provedor não equivale a criptografia de campos feita pela aplicação. Criptografia adicional por campo exige definir chaves, rotação e como consultas/relatórios funcionarão; não armazene chaves de criptografia no mesmo banco.
- Se as migrations foram coladas manualmente no SQL Editor, elas não ficam automaticamente registradas como aplicadas pelo CLI. Confira a política da migration 0003 no SQL Editor com:
  ```sql
  select schemaname, tablename, policyname, permissive, roles, cmd, qual
  from pg_policies
  where schemaname = 'public' and tablename = 'profiles';
  ```
  Deve aparecer `exige 2fa profiles`, `RESTRICTIVE` e uma condição que verifica `aal2`. Este projeto não tem configuração local nem CLI do Supabase detectados, então o estado do banco remoto não pode ser confirmado daqui. Não compartilhe `service_role`, tokens ou senhas para fazer essa verificação.

## 7. Convites e recuperação de senha por e-mail
1. No Supabase, configure **Authentication > URL Configuration** com a URL de produção do app como Site URL e adicione os endereços de retorno usados (incluindo `http://localhost:3000/auth/confirm` para desenvolvimento). Em produção, configure `NEXT_PUBLIC_SITE_URL` na Vercel com a origem HTTPS do app.
2. Em **Authentication > Email Templates**, configure o link do modelo de convite para verificar o token no app:
   ```html
   <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite">Confirmar e definir senha</a>
   ```
   No modelo de recuperação de senha, use:
   ```html
   <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Redefinir senha</a>
   ```
3. O admin convida pelo painel; a pessoa confirma o e-mail e define sua senha. A recuperação começa em **Esqueci minha senha** e envia o link pelo Supabase. Depois de definir senha, a pessoa precisa completar o 2FA antes de acessar os dados.
4. Configure um provedor SMTP próprio em **Authentication > SMTP Settings** para envio confiável em produção. Teste convite, confirmação, definição de senha, login, recuperação e expiração do link antes de publicar.
5. Na Vercel, `SUPABASE_SERVICE_ROLE_KEY` deve ser uma variável de servidor sensível, nunca prefixada por `NEXT_PUBLIC_`. Ela é necessária para o endpoint administrativo de convites.

## 8. IA local no navegador
- As sugestões de colunas são heurísticas locais; não exigem chave de provedor e não enviam a planilha.
- O chat usa WebLLM/WebGPU no dispositivo do usuário. Na primeira utilização, os pesos são baixados do Hugging Face e os arquivos do modelo vêm de `raw.githubusercontent.com`; a política CSP do app permite essas origens. O recurso depende da compatibilidade do navegador, da GPU, da memória disponível e do espaço local. Usuários sem WebGPU ainda podem usar importação e gráficos, mas não o chat.
- O app consulta do Supabase somente os fatos agregados da série selecionada e limita o contexto a 3.000 fatos e até 36 períodos. Se houver mais dados, a resposta deve informar que a amostra é limitada.
- A inferência ocorre no navegador, sem enviar perguntas nem fatos a uma API de IA. A página consulta os dados da conta no Supabase para mostrá-los e analisá-los; o download dos pesos do modelo é feito do Hugging Face.
- Modelos locais pequenos podem produzir respostas imprecisas. Valide conclusões com os gráficos e dados originais; não use o chat como fonte única para decisões importantes.
