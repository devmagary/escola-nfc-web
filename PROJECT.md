# PROJECT.md — Arquitetura e Especificação Técnica (`escola-nfc-web-offline` / `lab/offline`)

## 1. Visão Geral do Sistema

O subsistema **`escola-nfc-web-offline`** (mantido na branch `lab/offline` do repositório `escola-nfc-web.git`) constitui a solução completa para implantação local e independente de internet em escolas.

O sistema opera integralmente na rede local (LAN) da escola, utilizando um computador local ou notebook da portaria como servidor central de borda, conectado via Wi-Fi ou Ethernet aos totens/catracas baseados no microcontrolador ESP32-S3 e aos tablets da portaria.

---

## 2. Diagrama de Topologia de Rede Local

```
                  [ REDE LOCAL ESCOLAR (LAN / WI-FI) ]
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  TABLET PORTARIA │      │ CATRACA ESP32-S3 │      │ SECRETARIA / ADM │
│  (Navegador Web) │      │  (Leitor PN532)  │      │ (Computador LAN) │
│  http://IP:5500  │      │  http://IP-ESP   │      │  http://IP:5500  │
└────────┬─────────┘      └────────┬─────────┘      └────────┬─────────┘
         │                         │                         │
         │   Porta 5500 (HTTP)     │   Porta 54321 (REST)    │
         │   Porta 54321 (API)     │   Sync /api/ultimo      │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
                   ┌────────────────────────────────┐
                   │  SERVIDOR LOCAL DO LABORATÓRIO │
                   │  (Notebook / PC da Portaria)   │
                   │                                │
                   │  1. Node.js Static Server      │
                   │     Porta 5500                 │
                   │                                │
                   │  2. Docker / Supabase CLI      │
                   │     - Kong API: 54321          │
                   │     - PostgreSQL: 54322        │
                   │     - Studio Web: 54323        │
                   │     - Inbucket: 54324          │
                   │                                │
                   │  3. TUI de Monitoramento       │
                   │     lab.cmd / lab-menu.ps1     │
                   └────────────────────────────────┘
```

---

## 3. Matriz de Portas e Serviços Locais

| Serviço | Porta Local | Protocolo | Finalidade | Escopo de Acesso |
|---|---|---|---|---|
| **Painel Web / Totem** | 5500 | HTTP | Entrega da aplicação SPA ao navegador do tablet/PC | Rede Local (LAN) |
| **Kong API Gateway** | 54321 | HTTP | Endpoints REST, Auth (`/auth/v1`), PostgREST (`/rest/v1`) | Rede Local (LAN) |
| **PostgreSQL Local** | 54322 | TCP | Banco de dados relacional local do laboratório | Somente Localhost |
| **Supabase Studio** | 54323 | HTTP | Interface administrativa web do banco de dados | Rede Local / Admin |
| **Inbucket (E-mail)** | 54324 | HTTP | Caixa postal simulada para confirmação de cadastros | Somente Localhost |
| **ESP32-S3 REST API** | 80 | HTTP | Consulta de último cartão (`/api/ultimo`) e sincronização | Rede Local (LAN) |
| **Mock ESP32 (Dev)** | 8787 | HTTP | Emulador de hardware para desenvolvimento sem placa | Somente Localhost |

---

## 4. Estrutura de Diretórios e Componentes

```
escola-nfc-web-offline/
├── .github/workflows/          # Automações de CI (execução de testes em pull requests)
├── esp32s3-nfc-acesso/         # Firmware C++ FreeRTOS para a placa YD-ESP32-S3
│   ├── esp32s3-nfc-acesso.ino  # Loop dual-core de leitura e servidor REST local
│   ├── web_ferramentas.h       # Console de diagnóstico e Web OTA (/ota)
│   ├── pagina_web.h            # HTML armazenado na memória flash do microcontrolador
│   └── pagina_wifi.h           # Portal de captura e configuração Wi-Fi
├── js/                         # Frontend modular vanilla ES
│   ├── app.js                  # Controle central da interface e navegação entre abas
│   ├── lib/
│   │   ├── config.js           # Leitura de configuração imutável window.__APP_CONFIG__
│   │   └── utils.js            # Utilitários de CSV, formatação, validação e UUIDs
│   └── services/
│       ├── supabase.js         # Cliente local Supabase e gerenciamento de filas
│       └── esp32.js            # Cliente HTTP do leitor físico e polling da portaria
├── scripts/                    # Scripts de automação em Node.js (sem dependências externas)
│   ├── build-config.mjs        # Gera o config.js a partir do .env.local
│   ├── check-lab.mjs           # Diagnóstico detalhado de saúde do laboratório
│   ├── check-syntax.mjs        # Validação estática de sintaxe de todos os arquivos JS
│   ├── lab-setup.mjs           # Descoberta de IP de rede e configuração automática do .env
│   ├── mock-esp.mjs            # Emulador do microcontrolador para testes sem hardware
│   ├── network.mjs             # Regra de escolha do IP (ignora virtuais; prioriza hotspot)
│   └── serve-local.mjs         # Servidor HTTP estático nativo para a porta 5500
├── supabase/                   # Configuração e migrações da pilha local Supabase
│   ├── config.toml             # Definição de portas, limites e serviços da CLI
│   ├── seed.sql                # Dados de exemplo para alunos, turmas e acessos
│   └── migrations/             # Migrações incrementais do banco PostgreSQL
├── tests/                      # Suíte de 54 testes automatizados em node:test
├── lab.cmd                     # Inicializador do menu interativo no Windows
├── lab-menu.ps1                # TUI interativa em PowerShell com renderização direta
├── lab-estado.ps1              # Processo daemon para monitoramento das luzes da TUI
├── lab-hotspot.ps1             # Cria a rede Wi-Fi NFC-Lab sem internet (192.168.137.1)
├── lab-hotspot.cmd             # Atalho de duplo clique para ligar o hotspot
├── lab-hotspot-desligar.cmd    # Atalho para desligar o hotspot
├── lab-ligar.cmd               # Script rápido de inicialização do contêiner e servidor
├── lab-desligar.cmd            # Script rápido para encerramento dos contêineres Docker
├── lab-checar.cmd              # Script rápido para verificação de conectividade
├── lab-firewall-liberar.cmd    # Configuração automática das regras de Firewall do Windows
├── lab-criar-atalhos.cmd       # Criação de atalhos na Área de Trabalho do Windows
├── AGENT.md                    # Instruções operacionais para desenvolvedores e agentes
└── PROJECT.md                  # Este documento de referência técnica
```

---

## 5. Resiliência e Operação Offline

### 5.1 Validação Instantânea no Hardware
O leitor ESP32-S3 armazena o arquivo `/cartoes.json` na memória Flash (LittleFS). Quando um cartão RFID/NFC é aproximado:
1. O microcontrolador busca o identificador na base local em $< 1\text{ ms}$.
2. Se autorizado, aciona o relé da catraca imediatamente.
3. Disponibiliza o evento no endpoint `GET /api/ultimo`.
4. Não há bloqueio ou espera de resposta de rede para a liberação da catraca.

### 5.2 Fila de Contingência no Navegador
Caso a conexão entre o tablet e o servidor Supabase local oscile momentaneamente:
1. O painel web armazena os acessos de alunos autorizados em uma fila local no `localStorage` (capacidade de até 200 eventos).
2. Assim que a conectividade com o banco for restabelecida, a sincronização é executada automaticamente em segundo plano.
3. Tentativas com cartões não cadastrados não poluem a fila de contingência.

---

## 6. Procedimentos de Verificação e Homologação

```bash
# 1. Executar os 54 testes unitários e de integração
npm test

# 2. Validar sintaxe ECMAScript em todos os arquivos de script e biblioteca
npm run check

# 3. Executar o diagnóstico de ambiente do laboratório offline
npm run lab:check

# 4. Listar os endereços IP válidos da máquina na rede física local
npm run lab:ip
```
