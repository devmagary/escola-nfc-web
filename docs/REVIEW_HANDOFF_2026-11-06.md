# Handoff de revisão — sessão de 06/11/2026

## Intenção original e mudanças de rumo

O objetivo inicial era **usar o projeto offline**, com um notebook simulando o Supabase, **sem perder o que já existia**. Ao longo da sessão o escopo cresceu:

- Laboratório offline com **Supabase local em Docker**, **ESP32 real**, isolado em **git worktree** (`lab/offline`), com **commit a cada alteração**.
- Tutoriais de Docker **para leigos** e runbook para replicar em outro computador.
- TUI de terminal para ligar/desligar/checar o laboratório, atalhos no Windows e configuração automática do `.env.local`.
- Correção da **câmera no celular** quando o painel é aberto por IP (HTTP).
- Correção do **PN532 “zumbi”** após reconexão (firmware 2.1.3), watchdog e botão de reinício.
- Menu de ferramentas e revisão mobile da **página servida pela placa** (`http://nfc.local/`).
- Em outro repositório (`feira-exposicao`), simplificação da linguagem da linha do tempo para leigos.

## Decisões do usuário e fora de escopo

- **Decidido:** Docker Desktop + Supabase auto-hospedado; worktree `lab/offline`; ESP32 real; commits pequenos em português.
- **Decidido:** se o leitor cair, recuperação **por software** (RSTPD_N não está ligado); watchdog automático **+** botão manual; **sem auto-reboot** da placa.
- **Decidido:** no celular, “Tirar foto” usa a **câmera nativa** (input `capture`) em vez de exigir HTTPS.
- **Fora de escopo:** sincronizar o histórico local da placa com a nuvem. O usuário optou por **adiar e apenas documentar** — a implementação não era esperada. (O ADR em `docs/DECISAO_REGISTRO_OFFLINE.md` ainda não foi escrito; ver lacunas.)
- **Fora de escopo:** alterar seções técnicas da feira além da linha do tempo; operação oficial da escola; TLS no laboratório; auto-reboot do PN532.

## O que foi implementado

### 1. Laboratório offline (branch `lab/offline`)
- Supabase local com `config.toml`, migration inicial (cópia do `supabase_setup.sql`), seed de 6 alunos e admin.
- Scripts: `check-lab.mjs` (diagnóstico em português), `lab-setup.mjs` (detecta IP, grava `.env.local`, busca chaves), `lab:start/stop/status/reset/backup/admin/check/ip/dev/setup`.
- TUI `lab-menu.ps1` + `lab-estado.ps1` (luzes em processo de fundo), atalho único “Servidor NFC”, atalhos `.cmd`, liberador de firewall.
- Tutoriais 01–05 e runbook; cache de vendor; painel do laboratório apontando para o Supabase local.

### 2. Câmera no painel (main + cherry-pick no lab)
- `podeUsarWebcam()` decide entre webcam (HTTPS/localhost) e **câmera nativa** (HTTP na rede).
- Input oculto `accept="image/*" capture="environment"` + reaproveitamento do pipeline de compressão.

### 3. Firmware 2.1.3 (main)
- `reiniciarLeitorCompleto()`: `Wire.end()` → recuperação do barramento → `Wire.begin` → `nfc.begin` → versão com retries → **SAMConfig verificado**.
- Watchdog: 15 min sem leitura → reinício completo (máx. 1 a cada 10 min); se falhar, `nfcOk=false` (LED laranja).
- Comandos `reset_nfc`/`nfc_status`; campos novos em `/api/status` e `/api/diagnostico`.
- Página `/` ganhou o card **Ferramentas e Diagnóstico**; console/OTA/Wi-Fi com links cruzados; layout mobile (2 colunas no celular, 1 abaixo de 330 px).

### 4. Feira (repositório separado)
- Linha do tempo reescrita sem PN532/UID/I2C/Flash/LittleFS/cartoes.json; instrução, interruptor, selos e mensagens do painel simplificados.

## Onde o trabalho está

- **`escola-nfc-web` — main:** commits `923f78c..f8f2c5c` (câmera, firmware 2.1.3, páginas, docs). Enviado ao GitHub.
- **worktree `escola-nfc-web-offline` — `lab/offline`:** commits `36c05c5..e3aae59` (laboratório, TUI, setup, docs, câmera cherry-picked) + este documento. Enviado ao GitHub.
- **`feira-exposicao`:** commit `4d3c916`. Enviado ao GitHub.
- Arquivos principais: `esp32s3-nfc-acesso.ino`, `pagina_web.h`, `pagina_wifi.h`, `web_ferramentas.h`, `MANUAL_DO_SISTEMA.md`; `index.html`, `js/app.js`, `js/lib/utils.js`, `tests/utils.test.mjs`; no lab, `supabase/*`, `scripts/check-lab.mjs`, `scripts/lab-setup.mjs`, `lab-*.ps1/.cmd`, `docs/*`; na feira, `js/data.js`, `js/interactions.js`, `tests/*`.
- **Alterações não commitadas no workspace não fazem parte desta entrega.** `.env.local` e `config.js` são ignorados de propósito.

## Decisões de projeto e tradeoffs

- **Câmera:** fallback nativo em vez de HTTPS no ESP32/lab (sem certificado para gerenciar; funciona no celular e no desktop).
- **PN532:** sem reset por hardware, a recuperação replica o boot; o watchdog é “por tempo ocioso” (corredor vazio gera reinícios baratos, sem reboot). Não há como distinguir “sem cartão” de “RF morto” sem hardware.
- **Laboratório:** IP do notebook é DHCP e entra no `.env.local`; URLs públicas de foto dependem dele. `config.toml` só é ajustado com `--config` para não sujar o git.
- **Chaves:** locais/demo; nunca são impressas por inteiro pelo `lab:setup`. Produção permanece no checkout principal.
- **TUI:** desenho pela API do console, polling de 10 ms, luzes em processo separado. “Sair” sem número (ESC/setas); item 9 = configurar.

## Validação executada

- **Testes:** `npm test` — **54/54** no lab (inclui 7 de `lab-setup` e pacote do painel); **47/47** no main após o teste da câmera.
- **Sintaxe:** `npm run check` — 14 arquivos no lab, 12 no main, sem erros.
- **Firmware:** compilação OK em duas etapas; final **1.297.233 bytes (41%)**, RAM **61.760 (18%)**.
- **Câmera (Playwright, `http://192.168.0.81:5500`):** contexto inseguro confirmado; clique abriu o seletor; upload de JPEG gerou prévia e “Foto pronta para envio (6 KB)”.
- **Página local (Playwright, prévia):** screenshots em **390×844** e **360×640**, sem estouro horizontal; menu em 2 colunas.
- **`lab:setup`:** dry-run, execução real idempotente e teste com modelo em branco (preencheu as chaves via `status -o env`).
- **`lab:check`:** verde (executado antes das últimas mudanças de TUI/setup; não reexecutado depois).
- **TUI:** parser 0 erros; `-Acao configurar` executado com a pilha ligada.
- **Feira:** `node tests/run-tests.js` passou; sintaxe OK.
- **Push:** main, lab/offline e feira enviados.

## Não verificado / incertezas (inspecionar com atenção)

- **Placa estava offline:** firmware 2.1.3 **não foi gravado por OTA**, o painel novo **não foi reenviado** à placa e **não houve teste físico** de desconectar/reconectar o PN532 nem de leitura de cartão.
- **Câmera:** testada via seletor de arquivo em navegador de desktop, **não em celular real**; caso HEIC de iPhone não coberto.
- **TUI:** navegação interativa e layout não observados visualmente (apenas parser, ações e cálculo de coordenadas); `lab:setup --start` e `--config` não executados; firewall não rodado com elevação.
- **e2e da feira** não executado (só o teste estático); o e2e foi atualizado para incluir a linha do tempo.
- **PN532:** eficácia do `Wire.end + SAMConfig` no hardware é hipótese baseada no boot; limiares de 15/10 min não ajustados em campo.
- **Porta fixa 54321** no `lab:setup`; se alterada, exige ajuste manual/`config.toml`.
- **ADR do histórico offline** (decisão “só documentar”) ainda não existe no repositório.
- **Divergência main × lab:** a correção da câmera foi cherry-picked; merges futuros podem conflitar em README/docs.
- **Senha do admin do laboratório** foi reafirmada para `escola123` nesta máquina (efeito local, não é código).
- Revisar com prioridade: `reiniciarLeitorCompleto`/watchdog no `.ino`, `podeUsarWebcam`/`abrirCamera`, `lab-setup.mjs` (segredos e idempotência), `lab-menu.ps1` (índices 1–9, Sair e coordenadas do quadro) e a linha do tempo da feira versus os testes.
