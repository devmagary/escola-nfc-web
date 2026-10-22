# Decisão de backend — Supabase, Firebase ou PocketBase?

Este documento registra **por que o backend do Acesso Escolar NFC é o Supabase**, quais alternativas foram consideradas e em que condições a decisão deveria ser revista. Ele parte de um princípio: a escolha do backend é uma decisão de operação escolar, não de moda tecnológica.

## Resumo da decisão

| | Decisão |
| :--- | :--- |
| **Backend escolhido** | **Supabase** (Postgres + Auth + Storage + Realtime) |
| **Por quê** | Cobre autenticação, banco relacional, fotos e atualização em tempo real em um único serviço gerenciado; a API REST é simples de consumir pelo painel **e pelo firmware ESP32-S3**; o RLS permite negar acesso por cargo no próprio banco; o SQL versionado torna a instalação e a migração auditáveis. |
| **Alternativas viáveis** | Firebase (Google) e PocketBase (auto-hospedado) — ambas funcionam, com custos de migração e operação diferentes. |
| **O que NÃO era o problema** | O Supabase em si. A dor real era a **configuração por navegador** (cada máquina digitando URL/chave), que foi resolvida com configuração no build e bootstrap local do administrador — e que existiria com qualquer backend. |

## O problema que precisava ser resolvido

Antes, cada navegador precisava receber a **Project URL** e a **anon key** do Supabase por uma tela de configuração, e o primeiro administrador era criado por um botão público. Isso gerava:

* retrabalho a cada computador/tablet novo (e a cada troca de navegador ou limpeza de dados);
* risco de digitar chave errada, projeto errado ou expor credenciais em prints;
* um fluxo de "primeiro admin" público que precisava ser confiável — e que, sem hardening, permitia escalada de privilégio pelo signup;
* suporte constante: "o site não conecta" quase sempre era configuração local ausente.

A correção atual **não trocou de backend**:

1. a configuração virou **variáveis de ambiente no build** (`scripts/build-config.mjs` → `config.js`), iguais para todos;
2. a anon key é pública por projeto (o RLS protege), então pode ir no bundle;
3. a service role key só existe localmente, no `npm run admin`, para criar o primeiro administrador;
4. o SQL de hardening fecha a escalada de privilégio e protege o último admin ativo.

Ou seja: **a configuração inicial não desaparece em nenhum backend** — todo backend exige criar um projeto/servidor, obter credenciais, definir regras de acesso e criar o primeiro usuário. O que se eliminou foi a necessidade de **fazer isso em cada navegador**.

## Critérios usados na avaliação

1. **Autenticação pronta** (e-mail/senha, sessão, redefinição de senha) sem manter servidor próprio.
2. **Modelo de dados** adequado a alunos, perfis e histórico (consultas por data, filtros, CSV).
3. **Upload de fotos** com leitura pública para o totem e escrita restrita à secretaria.
4. **Atualização em tempo real** do histórico/totem.
5. **Consumo pelo ESP32-S3** (HTTP/REST simples, com CORS).
6. **Permissões por cargo no servidor**, não só na interface.
7. **Custo e operação** compatíveis com uma escola (sem plantão de servidor).
8. **Instalação/migração reproduzível** (script versionado).
9. **Esforço de migração** caso a escolha precise mudar.

## Comparativo

| Critério | **Supabase** (escolhido) | **Firebase** (Google) | **PocketBase** (auto-hospedado) |
| :--- | :--- | :--- | :--- |
| Modelo | Postgres relacional + Auth + Storage + Realtime | Firestore (NoSQL por documentos) + Auth + Cloud Storage + Hosting | SQLite embarcado + Auth + arquivos + realtime (SSE), em um único executável |
| Autenticação | GoTrue (e-mail/senha), sessão JWT | Firebase Auth (e-mail/senha, provedores sociais) | Auth embutido (e-mail/senha, OAuth opcional) |
| Permissões | **RLS** (SQL) + funções `SECURITY DEFINER` | Security Rules (Firestore/Storage) | API Rules por coleção |
| Consultas | SQL (filtros, índices, paginação, joins leves) | Consultas NoSQL (índices e desnormalização) | Filtros/ordenação do PocketBase (mais simples que SQL) |
| Fotos | Bucket `fotos-alunos` (público p/ leitura) + políticas | Cloud Storage + regras | Armazenamento local + regras |
| Tempo real | Supabase Realtime (Postgres changes) | Listeners do Firestore | SSE do PocketBase |
| ESP32 | Painel usa PostgREST; firmware expõe REST local (`/api/...`) e não fala com o backend | Painel usaria Firestore REST/Functions; firmware local permaneceria | Painel usaria REST do PocketBase; firmware local permaneceria |
| Operação | Gerenciado (nada para manter) | Gerenciado | **Você mantém a máquina** (energia, rede, backup, atualização) |
| Acesso externo | URL gerenciada | URL gerenciada | Exige túnel/VPN ou servidor exposto |
| Custo | Plano gratuito + planos pagos por uso | Plano gratuito + pagamento por uso; alguns recursos (ex.: Cloud Functions com saída de rede) exigem plano Blaze | "Grátis", mas com custo de máquina/servidor e tempo de operação |
| Migração a partir do sistema atual | — | Reescrever autenticação, dados, fotos e regras no painel; o firmware local permanece | Reescrever o esquema, as regras e os scripts no painel; o firmware local permanece |

## Supabase (escolhido) — por que atende bem

* **Um serviço, quatro necessidades:** banco, login, fotos e realtime. Não há servidor de aplicação para manter; o site é estático (Vercel) e fala direto com a API.
* **RLS + funções administrativas:** as políticas (`tem_permissao(...)`, por cargo) e as RPCs `admin_*` rodam **no banco**. Mesmo que alguém manipule o JavaScript, o banco nega a operação.
* **SQL versionado:** `supabase_setup.sql` (instalação nova) e `supabase/migrations/20261022_hardening.sql` (banco existente) tornam o esquema reproduzível e auditável — inclusive as proteções do último admin e a normalização de UID.
* **REST simples para o painel e API local estável para o ESP32:** o painel usa PostgREST (HTTP/CORS) e o firmware expõe `/api/...` na rede local; trocar o backend mudaria o painel, não o contrato local do leitor.
* **Custo inicial zero** para o volume de uma escola, com caminho de upgrade sem reescrever o app.
* **Fotos com leitura pública e escrita restrita:** o bucket público permite o totem mostrar a foto sem login, enquanto upload/alteração/exclusão exigem cargo autorizado.

Limitações a assumir: dependência de um serviço externo (internet e disponibilidade do provedor) e políticas de RLS que precisam ser bem mantidas — por isso o diagnóstico do painel e a migração versionada existem.

## Firebase — viável, mas com reescrita e custos específicos

O Firebase resolveria autenticação, dados e fotos com qualidade, porém:

* **Reescrever a camada de dados e de autenticação:** trocar Postgres/SQL por Firestore (documentos), reescrever consultas de histórico, paginação, filtros e CSV; trocar RLS por Security Rules.
* **Reescrever a camada de fotos:** trocar o bucket/políticas por Cloud Storage/regras.
* **Ajustar o painel, não o firmware:** o firmware só conversa com o navegador via `/api/...` local; com Firestore o painel passaria a usar Firestore REST/Functions, mantendo o contrato do leitor.
* **Redefinir a senha de terceiros** (o admin redefine a senha de outro funcionário):
  * pelo cliente, é possível enviar **e-mail de redefinição** ao usuário — depende de caixa de e-mail acessível e de o usuário agir;
  * para **definir** a senha diretamente, é preciso **Admin SDK**, que roda em ambiente confiável — normalmente **Cloud Functions** (que exigem o plano **Blaze**, com cobrança por uso) ou um servidor próprio com service account.
  * Ou seja: o equivalente ao `npm run admin` local deixa de ser um script simples e passa a exigir uma função na nuvem ou um servidor.
* **A configuração inicial não desaparece:** projeto Firebase, app web, chaves/`firebaseConfig`, regras, usuários e deploy continuam existindo — a "configuração zero" no navegador teria de ser implementada do mesmo jeito (build/hosting com variáveis).
* **Vantagem real:** integração com o ecossistema Google (Workspace, login Google) e robustez gerenciada.

**Quando faria sentido:** se a escola já depende operacionalmente do Google Workspace e quer login Google nativo, aceitando a reescrita e a dependência de Cloud Functions/Blaze para administração de senhas.

## PocketBase — excelente para rede local, exige operação própria

PocketBase é um **único executável** (Go) com SQLite, painel administrativo, autenticação, arquivos e realtime. É uma opção muito atraente para uma escola com infraestrutura local:

* **Prós:** simples de instalar, roda em qualquer máquina, dados ficam na escola, sem custo de serviço, ótimo para operação na rede local e para quem quer independência de provedor.
* **Contras:**
  * exige uma **máquina sempre ligada** (energia, refrigeração, atualização, disco) — se ela cair, login, fotos e histórico param;
  * acesso remoto (direção em casa, por exemplo) exige **túnel/VPN** (ex.: Cloudflare Tunnel) ou servidor exposto, com configuração de TLS e segurança própria;
  * backups e atualizações são **manuais** (copiar `pb_data`, versionar migrações do PocketBase);
  * o modelo de permissões (API Rules) é menos expressivo que RLS/SQL;
  * trocar agora significaria reescrever esquema, regras, scripts e o contrato consumido pelo firmware.

**Quando faria sentido:** se a escola decidir que o sistema deve funcionar **sem nenhuma dependência de nuvem**, com equipe de TI local para manter a máquina e o acesso remoto. Nesse cenário, um PocketBase em um servidor local (ou mesmo o Supabase auto-hospedado em Docker) seria mais coerente que trocar para Firebase.

## Por que a dor era a configuração por navegador (e não o Supabase)

Vale separar os dois problemas:

1. **Problema de produto/operação:** "cada navegador precisa digitar chave" e "primeiro admin por botão público". Isso independe de backend: Firebase, PocketBase ou Supabase teriam o mesmo atrito.
2. **Problema de escolha de backend:** biblioteca, modelo de dados, custo e operação. O Supabase atendia (e atende) bem, então trocar de backend não resolveria a dor e adicionaria meses de retrabalho.

A solução correta foi **tirar a configuração do navegador** (build-time) e **tirar o primeiro admin da interface pública** (script local com service role), mantendo o backend. É a mudança de menor risco e maior ganho — e é a que está implementada.

## Consequências operacionais da decisão

* A **anon key** é pública e vai no `config.js`; a segurança depende do **RLS** e das funções administrativas. Por isso o SQL de hardening é obrigatório em bancos existentes.
* A **service role key** é secreta e só existe no `.env.local` para `npm run admin`; nunca vai para a Vercel nem para o navegador.
* A portaria depende do **modo local HTTP** (`npm run totem`), porque o navegador bloqueia HTTPS → HTTP local; o painel na nuvem continua servindo para gestão.
* O **ESP32 mantém a decisão de acesso offline** com a base em Flash; a nuvem é usada para cadastro, foto, histórico e sincronização.
* Se um dia for necessário trocar de backend, o caminho de menor impacto é manter o contrato REST do painel e do firmware e migrar dados por CSV/JSON (alunos) + backup do banco + reenvio de fotos.

## Revisão da decisão

Revise esta decisão se:

* a escola exigir **operação 100% local/offline** (avaliar PocketBase ou Supabase auto-hospedado, com plano de operação);
* houver exigência institucional de **login Google/Workspace** (avaliar Firebase, aceitando a reescrita);
* os custos/limites do plano Supabase deixarem de caber no orçamento (avaliar auto-hospedagem antes de trocar de paradigma);
* o firmware passar a exigir outro protocolo (aí a troca de backend já não seria o maior custo).
