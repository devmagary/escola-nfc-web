# AGENT.md — Manual de Operação e Diretrizes de IA (`escola-nfc-web-offline` / `lab/offline`)

## 1. Visão Geral e Contexto de Execução

O diretório `escola-nfc-web-offline` é um ambiente isolado vinculado à branch `lab/offline` do repositório `https://github.com/devmagary/escola-nfc-web.git`.

Este subsistema implementa a infraestrutura completa para operação em ambiente escolar sem qualquer dependência de internet externa (On-Premise / Edge Laboratory / Portaria Escolar). Ele engloba:
1. **Pilha Local Supabase via Docker**: Gateway Kong (porta 54321), PostgreSQL 15 (porta 54322), GoTrue Auth, PostgREST, Storage local e Supabase Studio (porta 54323).
2. **Interface TUI e Scripts de Automação Windows**: Menu de terminal interativo (`lab.cmd`, `lab-menu.ps1`), scripts em lote para inicialização rápida (`lab-ligar.cmd`), encerramento (`lab-desligar.cmd`), diagnóstico (`lab-checar.cmd`), liberação de firewall (`lab-firewall-liberar.cmd`) e atalhos de área de trabalho (`lab-criar-atalhos.cmd`).
3. **Servidor HTTP Local de Baixa Latência**: Servidor embutido Node.js (`scripts/serve-local.mjs`) operando na porta 5500 para exibição do totem da portaria e painel administrativo em tablets, celulares e computadores na LAN.
4. **Firmware de Borda ESP32-S3 (v2.1.3 Unificada)**: Código C++ FreeRTOS Dual-Core com armazenamento em memória Flash (`/cartoes.json`), cache instantâneo de alunos em memória **PSRAM/RAM** ($< 1\text{ ms}$), buffer circular de histórico com gravação em lote, watchdog de autorrecuperação e suporte híbrido e simultâneo para cartões RFID/NFC (PN532) e impressões digitais ópticas (AS608/FPM10A/DY50).

---

## 2. Regras de Conduta para Agentes de IA

### 2.1 Princípio de Modificação Mínima
- Altere apenas as linhas e arquivos estritamente necessários para a demanda informada.
- Nunca reformate arquivos inteiros ou altere a estrutura de scripts PowerShell/Batch sem solicitação explícita.
- Mantenha a nomenclatura institucional em português (`matricula`, `turma`, `portaria`, `catraca`, `sincronizacao`, `laboratorio`, `biometria`).

### 2.2 Segurança de Hardware e Restrições do ESP32-S3 (N16R8)
- **CRÍTICO — PSRAM Protegida**: Na placa YD-ESP32-S3 (N16R8), nunca atribua os GPIOs **35, 36 ou 37**. Esses pinos são conectados internamente ao barramento Octal PSRAM de 8 MB. Qualquer acionamento externo causa travamento imediato e corrupção de memória.
- **Barramento I2C PN532**: SDA no **GPIO 8**, SCL no **GPIO 9**. Chaves seletoras do módulo PN532: **Chave 1 = ON, Chave 2 = OFF**.
- **Sensor Biométrico Óptico (AS608 / FPM10A / DY50)**:
  - Conexão serial dedicada na **UART1** a `57600 bps`.
  - **Pino 1 (VCC)**: `3.3V` (pino de alimentação de 3.3V).
  - **Pino 2 (TX)**: **GPIO 18** (`BIO_RX_PIN` da UART1).
  - **Pino 3 (RX)**: **GPIO 17** (`BIO_TX_PIN` da UART1).
  - **Pino 4 (GND)**: `GND` comum.
  - **Pinos 5 e 6 (Touch/Sensibilidade)**: Deixar desconectados (livres); o Core 0 executa a varredura contínua óptica automaticamente.
  - Suporta posições de template `1` a `300`. Alunos cadastrados somente com digital recebem o UID virtual unificado `FB:10:XX:YY`.
- **LED RGB Onboard (WS2812B)**: **GPIO 48**.
  - Azul piscando: Tentativa de conexão Wi-Fi.
  - Azul respirando suave: Operação normal em espera.
  - Verde aceso: Cartão ou digital reconhecida e autorizada / pulso de relé ativado.
  - Vermelho aceso: Acesso negado (aluno inativo ou não cadastrado).
  - Laranja estroboscópico: Alerta de falha em ambos os sensores (NFC e Biometria ausentes).
- **Relé da Catraca / Eletroímã**: Pulso ativo ALTO (Active HIGH) de 500 ms configurável nos pinos GPIO 4 ou GPIO 6 (`#define PINO_SAIDA`).
- **Prioridade Offline**: A validação de cartões e digitais pelo microcontrolador ocorre em tempo inferior a 1 ms diretamente do cache em RAM/PSRAM, sem depender de rede nem de requisições HTTP externas.

### 2.3 Respeito à LGPD e Isolamento de Dados
- Nunca comite dados reais de alunos, responsáveis, CPFs ou fotos reais no Git.
- Todos os testes e dados de sementeira (`supabase/seed.sql`) devem utilizar nomes fictícios e UIDs simulados (`04:A1:B2:C3`, `FB:10:00:07`).
- As chaves de serviço (`SUPABASE_SERVICE_ROLE_KEY`) devem residir exclusivamente no `.env.local`, nunca sendo injetadas no `config.js` exposto ao navegador.

### 2.4 Obrigatoriedade da Suíte de Testes
- Antes de qualquer commit na branch `lab/offline`, execute a suíte de testes completa:
  ```bash
  npm test
  ```
- Todos os **58 testes automatizados** devem passar com código de saída 0 (`PASS`).

---

## 3. Comandos e Rotinas do Laboratório Offline

### 3.1 Operação da Pilha Supabase Local
```bash
# Iniciar a pilha de contêineres Docker do Supabase
npm run lab:start

# Configurar automaticamente o .env.local com IP da máquina e chaves locais
npm run lab:setup

# Iniciar o servidor HTTP local do painel (porta 5500)
npm run lab:dev

# Parar todos os contêineres do Supabase
npm run lab:stop

# Redefinir o banco local aplicando migrations e seed.sql
npm run lab:reset

# Executar diagnóstico de integridade da pilha local
npm run lab:check
```

### 3.2 TUI de Terminal (`lab.cmd`)
Para operadores e técnicos de suporte em campo:
```cmd
lab.cmd
```
Abre a TUI unificada de 24 linhas com monitoramento em tempo real do Docker, Banco, Painel, ESP32 e Hotspot. O item **Hotspot NFC-Lab** liga/desliga a rede sem internet e atualiza o IP no `.env.local`; o "Ligar tudo" segue o `LAB_HOTSPOT_MODO` (`auto`, `sempre` ou `nunca`).

### 3.3 Verificação de Sintaxe, Testes e Simulação
```bash
# Testes unitários e de integração (58 testes nativos Node.js sem dependências externas)
npm test

# Validação sintática dos scripts ECMAScript
npm run check

# Iniciar o simulador de bancada do ESP32 com suporte a NFC e Biometria
npm run mock:esp
# Simular passagem de cartão NFC: curl http://localhost:8080/mock/nfc?uid=04:A1:B2:C3
# Simular leitura de digital:      curl http://localhost:8080/mock/bio?id=7
```

---

## 4. Estrutura de Arquivos e Responsabilidades

- `lab.cmd`: Ponto de entrada rápido para iniciar `lab-menu.ps1`.
- `lab-menu.ps1`: TUI interativa em PowerShell com renderização direta no console via `[Console]::Write` e item de hotspot.
- `lab-estado.ps1`: Processo em segundo plano que monitora a saúde das portas e grava estado em arquivo temporário JSON (inclui o hotspot).
- `lab-hotspot.ps1` / `lab-hotspot.cmd`: Criam a rede Wi-Fi `NFC-Lab` sem internet via API de tethering do Windows (`192.168.137.1`).
- `lab-hotspot-desligar.cmd`: Desliga a rede `NFC-Lab` e devolve o Wi-Fi normal.
- `lab-ligar.cmd`: Automação em lote que inicia o Docker, Supabase e o servidor do painel.
- `lab-desligar.cmd`: Automação em lote que encerra os contêineres do Supabase.
- `lab-checar.cmd`: Atalho de execução para `scripts/check-lab.mjs`.
- `lab-firewall-liberar.cmd`: Cria regras no Firewall do Windows para as portas 80, 54321, 5500 e 54323 só para a rede local (Wi-Fi, cabo e hotspot).
- `lab-criar-atalhos.cmd` / `lab-atalhos.ps1`: Gera atalhos `.lnk` na área de trabalho do usuário ("Servidor NFC" e "Hotspot NFC").
- `scripts/network.mjs`: Centraliza a escolha do IP do notebook, ignorando interfaces virtuais e priorizando o hotspot `192.168.137.1`.
- `scripts/lab-setup.mjs`: Varre interfaces de rede físicas (excluindo adaptadores virtuais WSL/Hyper-V/Docker), atualiza `.env.local` e extrai credenciais de `supabase status -o env`.
- `scripts/check-lab.mjs`: Validador do ambiente de laboratório com flags de relatório completo e exibição de IPs.
- `scripts/mock-esp.mjs`: Simulador de bancada para desenvolvimento sem hardware, com suporte completo a leitura e cadastro em 2 toques do sensor biométrico AS608.
- `supabase/config.toml`: Configurações de portas e serviços da CLI Supabase local (versão 2.121.0).
- `supabase/migrations/20261110_biometria_opcional.sql`: Migração SQL que adiciona suporte à coluna `biometria_id` (1 a 300) com índice único parcial.
- `supabase/seed.sql`: Carga inicial de estudantes fictícios cobrindo os 3 modos de identificação: somente NFC, somente biometria e híbrido.
- `tests/biometria.test.mjs`: Suíte de testes para normalização de ID biométrico, formatação de UID virtual e resolução mock.
- `esp32s3-nfc-acesso/`:
  - `esp32s3-nfc-acesso.ino`: Firmware v2.1.3 unificado com suporte a NFC + AS608, cache em PSRAM e máquina de estados não-bloqueante.
  - `pagina_web.h`, `pagina_wifi.h`, `web_ferramentas.h`: Páginas web compactadas e utilitários embutidos de diagnóstico.
  - `MANUAL_DO_SISTEMA.md` e `GUIA_DE_PINOS_E_EXPANSAO.md`: Manuais de ligação física e referência completa das rotas REST.

---

## 5. Fluxo de Git e Ramificação

- **Repositório Remoto**: `https://github.com/devmagary/escola-nfc-web.git`
- **Branch Ativa**: `lab/offline`
- **Comandos de Sincronização**:
  ```bash
  git fetch origin lab/offline
  git status
  git push origin lab/offline
  ```
