# Modo offline — laboratório local (runbook)

Este runbook é o procedimento operacional do laboratório **Acesso Escolar NFC** rodando sem internet: painel estático + Supabase local no notebook, tablet na mesma rede e placa ESP32 na portaria. Pilha validada em **03/11/2026** em Windows 11 com Docker Desktop (motor 29.9.2), Supabase CLI **2.121.0** fixada via `npx` e branch `lab/offline`. Para a versão sem jargão, veja [docs/docker-para-leigos/](docker-para-leigos/); para o porquê do Supabase, [docs/DECISAO_BACKEND.md](DECISAO_BACKEND.md).

## Arquitetura

```
        REDE LOCAL (Wi-Fi da escola) — internet NÃO é necessária após o setup

  TABLET / CELULAR                    NOTEBOOK DO LAB  (192.168.0.81)
  ┌──────────────┐               ┌─────────────────────────────────────────────┐
  │  navegador   │── :5500 ─────▶│ painel estático  (scripts/serve-local.mjs)   │
  │              │               │   index.html + js/app.js + vendor/supabase-js│
  │              │── :54321 ────▶│ Supabase local (Docker Desktop)             │
  └──────┬───────┘               │   Kong :54321 · Postgres :54322             │
         │                       │   Studio :54323 · Mailpit :54324            │
         │  /api/*, /painel/     └─────────────────────────────────────────────┘
         ▼
  ESP32 (totem) 192.168.0.73 / nfc.local
  ┌──────────────┐
  │ leitor NFC   │  NÃO fala com o Supabase: só /api e serve /painel/.
  └──────────────┘  O painel empurra a base de cartões para a placa.
```

## Endereços e portas

| Serviço | Endereço | Observação |
|---|---|---|
| Painel estático | `http://192.168.0.81:5500` | serve `index.html`, `js/`, `vendor/` |
| Supabase API (Kong) | `http://192.168.0.81:54321` | é o valor de `SUPABASE_URL` |
| Postgres | `192.168.0.81:54322` | uso da CLI/inspeção |
| Supabase Studio | `http://192.168.0.81:54323` | inspeção do banco |
| Mailpit | `http://192.168.0.81:54324` | e-mails de autenticação |
| ESP32 | `http://192.168.0.73` ou `http://nfc.local` | `/painel/` e `/api/*` |

> O IP vem de DHCP e **pode mudar**. Rode `npm run lab:ip`. Se mudou, atualize `SUPABASE_URL`/`ESP_URL` no `.env.local` **e** `site_url`/`additional_redirect_urls` em `supabase/config.toml` (nada quebra o login, mas os redirects usados por e-mails ficam desalinhados), reabra `npm run lab:dev` — ele regenera o `config.js` — e, se quiser realinhar a pilha, `npm run lab:stop` + `lab:start`.

## Pré-requisitos

- Windows 10/11 64 bits com **Docker Desktop** (backend WSL2) iniciado.
- **≥ 7 GB de RAM** para o stack (recomendação oficial da CLI). Em máquina de 8 GB, limite o WSL2 em `%UserProfile%\.wslconfig` (`[wsl2]` / `memory=6GB`) e aplique com `wsl --shutdown`.
- **Internet uma única vez**: o primeiro `lab:start` baixa ~2 GB de imagens. Depois disso o laboratório opera offline.
- Node.js ≥ 20 e Git (para clonar/atualizar).

## Setup em outra máquina

1. **Código**: em um clone do repositório, `git worktree add ..\escola-nfc-web-offline -b lab/offline`; ou copie a pasta do worktree inteira.
2. **Docker Desktop** instalado e rodando (`docker info` responde). Tutorial: [docs/docker-para-leigos/02-instalar-o-docker-desktop.md](docker-para-leigos/02-instalar-o-docker-desktop.md).
3. **Configuração**: `Copy-Item .env.lab.example .env.local`.
4. **Subir a pilha**: `npm run lab:start` (primeira vez demora; pull pode dar 429 e repetir sozinho).
5. **Chaves**: `npm run lab:status` imprime `anon key` e `service_role key`; cole em `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` no `.env.local`.
6. **Painel**: `npm run build` gera o `config.js` da raiz.
7. **Firewall**: execute `lab-firewall-liberar.cmd` (pede elevação; libera 54321 e 5500 no perfil **privado**). Na janela do Windows, marque **Redes privadas**.
8. **Verificação**: `npm run lab:check` (config, API, banco e chaves). `--ip` mostra os endereços para o tablet.
9. **Administrador**: `npm run lab:admin` (idempotente; usa `ADMIN_*` do `.env.local`).
10. **Servir o painel**: `npm run lab:dev` → `http://IP:5500`.
11. **Validação final**: `curl http://IP:54321/auth/v1/health` deve responder `{"date":...,"name":"GoTrue",...}`; abra o painel no tablet.

## Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `npm run lab:start` | sobe o Supabase local (ou acorda a pilha parada) |
| `npm run lab:stop` | para os containers **preservando os volumes/dados** |
| `npm run lab:status` | estado, URLs e chaves locais |
| `npm run lab:reset` | apaga o banco e reaplica migrations + seed |
| `npm run lab:backup` | dump **data-only** em `supabase/backup.sql` |
| `npm run lab:admin` | cria/garante o administrador do lab |
| `npm run lab:check` | checa config, banco e API (diagnóstico) |
| `npm run lab:ip` | lista os IPs para usar no tablet |
| `npm run lab:dev` | gera `config.js` e serve o painel em :5500 |
| `npm run painel:build` / `painel:upload` / `painel:deploy` | empacota/envia o painel para o ESP32 (modo avançado) |

## Ciclo de dados

| Ação | Efeito |
|---|---|
| `stop` → `start` | dados **preservados** (volumes mantidos; confirmado) |
| `db reset` (`lab:reset`) | descarta tudo e reaplica `supabase/migrations/` em ordem lexicográfica (`00000000000000_setup_inicial.sql`, `20261022_hardening.sql`) + `supabase/seed.sql` |
| `supabase stop --no-backup` | **apaga os volumes** — evitar |

O seed cria 6 alunos, incluindo UID `' 04ff11aa '` normalizado para `04FF11AA` pela trigger, 1 aluno inativo (Felipe Duarte) e histórico com data de 1 dia atrás.

**Backup**: `npm run lab:backup` gera `supabase/backup.sql` com dados das tabelas. Pela limitação oficial do `db dump`, esquemas gerenciados (`auth`, `storage`, `extensions`) **ficam de fora**: usuários de login e arquivos de fotos não são salvos. Recrie o admin com `npm run lab:admin` e reenvie fotos pelo painel.

**Restauração** (o `--no-seed` evita conflito com as linhas do seed):

```powershell
npx --yes supabase@2.121.0 db reset --no-seed
npm run lab:admin
npx --yes supabase@2.121.0 db query -f supabase/backup.sql --local
```

O que volta: **alunos e histórico** (tabelas comuns). O que não volta pelo backup: usuários de login (esquema `auth`) e fotos (esquema `storage`) — o admin é recriado com `lab:admin` e as fotos são reenviadas pelo painel; se o `db query` reclamar de uma linha antiga de `perfis_usuarios` (admin recriado com outro ID), o restante dos dados sobe mesmo assim. O backup é **captura secundária**; a fonte da verdade é o par **migrations + seed versionados no Git**.

## Sincronização com a placa ESP32

- Em **Configurações → Sincronizar base** (e também na Portaria) o painel grava toda a base na placa via `/api/sincronizar_todos`; **Comparar bases** mostra divergências.
- Diagnóstico da placa: `http://192.168.0.73/api/status` (IP, Wi-Fi, versão, contagem de cartões).
- A placa decide o acesso sozinha com a última base sincronizada; o painel enfileira leituras pendentes e envia quando o Supabase volta.
- **Modo avançado (opcional) — painel servido pela própria placa**: com `config.js` apontando para o Supabase local, rode `npm run build`, `npm run painel:build` e `npm run painel:upload -- --esp http://192.168.0.73` (credenciais `ESP_ADMIN_USER`/`ESP_ADMIN_PASSWORD`, padrão `admin`/`admin123`, lidas do `.env.local`).
  - **AVISO**: ao encerrar o lab, reenvie o painel original pelo checkout de **produção**: `npm run painel:deploy -- --esp http://192.168.0.73`. Sem isso a placa continua apontando para o notebook. `/wifi` e o painel local continuam funcionando.
- **HTTPS/mixed content**: o painel HTTPS da Vercel **não** pode falar com o Supabase local HTTP. Neste lab, use apenas HTTP local.

## Segurança

- `.env.local`, `config.js` e `painel-dist/` **não vão para o git**. As chaves do lab são as JWT demo do stack local (válidas só ali), mas trate como credencial.
- Produção permanece no checkout principal (`escola-nfc-web`), com chaves próprias. Não misture os dois.
- RLS está ativo: a chave anon vê **0 alunos** até o login; a service role vê os 6. Isso é o comportamento esperado, não um bug.
- Firewall só no perfil **privado**; nunca libere 54321/5500 em rede pública.
- Troque `ADMIN_PASSWORD` no `.env.local` antes de uso real (o valor inicial consta no `.env.lab.example` e no `.env.local` — nunca em documentação).
- Studio (54323) e Mailpit (54324) não têm autenticação: mantenha-os na rede do lab.

## Troubleshooting técnico

| Sintoma | Causa provável | Ação |
|---|---|---|
| `port already in use` (54321/54322/5500) | outra pilha/processo ocupando | `npm run lab:stop`; `netstat -ano \| findstr :5500`; `PORT=5501 npm run lab:dev` |
| Pull lento ou `429 Too Many Requests` | throttling do ECR (`public.ecr.aws/supabase/...`) | a CLI repete sozinha; aguarde e rode `lab:start` de novo |
| Anon retorna lista vazia de alunos | RLS (esperado) | faça login no painel; `lab:check` usa a service role quando presente |
| Stack "dormindo" / primeira resposta lenta | Resource Saver do Docker Desktop | o motor acorda em segundos; aguarde o primeiro comando |
| Tudo parou após `wsl --shutdown` | WSL2 encerrado | abra o Docker Desktop e `npm run lab:start` |
| Tablet não abre `IP:54321` | firewall, IP trocado ou outra rede | rode o `.cmd`, `lab:ip`, confirme a mesma rede; teste antes no próprio notebook |
| Hotspot do Windows instável | suporte não documentado (WSL mirrored) | prefira Wi-Fi/rede real; hotspot só como experimento |
| Aviso de nova versão da CLI (v3.0.0) | checagem de update | ignore; a versão fixada é 2.121.0 |
| `supabase/.temp` aparecendo | cache de versão da CLI | não é dado do lab; ignore |

## Referências

- Supabase local: https://supabase.com/docs/guides/local-development
- `config.toml`: https://supabase.com/docs/guides/local-development/cli/config
- CLI `db reset`: https://supabase.com/docs/reference/cli/supabase-db-reset
- CLI `db dump`: https://supabase.com/docs/reference/cli/supabase-db-dump
- CLI `db query`: https://supabase.com/docs/reference/cli/supabase-db-query
- Docker Desktop: https://docs.docker.com/desktop/
- Resource Saver: https://docs.docker.com/desktop/use-desktop/resource-saver/
- WSL (`wsl.config`): https://learn.microsoft.com/windows/wsl/wsl-config
- Firewall (`New-NetFirewallRule`): https://learn.microsoft.com/powershell/module/netsecurity/new-netfirewallrule
- Hotspot/WSL: https://github.com/microsoft/WSL/issues/10494
