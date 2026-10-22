# Acesso Escolar NFC 🎓🏷️

Sistema de controle de acesso escolar por cartão NFC: **painel web** (Vercel + Supabase), **totem da portaria** em tempo real e **firmware ESP32-S3** com operação offline.

O site **não pede URL nem chave do Supabase em nenhum navegador**. A configuração é gerada no build, a partir de variáveis de ambiente, por `scripts/build-config.mjs` (arquivo `.env.local` no computador e *Environment Variables* na Vercel).

## 🚀 Principais recursos

* **Controle de Acesso Baseado em Cargos (RBAC):** 5 cargos institucionais — `admin`, `direcao`, `coordenacao`, `secretaria` e `portaria`. Cada usuário vê apenas as abas e ações do seu cargo.
* **Portaria/totem em tempo real:** o navegador consulta o leitor (`GET /api/ultimo`), busca o aluno no Supabase e exibe foto, nome, turma, matrícula, curso, responsável e o status **LIBERADO / BLOQUEADO / NÃO CADASTRADO**, com link para notificar o responsável no WhatsApp, som e tela cheia.
* **Operação offline no ESP32-S3:** o leitor mantém a base de cartões na memória Flash (`cartoes.json`) e continua liberando/bloqueando mesmo sem internet. A sincronização é feita pelo painel (envio imediato ao salvar/bloquear e o botão **Sincronizar base**).
* **Resiliência do painel:** acessos de alunos identificados que não conseguem ser gravados na nuvem ficam numa fila local no navegador (até 200 eventos) e são reenviados quando a conexão volta. Tentativas de cartão não cadastrado não ocupam essa fila.
* **Monitoramento remoto:** a portaria grava os acessos no Supabase e a direção acompanha o histórico pelo link da Vercel, com Realtime e atualização automática a cada 10 segundos — sem precisar acessar a rede local.
* **Painel no próprio ESP32 (opcional, para tablet-only):** o firmware pode servir o painel em `http://IP-DO-ESP/painel/`, usando a mesma origem da API. Um script envia os arquivos para o LittleFS; depois a portaria não precisa de computador ligado.
* **Secretaria digital:** cadastro de alunos com foto (webcam ou arquivo, compactada no navegador), matrícula, turma, curso, responsável, telefone e UID NFC.
* **Histórico e relatórios:** filtros por período, nome/turma/UID e status, paginação, atualização em tempo real (Supabase Realtime) e exportação CSV.
* **Importação/exportação CSV:** modelo pronto para baixar, prévia com validação linha a linha, importação em lote e exportação de alunos e histórico.
* **Configuração zero no navegador:** `config.js` gerado no build; IP do ESP32 é a única preferência por dispositivo (fica no `localStorage` do navegador).
* **Diagnóstico integrado:** aba **Configurações** testa nuvem (API, migração `foto_path`, histórico, função de setup e bucket de fotos) e o leitor ESP32.
* **Qualidade:** testes automatizados (`npm test`), verificação de sintaxe (`npm run check`) e CI no GitHub Actions.
* **Diagnóstico de desempenho no firmware 2.0.0-diag:** `/api/diagnostico` mostra loop, HTTP, NFC, FS, heap, PSRAM, stack e eventos lentos; `/console` exibe os logs completos.

## ⚙️ Como a configuração funciona

```
variáveis de ambiente  →  npm run build  →  config.js  →  index.html carrega
(.env / .env.local / Vercel)                (gerado, ignorado no git)
```

O arquivo gerado contém apenas:

```js
window.__APP_CONFIG__ = Object.freeze({
  supabaseUrl, supabaseAnonKey, espUrl, appEnv, appVersion
});
```

| Variável | Obrigatória | Para que serve | Onde fica |
| :--- | :---: | :--- | :--- |
| `SUPABASE_URL` | ✅ | URL do projeto Supabase (`https://xxxx.supabase.co`) | build e `npm run admin` |
| `SUPABASE_ANON_KEY` | ✅ | chave pública usada pelo navegador (protegida pelo RLS) | build |
| `ESP_URL` | ❌ | endereço inicial do leitor (padrão `http://nfc.local`) | build e `npm run painel:upload` |
| `ESP_ADMIN_USER`, `ESP_ADMIN_PASSWORD` | ❌ | login do painel da placa para enviar o painel | apenas `.env.local` |
| `APP_ENV` | ❌ | ambiente exibido no painel (padrão `production`) | build |
| `APP_VERSION` | ❌ | versão exibida no painel (padrão `1.1.0`) | build |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ só para `npm run admin` | cria/repair do primeiro admin — **nunca vai para o navegador** | apenas `.env.local` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | ✅ só para `npm run admin` | dados do primeiro administrador | apenas `.env.local` |

> **Regra de ouro:** a **anon key é pública** (pode aparecer no `config.js` publicado; quem protege o banco é o RLS). A **service role key é secreta**: só existe no `.env.local`, nunca no navegador, na Vercel, em commit ou em print.

## 🗂️ Estrutura do projeto

```
escola-nfc-web/
├── index.html                      # painel (login, abas, modais e totem)
├── style.css
├── js/
│   ├── app.js                      # lógica do painel (abas, totem, CSV, usuários)
│   ├── lib/
│   │   ├── config.js               # leitura do window.__APP_CONFIG__ e IP do ESP32
│   │   └── utils.js                # CSV, datas, telefone, UID, avatar etc.
│   └── services/
│       ├── supabase.js             # auth, alunos, usuários, histórico, fotos
│       └── esp32.js                # API do leitor local + monitoramento da portaria
├── scripts/
│   ├── build-config.mjs            # gera config.js a partir das variáveis de ambiente
│   ├── bootstrap-admin.mjs         # cria o primeiro admin (service role, só local)
│   ├── serve-local.mjs             # servidor HTTP do totem (porta 5500)
│   ├── painel-build.mjs            # monta painel-dist/ (HTML/CSS/JS + gzip)
│   ├── painel-upload.mjs           # envia o painel ao LittleFS do ESP32
│   ├── mock-esp.mjs                # ESP32 simulado (porta 8787, inclui /painel/)
│   └── check-syntax.mjs            # node --check em js/ e scripts/
├── painel-dist/                    # gerado por npm run painel:build (ignorado no git)
├── tests/                          # testes com node:test (sem dependências)
├── supabase_setup.sql              # instalação NOVA do banco (idempotente)
├── supabase/migrations/
│   └── 20261022_hardening.sql      # migração para banco JÁ EXISTENTE
├── .env.example                    # modelo de configuração
├── vercel.json                     # build command + headers
├── .github/workflows/ci.yml        # CI: npm test + npm run check
└── esp32s3-nfc-acesso/             # firmware e manuais do ESP32-S3
```

`config.js` é gerado por `npm run build`, está no `.gitignore` e **não deve ser editado nem comitado**. Sempre que alterar as variáveis, rode o build de novo (na Vercel, faça *Redeploy*).

## ✅ Pré-requisitos

* **Node.js 20 ou superior** (o CI usa Node 20; versões mais novas também funcionam). O projeto **não tem dependências de runtime**.
* Conta gratuita no **[Supabase](https://supabase.com)** (banco, autenticação, fotos e realtime).
* Conta na **[Vercel](https://vercel.com)** para publicar o painel (opcional para uso só na rede local).
* **ESP32-S3 N16R8 + leitor PN532** para a portaria física (opcional: há um simulador para testar sem hardware).
* Navegador moderno (Chrome, Edge ou Firefox) no computador/tablet da portaria.

## 🚀 Início rápido

```bash
cd escola-nfc-web

# Opcional: o projeto não tem dependências de runtime
npm install
```

Crie o arquivo de configuração a partir do modelo e preencha os valores:

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env.local
notepad .env.local
```

```bash
# Linux/macOS
cp .env.example .env.local
```

No mínimo, preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`. Para criar o primeiro administrador, descomente e preencha também o bloco `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `ADMIN_NAME`.

Gere o `config.js`:

```bash
npm run build
```

Crie o primeiro administrador (roda **somente na sua máquina**, usando a service role key):

```bash
npm run admin
```

Para testar o painel localmente (gera o `config.js` e sobe o servidor HTTP na porta 5500):

```bash
npm run dev
# abra http://localhost:5500
```

Entre com o e-mail e a senha definidos em `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Depois use a aba **Usuários** para criar as contas dos demais funcionários e a aba **Secretaria** para cadastrar alunos.

### Rodar apenas o totem da portaria

```bash
npm run totem   # use antes npm run build (ou npm run dev) para gerar o config.js
# abra http://localhost:5500 em HTTP (obrigatório para falar com o ESP32)
```

### Testar sem o hardware (ESP32 simulado)

Em um terminal:

```bash
npm run mock
# API simulada em http://localhost:8787
```

No painel, abra a aba **Configurações → Leitor ESP32** e use `http://localhost:8787` como endereço do leitor. Para simular uma aproximação de cartão:

```bash
curl "http://localhost:8787/mock/ler?uid=2C:9D:7E:8E"
```

(No Windows, use `Invoke-WebRequest "http://localhost:8787/mock/ler?uid=2C:9D:7E:8E"` ou abra a URL no navegador.)

### Testes e verificação

```bash
npm test        # testes automatizados (node:test)
npm run check   # verifica a sintaxe de js/ e scripts/
```

## ☁️ Publicar na Vercel

1. Envie o repositório para o GitHub (o diretório `escola-nfc-web` é um repositório separado; não há commit automático neste projeto).
2. Na Vercel, clique em **Add New → Project** e importe o repositório.
3. Se estiver publicando um repositório maior, defina **Root Directory = `escola-nfc-web`**. Se o repositório for o próprio `escola-nfc-web`, deixe a raiz.
4. Em **Environment Variables**, cadastre `SUPABASE_URL` e `SUPABASE_ANON_KEY` (e, se quiser, `ESP_URL`, `APP_ENV`, `APP_VERSION`). **Não cadastre a service role key.**
5. Faça o deploy. O `vercel.json` já define `npm run build` e a raiz como diretório de saída; o `config.js` é gerado no build.
6. Depois de criar ou alterar variáveis, use **Redeploy** para gerar o `config.js` novo.
7. O link `https://...vercel.app` serve para direção, secretaria, coordenação e admin. **A portaria com ESP32 deve continuar usando o modo local HTTP** (veja abaixo).

> ⚠️ A portaria **não funciona** pelo link HTTPS da Vercel: o navegador bloqueia chamadas de uma página HTTPS para o ESP32 em HTTP na rede local (*mixed content / Private Network Access*). O painel exibe o selo **Bloq. HTTPS** e instrui a abrir o modo local.

### Acompanhar de fora da escola

A direção pode entrar no link da Vercel com uma conta **Direção** ou **Admin** e abrir **Histórico**. O painel remoto lê o Supabase, não o ESP32, então não precisa de IP público, VPN ou liberar porta no roteador. A atualização chega por Realtime e, como garantia, por consulta automática a cada 10 segundos.

O dispositivo da portaria (computador/tablet com o painel local) precisa estar **ligado, online e com a página aberta/logada** — ele é a ponte entre o leitor e a nuvem. Se a internet cair, os acessos de alunos identificados ficam na fila e aparecem no histórico remoto quando sincronizarem. O painel embutido do ESP32 (`http://<ip>/`) não grava no Supabase; para monitoramento remoto use o painel completo.

### Portaria só com tablet (painel no ESP32)

Se não houver computador na portaria, o próprio ESP32 pode hospedar o painel:

```bash
npm run painel:deploy -- --esp http://192.168.0.73
```

Depois, no tablet (na mesma rede Wi-Fi 2,4 GHz do ESP32), abra:

```
http://192.168.0.73/painel/
```

O painel completo continua falando **direto com o Supabase**; a placa só entrega HTML/CSS/JS e responde à API local. O pacote tem ~185 KB (ou ~45 KB gzip) e é servido do LittleFS. A senha do upload é a `ADMIN_SENHA` do painel da placa (padrão `admin123`; troque antes de usar). Para atualizar o painel depois, rode novamente `npm run painel:deploy`.

O primeiro envio/flash ainda precisa de um computador. Recomenda-se reservar um IP fixo no roteador e criar um atalho na tela inicial do tablet. Webcam/Wake Lock não funcionam em HTTP fora de `localhost`; a portaria não usa webcam.

Manual completo de implantação: **[COMO_CONFIGURAR_E_PUBLICAR.md](COMO_CONFIGURAR_E_PUBLICAR.md)**.

## 🔐 Segurança e segredos

* **`SUPABASE_ANON_KEY` é pública por projeto:** ela identifica o projeto no navegador. Quem impede acesso indevido é o **RLS** criado em `supabase_setup.sql`, não o sigilo da chave.
* **`SUPABASE_SERVICE_ROLE_KEY` ignora o RLS:** use somente em `.env.local`, para `npm run admin`. Nunca coloque na Vercel, no `config.js`, em código do frontend, em issue, print ou commit.
* `.env.local` e `config.js` estão no `.gitignore`. O repositório versiona apenas `.env.example` com valores de exemplo.
* Basta a **anon key** no site para autenticar usuários; o cargo e o status ativo são lidos de `public.perfis_usuarios` e reforçados pelas políticas RLS.
* Novos cadastros públicos entram **inativos** como `portaria` e precisam de ativação por um administrador. O primeiro admin é criado por `npm run admin` — não existe mais botão público de "cadastrar 1º administrador". Rode o bootstrap **antes de divulgar o link** publicado.
* Em banco **já existente**, rode a migração **`supabase/migrations/20261022_hardening.sql`** antes de usar a versão nova: ela fecha a escalada de privilégio no signup, protege o último admin ativo e adiciona `alunos.foto_path`.
* O firmware do ESP32 tem senhas próprias (painel e AP) e a rede Wi-Fi deve ser **2,4 GHz**; veja [`esp32s3-nfc-acesso/README.md`](esp32s3-nfc-acesso/README.md).
* As rotas de sincronização do ESP32 (`/api/sincronizar_*`) são abertas na rede local, como no firmware atual. Mantenha a Wi-Fi da escola com senha forte e não exponha o leitor diretamente à internet; autenticar essas rotas é uma melhoria futura de firmware.

## 🧰 Scripts disponíveis

| Comando | O que faz |
| :--- | :--- |
| `npm run build` | Gera `config.js` a partir de `.env`, `.env.local` e variáveis do ambiente |
| `npm run dev` | Gera `config.js` e sobe o servidor local em `http://localhost:5500` |
| `npm run totem` | Sobe apenas o servidor local HTTP (`PORT` opcional, padrão 5500) |
| `npm run serve` | Mesmo que `npm run totem` |
| `npm run mock` | ESP32 simulado em `http://localhost:8787` (sem hardware), incluindo `/painel/` |
| `npm run admin` | Cria/repara o primeiro administrador (usa a service role key local) |
| `npm run painel:build` | Gera `painel-dist/` com HTML/CSS/JS e versões `.gz` |
| `npm run painel:upload -- --esp http://IP` | Envia o painel para o LittleFS do ESP32 |
| `npm run painel:deploy -- --esp http://IP` | Gera e envia o painel em um comando |
| `npm test` | Executa os testes automatizados |
| `npm run check` | Verifica a sintaxe de `js/` e `scripts/` |

## 📚 Documentação

* **[COMO_CONFIGURAR_E_PUBLICAR.md](COMO_CONFIGURAR_E_PUBLICAR.md)** — passo a passo do Supabase, `.env.local`, primeiro admin, Vercel, totem local, CSV, backup e solução de problemas.
* **[docs/DECISAO_BACKEND.md](docs/DECISAO_BACKEND.md)** — por que o backend é o Supabase e como Firebase e PocketBase se comparam.
* **[esp32s3-nfc-acesso/MANUAL_DO_SISTEMA.md](esp32s3-nfc-acesso/MANUAL_DO_SISTEMA.md)** — montagem, gravação, console e OTA do firmware.
* **[esp32s3-nfc-acesso/README.md](esp32s3-nfc-acesso/README.md)** — visão geral do firmware e das ferramentas embarcadas.
