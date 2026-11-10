# Modo offline — laboratório local (runbook)

Este runbook é o procedimento operacional do laboratório **Acesso Escolar NFC** rodando sem internet: painel estático + Supabase local no notebook, tablet na mesma rede e placa ESP32 na portaria. Pilha validada em **03/11/2026** em Windows 11 com Docker Desktop (motor 29.9.2), Supabase CLI **2.121.0** fixada via `npx` e branch `lab/offline`. Para a versão sem jargão, veja [docs/docker-para-leigos/](docker-para-leigos/); para o porquê do Supabase, [docs/DECISAO_BACKEND.md](DECISAO_BACKEND.md).

> **Sem internet ou sem Wi-Fi?** `lab-hotspot.cmd` cria a rede **`NFC-Lab`** em `192.168.137.1` usando a API de tethering do Windows (não exige uma conexão de origem). A TUI também liga/desliga o hotspot e grava esse IP no `.env.local`, para o Docker/Supabase e o painel serem acessados pelo tablet.


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
| Hotspot do laboratório | `http://192.168.137.1` | rede `NFC-Lab` sem internet; criada por `lab-hotspot.cmd` |
| Painel estático | `http://IP-DO-NOTEBOOK:5500` | serve `index.html`, `js/`, `vendor/` |
| Painel no hotspot | `http://192.168.137.1:5500` | mesmo painel, rede criada pelo próprio notebook |
| Supabase API (Kong) | `http://IP-DO-NOTEBOOK:54321` | é o valor de `SUPABASE_URL` (no hotspot, `192.168.137.1`) |
| Postgres | `IP-DO-NOTEBOOK:54322` | uso da CLI/inspeção |
| Supabase Studio | `http://IP-DO-NOTEBOOK:54323` | inspeção do banco |
| Mailpit | `http://IP-DO-NOTEBOOK:54324` | e-mails de autenticação |
| ESP32 | `http://192.168.0.73` ou `http://nfc.local` | `/painel/` e `/api/*` |

> O IP vem de DHCP e **pode mudar**. Rode `npm run lab:ip`. Se mudou, atualize `SUPABASE_URL`/`ESP_URL` no `.env.local` **e** `site_url`/`additional_redirect_urls` em `supabase/config.toml` (nada quebra o login, mas os redirects usados por e-mails ficam desalinhados), reabra `npm run lab:dev` — ele regenera o `config.js` — e, se quiser realinhar a pilha, `npm run lab:stop` + `lab:start`.
>
> O `lab:setup` ignora Tailscale, ZeroTier, WSL e Hyper-V e grava o IP do Wi-Fi/cabo. Se o hotspot estiver ligado, ele tem prioridade e o IP `192.168.137.1` é gravado no `.env.local`. Se houver mais de um IP físico, ele mostra os outros; use `--ip 10.x.x.x` para escolher.
>
> **Sem nenhuma rede?** Rode `lab-hotspot.cmd`: ele cria a rede `NFC-Lab` (senha `nfc-lab-2026`) em `192.168.137.1` sem precisar de internet. Depois rode `npm run lab:setup` para gravar esse IP e `npm run lab:dev`. No tablet, conecte na rede `NFC-Lab` e abra `http://192.168.137.1:5500`. Para desligar, `lab-hotspot-desligar.cmd`.
>
> O **"Ligar tudo"** da TUI usa o hotspot conforme `LAB_HOTSPOT_MODO` no `.env.local`: `auto` (só quando não há rede), `sempre` (todo dia) ou `nunca`. A ordem é: Docker → hotspot/rede → banco → `lab:setup` (grava o IP) → painel.

## Pré-requisitos

- Windows 10/11 64 bits com **Docker Desktop** (backend WSL2) iniciado.
- **≥ 7 GB de RAM** para o stack (recomendação oficial da CLI). Em máquina de 8 GB, limite o WSL2 em `%UserProfile%\.wslconfig` (`[wsl2]` / `memory=6GB`) e aplique com `wsl --shutdown`.
- **Internet uma única vez**: o primeiro `lab:start` baixa ~2 GB de imagens. Depois disso o laboratório opera offline.
- Node.js ≥ 20 e Git (para clonar/atualizar).

## Setup em outra máquina

1. **Código**: em um clone do repositório, `git worktree add ..\escola-nfc-web-offline -b lab/offline`; ou copie a pasta do worktree inteira.
2. **Docker Desktop** instalado e rodando (`docker info` responde). Tutorial: [docs/docker-para-leigos/02-instalar-o-docker-desktop.md](docker-para-leigos/02-instalar-o-docker-desktop.md).
   - **Sem Wi-Fi/internet?** Antes do próximo passo, rode `lab-hotspot.cmd` (cria a rede `NFC-Lab` em `192.168.137.1`) e continue; o `lab:setup` do passo 3 detecta esse IP.
3. **Configuração automática**: `npm run lab:setup` — descobre o IP, cria/atualiza o `.env.local` e (com a pilha ligada) preenche as chaves. `--esp http://IP-DA-PLACA` ajusta a placa; `--config` alinha os redirects do `config.toml`; `--start` sobe a pilha antes.
4. **Subir a pilha**: `npm run lab:start` (primeira vez demora; pull pode dar 429 e repetir sozinho).
5. **Chaves**: se o setup rodou antes da pilha, rode `npm run lab:setup` de novo com a pilha ligada (ou `npm run lab:status` e copie `ANON_KEY`/`SERVICE_ROLE_KEY` para o `.env.local`).
6. **Painel**: `npm run build` gera o `config.js` da raiz.
7. **Firewall**: execute `lab-firewall-liberar.cmd` (pede elevação; libera 80/5500/54321/54323 **só para as redes locais** — Wi-Fi, cabo e hotspot — em qualquer perfil). A regra `LocalSubnet` acompanha o IP atual e cobre o `192.168.137.0/24` do hotspot.
8. **Verificação**: `npm run lab:check` (config, API, banco e chaves). `--ip` mostra os endereços para o tablet.
9. **Administrador**: `npm run lab:admin` (idempotente; usa `ADMIN_*` do `.env.local`).
10. **Servir o painel**: `npm run lab:dev` → `http://IP:5500`.
11. **Validação final**: `curl http://IP:54321/auth/v1/health` deve responder `{"date":...,"name":"GoTrue",...}`; abra o painel no tablet.

## Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `npm run lab:start` | sobe o Supabase local (ou acorda a pilha parada) |
| `npm run lab:setup` | descobre o IP, cria/atualiza o `.env.local` e preenche as chaves (`--start`, `--esp`, `--config`) |
| `npm run lab:stop` | para os containers **preservando os volumes/dados** |
| `npm run lab:status` | mostra URLs e as linhas `ANON_KEY`/`SERVICE_ROLE_KEY` (exige a pilha ligada) |
| `npm run lab:reset` | apaga o banco e reaplica migrations + seed |
| `npm run lab:backup` | dump **data-only** em `supabase/backup.sql` |
| `npm run lab:admin` | cria/garante o administrador do lab |
| `npm run lab:check` | checa config, banco e API (diagnóstico) |
| `npm run lab:ip` | lista os IPs para usar no tablet |
| `npm run lab:dev` | gera `config.js` e serve o painel em :5500 |
| `lab-hotspot.cmd` / `npm run lab:hotspot` | cria a rede `NFC-Lab` sem internet (IP `192.168.137.1`) |
| `lab-hotspot-desligar.cmd` / `npm run lab:hotspot:off` | desliga o hotspot e volta ao Wi-Fi normal |
| `npm run lab:hotspot:status` | mostra estado, rede e IP do hotspot |
| `lab.cmd` (ou o atalho "Servidor NFC") | TUI unificada: luzes ao vivo (Docker/Banco/Painel/Placa/Hotspot) e menu de dez ações (ligar, desligar, checar, abrir painel, endereços, hotspot, firewall, backup, zerar e configurar este notebook) |
| `lab-ligar.cmd` / `lab-desligar.cmd` / `lab-checar.cmd` | atalhos diretos para as mesmas ações ("Ligar" cria a janela dedicada `Painel NFC`) |
| `lab-criar-atalhos.cmd` | cria os atalhos "Servidor NFC" e "Hotspot NFC" na área de trabalho (e limpa os antigos) |
| `lab-firewall-liberar.cmd` | libera 80/5500/54321/54323 só para as redes locais (Wi-Fi/cabo/hotspot; eleva sozinho) |
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
- Firewall restrito às **redes locais** (Wi-Fi, cabo e hotspot; vale em qualquer perfil), sem abrir para a internet. A regra `LocalSubnet` acompanha o IP atual e cobre o `192.168.137.0/24` do hotspot.
- Troque `ADMIN_PASSWORD` no `.env.local` antes de uso real (o valor inicial consta no `.env.lab.example` e no `.env.local` — nunca em documentação).
- O hotspot `NFC-Lab` usa WPA2 com `HOTSPOT_PASSWORD` (padrão `nfc-lab-2026` no modelo). Troque antes de uso real.
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
| Windows não deixa ligar o Hotspot (pede outra rede) | a tela do Windows exige uma conexão de origem | use `lab-hotspot.cmd` (API direta; funciona sem internet) |
| Tablet não encontra a rede `NFC-Lab` | hotspot desligado ou adaptador sem modo AP | rode `npm run lab:hotspot:status`; se der erro, use um adaptador USB Wi-Fi |
| Hotspot sumiu depois de reiniciar | o Windows desliga o hotspot no reboot | rode `lab-hotspot.cmd` de novo (ou use "Ligar tudo" com `LAB_HOTSPOT_MODO=sempre`) |
| `.env.local` com IP antigo depois de ligar o hotspot | o `lab:setup` não rodou | rode `npm run lab:setup`; a TUI "Ligar tudo" e o item Hotspot já fazem isso sozinhos |
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
