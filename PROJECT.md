# PROJECT.md — Architecture, Schema & Contracts (`escola-nfc-web`)

## 1. Project Overview

**`escola-nfc-web`** is the central school gatehouse monitoring, card management, and edge hardware coordination system. It links cloud storage (Supabase) and school administrators with physical turnstiles running custom ESP32-S3 firmware.

### Key Capabilities
- **Real-Time Portaria Kiosk**: Live badge scan display showing student photo, name, class, authorization status, and timestamp.
- **Bi-Directional Edge Sync**: Instant push updates from web panel to ESP32 local flash via local HTTP REST, plus bulk synchronization fallback.
- **Offline Resilience**: Turnstiles evaluate student entry in $< 1\text{ ms}$ from internal Flash (`/cartoes.json`). If internet drops, turnstiles continue opening gates for registered students without interruption.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions for 5 roles (`Administrador`, `Secretaria`, `Portaria`, `Professor`, `Responsavel`).

---

## 2. Directory Layout

```
escola-nfc-web/
├── .github/workflows/          # CI/CD and deployment workflows
├── esp32s3-nfc-acesso/         # Production ESP32-S3 C++ firmware
│   ├── esp32s3-nfc-acesso.ino  # Dual-core FreeRTOS sketch
│   ├── web_ferramentas.h       # Diagnostics console & Web OTA
│   ├── pagina_web.h            # Main web UI in Flash PROGMEM
│   ├── pagina_wifi.h           # Wi-Fi setup & captive portal
│   ├── MANUAL_DO_SISTEMA.md    # Hardware manual & network guide
│   ├── GUIA_37_SENSORES_ESP32.md # Sensor interfacing catalog
│   └── GUIA_DE_PINOS_E_EXPANSAO.md # Pinout & Octal PSRAM rules
├── js/                         # Vanilla ES frontend modules
│   ├── app.js                  # Main UI & event bindings
│   ├── supabase.js             # Supabase client & Realtime
│   ├── sync.js                 # LAN polling & push sync service
│   └── rfid.js                 # NFC UID parser
├── supabase/                   # Supabase schema and migrations
│   └── supabase_setup.sql      # Schema, RLS, functions & RBAC
├── tests/                      # Automated test suite (Jest/Node)
├── index.html                  # Single-page dashboard markup
├── style.css                   # Administrative styling & themes
├── vercel.json                 # Production Vercel routing
├── AGENT.md                    # Developer and AI agent guidelines
└── PROJECT.md                  # This architectural reference
```

---

## 3. Database Schema (Supabase / PostgreSQL)

### 3.1 Tables
- **`alunos`**: Core student registry.
  - `id`: UUID (Primary Key)
  - `nome`: VARCHAR(255)
  - `matricula`: VARCHAR(50) (Unique)
  - `turma`: VARCHAR(50)
  - `uid_cartao`: VARCHAR(32) (Unique, NFC badge UID)
  - `autorizado`: BOOLEAN (Default TRUE)
  - `foto_url`: TEXT (Supabase Storage reference)
  - `created_at`: TIMESTAMPTZ
- **`registros_acesso`**: Turnstile access logs.
  - `id`: UUID (Primary Key)
  - `aluno_id`: UUID (Foreign Key -> `alunos.id`)
  - `uid_cartao`: VARCHAR(32)
  - `tipo`: VARCHAR(20) (`ENTRADA` / `SAIDA`)
  - `status`: VARCHAR(20) (`AUTORIZADO` / `BLOQUEADO` / `DESCONHECIDO`)
  - `dispositivo_id`: VARCHAR(50) (Turnstile identifier)
  - `created_at`: TIMESTAMPTZ
- **`usuarios_permissoes`**: RBAC role mapping linking `auth.users` to school roles.

### 3.2 Row Level Security (RLS)
- Portaria accounts can read `alunos` and insert `registros_acesso`.
- Secretaria and Administrador have full write permissions to `alunos`.
- Responsaveis and Professores have read-only filtered access to class or child attendance.

---

## 4. Hardware Pinout & Specs (YD-ESP32-S3 N16R8)

| Component | Pin / Bus | Notes |
|---|---|---|
| **PN532 SDA** | GPIO 8 | I2C Data (Requires 4.7kΩ pullup if not present on breakout) |
| **PN532 SCL** | GPIO 9 | I2C Clock |
| **Relay Solenoid** | GPIO 4 | Active HIGH (Triggers 500 ms turnstile unlatch pulse) |
| **NeoPixel WS2812B** | GPIO 48 | Onboard status RGB LED (Cyan=Idle, Green=Pass, Red=Blocked, Yellow=Sync) |
| **Flash Memory** | SPI (Internal) | 16 MB LittleFS/FFat storing `/cartoes.json` |
| **PSRAM** | Octal (Internal) | 8 MB PSRAM (Pins 35, 36, 37 reserved — do not connect!) |

---

## 5. Verification Commands

```bash
# Run unit & integration tests
npm test

# Check syntax / static analysis
npm run lint (if configured) or node tests/
```
