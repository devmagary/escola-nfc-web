# Firmware ESP32-S3 — Controle de Acesso NFC

Firmware do controlador de acesso (ESP32-S3 N16R8 + leitor PN532) que conversa com o web app deste repositório.

## Arquivos

| Arquivo | Função |
| :--- | :--- |
| `esp32s3-nfc-acesso.ino` | Firmware principal: NFC, Wi-Fi, API REST, console web, OTA, NVS |
| `pagina_web.h` | Painel web do controlador (cartões, histórico, leitura NFC) |
| `pagina_wifi.h` | Página `/wifi` de configuração do Wi-Fi pelo celular |
| `web_ferramentas.h` | Console serial remoto (`/console`) e atualizador OTA (`/ota`) |
| `MANUAL_DO_SISTEMA.md` | Manual completo: montagem, LED, gravação, console, OTA e sincronização |
| `GUIA_DE_PINOS_E_EXPANSAO.md` | Pinagem e placa de expansão |
| `GUIA_37_SENSORES_ESP32.md` | Guia de integração de sensores extras |

## Antes de gravar

1. Abra `esp32s3-nfc-acesso.ino` e preencha `WIFI_SSID` e `WIFI_SENHA` com a rede **2,4 GHz** do local (os valores no repositório são placeholders).
2. Troque `ADMIN_SENHA` (login do painel) e `AP_SENHA` (mínimo de 8 caracteres, WPA2).
3. Na Arduino IDE, instale as bibliotecas **Adafruit PN532** (com *Adafruit BusIO*), **Adafruit NeoPixel** e **ArduinoJson 7.x**.
4. Selecione **ESP32S3 Dev Module**, Flash 16MB, PSRAM **OPI PSRAM** e um esquema de partição com OTA (ex.: `app3M_fat9M_16MB`).

## Configuração sem recompilar

Se a placa não encontrar a rede salva, ela cria o AP **`ControleAcesso-S3`** e o portal cativo abre a página `/wifi`: escolha a rede 2,4 GHz, digite a senha e a placa salva na NVS e reinicia conectada. O passo a passo está na seção 5.3 do manual.

## Painel web no próprio ESP32

O firmware inclui as rotas:

- `GET /painel/` — painel web completo (HTML/CSS/JS) servido do LittleFS, na mesma origem da API;
- `GET /painel/...` — arquivos estáticos (aceita `.gz`, com `Content-Encoding: gzip`);
- `POST /api/painel/upload?path=/painel/...` — upload multipart, protegido pelo login Basic do painel da placa.

No repositório web, rode:

```bash
npm run painel:deploy -- --esp http://IP-DO-ESP
```

O pacote tem ~185 KB (ou ~45 KB gzip) e cabe na partição LittleFS/FAT de 8–9,9 MB. O upload usa `ADMIN_USUARIO`/`ADMIN_SENHA` do firmware; troque a senha padrão. Após enviar, o tablet abre `http://IP-DO-ESP/painel/` e continua falando direto com o Supabase.

Para atualizar só o painel (sem regravar o firmware), repita `npm run painel:deploy`. Se a partição de dados for alterada, envie novamente. O `WebServer` atende uma requisição por vez; para uma portaria com um tablet, o custo é pequeno, e a decisão de acesso do NFC continua no Core 0, independente do servidor web.

## Observações de rádio

- Wi-Fi **4** (802.11 b/g/n) **somente em 2,4 GHz** — o ESP32-S3 não conecta em redes Wi-Fi 5/6 (5 GHz).
- **Bluetooth 5 (LE)** existe no chip, mas não é usado por este firmware.
- Mais detalhes na seção 1.1 do manual.

> Este diretório não versiona credenciais reais nem artefatos de compilação (`build/`).
