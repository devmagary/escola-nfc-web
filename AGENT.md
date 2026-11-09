# AGENT.md — Developer & AI Agent Operating Manual (`escola-nfc-web`)

## 1. Subsystem Overview & Mental Model

The **`escola-nfc-web`** repository is the central administrative hub and hardware management platform for school turnstile access control. It pairs cloud database management (Supabase) with local edge hardware (ESP32-S3 NFC turnstiles).

As an AI agent or developer working here, understand that this codebase encompasses two tightly coordinated layers:
1. **Frontend Web Application (Vanilla ES Modules)**: School administration dashboard, live gatehouse kiosk with photo display, student enrollment, RBAC permission enforcement, and bi-directional local sync with edge turnstiles.
2. **Edge Hardware Firmware (`esp32s3-nfc-acesso/`)**: C++ Arduino/ESP-IDF dual-core firmware running on the YD-ESP32-S3 (N16R8), validating RFID cards locally from Flash memory (`/cartoes.json`) with $< 1\text{ ms}$ latency even if the internet or local server is down.

---

## 2. Rules of Engagement for AI Agents

### 2.1 The Minimal Change Principle
- Only modify lines directly relevant to the feature, bugfix, or refactoring requested.
- Never reformat entire files or change build setups unprompted.
- Preserve domain terminology in Portuguese (e.g., `matricula`, `turma`, `portaria`, `catraca`, `sincronizar`).

### 2.2 Hardware Safety & ESP32-S3 Critical Constraints
- **CRITICAL**: On the YD-ESP32-S3 (N16R8), **never assign GPIO 35, 36, or 37**. They are bonded to the 8 MB Octal PSRAM bus; connecting external circuitry triggers instantaneous CPU crashes and memory bus lockup.
- **PN532 I2C Pinout**: SDA = GPIO 8, SCL = GPIO 9. Switch 1 = ON, Switch 2 = OFF.
- **Onboard WS2812B NeoPixel**: Fixed on GPIO 48.
- **Relay / Turnstile Output**: Active HIGH trigger on GPIO 4 / GPIO 6.
- **Offline First**: All access validations MUST resolve locally in memory/Flash without waiting for an HTTP response from Supabase or the web dashboard.

### 2.3 Strict LGPD & Student Data Protection
- Never commit real student photos, CPFs, or contact details to Git.
- Real spreadsheets and photos belong exclusively in local ignored storage (`.env.local`, Supabase private buckets).
- Test fixtures must use synthetic names and mock UIDs (`04A1B2C3D4`, `1234567890`).

### 2.4 Test Verification Mandate
- Before and after modifying web code, execute the test suite:
  ```bash
  npm test
  ```
- All 47 test suites (auth, rbac, sync, rfid) must exit with code 0 (`PASS`).

---

## 3. Architecture & File Inventory

### 3.1 Web Application
- `index.html`: Single-page application markup with modal windows for gatehouse kiosk, registration, and terminal sync.
- `style.css`: Clean, dark-mode administrative theme with Tailwind-compatible utility classes.
- `js/app.js`: Main application controller and UI state management.
- `js/supabase.js`: Supabase JS client initializer and Realtime subscription handlers.
- `js/sync.js`: Polling and push sync engine between Supabase and local ESP32 IP endpoints.
- `js/rfid.js`: Web NFC and serial reader parser.
- `supabase_setup.sql`: Complete PostgreSQL schema with RLS policies, 5 RBAC roles (`Administrador`, `Secretaria`, `Portaria`, `Professor`, `Responsavel`), and audit log tables.

### 3.2 Firmware (`esp32s3-nfc-acesso/`)
- `esp32s3-nfc-acesso.ino`: Main sketch with FreeRTOS dual-core task separation:
  - **Core 0**: Continuous 50 ms NFC polling loop and I2C hardware watchdog.
  - **Core 1**: Async REST web server, DNS Captive Portal, and Web OTA handler.
- `web_ferramentas.h`: Web console (`/console`), interactive pin test bench, and OTA flashing interface (`/ota`).
- `pagina_web.h` & `pagina_wifi.h`: Responsive HTML templates stored in flash memory (`PROGMEM`).
- `MANUAL_DO_SISTEMA.md`: Operational user manual for school operators and installers.

---

## 4. REST API Contract (ESP32-S3 Endpoints)

| Method | Endpoint | Description | Payload / Response |
|---|---|---|---|
| `GET` | `/api/ultimo` | Returns most recent card read event | `{"uid":"04A1B2C3","nome":"Lucas","status":"autorizado"}` |
| `POST` | `/api/sincronizar_aluno` | Incremental add/update student in Flash | `{"uid":"04A1B2C3","nome":"Lucas","autorizado":true}` |
| `POST` | `/api/remover_aluno` | Remove student UID from Flash | `{"uid":"04A1B2C3"}` |
| `POST` | `/api/sincronizar_todos`| Bulk upload full authorized student array | `[{"uid":"...","nome":"...","autorizado":true}]` |
| `GET` | `/console` | Embedded diagnostics and Wi-Fi health console | HTML page |
| `POST` | `/update` | Web OTA binary firmware update | Multipart firmware binary |

---

## 5. Development & Deployment Workflow

### Running Locally
```bash
# Serve static frontend
npx serve .
# Or via Python
python -m http.server 3000
```

### Running Tests
```bash
npm test
```

### Deploying Frontend to Vercel
```bash
vercel --prod
```
