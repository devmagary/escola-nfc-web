# Manual de Configuração e Publicação — Acesso Escolar NFC

Este é o passo a passo completo para colocar o sistema no ar: criar o banco no Supabase, configurar as variáveis de ambiente, criar o primeiro administrador, testar, publicar na Vercel e operar a portaria com o ESP32-S3.

> **O que mudou:** o sistema **não pede mais URL/chave do Supabase no navegador**. A configuração é gerada no build (`npm run build`) a partir de variáveis de ambiente. Também não existe mais botão público de "cadastrar 1º administrador": o primeiro admin é criado pelo comando `npm run admin`, usando a *service role key* **somente na sua máquina**.

## Índice

1. [Criar o projeto no Supabase e preparar o banco](#1-criar-o-projeto-no-supabase-e-preparar-o-banco)
2. [Configurar o `.env.local`](#2-configurar-o-envlocal)
3. [Criar o primeiro administrador (`npm run admin`)](#3-criar-o-primeiro-administrador-npm-run-admin)
4. [Testar localmente (`npm run dev`)](#4-testar-localmente-npm-run-dev)
5. [Publicar na Vercel](#5-publicar-na-vercel)
6. [Cadastrar usuários e alunos](#6-cadastrar-usuários-e-alunos)
7. [Modo portaria local (totem) e ESP32](#7-modo-portaria-local-totem-e-esp32)
8. [Importação e exportação CSV](#8-importação-e-exportação-csv)
9. [Backup](#9-backup)
10. [Solução de problemas](#10-solução-de-problemas)

---

## 1. Criar o projeto no Supabase e preparar o banco

O Supabase é o backend do sistema: guarda alunos, fotos compactadas, histórico de acessos e os perfis dos funcionários (RBAC).

1. Acesse **[supabase.com](https://supabase.com)**, faça login e clique em **New Project**.
2. Informe nome (ex.: `escola-nfc`), senha forte do banco e região **South America (São Paulo)**.
3. Aguarde o provisionamento (cerca de 1 minuto).
4. Guarde as chaves em **Project Settings → API**:
   * **Project URL** — ex.: `https://abcdefghijk.supabase.co`
   * **anon public** — chave pública usada pelo navegador
   * **service_role** — chave secreta, usada **apenas** para criar o primeiro admin na sua máquina

### 1.1 Banco NOVO: rode `supabase_setup.sql`

1. No menu lateral, abra **SQL Editor → New query**.
2. Abra o arquivo [`supabase_setup.sql`](supabase_setup.sql) deste repositório.
3. Copie **o arquivo inteiro**, cole no editor e clique em **Run**.
4. Confira as mensagens (Notices) exibidas. O script cria:
   * `public.perfis_usuarios` — cargos (`admin`, `direcao`, `coordenacao`, `secretaria`, `portaria`) e status ativo;
   * `public.alunos` — cadastro, UID NFC, foto (`foto_url` + `foto_path`) e status;
   * `public.historico_acessos` — registros de entrada com data/hora e status;
   * funções `sistema_precisa_setup`, `obter_meu_perfil`, `obter_cargo_usuario`, `tem_permissao`;
   * funções administrativas `admin_alterar_usuario`, `admin_redefinir_senha`, `admin_excluir_usuario`;
   * triggers de auto-confirmação de e-mail, criação de perfil (endurecida), `updated_at` e normalização de UID;
   * bucket público **`fotos-alunos`** e as políticas de Storage;
   * políticas **RLS** e os `GRANT/REVOKE` das funções;
   * publicação do histórico no **Realtime**.

O script é **idempotente** (pode ser reexecutado) e não usa `DROP TABLE`, `TRUNCATE` nem `DELETE` em massa.

### 1.2 Banco JÁ EXISTENTE (produção): rode a migração de hardening

Se o projeto Supabase já tem dados da versão anterior, **não rode o setup inteiro por cima**: rode apenas a migração incremental [`supabase/migrations/20261022_hardening.sql`](supabase/migrations/20261022_hardening.sql).

1. **Antes de tudo, faça um backup/snapshot do projeto** (veja a [seção 9](#9-backup)).
2. Abra **SQL Editor → New query**, cole o arquivo **inteiro** e execute **uma única vez**.
3. O editor executa o script em uma transação: se qualquer etapa lançar exceção, **nada é aplicado**.
4. Leia os Notices com atenção. A migração:
   * substitui `public.lidar_novo_usuario()` — o cargo enviado no cadastro é **ignorado**; o primeiro perfil vira `admin` ativo e os demais entram como `portaria` **inativos** (fecha a escalada de privilégio pelo signup público);
   * blinda `admin_alterar_usuario` / `admin_excluir_usuario` contra rebaixar, bloquear ou excluir o **último administrador ativo**;
   * adiciona `public.alunos.foto_path` e faz backfill a partir de `foto_url` do bucket `fotos-alunos` (e limpa `foto_url` gravada como `data:`);
   * cria `public.set_updated_at()` e os triggers de `updated_at`;
   * cria os índices do histórico;
   * publica `historico_acessos` em `supabase_realtime` (idempotente);
   * normaliza `uid_nfc` (`upper`/`trim`) — **se houver UIDs duplicados após a normalização, a migração aborta e lista os UIDs**, sem alterar nada;
   * revisa/habilita o RLS, restringe a leitura de perfis ao próprio usuário/admin e remove a escrita direta em `perfis_usuarios`;
   * garante que `sistema_precisa_setup()` continue acessível a `anon`.

> **Importante:** a migração é obrigatória em bancos existentes. Sem ela, o painel mostra o erro *"Banco desatualizado: execute a migração SQL de hardening antes de usar fotos"* ao salvar foto, e o signup público continua inseguro.

Se a migração abortar por UIDs duplicados, localize-os e corrija antes de rodar de novo:

```sql
SELECT upper(btrim(uid_nfc)) AS uid, COUNT(*) AS ocorrencias
FROM public.alunos
GROUP BY upper(btrim(uid_nfc))
HAVING COUNT(*) > 1;
```

Una/remova os registros repetidos manualmente e execute a migração novamente.

### 1.3 Verificação rápida do banco

No **SQL Editor**, rode:

```sql
SELECT id, email, cargo, ativo FROM public.perfis_usuarios ORDER BY created_at;
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'alunos' AND column_name = 'foto_path';
```

* A primeira consulta lista os funcionários (vazia antes do primeiro admin).
* A segunda deve retornar `foto_path` (uma linha). Se vier vazia, a migração/instalação não foi aplicada.

---

## 2. Configurar o `.env.local`

O site lê a configuração em **tempo de build**. Na sua máquina, o arquivo é o `.env.local`; na Vercel, são as *Environment Variables*.

Dentro da pasta `escola-nfc-web`:

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env.local
notepad .env.local
```

```bash
# Linux/macOS
cp .env.example .env.local
```

### 2.1 Variáveis

| Variável | Obrigatória | Usada por | Como obter |
| :--- | :---: | :--- | :--- |
| `SUPABASE_URL` | ✅ | `npm run build` + `npm run admin` | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | ✅ | `npm run build` | Project Settings → API → anon public |
| `ESP_URL` | ❌ | `npm run build` (endereço inicial do leitor) | IP do ESP32 na rede local (padrão `http://nfc.local`) |
| `APP_ENV` | ❌ | `npm run build` | `production`, `staging`… (padrão `production`) |
| `APP_VERSION` | ❌ | `npm run build` | ex.: `1.1.0` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ só para `npm run admin` | `scripts/bootstrap-admin.mjs` | Project Settings → API → service_role |
| `ADMIN_EMAIL` | ✅ só para `npm run admin` | primeiro administrador | e-mail institucional |
| `ADMIN_PASSWORD` | ✅ só para `npm run admin` | senha inicial (mínimo 6 caracteres) | escolha você |
| `ADMIN_NAME` | ❌ | nome exibido do admin | padrão: parte antes do `@` |

Exemplo de `.env.local`:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...sua-chave-anon-publica

ESP_URL=http://192.168.0.73
APP_ENV=production
APP_VERSION=1.1.0

# Somente para o bootstrap local do administrador. NUNCA comite este arquivo.
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...sua-service-role-key-secreta
ADMIN_EMAIL=admin@escola.exemplo.br
ADMIN_PASSWORD=uma-senha-forte
ADMIN_NAME=Administrador do Sistema
```

### 2.2 Regras de precedência

O script lê, nesta ordem (o último vence):

1. `.env` (se existir);
2. `.env.local` (sobrescreve o `.env`);
3. variáveis já definidas no ambiente do processo (sobrescrevem os arquivos) — é o que a Vercel usa.

Ou seja: se algo continuar "com valor antigo", verifique se a variável não está definida no próprio sistema operacional/terminal.

### 2.3 Cuidados

* `.env.local` e `config.js` estão no `.gitignore`. **Não comite nenhum dos dois.**
* O `npm run build` só embute no `config.js` as variáveis públicas (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ESP_URL`, `APP_ENV`, `APP_VERSION`). A `SUPABASE_SERVICE_ROLE_KEY` **não** é lida pelo build e nunca chega ao navegador.
* Ao alterar qualquer variável, rode `npm run build` novamente (na Vercel, *Redeploy*).

---

## 3. Criar o primeiro administrador (`npm run admin`)

Novos cadastros públicos entram **inativos e como `portaria`** (é a proteção contra escalada de privilégio). Por isso o primeiro administrador é criado localmente, com a service role key.

1. Preencha no `.env.local`:

   ```dotenv
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...service-role-key
   ADMIN_EMAIL=admin@escola.exemplo.br
   ADMIN_PASSWORD=uma-senha-com-6-ou-mais-caracteres
   ADMIN_NAME=Administrador do Sistema
   ```

2. Na pasta do projeto, execute:

   ```bash
   npm run admin
   ```

3. Saída esperada (a senha e a chave **nunca** são exibidas):

   ```
   🔐 Bootstrap do administrador (Supabase)
      Arquivos lidos: .env.local
      Supabase: https://seu-projeto.supabase.co
      E-mail  : admin@escola.exemplo.br
      ✅ Usuário criado com e-mail já confirmado.

   ✅ Administrador criado com sucesso!
      Nome  : Administrador do Sistema
      E-mail: admin@escola.exemplo.br
      ID    : 00000000-0000-0000-0000-000000000000
      Cargo : admin (ativo)
      🔒 Senha definida (não exibida por segurança).
   ```

O comando é **idempotente**: pode ser executado várias vezes. Se o usuário já existir, ele é reaproveitado (o e-mail é confirmado, se necessário) e o perfil em `public.perfis_usuarios` é atualizado para `cargo = admin`, `ativo = true`. **A senha de um usuário existente não é alterada.**

> **Esqueceu a senha do único admin?** Crie um novo admin: altere `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `.env.local` para outro e-mail e rode `npm run admin` de novo. Depois entre com a conta nova e redefina a senha da conta antiga em **Usuários → Senha**.
>
> **Importante:** rode o `npm run admin` **antes de divulgar o link publicado**. O trigger do banco promove o primeiro usuário cadastrado a administrador; se o site ficar público antes do bootstrap, alguém poderia tentar ocupar esse lugar. Enquanto o administrador não existir, mantenha o deploy restrito/teste.
>
> **Segurança:** a service role key ignora o RLS. Mantenha-a **somente** no `.env.local` da sua máquina. Nunca a coloque na Vercel, no `config.js`, em código do frontend, em issue/print ou em commit.

As demais contas de funcionários são criadas pelo próprio painel (seção 6), **não** pelo `npm run admin`.

---

## 4. Testar localmente (`npm run dev`)

O comando `npm run dev` gera o `config.js` e sobe o servidor HTTP local na porta 5500:

```bash
npm run dev
```

Abra **http://localhost:5500**, entre com o e-mail/senha do administrador e valide:

1. **Configurações → Testar conexões:** o diagnóstico de nuvem verifica
   * conexão com a API e acesso à tabela `alunos`;
   * coluna `foto_path` (migração aplicada);
   * tabela `historico_acessos`;
   * função de setup (indica se o banco ainda não tem administrador);
   * bucket `fotos-alunos`.
2. **Usuários:** crie uma conta de teste para cada cargo e confirme as abas visíveis.
3. **Secretaria:** cadastre um aluno de teste (nome, turma, UID). Com o leitor configurado, a gravação também sincroniza o cartão no ESP32.
4. **Portaria:** aproxime um cartão cadastrado (ou use o simulador da seção 7) e confirme a exibição do aluno e o registro no histórico.

Se aparecer o aviso **"Este site ainda não foi conectado ao banco."**, o `config.js` não foi gerado ou está incompleto: rode `npm run build` e recarregue.

Para parar o servidor: `Ctrl+C`.

---

## 5. Publicar na Vercel

A publicação é para o **painel** (direção, secretaria, coordenação, admin). A portaria continua no modo local HTTP (seção 7).

### 5.1 Enviar o repositório para o GitHub

Dentro da pasta `escola-nfc-web` (que é um repositório git separado):

```bash
git add .
git commit -m "Configuração por ambiente, bootstrap de admin e SQL de hardening"
git push origin main
```

Confirme que `.env.local` e `config.js` **não** aparecem no commit.

### 5.2 Importar na Vercel

1. Em **[vercel.com](https://vercel.com)**, clique em **Add New → Project** e importe o repositório.
2. **Root Directory:** se você publicar um repositório maior (monorepo), selecione `escola-nfc-web`; se o repositório for o próprio `escola-nfc-web`, deixe a raiz.
3. **Framework Preset:** *Other* (o projeto é HTML/JS estático). Não é preciso configurar build manualmente: o [`vercel.json`](vercel.json) já define `buildCommand: "npm run build"` e `outputDirectory: "."`.
4. Em **Environment Variables**, cadastre (em Production, Preview e Development, conforme o uso):

   | Nome | Valor |
   | :--- | :--- |
   | `SUPABASE_URL` | URL do projeto Supabase |
   | `SUPABASE_ANON_KEY` | anon public key |
   | `ESP_URL` | opcional — endereço inicial do leitor (padrão `http://nfc.local`) |
   | `APP_ENV` | opcional — ex.: `production` |
   | `APP_VERSION` | opcional — ex.: `1.1.0` |

5. Clique em **Deploy**.

### 5.3 Confira o build

* O build roda `node scripts/build-config.mjs` e gera o `config.js` na raiz publicada.
* Se faltar `SUPABASE_URL`/`SUPABASE_ANON_KEY`, o **build falha** com mensagem clara em português (a Vercel mostra o log) — é melhor falhar no deploy do que publicar um site sem banco.
* Depois de **criar ou alterar** variáveis, clique em **Redeploy** para gerar o `config.js` novo.
* Abra o link `https://...vercel.app`, faça login e confirme o funcionamento da nuvem em **Configurações**.

### 5.4 Avisos de segurança do deploy

* A **anon key é pública** e vai aparecer no `config.js` publicado — isso é esperado. Quem protege os dados é o RLS.
* **Nunca** cadastre `SUPABASE_SERVICE_ROLE_KEY` na Vercel. Ela não é usada pelo build e não deve existir fora da sua máquina.
* O [`vercel.json`](vercel.json) publica a raiz do projeto, mas o [`.vercelignore`](.vercelignore) remove do deploy os arquivos internos (`tests/`, `supabase/`, `docs/`, firmware etc.). Ainda assim, **nunca** comite dados reais de alunos, backups ou arquivos `.env`.
* A portaria **não** usa o link da Vercel para falar com o ESP32 (veja a seção 7).

---

## 6. Cadastrar usuários e alunos

### 6.1 Usuários e permissões (RBAC)

Entre como administrador, abra a aba **Usuários** e clique em **➕ Novo Usuário**: nome, e-mail institucional, senha provisória (mínimo 6 caracteres), cargo e status ativo.

| Cargo | Portaria | Secretaria | Histórico | Usuários | Configurações | Pode editar alunos | Pode excluir | Sincronizar ESP32 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 🛠️ **Admin / Técnico** | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ |
| 🏛️ **Direção** | ✔️ | ✔️ | ✔️ | ❌ | ❌ | ✔️ | ✔️ | ✔️ |
| 📚 **Coordenação** | ✔️ | ✔️ | ✔️ | ❌ | ❌ | ✔️ | ❌ | ❌ |
| 📝 **Secretaria** | ✔️ | ✔️ | ✔️ | ❌ | ❌ | ✔️ | ✔️ | ✔️ |
| 🏢 **Portaria** | ✔️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Regras de proteção aplicadas pelo banco:

* O administrador **não pode** rebaixar, bloquear ou excluir a própria conta.
* O **último administrador ativo** não pode ser rebaixado, bloqueado nem excluído (a mensagem de erro explica a regra).
* O cargo efetivo e o status ativo são lidos de `public.perfis_usuarios`; as políticas RLS reforçam as permissões.

Ações disponíveis por usuário: **Editar** (nome, cargo e status), **Senha** (redefinir senha), **Bloquear/Ativar** e **Excluir** (as duas últimas não aparecem para a própria conta). Todo usuário pode trocar a própria senha em **Conta** (canto superior direito).

### 6.2 Alunos e fotos

Na aba **Secretaria**:

1. Preencha **nome completo** (mínimo 3 caracteres), **matrícula** (opcional, mas única), **turma** (obrigatória), **curso**, **responsável**, **WhatsApp** e o **UID do cartão NFC** (obrigatório, formato hexadecimal, ex.: `2C:9D:7E:8E`).
2. A **foto é opcional**: escolha um arquivo JPG/PNG/WebP (até 10 MB, reduzida automaticamente) ou tire a foto pela webcam. Ela é gravada no bucket `fotos-alunos` e o caminho fica em `alunos.foto_path`. A webcam do navegador exige **HTTPS** (link da Vercel) ou **localhost**; em `http://192.168...` use o upload de arquivo.
3. Para preencher o UID direto do leitor, use **📡 Puxar do leitor** (precisa estar no modo local HTTP — seção 7).
4. Marque **Permissão de acesso ativa** para liberar o cartão e clique em **Salvar Aluno**.

Ao salvar, o painel grava no Supabase e — se estiver em modo local e o ESP32 responder — envia o cartão na hora (`POST /api/sincronizar_aluno`). Bloquear/liberar também atualiza o leitor. Excluir remove o cartão do leitor e a foto do bucket, mantendo o histórico.

---

## 7. Modo portaria local (totem) e ESP32

### 7.1 Por que a portaria precisa de HTTP local

O ESP32-S3 responde em **HTTP** na rede local (ex.: `http://192.168.0.73` ou `http://nfc.local`). Navegadores modernos **bloqueiam** requisições de uma página **HTTPS** (como o link da Vercel) para endereços **HTTP** da rede local — é a política de *mixed content / Private Network Access*. Por isso:

* o painel publicado na Vercel serve para **gestão** (secretaria, direção, admin), não para operar o leitor;
* o computador/tablet da portaria deve abrir o site por **HTTP local**, usando o servidor incluído no projeto.

Se tentar operar a portaria pelo link HTTPS, o selo do ESP32 mostra **`Bloq. HTTPS`** e o banner explica como abrir o modo local.

### 7.2 Subir o servidor local do totem

```bash
npm run build   # garante o config.js atualizado
npm run totem   # servidor HTTP em http://localhost:5500
```

O terminal mostra os endereços:

```
Local: http://localhost:5500
Rede : http://192.168.0.50:5500
```

* Na máquina da portaria: abra `http://localhost:5500`.
* Em outro tablet/computador da mesma rede: abra `http://IP-DA-MAQUINA:5500` (o servidor escuta em `0.0.0.0`). Autorize o Node.js no firewall do Windows para redes privadas.
* Se a porta 5500 estiver ocupada, use outra:

  ```powershell
  # Windows (PowerShell)
  $env:PORT = "5501"; npm run totem
  ```

  ```bash
  # Linux/macOS
  PORT=5501 npm run totem
  ```

### 7.3 Configurar o endereço do ESP32

O endereço do leitor é uma preferência **por dispositivo** (salva no `localStorage` do navegador), porque o IP pode variar entre a portaria e a secretaria.

1. Clique no selo **ESP32: …** no cabeçalho, ou abra **Configurações → Leitor ESP32**.
2. Informe o endereço, por exemplo `http://192.168.0.73` ou `http://nfc.local` (mDNS, quando funcionar).
3. Use **Testar leitor** para ver IP, Wi-Fi e sinal; salve.

Atalho por link (útil para configurar um tablet novo de uma vez):

```
http://localhost:5500/?esp=http://192.168.0.73#/portaria
```

Onde encontrar o IP do ESP32:

* **Monitor Serial** da Arduino IDE (115200 baud) após conectar no Wi-Fi;
* a página de configuração do próprio firmware (`/wifi`) ou o **console**/`/api/status`;
* a lista de clientes DHCP do roteador. Recomenda-se **reservar um IP fixo** para o leitor no roteador.

### 7.4 Operar a portaria

1. Entre com uma conta de cargo **Portaria** (ou admin).
2. Aproxime o cartão do leitor: o totem exibe foto, nome, turma, curso, responsável e o status:
   * **ACESSO LIBERADO** — cartão cadastrado e ativo;
   * **ACESSO BLOQUEADO** — cartão cadastrado, mas bloqueado;
   * **NÃO CADASTRADO** — UID não encontrado.
3. Cada leitura processada é registrada em `historico_acessos`. Se a gravação falhar (nuvem instável), o acesso de um **aluno identificado** fica numa **fila local** no navegador e é reenviado quando a conexão volta. Tentativas de **cartão não cadastrado** são registradas quando a nuvem está online, mas **não entram na fila** (qualquer tag NFC geraria lixo na fila). Sem internet, a decisão de liberar/bloquear continua sendo tomada pelo **próprio ESP32** com a base em Flash; o painel usa a última base de alunos salva no dispositivo para exibir nome/status.
4. Botões do totem: **⛶ Tela cheia**, **🔇/🔊 Ativar som** e, quando em tela cheia, **✕ Sair do modo totem**.
5. O link **Notificar responsável no WhatsApp** abre a conversa com o telefone cadastrado.

### 7.5 Sincronizar a base com o leitor

O ESP32 mantém a base de cartões na Flash e continua funcionando **mesmo se a internet cair** (a decisão de liberar/bloquear é local). Para atualizar a base:

* **Automático:** salvar/editar/bloquear um aluno em modo local envia o cartão na hora.
* **Manual:** **Secretaria → 🔄 Sincronizar ESP32** (ou **Configurações → Sincronizar base**), que grava a lista completa.
* **Conferência:** **Configurações → 🔍 Comparar bases** mostra cartões faltando, com status divergente ou sobrando no leitor.

Se a sincronização falhar, o painel avisa ("Aluno salvo na nuvem, mas o ESP32 não confirmou…"). Verifique se está em modo local HTTP e se o endereço do leitor está correto.

### 7.6 Testar sem hardware (ESP32 simulado)

O script `scripts/mock-esp.mjs` implementa o mesmo contrato HTTP do firmware, na porta 8787, com CORS liberado.

```bash
npm run mock
```

No painel (**Configurações → Leitor ESP32**), use `http://localhost:8787` como endereço. Depois:

1. cadastre/edite um aluno (a sincronização grava o cartão no simulador) ou use **Sincronizar base**;
2. simule a leitura:

   ```bash
   curl "http://localhost:8787/mock/ler?uid=2C:9D:7E:8E"
   ```

### 7.7 Acompanhar de fora da escola

O acompanhamento remoto **não precisa acessar o ESP32 nem a rede local**. O caminho é:

```
painel da portaria (HTTP local)  →  Supabase (nuvem)  →  painel da direção (Vercel/HTTPS)
```

1. A portaria mantém o **painel completo** aberto e logado no dispositivo local. É ele que lê o ESP32 e grava cada acesso no Supabase.
2. A direção entra no link da Vercel (`https://escola-nfc-web.vercel.app`) com uma conta de cargo **Direção** (ou admin) e abre **Histórico**.
3. O histórico se atualiza por **Realtime** quando a publicação está configurada e, como garantia, por **consulta automática a cada 10 segundos**; o botão **↻ Atualizar agora** força a consulta.
4. Não é necessário abrir porta no roteador, IP público ou túnel: apenas o Supabase e a Vercel são acessados pela internet.

Condições importantes:

* o dispositivo da portaria precisa estar **ligado, com internet e com a página da portaria aberta/logada** — ele é a ponte entre o leitor e a nuvem;
* se a internet cair, os acessos de alunos identificados ficam na **fila local** e aparecem no histórico remoto quando sincronizarem (podem chegar com atraso);
* o **painel embutido do ESP32** (`http://<ip-do-esp>/`) serve para cartões/histórico local, mas **não grava no Supabase**; para acompanhamento remoto use o painel completo;
* se for necessário acompanhar mesmo com o navegador da portaria fechado, a evolução é fazer o **ESP32 enviar os eventos diretamente para o Supabase** (função/Edge Function com token de dispositivo) — isso é uma mudança de firmware, não necessária para o fluxo atual;
* a conta remota precisa de cargo **Direção** ou **Admin** para ver o histórico; a RLS não libera dados para qualquer pessoa.

   ou abra `http://localhost:8787/mock/ler?uid=2C:9D:7E:8E` no navegador;

3. o totem deve exibir o aluno. Rotas úteis do simulador:
   * `GET /api/ultimo`, `GET /api/status`, `GET /api/cartoes`
   * `POST /api/sincronizar_aluno`, `POST /api/sincronizar_todos`, `POST /api/remover_aluno`
   * `GET /mock/ler?uid=…` e `GET /mock/estado`

O estado do simulador é mantido em memória (reinicia ao parar o processo).

### 7.7 Acessos remotos

Direção, secretaria e coordenação podem usar o link da Vercel normalmente para cadastrar alunos, consultar relatórios e gerenciar usuários. A operação física da portaria (leitor) é sempre local.

---

## 8. Importação e exportação CSV

### 8.1 Importar alunos

Na aba **Secretaria**, clique em **📥 Importar CSV**. O arquivo deve ser **UTF-8**, ter no máximo **5 MB** e usar `;` (ponto e vírgula) ou `,` como separador (o sistema detecta).

Clique em **Baixar modelo CSV** para obter o modelo com os cabeçalhos exatos:

```csv
nome_completo;matricula;turma;curso;nome_responsavel;telefone_responsavel;uid_nfc;ativo
Maria Clara Souza;20241002;Informática 2;Técnico em Informática;Carlos Roberto Souza;84998765432;2C:9D:7E:8E;sim
```

* **Obrigatórias:** `nome_completo`, `turma` e `uid_nfc`.
* **Opcionais:** `matricula`, `curso`, `nome_responsavel`, `telefone_responsavel`, `ativo`.
* O sistema aceita apelidos de cabeçalho (sem diferenciar maiúsculas/acentos), por exemplo `nome`, `aluno`, `matricula`, `mat`, `turma`, `classe`, `serie`, `responsavel`, `whatsapp`, `uid`, `cartao`, `tag`, `liberado`.
* `ativo` aceita `sim`/`nao`, `1`/`0`, `liberado`/`bloqueado` (vazio = ativo).
* **UID válido:** hexadecimal com pelo menos 8 dígitos, em quantidade par; é normalizado para maiúsculas com `:` (ex.: `2C9D7E8E` → `2C:9D:7E:8E`).
* Nome com menos de 3 caracteres, turma vazia, UID inválido, UID repetido no arquivo, UID/matrícula já cadastrados geram erro **naquela linha**.

O sistema mostra uma **prévia** com as linhas válidas e a lista de erros; linhas com erro são ignoradas e o restante é importado em lotes. Alunos importados **não** trazem foto (a foto é enviada depois pelo formulário) e, ao final, a base é sincronizada com o leitor quando possível.

### 8.2 Exportar alunos

* **Secretaria → 📤 Exportar CSV:** colunas `nome_completo`, `matricula`, `turma`, `curso`, `nome_responsavel`, `telefone_responsavel`, `uid_nfc`, `ativo`, `foto_url` (arquivo UTF-8 com BOM, abre no Excel).
* **Configurações → 📦 Exportar alunos (JSON):** backup completo dos campos de `alunos`.
* **Configurações → 📤 Exportar alunos (CSV):** mesma exportação da Secretaria.

### 8.3 Exportar histórico

Na aba **Histórico**, aplique os filtros (período, busca, status) e clique em **📤 Exportar CSV**. Colunas: `data_hora`, `nome_identificado`, `turma`, `uid_nfc`, `status`, `tipo_evento`, `aluno_id`. A exportação busca os registros do filtro em páginas de 1.000 (até 20.000 linhas).

---

## 9. Backup

O sistema **não substitui** uma rotina de backup. Recomendações práticas:

1. **Alunos:** em **Configurações**, exporte **JSON** (backup completo) e **CSV** (abre no Excel) periodicamente. O JSON é o melhor formato para guardar os campos; o CSV serve para conferência e reimportação.
2. **Fotos:** o bucket `fotos-alunos` é **público para leitura** e as imagens **não** vão dentro do JSON/CSV (eles guardam apenas `foto_url`/`foto_path`). Baixe o conteúdo do bucket pelo painel do Supabase (**Storage → fotos-alunos**) para guardar as imagens.
3. **Banco (perfis, alunos e histórico):** use os **backups do Supabase** disponíveis no plano contratado (**Database → Backups**). O plano gratuito pode não oferecer retenção automática de backups — confira o seu plano e, se necessário, exporte as tabelas pelo SQL Editor ou faça um dump com `pg_dump` usando a string de conexão do projeto.
4. **Configuração:** guarde as variáveis do `.env.local` (ou só as chaves) em um gerenciador de senhas. Em caso de troca de projeto Supabase, será preciso gerar um `config.js` novo (build/redeploy) e recriar o admin com `npm run admin`.
5. **Restauração:** crie o projeto Supabase, rode `supabase_setup.sql`, ajuste `.env.local` (ou as variáveis da Vercel), rode `npm run admin`, reimporte os alunos por CSV/JSON e reenvie as fotos. Histórico antigo só é restaurado a partir de um backup do banco.

> ⚠️ **LGPD e privacidade:** os backups contêm dados pessoais de alunos (inclusive fotos e telefone do responsável). Guarde-os em local seguro e restrito, não os envie por WhatsApp/e-mail e **nunca** os comite no repositório.

---

## 10. Solução de problemas

### Configuração e build

| Sintoma | Causa provável | Solução |
| :--- | :--- | :--- |
| **"Este site ainda não foi conectado ao banco."** na tela de login | `config.js` ausente/inválido, ou build sem as variáveis | Rode `npm run build`; na Vercel, cadastre as Environment Variables e faça **Redeploy** |
| `config.js não encontrado. Rode "npm run build"...` ao abrir `http://localhost:5500` | Servidor local iniciado sem build | `npm run build` (ou `npm run dev`) antes de abrir o totem |
| Build da Vercel falha com `SUPABASE_URL é obrigatória` | Variável não cadastrada no ambiente certo | Cadastre em **Production/Preview/Development** e faça Redeploy |
| Alterei a variável e o site continua igual | Falta rebuild/redeploy; cache do navegador | Rode `npm run build` ou **Redeploy**; recarregue com cache limpo (`Ctrl+F5`) |
| `.env.local` preenchido, mas o comando usa outro valor | Variável já definida no ambiente do sistema (precedência) | Remova a variável do shell/sistema ou use o valor correto |
| `npm run build` diz `Erro em .env.local (linha N)` | Linha malformada (esperado `CHAVE=valor`) | Corrija a linha indicada; não use `=` sem chave válida nem comece nome de variável com número |

### Login e permissões

| Sintoma | Causa provável | Solução |
| :--- | :--- | :--- |
| **"Sua conta está desativada. Fale com o administrador."** | Perfil com `ativo = false` (novos cadastros entram inativos) | Um admin ative a conta em **Usuários → Ativar** |
| **"E-mail ou senha incorretos."** | Credenciais erradas | Confira o e-mail; se necessário, admin redefine em **Usuários → Senha** |
| **"E-mail ainda não confirmado."** | Usuário sem `email_confirmed_at` | Rode o `npm run admin` para o admin (confirma o e-mail) e/ou garanta que o trigger `auto_confirmar_usuario` existe (reexecute `supabase_setup.sql`, que é idempotente); admin também pode redefinir a senha |
| **"Este e-mail já possui conta. Use outro e-mail."** | E-mail já cadastrado no Supabase Auth | Use outro e-mail ou edite o usuário existente |
| **"Seu perfil não tem permissão para esta ação."** / `permission denied` / `row-level security` | Cargo sem permissão ou políticas RLS ausentes | Confira a tabela da [seção 6.1](#61-usuários-e-permissões-rbac); garanta que o SQL (setup/migração) foi aplicado |
| Erro ao rebaixar/bloquear/excluir: **"este é o último administrador ativo"** | Proteção do banco | Crie/ative outro admin antes de mudar esta conta |
| Não consigo editar meu próprio cargo/status | Proteção intencional | Peça a outro admin |
| Diagnóstico mostra **"Banco sem administrador"** | Nenhum perfil em `public.perfis_usuarios` | Rode `npm run admin` (seção 3) |

### Banco e migração

| Sintoma | Causa provável | Solução |
| :--- | :--- | :--- |
| **"Banco desatualizado: execute a migração SQL de hardening antes de usar fotos."** | Coluna `alunos.foto_path` ausente | Execute `supabase/migrations/20261022_hardening.sql` (banco existente) ou `supabase_setup.sql` (banco novo) |
| Migração abortou com **"UIDs NFC duplicados após normalização"** | Dois alunos com o mesmo UID após `upper/trim` | Localize e una/remova os duplicados (consulta na [seção 1.2](#12-banco-já-existente-produção-rode-a-migração-de-hardening)) e rode de novo |
| **"duplicate key ... alunos_uid_nfc_key"** | Cartão já cadastrado para outro aluno | Consulte a lista de alunos e corrija o UID |
| **"duplicate key ... alunos_matricula_key"** | Matrícula já cadastrada | Corrija ou deixe a matrícula em branco |
| Nenhum aluno aparece / tabela vazia | RLS ou SQL não aplicado; usuário sem permissão | Rode o SQL completo e confira o cargo do usuário |
| Histórico não atualiza sozinho | Realtime não publicado ou sem conexão | Rode a migração (publica `historico_acessos` em `supabase_realtime`) e recarregue |
| Migração não aplicou nada | Script rodou em transação e alguma etapa falhou | Leia a mensagem de erro do SQL Editor, corrija a causa e execute novamente |
| Precisa desfazer? | A migração não tem rollback automático | Restaure o backup/snapshot feito antes da execução |

### ESP32, totem e rede

| Sintoma | Causa provável | Solução |
| :--- | :--- | :--- |
| Selo **`Bloq. HTTPS`** / "Página HTTPS não pode acessar o ESP32 em HTTP" | Site aberto por HTTPS (Vercel) | Abra a portaria pelo modo local: `npm run totem` e `http://localhost:5500` |
| Selo **`Offline`** e banner "Não foi possível falar com o leitor…" | ESP32 desligado, fora da rede, IP errado ou firewall | Confira alimentação, Wi-Fi **2,4 GHz**, IP no monitor serial e o endereço em **Configurações → Leitor ESP32**; teste com **Testar leitor** |
| Selo **`Leitor OFF`** | ESP32 online, mas o módulo PN532 não respondeu | Verifique a ligação I2C/SPI do PN532 e reinicie o leitor |
| Endereço `http://nfc.local` não resolve | mDNS indisponível no Windows/rede | Use o IP direto (ex.: `http://192.168.0.73`) |
| IP do leitor mudou sozinho | DHCP atribuiu outro IP | Reserve um IP fixo para o ESP32 no roteador e atualize o endereço no painel |
| Aproximação não aparece no totem | Leitor offline, UID não sincronizado ou conta sem permissão | Teste com **Testar leitor**; use **Sincronizar base**; confirme o UID cadastrado |
| **"Aluno salvo na nuvem, mas o ESP32 não confirmou a sincronização."** | Portaria em HTTPS ou leitor inacessível | Sincronize a partir do modo local HTTP |
| Porta 5500 ocupada | Outro processo usando a porta | Use `PORT=5501` (`$env:PORT = "5501"; npm run totem` no PowerShell) |
| Tablet da portaria não abre `http://IP:5500` | Firewall do Windows bloqueando | Libere o Node.js para redes privadas ou use a mesma máquina |

### Fotos e CSV

| Sintoma | Causa provável | Solução |
| :--- | :--- | :--- |
| Foto não aparece no totem | Falha no upload ou `foto_path` antigo | Verifique o bucket `fotos-alunos` e o diagnóstico de nuvem; reenvie a foto |
| CSV recusado com "precisa ter as colunas nome_completo, turma e uid_nfc" | Cabeçalhos ausentes (ou sem apelido reconhecido) | Use o **modelo CSV** baixado pelo próprio sistema |
| Muitas linhas com erro de UID | UID inválido (menos de 8 dígitos hexadecimais ou quantidade ímpar) | Ajuste para o formato do leitor: pares hexadecimais separados por `:` |
| Acentuação errada no Excel | CSV sem UTF-8 | Salve o CSV em UTF-8 (o sistema exporta com BOM, compatível com Excel) |

---

## Resumo do fluxo de implantação

```
1. Supabase: projeto novo → supabase_setup.sql        (existente → migração de hardening)
2. .env.local: SUPABASE_URL + SUPABASE_ANON_KEY (+ bloco do admin)
3. npm run build
4. npm run admin                → primeiro administrador
5. npm run dev                  → testar em http://localhost:5500
6. Vercel: env vars públicas + deploy/redeploy
7. Painel (Vercel): usuários, alunos, histórico e relatórios
8. Portaria: npm run totem + http://localhost:5500 + endereço do ESP32
```

Próximos passos: leia a decisão de backend em [`docs/DECISAO_BACKEND.md`](docs/DECISAO_BACKEND.md) e o manual do firmware em [`esp32s3-nfc-acesso/MANUAL_DO_SISTEMA.md`](esp32s3-nfc-acesso/MANUAL_DO_SISTEMA.md).
