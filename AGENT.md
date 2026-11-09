# AGENT.md — Manual de Operação e Diretrizes de IA (`escola-nfc-web-offline` / `lab/offline`)

## 1. Visão Geral e Contexto de Execução

O diretório `escola-nfc-web-offline` é um git worktree vinculado à branch `lab/offline` do repositório `https://github.com/devmagary/escola-nfc-web.git`.

Este subsistema implementa a infraestrutura completa para operação em ambiente escolar sem dependência de internet externa (On-Premise / Edge Laboratory). Ele engloba:
1. **Pilha Local Supabase via Docker**: Gateway Kong (porta 54321), PostgreSQL (porta 54322), GoTrue Auth, PostgREST, Storage local e Supabase Studio (porta 54323).
2. **Interface TUI e Scripts de Automação Windows**: Menu de terminal interativo (`lab.cmd`, `lab-menu.ps1`), scripts em lote para inicialização rápida (`lab-ligar.cmd`), encerramento (`lab-desligar.cmd`), diagnóstico (`lab-checar.cmd`), liberação de firewall (`lab-firewall-liberar.cmd`) e atalhos de área de trabalho (`lab-criar-atalhos.cmd`).
3. **Servidor HTTP Local de Baixa Latência**: Servidor embutido Node.js (`scripts/serve-local.mjs`) operando na porta 5500 para exibição do totem da portaria e painel administrativo em tablets e computadores na LAN.
4. **Firmware de Borda ESP32-S3**: Código C++ FreeRTOS com armazenamento em memória Flash (`/cartoes.json`) e sincronização bidirecional na rede local.

---

## 2. Regras de Conduta para Agentes de IA

### 2.1 Princípio de Modificação Mínima
- Altere apenas as linhas e arquivos estritamente necessários para a demanda informada.
- Nunca reformate arquivos inteiros ou altere a estrutura de scripts PowerShell/Batch sem solicitação explícita.
- Mantenha a nomenclatura institucional em português (`matricula`, `turma`, `portaria`, `catraca`, `sincronizacao`, `laboratorio`).

### 2.2 Segurança de Hardware e Restrições do ESP32-S3 (N16R8)
- **CRÍTICO**: Na placa YD-ESP32-S3 (N16R8), nunca atribua os GPIOs 35, 36 ou 37. Esses pinos são conectados internamente ao barramento Octal PSRAM de 8 MB. Qualquer acionamento externo causa travamento imediato e corrupção de memória.
- **Barramento I2C PN532**: SDA no GPIO 8, SCL no GPIO 9. Chaves seletoras do PN532: Chave 1 = ON, Chave 2 = OFF.
- **LED RGB Onboard (WS2812B)**: GPIO 48.
- **Relé da Catraca**: Pulso ativo ALTO (Active HIGH) de 500 ms nos pinos GPIO 4 ou GPIO 6.
- **Prioridade Offline**: A validação de cartões pelo leitor físico deve ocorrer em tempo inferior a 1 ms diretamente da Flash/RAM local, sem bloqueio por requisições HTTP pendentes.

### 2.3 Respeito à LGPD e Isolamento de Dados
- Nunca comite dados reais de alunos, responsáveis, CPFs ou fotos reais no Git.
- Todos os testes e dados de sementeira (`supabase/seed.sql`) devem utilizar nomes fictícios e UIDs simulados (`04:A1:B2:C3`, `11:22:33:44`).
- As chaves de serviço (`SUPABASE_SERVICE_ROLE_KEY`) devem residir exclusivamente no `.env.local`, nunca sendo injetadas no `config.js` exposto ao navegador.

### 2.4 Obrigatoriedade da Suíte de Testes
- Antes de qualquer commit na branch `lab/offline`, execute a suíte de testes:
  ```bash
  npm test
  ```
- Todos os 54 testes automatizados devem passar com código de saída 0 (`PASS`).

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
Abre a TUI unificada de 24 linhas com monitoramento em tempo real do Docker, Banco, Painel e ESP32.

### 3.3 Verificação de Sintaxe e Testes
```bash
# Testes unitários e de integração (Node.js nativo sem dependências externas)
npm test

# Validação sintática dos scripts ECMAScript
npm run check
```

---

## 4. Estrutura de Arquivos e Responsabilidades

- `lab.cmd`: Ponto de entrada rápido para iniciar `lab-menu.ps1`.
- `lab-menu.ps1`: TUI interativa em PowerShell com renderização direta no console via `[Console]::Write`.
- `lab-estado.ps1`: Processo em segundo plano que monitora a saúde das portas e grava estado em arquivo temporário JSON.
- `lab-ligar.cmd`: Automação em lote que inicia o Docker, Supabase e o servidor do painel.
- `lab-desligar.cmd`: Automação em lote que encerra os contêineres do Supabase.
- `lab-checar.cmd`: Atalho de execução para `scripts/check-lab.mjs`.
- `lab-firewall-liberar.cmd`: Cria regras no Firewall do Windows para as portas 54321, 5500 e 54323.
- `lab-criar-atalhos.cmd` / `lab-atalhos.ps1`: Gera atalhos `.lnk` na área de trabalho do usuário.
- `scripts/lab-setup.mjs`: Varre interfaces de rede físicas (excluindo adaptadores virtuais WSL/Hyper-V/Docker), atualiza `.env.local` e extrai credenciais de `supabase status -o env`.
- `scripts/check-lab.mjs`: Validador do ambiente de laboratório com flags de relatório completo e exibição de IPs.
- `supabase/config.toml`: Configurações de portas e serviços da CLI Supabase local (versão 2.121.0).
- `supabase/seed.sql`: Carga inicial de estudantes fictícios e histórico para homologação offline.
- `esp32s3-nfc-acesso/`: Firmware de borda e documentação de integração com sensores e periféricos.

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
