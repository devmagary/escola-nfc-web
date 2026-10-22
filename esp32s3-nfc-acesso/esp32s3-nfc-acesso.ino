/*
 * Controle de Acesso NFC Profissional para ESP32-S3 N16R8
 * Placa: YD-ESP32-S3 (Dual USB-C, 16MB Flash, 8MB PSRAM OPI)
 *
 * Recursos desta versão S3:
 *   - Auto-diagnóstico de Partições da Flash no boot
 *   - Suporte universal ao sistema de arquivos (LittleFS ou FATFS/FFat automático)
 *   - Dual Core FreeRTOS: Leitor NFC no Core 0, Servidor Web no Core 1 (0 lag)
 *   - LED RGB WS2812B integrado no GPIO 48 (Verde=Liberado, Vermelho=Negado)
 *   - Armazenamento em arquivos JSON na Flash (sem limite rígido de cartões)
 *   - Backup e Restauração de cartões via Web (Download/Upload JSON)
 *   - Horário oficial via NTP (pool.ntp.br) com data e hora exata nos logs
 *   - Histórico gravado na Flash (sobrevive a desligamentos)
 *   - Configuração de Wi-Fi pela Web no modo AP (varredura 2,4 GHz, senha e conexão)
 *   - Credenciais salvas na NVS (sobrevivem a desligamentos e OTA)
 *   - Rádio do chip: Wi-Fi 4 (802.11 b/g/n) somente em 2,4 GHz; Bluetooth 5 (LE)
 *     disponível no hardware, mas não utilizado por este firmware
 *   - Pinos protegidos: não interfere na PSRAM Octal (GPIO 35, 36, 37 livres)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <FS.h>
#include <LittleFS.h>
#include <FFat.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <Wire.h>
#include <Adafruit_PN532.h>
#include <time.h>
#include <Preferences.h>
#include <DNSServer.h>
#include "esp_partition.h"
#include <Update.h>
#include "pagina_web.h"
#include "web_ferramentas.h"
#include "pagina_wifi.h"

// =====================================================================
// CONFIGURAÇÕES — Ajuste aqui
// =====================================================================

// Sua rede Wi-Fi residencial / corporativa (precisa ser 2,4 GHz - o ESP32-S3 nao usa 5 GHz)
// ATENCAO: preencha com os dados da rede local antes de gravar. Nunca publique a senha real no Git.
const char* WIFI_SSID  = "NOME_DA_REDE_2G";
const char* WIFI_SENHA = "SENHA_DA_REDE";

// Rede própria criada pelo ESP32 caso não encontre o Wi-Fi
const char* AP_SSID  = "ControleAcesso-S3";
const char* AP_SENHA = "12345678";

// Tempo máximo de espera pela conexão Wi-Fi (ms)
#define WIFI_TIMEOUT_BOOT_MS       20000
#define WIFI_TIMEOUT_TENTATIVA_MS  20000

// Cache da lista de redes exibida na página /wifi (ms)
#define SCAN_CACHE_MS              4000
#define MAX_REDES_JSON             30

// Capacidades de rádio do alvo de compilação (reportadas na API e na página /wifi)
#if defined(SOC_WIFI_SUPPORT_5G) && SOC_WIFI_SUPPORT_5G
  #define RADIO_WIFI_FAIXAS "2,4 GHz + 5 GHz"
#else
  #define RADIO_WIFI_FAIXAS "2,4 GHz"
#endif

#if defined(SOC_BLE_50_SUPPORTED) && SOC_BLE_50_SUPPORTED
  #define RADIO_BLUETOOTH "Bluetooth 5 (LE)"
#else
  #define RADIO_BLUETOOTH "Bluetooth (LE)"
#endif

#if defined(CONFIG_IDF_TARGET_ESP32S3)
  #define RADIO_WIFI_PADRAO "802.11 b/g/n (Wi-Fi 4)"
#else
  #define RADIO_WIFI_PADRAO "consulte o datasheet do chip"
#endif

// Login do Painel Web
const char* ADMIN_USUARIO = "admin";
const char* ADMIN_SENHA   = "admin123"; // Recomenda-se alterar!

// Nome na rede local -> acesse via http://nfc.local
const char* HOSTNAME = "nfc";

// Pinos I2C da fileira amarela
#define SDA_PIN 8
#define SCL_PIN 9

// Pinos virtuais do PN532 (GPIO 5 evita pinos de boot do S3)
#define PN532_IRQ   2
#define PN532_RESET 5

// LED RGB WS2812B integrado na placa YD-ESP32-S3
#define PINO_LED_RGB 48

// Saída para Relé / Fechadura elétrica (-1 para desativar, ou use GPIO 4, 6, etc)
#define PINO_SAIDA        -1
#define SAIDA_NIVEL_ATIVO HIGH
#define TEMPO_SAIDA_MS    3000

// Cartão padrão para a primeira inicialização
const char* CARTAO_INICIAL_UID  = "2C:9D:7E:8E";
const char* CARTAO_INICIAL_NOME = "Cartão Inicial";

// Caminhos dos arquivos
const char* ARQ_CARTOES   = "/cartoes.json";
const char* ARQ_HISTORICO = "/historico.json";
#define MAX_HISTORICO_LOG 50

// Painel web completo (HTML/CSS/JS) servido pela própria placa.
// Os arquivos são enviados por scripts/painel-upload.mjs para o LittleFS.
const char* PASTA_PAINEL = "/painel";
#define PAINEL_MAX_ARQUIVO (512 * 1024)

// =====================================================================
// Objetos e Estado Global
// =====================================================================

Adafruit_PN532     nfc(PN532_IRQ, PN532_RESET);
Adafruit_NeoPixel  rgb(1, PINO_LED_RGB, NEO_GRB + NEO_KHZ800);
WebServer          server(80);
DNSServer          dnsServer;
Preferences        prefsWifi;

// Credenciais de Wi-Fi salvas na NVS (sobrevivem a desligamentos e OTA)
String   wifiSsidSalvo       = "";
String   wifiSenhaSalva      = "";
bool     temConfigWifiSalva  = false; // Chave "configurado" da NVS
bool     temRedeSalva        = false; // SSID salvo não vazio

// Tentativa de conexão iniciada pela página /wifi
struct TentativaWifi {
  bool     ativa          = false;
  String   ssid           = "";
  String   senha          = "";   // Mantida apenas até a conexão terminar
  uint32_t inicio         = 0;
  uint8_t  falhasSeguidas = 0;
  String   resultado      = "";   // "" | "ok" | "falha"
  String   motivo         = "";
} tentativaWifi;

uint32_t wifiReiniciarEm = 0;   // 0 = nenhum reinício agendado
String   wifiIpNovo      = "";

// Cache da varredura de redes exibida na página /wifi
String   scanCacheJson   = "[]";
uint32_t scanCacheMs     = 0;
bool     scanCacheValido = false;

// Ponteiro universal para o sistema de arquivos (LittleFS ou FFat)
fs::FS* fsPtr = nullptr;
const char* nomeFsAtivo = "Nenhum";
void garantirPastasPainel();

// Upload do painel web (multipart) para o LittleFS.
File    painelUploadArquivo;
String  painelUploadCaminho = "";
String  painelUploadErro = "";
size_t  painelUploadBytes = 0;
bool    painelUploadAutorizado = false;
bool    painelUploadFalhou = false;

// Sincronização entre Cores (Core 0 para NFC, Core 1 para Web)
SemaphoreHandle_t  travaDados;

// Informações do último cartão lido
String   ultimoUidLido = "";
String   ultimoNomeLido = "";
bool     ultimoCadastrado = false;
uint32_t ultimoSeq = 0;
uint32_t ultimoLidoMs = 0;
uint32_t ultimoVistoMs = 0;

bool     nfcOk = false;
bool     modoAP = false;
bool     ntpSincronizado = false;

// Controle de cor temporária do LED RGB
uint32_t ledTemporarioAte = 0;
uint8_t  ledTempR = 0, ledTempG = 0, ledTempB = 0;

#if PINO_SAIDA >= 0
bool     saidaLigada = false;
uint32_t saidaInicio = 0;
#endif

// =====================================================================
// Controle do LED RGB (WS2812B no GPIO 48)
// =====================================================================

void aplicarCorLed(uint8_t r, uint8_t g, uint8_t b) {
  rgb.setPixelColor(0, rgb.Color(r, g, b));
  rgb.show();
}

void acionarLedFeedback(uint8_t r, uint8_t g, uint8_t b, uint32_t duracaoMs) {
  ledTempR = r;
  ledTempG = g;
  ledTempB = b;
  ledTemporarioAte = millis() + duracaoMs;
  aplicarCorLed(r, g, b);
}

void atualizarLedStatus() {
  uint32_t agora = millis();

  // 1. Prioridade máxima: Feedback temporário de aproximação de cartão
  if (agora < ledTemporarioAte) {
    aplicarCorLed(ledTempR, ledTempG, ledTempB);
    return;
  }

  // 2. Alerta de Falha Crítica de Hardware: Leitor NFC Desconectado ou sem comunicação
  if (!nfcOk) {
    // Alerta estroboscópico âmbar/laranja de alta visibilidade (2 piscadas rápidas por segundo)
    uint32_t t = agora % 1000;
    if (t < 130 || (t > 240 && t < 370)) {
      aplicarCorLed(220, 45, 0); // Laranja/Vermelho vivo de alerta de cabo solto
    } else {
      aplicarCorLed(0, 0, 0);    // Apagado
    }
    return;
  }

  // 3. Alerta de Rede: Sem conexão Wi-Fi (desconectado ou tentando reconectar ao roteador)
  bool wifiConectado = (WiFi.status() == WL_CONNECTED);
  if (!modoAP && !wifiConectado) {
    // Amarelo/Âmbar pulsando: buscando sinal Wi-Fi
    uint32_t t = (agora / 6) % 100;
    uint8_t b = (t > 50) ? (100 - t) : t;
    aplicarCorLed(b * 2, b * 1.5, 0);
    return;
  }

  // 4. Tentando conectar a uma rede escolhida na pagina /wifi
  if (tentativaWifi.ativa) {
    uint32_t t = agora % 700;
    if (t < 350) {
      aplicarCorLed(0, 90, 255); // Azul piscando: conexao em andamento
    } else {
      aplicarCorLed(0, 0, 0);
    }
    return;
  }

  // 5. Modo Ponto de Acesso (Rede própria de emergência criada pela placa)
  if (modoAP) {
    // Roxo suave constante
    aplicarCorLed(40, 0, 50);
    return;
  }

  // 6. Estado Normal Operacional (Tudo 100% OK e Pronto para ler cartão):
  // Ciano / Azul-Turquesa suave respirando (padrão de catracas e totens de acesso)
  // Deixa o VERDE exclusivo e de alto impacto para quando o cartão for LIBERADO!
  uint32_t t = (agora / 20) % 100; // Ciclo suave de 2 segundos
  uint8_t brilho = 6 + ((t > 50) ? (100 - t) : t) / 3; // Oscila suavemente entre 6 e 22
  aplicarCorLed(0, brilho / 2, brilho); // Ciano suave (Turquesa em espera)
}

// =====================================================================
// Relógio e Data/Hora NTP (Horário de Brasília)
// =====================================================================

void iniciarNTP() {
  configTzTime("<-03>3", "pool.ntp.br", "time.google.com", "a.st1.ntp.br");
}

String obterDataHoraAtual() {
  struct tm infoTempo;
  if (!getLocalTime(&infoTempo, 50)) {
    return ""; // Sem sincronismo NTP ainda
  }
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%d/%m/%Y %H:%M:%S", &infoTempo);
  return String(buffer);
}

// =====================================================================
// Buffer Circular de Logs para o Console Serial Remoto (Web / Wi-Fi)
// =====================================================================
#define MAX_LOG_CONSOLE 100
struct LogEntry {
  uint32_t id;
  String   hora;
  String   msg;
  String   tipo; // "info", "ok", "err", "wa", "nfc"
};

LogEntry bufferLogs[MAX_LOG_CONSOLE];
int logIndexInicio = 0;
int logTotal = 0;
uint32_t logProximoId = 1;

void logSerial(const String& msg, const String& tipo = "info") {
  String hora = obterDataHoraAtual();
  if (hora.isEmpty()) {
    uint32_t s = millis() / 1000;
    char b[16];
    snprintf(b, sizeof(b), "%02u:%02u:%02u", (s / 3600) % 24, (s / 60) % 60, s % 60);
    hora = String(b);
  }

  int pos = (logIndexInicio + logTotal) % MAX_LOG_CONSOLE;
  if (logTotal < MAX_LOG_CONSOLE) {
    logTotal++;
  } else {
    logIndexInicio = (logIndexInicio + 1) % MAX_LOG_CONSOLE;
  }

  bufferLogs[pos].id = logProximoId++;
  bufferLogs[pos].hora = hora;
  bufferLogs[pos].msg = msg;
  bufferLogs[pos].tipo = tipo;

  Serial.printf("[%s] %s\n", hora.c_str(), msg.c_str());
}

// =====================================================================
// Utilitários de String e UID
// =====================================================================

String uidBytesParaTexto(const uint8_t* uid, uint8_t len) {
  String s;
  char b[4];
  for (uint8_t i = 0; i < len; i++) {
    snprintf(b, sizeof(b), "%02X", uid[i]);
    if (i > 0) s += ':';
    s += b;
  }
  return s;
}

String normalizarUid(String txt) {
  txt.toUpperCase();
  txt.replace("0X", "");
  String hexLimpo;
  for (size_t i = 0; i < txt.length(); i++) {
    char c = txt[i];
    if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')) {
      hexLimpo += c;
    }
  }
  if (hexLimpo.length() < 8 || hexLimpo.length() % 2 != 0) return "";
  String formatado;
  for (size_t i = 0; i < hexLimpo.length(); i += 2) {
    if (i > 0) formatado += ':';
    formatado += hexLimpo.substring(i, i + 2);
  }
  return formatado;
}

// =====================================================================
// Diagnóstico Detalhado da Flash e Montagem do Sistema de Arquivos
// =====================================================================

void imprimirDiagnosticoFlash() {
  Serial.println("\n--------------------------------------------------");
  Serial.println("  [DIAGNÓSTICO DA MEMÓRIA FLASH E PARTIÇÕES]      ");
  Serial.println("--------------------------------------------------");
  Serial.printf("  Chip Flash: %u MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("  PSRAM Total: %u MB\n", ESP.getPsramSize() / (1024 * 1024));
  Serial.println("  Tabela de Partições detectada na placa:");

  bool temSpiffs = false;
  bool temFat = false;

  esp_partition_iterator_t it = esp_partition_find(ESP_PARTITION_TYPE_ANY, ESP_PARTITION_SUBTYPE_ANY, NULL);
  if (!it) {
    Serial.println("  [AVISO] Nenhuma partição encontrada pelo bootloader.");
  } else {
    while (it != NULL) {
      const esp_partition_t *p = esp_partition_get(it);
      const char* tipoDesc = (p->type == ESP_PARTITION_TYPE_APP) ? "APP" : "DATA";
      
      Serial.printf("    - \"%s\" (Tipo: %s | Subtipo: 0x%02X | Tamanho: %u KB)\n",
                    p->label, tipoDesc, p->subtype, (uint32_t)(p->size / 1024));

      if (p->subtype == ESP_PARTITION_SUBTYPE_DATA_SPIFFS) temSpiffs = true;
      if (p->subtype == ESP_PARTITION_SUBTYPE_DATA_FAT) temFat = true;

      it = esp_partition_next(it);
    }
    esp_partition_iterator_release(it);
  }

  Serial.println("\n  Tentando montar o sistema de arquivos para os cartões...");

  // 1. Tenta montar LittleFS (se a partição for do tipo SPIFFS/LittleFS)
  if (LittleFS.begin(true)) {
    fsPtr = &LittleFS;
    nomeFsAtivo = "LittleFS";
    Serial.println("  [SUCESSO] Sistema LittleFS montado e pronto para uso!");
  } 
  // 2. Se falhar ou a partição for FATFS (ex: '16M Flash (3MB APP/9.9MB FATFS)'), tenta FFat
  else if (FFat.begin(true)) {
    fsPtr = &FFat;
    nomeFsAtivo = "FFat (FATFS)";
    Serial.println("  [SUCESSO] Partição FATFS detectada e montada com sucesso via FFat!");
  } 
  // 3. Se nenhuma deu certo, imprime instrução direta
  else {
    fsPtr = nullptr;
    nomeFsAtivo = "Indisponível";
    Serial.println("\n  [ERRO CRÍTICO] Não foi possível montar nem LittleFS nem FFat.");
    Serial.println("  Motivo provável: O esquema de partição selecionado na Arduino IDE não contém partição de dados.");
    Serial.println("  COMO RESOLVER EM 10 SEGUNDOS:");
    Serial.println("  1. No menu superior da Arduino IDE, vá em: Ferramentas -> Partition Scheme");
    Serial.println("  2. Selecione: 'Default 4MB with spiffs' OU '8M with spiffs' OU 'ESP SR 16M (3MB APP/6MB SPIFFS)'");
    Serial.println("  3. Clique novamente no botão de Upload.");
    Serial.println("--------------------------------------------------\n");
    return;
  }

  Serial.printf("  Sistema de arquivos ativo: %s\n", nomeFsAtivo);
  Serial.println("--------------------------------------------------\n");
}

bool salvarJsonNoArquivo(const char* caminho, const JsonDocument& doc) {
  if (!fsPtr) return false;
  File arq = fsPtr->open(caminho, "w");
  if (!arq) return false;
  serializeJson(doc, arq);
  arq.close();
  return true;
}

bool carregarJsonDoArquivo(const char* caminho, JsonDocument& doc) {
  if (!fsPtr || !fsPtr->exists(caminho)) return false;
  File arq = fsPtr->open(caminho, "r");
  if (!arq) return false;
  DeserializationError erro = deserializeJson(doc, arq);
  arq.close();
  return (erro == DeserializationError::Ok);
}

void inicializarArquivosDados() {
  imprimirDiagnosticoFlash();

  if (!fsPtr) {
    Serial.println("[AVISO] Gravacao na Flash desativada temporariamente ate ajustar a particao.");
    return;
  }

  garantirPastasPainel();

  // Verifica se o arquivo de cartões existe; caso contrário cria o padrão inicial
  if (!fsPtr->exists(ARQ_CARTOES)) {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    JsonObject c = arr.add<JsonObject>();
    c["uid"] = CARTAO_INICIAL_UID;
    c["nome"] = CARTAO_INICIAL_NOME;
    c["ativo"] = true;
    salvarJsonNoArquivo(ARQ_CARTOES, doc);
    Serial.println("[Flash] Arquivo cartoes.json inicializado com cartao padrao.");
  } else {
    Serial.println("[Flash] Arquivo cartoes.json carregado com sucesso.");
  }

  // Cria arquivo de histórico se não existir
  if (!fsPtr->exists(ARQ_HISTORICO)) {
    JsonDocument doc;
    doc.to<JsonArray>();
    salvarJsonNoArquivo(ARQ_HISTORICO, doc);
  }
}

void registrarAcessoNoHistorico(String uid, String nome, uint8_t res) {
  if (!fsPtr) return;
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_HISTORICO, doc);
  JsonArray arr = doc.as<JsonArray>();

  JsonObject novo = doc.createNestedObject();
  novo["uid"] = uid;
  novo["nome"] = nome;
  novo["res"] = res;
  String dh = obterDataHoraAtual();
  novo["dh"] = dh.isEmpty() ? "" : dh;
  novo["tempo"] = millis();

  arr.remove(novo);
  JsonDocument docNovo;
  JsonArray arrNovo = docNovo.to<JsonArray>();
  arrNovo.add(novo);
  for (size_t i = 0; i < arr.size() && arrNovo.size() < MAX_HISTORICO_LOG; i++) {
    arrNovo.add(arr[i]);
  }
  salvarJsonNoArquivo(ARQ_HISTORICO, docNovo);
}

// =====================================================================
// Saída (Relé / Fechadura)
// =====================================================================

void acionarSaidaFechadura() {
#if PINO_SAIDA >= 0
  digitalWrite(PINO_SAIDA, SAIDA_NIVEL_ATIVO);
  saidaLigada = true;
  saidaInicio = millis();
#endif
}

void atualizarSaidaFechadura() {
#if PINO_SAIDA >= 0
  if (saidaLigada && millis() - saidaInicio >= TEMPO_SAIDA_MS) {
    digitalWrite(PINO_SAIDA, !SAIDA_NIVEL_ATIVO);
    saidaLigada = false;
  }
#endif
}

// =====================================================================
// Lógica de Validação e Leitura NFC (Executada no Core 0)
// =====================================================================

bool iniciarPN532(bool verboso) {
  nfc.begin();
  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    if (verboso) {
      Serial.println("Erro: Modulo PN532 nao encontrado no I2C (pinos 8 e 9).");
      Serial.println("1. Verifique se Chave 1=ON e Chave 2=OFF no modulo.");
      Serial.println("2. Verifique se SDA esta no pino 8 e SCL no pino 9.");
    }
    return false;
  }
  if (verboso) {
    Serial.printf("PN532 Detectado! Firmware %d.%d\n", (versiondata >> 16) & 0xFF, (versiondata >> 8) & 0xFF);
  }
  nfc.SAMConfig();
  return true;
}

void processarLeituraNfc(String uidFormatado) {
  xSemaphoreTake(travaDados, portMAX_DELAY);

  ultimoUidLido = uidFormatado;
  ultimoLidoMs = millis();
  ultimoSeq++;

  bool encontrado = false;
  bool ativo = false;
  String nome = "";

  // Busca o cartão no arquivo JSON se a memória estiver disponível
  if (fsPtr) {
    JsonDocument doc;
    carregarJsonDoArquivo(ARQ_CARTOES, doc);
    JsonArray arr = doc.as<JsonArray>();

    for (JsonObject c : arr) {
      if (c["uid"].as<String>().equalsIgnoreCase(uidFormatado)) {
        encontrado = true;
        ativo = c["ativo"].as<bool>();
        nome = c["nome"].as<String>();
        break;
      }
    }
  } else {
    // Modo de segurança (se a Flash estiver com partição inválida, reconhece o cartão inicial)
    if (uidFormatado.equalsIgnoreCase(CARTAO_INICIAL_UID)) {
      encontrado = true;
      ativo = true;
      nome = CARTAO_INICIAL_NOME;
    }
  }

  ultimoCadastrado = encontrado;
  ultimoNomeLido = nome;

  uint8_t res = (!encontrado) ? 1 : (ativo ? 0 : 2); // 0=Liberado, 1=Nao cadastrado, 2=Bloqueado

  Serial.println("\n====================================");
  Serial.printf("Cartao Detectado: %s\n", uidFormatado.c_str());
  if (encontrado) Serial.printf("Titular: %s\n", nome.c_str());

  if (res == 0) {
    logSerial("ACESSO LIBERADO: " + nome + " [" + uidFormatado + "]", "ok");
    acionarLedFeedback(0, 255, 0, 1800); // LED Verde vibrante
    acionarSaidaFechadura();
  } else if (res == 2) {
    logSerial("ACESSO NEGADO (Bloqueado): " + nome + " [" + uidFormatado + "]", "err");
    acionarLedFeedback(255, 0, 0, 1800); // LED Vermelho
  } else {
    logSerial("ACESSO NEGADO (Nao Cadastrado): [" + uidFormatado + "]", "wa");
    acionarLedFeedback(255, 0, 0, 1800); // LED Vermelho
  }
  Serial.println("====================================");

  registrarAcessoNoHistorico(uidFormatado, nome, res);

  xSemaphoreGive(travaDados);
}

// Tarefa dedicada do Core 0 (FreeRTOS)
void tarefaNFC(void* parametro) {
  Serial.println("[Core 0] Tarefa do Leitor NFC em execucao.");
  uint8_t uidBuffer[10];
  uint8_t uidLength = 0;
  uint32_t ultimoHeartbeatNfc = 0;

  for (;;) {
    // 1. Se o módulo estiver desconectado, tenta reconectar periodicamente
    if (!nfcOk) {
      vTaskDelay(pdMS_TO_TICKS(1500));
      nfcOk = iniciarPN532(false);
      if (nfcOk) {
        Serial.println("\n[HARDWARE] Leitor NFC PN532 reconectado com sucesso!");
      }
      continue;
    }

    uint32_t agora = millis();

    // 2. Teste Ativo de Presença do Módulo (Heartbeat I2C a cada 2.5s)
    // Se o jumper SDA ou SCL for puxado, detecta a desconexão imediatamente
    if (agora - ultimoHeartbeatNfc >= 2500) {
      ultimoHeartbeatNfc = agora;
      uint32_t versao = nfc.getFirmwareVersion();
      if (!versao) {
        nfcOk = false;
        Serial.println("\n[ALERTA HARDWARE] Modulo PN532 parou de responder! Verifique os fios SDA (GPIO 8) e SCL (GPIO 9).");
        continue;
      }
    }

    // 3. Leitura passiva com timeout curto (50ms)
    bool detectado = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uidBuffer, &uidLength, 50);

    if (detectado && uidLength > 0 && uidLength <= 10) {
      ultimoHeartbeatNfc = millis(); // Se leu cartão, o hardware está 100% responsivo
      String uidStr = uidBytesParaTexto(uidBuffer, uidLength);
      agora = millis();

      // Evita disparar repetidas vezes enquanto o cartão continua encostado
      if (uidStr.equalsIgnoreCase(ultimoUidLido) && (agora - ultimoVistoMs < 2000)) {
        ultimoVistoMs = agora;
      } else {
        ultimoVistoMs = agora;
        processarLeituraNfc(uidStr);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// =====================================================================
// Servidor Web / API REST (Executado no Core 1)
// =====================================================================

bool autenticarRequisicao() {
  if (!server.authenticate(ADMIN_USUARIO, ADMIN_SENHA)) {
    server.requestAuthentication(BASIC_AUTH, "ESP32-S3 NFC");
    return false;
  }
  return true;
}

void responderJson(int codigo, const String& conteudo) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(codigo, "application/json; charset=utf-8", conteudo);
}

void responderErro(int codigo, const char* msg) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["erro"] = msg;
  String s;
  serializeJson(doc, s);
  responderJson(codigo, s);
}

void rotaPaginaPrincipal() {
  if (!autenticarRequisicao()) return;
  server.send_P(200, "text/html; charset=utf-8", PAGINA_HTML);
}

void rotaListarCartoes() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_CARTOES, doc);
  xSemaphoreGive(travaDados);
  String saida;
  serializeJson(doc, saida);
  responderJson(200, saida);
}

void rotaAdicionarCartao() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");

  String uid = normalizarUid(server.arg("uid"));
  if (uid.isEmpty()) return responderErro(400, "UID inválido! Digite em hexadecimal.");

  String nome = server.arg("nome");
  nome.trim();
  if (nome.isEmpty()) return responderErro(400, "Informe um nome/identificação!");

  bool ativo = (server.arg("ativo") != "0");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_CARTOES, doc);
  JsonArray arr = doc.as<JsonArray>();

  for (JsonObject c : arr) {
    if (c["uid"].as<String>().equalsIgnoreCase(uid)) {
      xSemaphoreGive(travaDados);
      return responderErro(409, "Este UID já está cadastrado!");
    }
  }

  JsonObject novo = arr.add<JsonObject>();
  novo["uid"] = uid;
  novo["nome"] = nome;
  novo["ativo"] = ativo;

  salvarJsonNoArquivo(ARQ_CARTOES, doc);
  xSemaphoreGive(travaDados);

  Serial.printf("[WEB] Cartao cadastrado: %s (%s)\n", uid.c_str(), nome.c_str());
  responderJson(201, "{\"ok\":true}");
}

void rotaAtualizarCartao() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");

  String uid = normalizarUid(server.arg("uid"));
  if (uid.isEmpty()) return responderErro(400, "UID inválido!");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_CARTOES, doc);
  JsonArray arr = doc.as<JsonArray>();

  JsonObject item;
  bool achou = false;
  for (JsonObject c : arr) {
    if (c["uid"].as<String>().equalsIgnoreCase(uid)) {
      item = c;
      achou = true;
      break;
    }
  }

  if (!achou) {
    xSemaphoreGive(travaDados);
    return responderErro(404, "Cartão não encontrado!");
  }

  if (server.hasArg("novo_uid")) {
    String nuid = normalizarUid(server.arg("novo_uid"));
    if (nuid.isEmpty()) {
      xSemaphoreGive(travaDados);
      return responderErro(400, "Novo UID inválido!");
    }
    for (JsonObject c : arr) {
      if (c["uid"].as<String>().equalsIgnoreCase(nuid) && !c["uid"].as<String>().equalsIgnoreCase(uid)) {
        xSemaphoreGive(travaDados);
        return responderErro(409, "Já existe outro cartão com esse novo UID!");
      }
    }
    item["uid"] = nuid;
  }

  if (server.hasArg("nome")) {
    String nome = server.arg("nome");
    nome.trim();
    if (nome.isEmpty()) {
      xSemaphoreGive(travaDados);
      return responderErro(400, "O nome não pode ficar vazio!");
    }
    item["nome"] = nome;
  }

  if (server.hasArg("ativo")) {
    item["ativo"] = (server.arg("ativo") != "0");
  }

  salvarJsonNoArquivo(ARQ_CARTOES, doc);
  xSemaphoreGive(travaDados);

  responderJson(200, "{\"ok\":true}");
}

void rotaExcluirCartao() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");

  String uid = normalizarUid(server.arg("uid"));
  if (uid.isEmpty()) return responderErro(400, "UID inválido!");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_CARTOES, doc);
  JsonArray arr = doc.as<JsonArray>();

  int indexRemover = -1;
  for (size_t i = 0; i < arr.size(); i++) {
    if (arr[i]["uid"].as<String>().equalsIgnoreCase(uid)) {
      indexRemover = i;
      break;
    }
  }

  if (indexRemover < 0) {
    xSemaphoreGive(travaDados);
    return responderErro(404, "Cartão não encontrado!");
  }

  arr.remove(indexRemover);
  salvarJsonNoArquivo(ARQ_CARTOES, doc);
  xSemaphoreGive(travaDados);

  Serial.printf("[WEB] Cartao removido: %s\n", uid.c_str());
  responderJson(200, "{\"ok\":true}");
}

void rotaDownloadBackup() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr || !fsPtr->exists(ARQ_CARTOES)) return responderErro(404, "Sem arquivo de cartões.");
  File arq = fsPtr->open(ARQ_CARTOES, "r");
  server.sendHeader("Content-Disposition", "attachment; filename=\"backup_cartoes_nfc.json\"");
  server.streamFile(arq, "application/json");
  arq.close();
}

void rotaRestaurarBackup() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");
  if (!server.hasArg("plain")) return responderErro(400, "Corpo da requisição vazio.");

  JsonDocument doc;
  DeserializationError erro = deserializeJson(doc, server.arg("plain"));
  if (erro != DeserializationError::Ok || !doc.is<JsonArray>()) {
    return responderErro(400, "Arquivo JSON inválido!");
  }

  xSemaphoreTake(travaDados, portMAX_DELAY);
  salvarJsonNoArquivo(ARQ_CARTOES, doc);
  xSemaphoreGive(travaDados);

  responderJson(200, "{\"ok\":true}");
}

// Sincronização individual em tempo real pelo Painel Web
void rotaSincronizarAluno() {
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");

  String uid = "";
  String nome = "";
  bool ativo = true;

  if (server.hasArg("plain")) {
    JsonDocument body;
    if (deserializeJson(body, server.arg("plain")) == DeserializationError::Ok) {
      uid = normalizarUid(body["uid"].as<String>());
      nome = body["nome"].as<String>();
      ativo = body["ativo"].as<bool>();
    }
  }

  if (uid.isEmpty()) {
    uid = normalizarUid(server.arg("uid"));
    nome = server.arg("nome");
    if (server.hasArg("ativo")) {
      ativo = (server.arg("ativo") != "0" && server.arg("ativo") != "false");
    }
  }

  if (uid.isEmpty()) return responderErro(400, "UID do cartão ausente!");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_CARTOES, doc);
  JsonArray arr = doc.as<JsonArray>();

  bool achou = false;
  for (JsonObject c : arr) {
    if (c["uid"].as<String>().equalsIgnoreCase(uid)) {
      c["ativo"] = ativo;
      if (!nome.isEmpty()) c["nome"] = nome;
      achou = true;
      break;
    }
  }

  if (!achou) {
    JsonObject novo = arr.add<JsonObject>();
    novo["uid"] = uid;
    novo["nome"] = nome.isEmpty() ? "Aluno" : nome;
    novo["ativo"] = ativo;
  }

  salvarJsonNoArquivo(ARQ_CARTOES, doc);
  xSemaphoreGive(travaDados);

  String logMsg = "[SYNC] Aluno " + (nome.isEmpty() ? uid : nome) + " atualizado para " + (ativo ? "LIBERADO" : "BLOQUEADO");
  logSerial(logMsg, ativo ? "ok" : "err");
  Serial.println(logMsg);

  responderJson(200, "{\"ok\":true}");
}

// Sincronização em lote: grava lista completa de alunos do Supabase na Flash
void rotaSincronizarTodosAlunos() {
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");
  if (!server.hasArg("plain")) return responderErro(400, "Corpo da requisição vazio.");

  JsonDocument doc;
  DeserializationError erro = deserializeJson(doc, server.arg("plain"));
  if (erro != DeserializationError::Ok || !doc.is<JsonArray>()) {
    return responderErro(400, "Array JSON de alunos inválido!");
  }

  xSemaphoreTake(travaDados, portMAX_DELAY);
  salvarJsonNoArquivo(ARQ_CARTOES, doc);
  xSemaphoreGive(travaDados);

  int total = doc.as<JsonArray>().size();
  String logMsg = "[SYNC] Base completa sincronizada: " + String(total) + " alunos na Flash.";
  logSerial(logMsg, "ok");
  Serial.println(logMsg);

  responderJson(200, "{\"ok\":true, \"total\":" + String(total) + "}");
}

// Remoção de aluno sincronizado da Flash
void rotaRemoverAlunoSincronizado() {
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");
  String uid = normalizarUid(server.arg("uid"));
  if (uid.isEmpty() && server.hasArg("plain")) {
    JsonDocument body;
    if (deserializeJson(body, server.arg("plain")) == DeserializationError::Ok) {
      uid = normalizarUid(body["uid"].as<String>());
    }
  }
  if (uid.isEmpty()) return responderErro(400, "UID ausente!");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_CARTOES, doc);
  JsonArray arr = doc.as<JsonArray>();

  int idx = -1;
  for (int i = 0; i < arr.size(); i++) {
    if (arr[i]["uid"].as<String>().equalsIgnoreCase(uid)) {
      idx = i;
      break;
    }
  }

  if (idx >= 0) {
    arr.remove(idx);
    salvarJsonNoArquivo(ARQ_CARTOES, doc);
  }
  xSemaphoreGive(travaDados);

  logSerial("[SYNC] Cartão removido da Flash: " + uid, "wa");
  responderJson(200, "{\"ok\":true}");
}

void rotaUltimoCartao() {
  // Rota de leitura pública para totens e portaria web na rede local
  JsonDocument doc;
  doc["nfc_ok"] = nfcOk;
  doc["seq"] = ultimoSeq;
  if (ultimoSeq > 0) {
    doc["uid"] = ultimoUidLido;
    doc["nome"] = ultimoNomeLido;
    doc["cadastrado"] = ultimoCadastrado;
    doc["ha"] = (millis() - ultimoLidoMs) / 1000;
  }
  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaObterLog() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderJson(200, "[]");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_HISTORICO, doc);
  xSemaphoreGive(travaDados);

  uint32_t agora = millis();
  JsonArray arr = doc.as<JsonArray>();
  for (JsonObject item : arr) {
    uint32_t tempo = item["tempo"].as<uint32_t>();
    item["ha"] = (agora >= tempo) ? (agora - tempo) / 1000 : 0;
  }

  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaLimparLog() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderJson(200, "{\"ok\":true}");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  JsonDocument doc;
  doc.to<JsonArray>();
  salvarJsonNoArquivo(ARQ_HISTORICO, doc);
  xSemaphoreGive(travaDados);
  responderJson(200, "{\"ok\":true}");
}

void rotaStatusSistema() {
  // Rota de telemetria pública para monitoramento do totem/portaria
  JsonDocument doc;
  doc["modo"] = modoAP ? "AP" : "STA";
  doc["ssid"] = modoAP ? AP_SSID : WiFi.SSID();
  doc["ip"] = (modoAP ? WiFi.softAPIP() : WiFi.localIP()).toString();
  doc["rssi"] = modoAP ? 0 : WiFi.RSSI();
  doc["ssid_salvo"] = wifiSsidSalvo;
  doc["tem_rede_salva"] = temRedeSalva;
  doc["clientes_ap"] = modoAP ? WiFi.softAPgetStationNum() : 0;
  doc["chip"] = ESP.getChipModel();
  doc["chip_revisao"] = ESP.getChipRevision();
  doc["chip_nucleos"] = ESP.getChipCores();
  doc["wifi_padrao"] = RADIO_WIFI_PADRAO;
  doc["wifi_faixas"] = RADIO_WIFI_FAIXAS;
  doc["bluetooth"] = RADIO_BLUETOOTH;
  doc["nfc"] = nfcOk;
  doc["psram"] = ESP.getPsramSize() / (1024 * 1024);
  doc["flash"] = ESP.getFlashChipSize() / (1024 * 1024);
  doc["fs"] = nomeFsAtivo;
  doc["uptime"] = millis() / 1000;
  doc["hora"] = obterDataHoraAtual();

  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

// =====================================================================
// Configuração de Wi-Fi pela Web (modo AP): NVS, varredura e conexão
// =====================================================================

#define NVS_WIFI_NAMESPACE "acesso_nfc_wifi"

// Lê as credenciais salvas. Retorna true se a placa já foi configurada alguma vez.
bool carregarCredenciaisWifi() {
  temConfigWifiSalva = false;
  temRedeSalva = false;
  wifiSsidSalvo = "";
  wifiSenhaSalva = "";

  if (!prefsWifi.begin(NVS_WIFI_NAMESPACE, true)) {
    logSerial("[WIFI] NVS indisponivel para leitura. Usando a rede definida no codigo.", "err");
    return false;
  }
  temConfigWifiSalva = prefsWifi.getBool("configurado", false);
  wifiSsidSalvo = prefsWifi.getString("ssid", "");
  wifiSenhaSalva = prefsWifi.getString("senha", "");
  prefsWifi.end();

  wifiSsidSalvo.trim();
  temRedeSalva = (temConfigWifiSalva && wifiSsidSalvo.length() > 0);
  return temConfigWifiSalva;
}

bool salvarCredenciaisWifi(const String& ssid, const String& senha) {
  if (!prefsWifi.begin(NVS_WIFI_NAMESPACE, false)) {
    logSerial("[WIFI] NVS indisponivel: credenciais nao foram salvas.", "err");
    return false;
  }
  prefsWifi.putString("ssid", ssid);
  prefsWifi.putString("senha", senha);
  prefsWifi.putBool("configurado", true);
  prefsWifi.end();

  wifiSsidSalvo = ssid;
  wifiSenhaSalva = senha;
  temConfigWifiSalva = true;
  temRedeSalva = (ssid.length() > 0);

  logSerial("[WIFI] Rede salva na memoria: " + ssid, "ok");
  return true;
}

// Grava "configurado" para o boot não semear de novo a rede do código-fonte.
bool esquecerCredenciaisWifi() {
  if (!prefsWifi.begin(NVS_WIFI_NAMESPACE, false)) {
    logSerial("[WIFI] NVS indisponivel: nao foi possivel esquecer a rede.", "err");
    return false;
  }
  prefsWifi.putString("ssid", "");
  prefsWifi.putString("senha", "");
  prefsWifi.putBool("configurado", true);
  prefsWifi.end();

  wifiSsidSalvo = "";
  wifiSenhaSalva = "";
  temConfigWifiSalva = true;
  temRedeSalva = false;

  logSerial("[WIFI] Rede esquecida. A placa voltara ao modo AP.", "wa");
  return true;
}

const char* nomeSegurancaWifi(wifi_auth_mode_t modo) {
  switch (modo) {
    case WIFI_AUTH_OPEN:            return "Aberta";
    case WIFI_AUTH_WEP:             return "WEP";
    case WIFI_AUTH_WPA_PSK:         return "WPA";
    case WIFI_AUTH_WPA2_PSK:        return "WPA2";
    case WIFI_AUTH_WPA_WPA2_PSK:    return "WPA/WPA2";
    case WIFI_AUTH_WPA3_PSK:        return "WPA3";
    case WIFI_AUTH_WPA2_WPA3_PSK:   return "WPA2/WPA3";
    case WIFI_AUTH_WAPI_PSK:        return "WAPI";
    default:                        return "Protegida";
  }
}

String motivoFalhaWifi(wl_status_t situacao) {
  switch (situacao) {
    case WL_NO_SSID_AVAIL:
      return "Rede nao encontrada. Confira o nome e se ela e de 2,4 GHz.";
    case WL_CONNECT_FAILED:
      return "Nao foi possivel conectar. A senha pode estar incorreta.";
    case WL_CONNECTION_LOST:
      return "A conexao caiu durante a tentativa. Verifique o sinal da rede.";
    default:
      return "Tempo esgotado sem resposta do roteador. Confira a senha e tente novamente.";
  }
}

// Monta o JSON da lista de redes (deduplicado por SSID, mais forte primeiro).
struct RedeWifiEncontrada {
  String      ssid;
  int32_t     rssi;
  uint8_t     canal;
  bool        aberta;
  const char* seguranca;
};

String montarRedesJson(int16_t total) {
  static RedeWifiEncontrada redes[MAX_REDES_JSON];
  uint16_t qtd = 0;

  for (int16_t i = 0; i < total; i++) {
    String ssid = WiFi.SSID(i);
    ssid.trim();
    if (ssid.isEmpty()) continue;

    int32_t rssi = WiFi.RSSI(i);
    bool repetida = false;
    for (uint16_t j = 0; j < qtd; j++) {
      if (redes[j].ssid == ssid) {
        repetida = true;
        if (rssi > redes[j].rssi) redes[j].rssi = rssi;
        break;
      }
    }
    if (repetida) continue;
    if (qtd >= MAX_REDES_JSON) break;

    wifi_auth_mode_t seg = WiFi.encryptionType(i);
    redes[qtd].ssid = ssid;
    redes[qtd].rssi = rssi;
    redes[qtd].canal = WiFi.channel(i);
    redes[qtd].aberta = (seg == WIFI_AUTH_OPEN);
    redes[qtd].seguranca = nomeSegurancaWifi(seg);
    qtd++;
  }

  // Ordenação por sinal (mais forte primeiro)
  for (uint16_t i = 1; i < qtd; i++) {
    RedeWifiEncontrada chave = redes[i];
    int16_t j = (int16_t)i - 1;
    while (j >= 0 && redes[j].rssi < chave.rssi) {
      redes[j + 1] = redes[j];
      j--;
    }
    redes[j + 1] = chave;
  }

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (uint16_t i = 0; i < qtd; i++) {
    JsonObject item = arr.add<JsonObject>();
    item["ssid"] = redes[i].ssid;
    item["rssi"] = redes[i].rssi;
    item["canal"] = redes[i].canal;
    item["aberta"] = redes[i].aberta;
    item["seguranca"] = redes[i].seguranca;
  }

  String saida;
  serializeJson(doc, saida);
  return saida;
}

// Entra no modo AP (STA ativo para permitir varredura) e sobe o portal cativo.
void entrarModoAP(const String& motivo) {
  modoAP = true;

  WiFi.disconnect(false, false);
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(AP_SSID, AP_SENHA)) {
    Serial.println("[WIFI] Falha ao criar a rede AP!");
  }

  if (!dnsServer.isUp() && !dnsServer.start()) {
    Serial.println("[WIFI] Falha ao iniciar o portal cativo (DNS).");
  }

  Serial.println();
  Serial.println("[WIFI] " + motivo);
  Serial.printf("  Rede de configuracao: %s\n", AP_SSID);
  Serial.printf("  Senha do AP: %s\n", AP_SENHA);
  Serial.printf("  Configure em: http://%s/wifi\n", WiFi.softAPIP().toString().c_str());

  logSerial("[WIFI] Modo AP ativo: " + String(AP_SSID) + " - configure em http://" + WiFi.softAPIP().toString() + "/wifi", "wa");
}

// Somente em modo AP a configuração fica aberta (o AP já exige senha WPA2).
bool autenticarWifi() {
  if (modoAP) return true;
  return autenticarRequisicao();
}

void redirecionarParaPortal() {
  if (!modoAP) {
    server.send(404, "text/plain", "Nao encontrado");
    return;
  }
  String destino = "http://" + WiFi.softAPIP().toString() + "/wifi";
  server.sendHeader("Location", destino);
  server.sendHeader("Cache-Control", "no-store");
  server.send(302, "text/plain", "Redirecionando para " + destino);
}

void rotaPaginaWifi() {
  if (!autenticarWifi()) return;
  server.sendHeader("Cache-Control", "no-store");
  server.send_P(200, "text/html; charset=utf-8", PAGINA_WIFI_HTML);
}

void rotaEstadoWifi() {
  if (!autenticarWifi()) return;

  JsonDocument doc;
  doc["modo"] = modoAP ? "AP" : "STA";
  doc["ssid_atual"] = modoAP ? String(AP_SSID) : WiFi.SSID();
  doc["ip"] = (modoAP ? WiFi.softAPIP() : WiFi.localIP()).toString();
  doc["rssi"] = (modoAP || WiFi.status() != WL_CONNECTED) ? 0 : WiFi.RSSI();
  doc["clientes_ap"] = modoAP ? WiFi.softAPgetStationNum() : 0;
  doc["tem_rede_salva"] = temRedeSalva;
  doc["ssid_salvo"] = wifiSsidSalvo;
  doc["status"] = (int)WiFi.status();
  doc["chip"] = ESP.getChipModel();
  doc["wifi_padrao"] = RADIO_WIFI_PADRAO;
  doc["wifi_faixas"] = RADIO_WIFI_FAIXAS;
  doc["bluetooth"] = RADIO_BLUETOOTH;

  JsonObject tentativa = doc["tentativa"].to<JsonObject>();
  tentativa["ativa"] = tentativaWifi.ativa;
  tentativa["ssid"] = tentativaWifi.ssid;
  tentativa["resultado"] = tentativaWifi.resultado;
  tentativa["motivo"] = tentativaWifi.motivo;
  tentativa["ip"] = wifiIpNovo;

  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaScanWifi() {
  if (!autenticarWifi()) return;

  bool forcar = server.hasArg("forcar") && server.arg("forcar") != "0";
  uint32_t agora = millis();
  bool cacheOk = scanCacheValido && !forcar && (agora - scanCacheMs) < SCAN_CACHE_MS;

  if (!cacheOk) {
    int16_t total = WiFi.scanNetworks(false, true, false, 120);
    if (total < 0) {
      scanCacheValido = false;
      logSerial("[WIFI] Varredura de redes falhou.", "err");
      return responderErro(502, "Nao foi possivel escanear as redes agora. Tente novamente.");
    }
    scanCacheJson = montarRedesJson(total);
    scanCacheMs = millis();
    scanCacheValido = true;
    WiFi.scanDelete();
    Serial.printf("[WEB] Varredura Wi-Fi: %d rede(s) encontrada(s).\n", total);
  }

  String s = "{\"ok\":true,\"scanning\":false,\"ts\":" + String(scanCacheMs) + ",\"redes\":" + scanCacheJson + "}";
  responderJson(200, s);
}

void finalizarTentativaWifi(wl_status_t situacao) {
  tentativaWifi.ativa = false;
  tentativaWifi.resultado = "falha";
  tentativaWifi.motivo = motivoFalhaWifi(situacao);
  tentativaWifi.senha = "";
  WiFi.disconnect(false, false);
  WiFi.setAutoReconnect(false);

  logSerial("[WIFI] Falha ao conectar em \"" + tentativaWifi.ssid + "\": " + tentativaWifi.motivo, "err");
  Serial.printf("[WIFI] Falha: %s\n", tentativaWifi.motivo.c_str());
}

void rotaConectarWifi() {
  if (!autenticarWifi()) return;

  if (!modoAP) {
    return responderErro(409, "A troca de rede pela web so esta disponivel no modo de configuracao (AP). Use 'Esquecer rede' e reconfigure.");
  }
  if (tentativaWifi.ativa) {
    return responderErro(409, "Ja existe uma tentativa de conexao em andamento. Aguarde.");
  }

  String ssid = "";
  String senha = "";

  if (server.hasArg("plain")) {
    JsonDocument body;
    if (deserializeJson(body, server.arg("plain")) == DeserializationError::Ok) {
      ssid = body["ssid"].as<String>();
      senha = body["senha"].as<String>();
    }
  }
  if (ssid.isEmpty() && server.hasArg("ssid")) {
    ssid = server.arg("ssid");
    senha = server.arg("senha");
  }

  ssid.trim();
  if (ssid.isEmpty() || ssid.length() > 32) {
    return responderErro(400, "Informe o nome (SSID) da rede Wi-Fi.");
  }
  if (ssid.equalsIgnoreCase(AP_SSID)) {
    return responderErro(400, "Essa e a rede de configuracao da propria placa. Escolha a rede do roteador.");
  }
  if (!senha.isEmpty() && (senha.length() < 8 || senha.length() > 63)) {
    return responderErro(400, "A senha deve ter entre 8 e 63 caracteres (ou ficar vazia para rede aberta).");
  }

  if (!(WiFi.getMode() & WIFI_STA)) {
    WiFi.mode(WIFI_AP_STA);
  }
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);

  tentativaWifi.ativa = true;
  tentativaWifi.ssid = ssid;
  tentativaWifi.senha = senha;
  tentativaWifi.inicio = millis();
  tentativaWifi.falhasSeguidas = 0;
  tentativaWifi.resultado = "";
  tentativaWifi.motivo = "";
  wifiIpNovo = "";

  wl_status_t situacao = WiFi.begin(ssid.c_str(), senha.c_str());
  if (situacao == WL_CONNECT_FAILED) {
    finalizarTentativaWifi(situacao);
    return responderErro(500, motivoFalhaWifi(situacao).c_str());
  }

  logSerial("[WIFI] Tentando conectar a \"" + ssid + "\"...", "info");
  responderJson(202, "{\"ok\":true,\"iniciado\":true}");
}

void rotaEsquecerWifi() {
  if (!autenticarWifi()) return;

  tentativaWifi.ativa = false;
  tentativaWifi.senha = "";
  tentativaWifi.resultado = "";
  tentativaWifi.motivo = "";

  if (!esquecerCredenciaisWifi()) {
    return responderErro(500, "Nao foi possivel gravar na memoria NVS.");
  }

  responderJson(200, "{\"ok\":true}");
  wifiReiniciarEm = millis() + 1500;
}

// Executada no Core 1 (loop): acompanha a tentativa e agenda o reinício.
void processarTentativaWifi() {
  if (wifiReiniciarEm && millis() >= wifiReiniciarEm) {
    wifiReiniciarEm = 0;
    Serial.println("[SISTEMA] Reiniciando para aplicar a configuracao de Wi-Fi...");
    delay(150);
    ESP.restart();
  }

  if (!tentativaWifi.ativa) return;

  static uint32_t ultimaChecagem = 0;
  if (millis() - ultimaChecagem < 400) return;
  ultimaChecagem = millis();

  wl_status_t situacao = WiFi.status();

  if (situacao == WL_CONNECTED) {
    salvarCredenciaisWifi(tentativaWifi.ssid, tentativaWifi.senha);
    tentativaWifi.ativa = false;
    tentativaWifi.resultado = "ok";
    tentativaWifi.motivo = "";
    tentativaWifi.senha = "";
    wifiIpNovo = WiFi.localIP().toString();
    WiFi.setAutoReconnect(true);
    modoAP = false;
    acionarLedFeedback(0, 255, 0, 3000);
    logSerial("[WIFI] Conectado a \"" + tentativaWifi.ssid + "\" - IP " + wifiIpNovo, "ok");
    wifiReiniciarEm = millis() + 4000;
    return;
  }

  uint32_t decorrido = millis() - tentativaWifi.inicio;
  bool erroTerminal = (situacao == WL_NO_SSID_AVAIL || situacao == WL_CONNECT_FAILED || situacao == WL_CONNECTION_LOST);

  if (erroTerminal) {
    tentativaWifi.falhasSeguidas++;
    if (decorrido >= 3000 && tentativaWifi.falhasSeguidas >= 3) {
      finalizarTentativaWifi(situacao);
      return;
    }
  } else {
    tentativaWifi.falhasSeguidas = 0;
  }

  if (decorrido >= WIFI_TIMEOUT_TENTATIVA_MS) {
    finalizarTentativaWifi(situacao);
  }
}

// =====================================================================
// Rotas do Console Serial Remoto e Atualização OTA
// =====================================================================

void rotaConsoleWeb() {
  if (!autenticarRequisicao()) return;
  server.send_P(200, "text/html; charset=utf-8", PAGINA_CONSOLE_HTML);
}

void rotaObterLogsConsole() {
  if (!autenticarRequisicao()) return;
  uint32_t desde = server.hasArg("desde") ? server.arg("desde").toInt() : 0;

  JsonDocument doc;
  doc["uptime"] = millis() / 1000;
  doc["nfc"] = nfcOk;
  doc["ip"] = (modoAP ? WiFi.softAPIP() : WiFi.localIP()).toString();

  JsonArray arr = doc["logs"].to<JsonArray>();

  for (int i = 0; i < logTotal; i++) {
    int idx = (logIndexInicio + i) % MAX_LOG_CONSOLE;
    if (bufferLogs[idx].id > desde) {
      JsonObject item = arr.add<JsonObject>();
      item["id"] = bufferLogs[idx].id;
      item["hora"] = bufferLogs[idx].hora;
      item["msg"] = bufferLogs[idx].msg;
      item["tipo"] = bufferLogs[idx].tipo;
    }
  }

  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaComandoConsole() {
  if (!autenticarRequisicao()) return;
  String cmd = server.arg("cmd");
  cmd.trim();
  cmd.toLowerCase();

  String resposta = "";

  if (cmd == "ping_nfc") {
    uint32_t v = nfc.getFirmwareVersion();
    if (v) {
      resposta = "PN532 Ativo! Firmware " + String((v >> 16) & 0xFF) + "." + String((v >> 8) & 0xFF);
      logSerial(resposta, "ok");
    } else {
      resposta = "FALHA: PN532 nao respondeu no I2C (Pinos 8 e 9)";
      logSerial(resposta, "err");
    }
  } else if (cmd == "status") {
    resposta = "IP: " + (modoAP ? WiFi.softAPIP() : WiFi.localIP()).toString() +
               " | RSSI: " + String(WiFi.RSSI()) + " dBm" +
               " | Heap: " + String(ESP.getFreeHeap() / 1024) + " KB" +
               " | PSRAM: " + String(ESP.getFreePsram() / 1024) + " KB";
    logSerial(resposta, "info");
  } else if (cmd == "limpar") {
    logTotal = 0;
    logIndexInicio = 0;
    resposta = "Logs de memoria limpos.";
    logSerial(resposta, "wa");
  } else if (cmd == "reboot") {
    logSerial("[SISTEMA] Reiniciando ESP32 por comando remoto...", "err");
    responderJson(200, "{\"ok\":true, \"msg\":\"Reiniciando placa em 1 segundo...\"}");
    delay(1000);
    ESP.restart();
    return;
  } else {
    resposta = "Comando desconhecido: " + cmd;
  }

  JsonDocument doc;
  doc["ok"] = true;
  doc["msg"] = resposta;
  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaPaginaOta() {
  if (!autenticarRequisicao()) return;
  server.send_P(200, "text/html; charset=utf-8", PAGINA_OTA_HTML);
}

void rotaOtaFinalizar() {
  if (!autenticarRequisicao()) return;
  server.sendHeader("Connection", "close");
  server.send(200, "text/plain", (Update.hasError()) ? "FALHA" : "OK");
  delay(1000);
  ESP.restart();
}

void rotaOtaUpload() {
  HTTPUpload& upload = server.upload();
  if (upload.status == UPLOAD_FILE_START) {
    logSerial("[OTA] Iniciando gravacao de firmware: " + upload.filename, "wa");
    uint32_t maxSpace = (ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000;
    if (!Update.begin(maxSpace, U_FLASH)) {
      Update.printError(Serial);
      logSerial("[OTA] Erro no Update.begin: " + String(Update.errorString()), "err");
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
      Update.printError(Serial);
      logSerial("[OTA] Erro no Update.write", "err");
    }
  } else if (upload.status == UPLOAD_FILE_END) {
    if (Update.end(true)) {
      logSerial("[OTA] Gravacao concluida com sucesso! " + String(upload.totalSize) + " bytes.", "ok");
    } else {
      Update.printError(Serial);
      logSerial("[OTA] Erro no Update.end: " + String(Update.errorString()), "err");
    }
  }
}

// =====================================================================
// Painel web completo servido pela placa (LittleFS)
// =====================================================================

String mimeDoPainel(const String& caminho) {
  int ponto = caminho.lastIndexOf('.');
  String ext = ponto >= 0 ? caminho.substring(ponto + 1) : "";
  ext.toLowerCase();

  if (ext == "html") return "text/html; charset=utf-8";
  if (ext == "css")  return "text/css; charset=utf-8";
  if (ext == "js" || ext == "mjs") return "text/javascript; charset=utf-8";
  if (ext == "json" || ext == "map") return "application/json; charset=utf-8";
  if (ext == "svg")  return "image/svg+xml";
  if (ext == "png")  return "image/png";
  if (ext == "jpg" || ext == "jpeg") return "image/jpeg";
  if (ext == "webp") return "image/webp";
  if (ext == "ico")  return "image/x-icon";
  if (ext == "woff") return "font/woff";
  if (ext == "woff2") return "font/woff2";
  return "application/octet-stream";
}

String normalizarCaminhoPainel(String valor, bool permitirIndex) {
  int interrogacao = valor.indexOf('?');
  if (interrogacao >= 0) valor = valor.substring(0, interrogacao);
  valor.trim();

  if (valor == "/painel" || valor == "/painel/") {
    return permitirIndex ? String("/painel/index.html") : String("");
  }
  if (!valor.startsWith("/painel/")) return "";
  if (valor.indexOf("..") >= 0 || valor.indexOf('\\') >= 0) return "";
  return valor;
}

void garantirPastasPainel() {
  if (!fsPtr) return;
  fsPtr->mkdir("/painel");
  fsPtr->mkdir("/painel/js");
  fsPtr->mkdir("/painel/js/lib");
  fsPtr->mkdir("/painel/js/services");
}

bool servirArquivoPainel(const String& uri) {
  if (!fsPtr) {
    server.send(503, "text/plain; charset=utf-8", "Memoria Flash indisponivel.");
    return true;
  }

  String caminho = normalizarCaminhoPainel(uri, true);
  if (caminho.isEmpty()) {
    server.send(400, "text/plain; charset=utf-8", "Caminho invalido.");
    return true;
  }

  String envio = caminho;
  bool usarGzip = false;
  String aceita = server.header("Accept-Encoding");
  if (aceita.indexOf("gzip") >= 0 && fsPtr->exists((caminho + ".gz").c_str())) {
    envio = caminho + ".gz";
    usarGzip = true;
  }

  if (!fsPtr->exists(envio.c_str())) {
    server.send(404, "text/plain; charset=utf-8",
                "Painel ainda nao enviado. Rode: npm run painel:deploy");
    return true;
  }

  File arquivo = fsPtr->open(envio.c_str(), "r");
  if (!arquivo) {
    server.send(500, "text/plain; charset=utf-8", "Falha ao abrir o arquivo do painel.");
    return true;
  }

  if (usarGzip) server.sendHeader("Content-Encoding", "gzip");
  server.sendHeader("Vary", "Accept-Encoding");
  // O painel e atualizado por upload; sem cache evita rodar JS antigo.
  server.sendHeader("Cache-Control", "no-store, max-age=0");
  String tipo = mimeDoPainel(caminho);
  server.streamFile(arquivo, tipo.c_str());
  arquivo.close();
  return true;
}

void rotaPainelSemBarra() {
  server.sendHeader("Location", "/painel/");
  server.sendHeader("Cache-Control", "no-store");
  server.send(302, "text/plain", "Redirecionando para /painel/");
}

void rotaUploadPainelFinal() {
  if (!painelUploadAutorizado) {
    server.requestAuthentication(BASIC_AUTH, "ESP32-S3 NFC");
    return;
  }

  if (painelUploadFalhou) {
    String resposta = String("{\"ok\":false,\"erro\":\"") + painelUploadErro + "\"}";
    server.send(400, "application/json; charset=utf-8", resposta);
    return;
  }

  String resposta = String("{\"ok\":true,\"bytes\":") + String(painelUploadBytes) + "}";
  server.send(200, "application/json; charset=utf-8", resposta);
}

void rotaUploadPainelArquivo() {
  HTTPUpload& upload = server.upload();

  if (upload.status == UPLOAD_FILE_START) {
    painelUploadAutorizado = server.authenticate(ADMIN_USUARIO, ADMIN_SENHA);
    painelUploadFalhou = false;
    painelUploadErro = "";
    painelUploadBytes = 0;
    painelUploadCaminho = "";

    if (!painelUploadAutorizado) return;

    if (!fsPtr) {
      painelUploadFalhou = true;
      painelUploadErro = "Flash indisponivel";
      return;
    }

    String destino = normalizarCaminhoPainel(server.arg("path"), false);
    if (destino.isEmpty()) {
      painelUploadFalhou = true;
      painelUploadErro = "path invalido";
      return;
    }

    garantirPastasPainel();
    painelUploadCaminho = destino + ".tmp";
    if (fsPtr->exists(painelUploadCaminho.c_str())) fsPtr->remove(painelUploadCaminho.c_str());
    painelUploadArquivo = fsPtr->open(painelUploadCaminho.c_str(), "w");
    if (!painelUploadArquivo) {
      painelUploadFalhou = true;
      painelUploadErro = "falha ao criar arquivo temporario";
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (!painelUploadAutorizado || painelUploadFalhou) return;

    if (painelUploadBytes + upload.currentSize > PAINEL_MAX_ARQUIVO) {
      painelUploadFalhou = true;
      painelUploadErro = "arquivo maior que 512 KB";
      if (painelUploadArquivo) painelUploadArquivo.close();
      if (fsPtr && fsPtr->exists(painelUploadCaminho.c_str())) fsPtr->remove(painelUploadCaminho.c_str());
      return;
    }

    if (!painelUploadArquivo ||
        painelUploadArquivo.write(upload.buf, upload.currentSize) != upload.currentSize) {
      painelUploadFalhou = true;
      painelUploadErro = "falha ao gravar na Flash";
      if (painelUploadArquivo) painelUploadArquivo.close();
      if (fsPtr && fsPtr->exists(painelUploadCaminho.c_str())) fsPtr->remove(painelUploadCaminho.c_str());
      return;
    }
    painelUploadBytes += upload.currentSize;
  } else if (upload.status == UPLOAD_FILE_END) {
    if (!painelUploadAutorizado) return;
    if (painelUploadArquivo) painelUploadArquivo.close();

    if (!painelUploadFalhou && !painelUploadCaminho.isEmpty()) {
      String destino = painelUploadCaminho;
      destino.remove(destino.length() - 4); // remove ".tmp"
      if (fsPtr->exists(destino.c_str())) fsPtr->remove(destino.c_str());
      if (!fsPtr->rename(painelUploadCaminho.c_str(), destino.c_str())) {
        painelUploadFalhou = true;
        painelUploadErro = "falha ao renomear o arquivo";
      }
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    if (painelUploadArquivo) painelUploadArquivo.close();
    if (fsPtr && !painelUploadCaminho.isEmpty() && fsPtr->exists(painelUploadCaminho.c_str())) {
      fsPtr->remove(painelUploadCaminho.c_str());
    }
    painelUploadFalhou = true;
    painelUploadErro = "upload abortado";
  }
}

void configurarRotasServidor() {
  // Necessário para ler Accept-Encoding e servir os .gz do painel.
  static const char* CABECALHOS_PAINEL[] = {"Accept-Encoding"};
  server.collectHeaders(CABECALHOS_PAINEL, 1);

  server.on("/",              HTTP_GET,    rotaPaginaPrincipal);

  // Painel web completo servido pela placa (mesma origem da API).
  server.on("/painel",        HTTP_GET,    rotaPainelSemBarra);
  server.on("/painel/",       HTTP_GET,    []() { servirArquivoPainel("/painel/"); });
  server.on("/api/painel/upload", HTTP_POST, rotaUploadPainelFinal, rotaUploadPainelArquivo);

  server.on("/api/cartoes",   HTTP_GET,    rotaListarCartoes);
  server.on("/api/cartoes",   HTTP_POST,   rotaAdicionarCartao);
  server.on("/api/cartoes",   HTTP_PUT,    rotaAtualizarCartao);
  server.on("/api/cartoes",   HTTP_DELETE, rotaExcluirCartao);
  server.on("/api/backup",    HTTP_GET,    rotaDownloadBackup);
  server.on("/api/restaurar", HTTP_POST,   rotaRestaurarBackup);
  server.on("/api/sincronizar_aluno", HTTP_POST, rotaSincronizarAluno);
  server.on("/api/sincronizar_todos", HTTP_POST, rotaSincronizarTodosAlunos);
  server.on("/api/remover_aluno",     HTTP_POST, rotaRemoverAlunoSincronizado);
  server.on("/api/ultimo",    HTTP_GET,    rotaUltimoCartao);
  server.on("/api/log",       HTTP_GET,    rotaObterLog);
  server.on("/api/log",       HTTP_DELETE, rotaLimparLog);
  server.on("/api/status",    HTTP_GET,    rotaStatusSistema);
  server.on("/wifi",               HTTP_GET,  rotaPaginaWifi);
  server.on("/api/wifi/estado",    HTTP_GET,  rotaEstadoWifi);
  server.on("/api/wifi/scan",      HTTP_GET,  rotaScanWifi);
  server.on("/api/wifi/conectar",  HTTP_POST, rotaConectarWifi);
  server.on("/api/wifi/esquecer",  HTTP_POST, rotaEsquecerWifi);

  // Sondagens de portal cativo (Android, iOS e Windows) caem na página /wifi
  server.on("/generate_204",            HTTP_GET, redirecionarParaPortal);
  server.on("/gen_204",                 HTTP_GET, redirecionarParaPortal);
  server.on("/hotspot-detect.html",     HTTP_GET, redirecionarParaPortal);
  server.on("/library/test/success.html", HTTP_GET, redirecionarParaPortal);
  server.on("/connecttest.txt",         HTTP_GET, redirecionarParaPortal);
  server.on("/ncsi.txt",                HTTP_GET, redirecionarParaPortal);
  server.on("/success.txt",             HTTP_GET, redirecionarParaPortal);
  server.on("/canonical.html",          HTTP_GET, redirecionarParaPortal);
  server.on("/redirect",                HTTP_GET, redirecionarParaPortal);
  server.on("/console",       HTTP_GET,    rotaConsoleWeb);
  server.on("/api/logs",      HTTP_GET,    rotaObterLogsConsole);
  server.on("/api/comando",   HTTP_POST,   rotaComandoConsole);
  server.on("/ota",           HTTP_GET,    rotaPaginaOta);
  server.on("/atualizar",     HTTP_GET,    rotaPaginaOta);
  server.on("/api/ota",       HTTP_POST,   rotaOtaFinalizar, rotaOtaUpload);
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) {
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.sendHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      server.sendHeader("Access-Control-Allow-Headers", "*");
      server.send(204);
      return;
    }

    // Arquivos estáticos do painel (/painel/style.css, /painel/js/app.js...).
    if (server.method() == HTTP_GET && server.uri().startsWith("/painel/")) {
      servirArquivoPainel(server.uri());
      return;
    }
    // No modo AP, qualquer endereço desconhecido (menos a API) leva ao portal de configuração
    if (modoAP && !server.uri().startsWith("/api/")) {
      String destino = "http://" + WiFi.softAPIP().toString() + "/wifi";
      server.sendHeader("Location", destino);
      server.sendHeader("Cache-Control", "no-store");
      server.send(302, "text/plain", "Redirecionando para " + destino);
      return;
    }
    server.send(404, "text/plain", "Nao encontrado");
  });
}

// =====================================================================
// Inicialização do Wi-Fi
// =====================================================================

void iniciarConexaoWiFi() {
  // O core do ESP32 não deve guardar credenciais por conta própria: quem manda é a NVS do sistema.
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.setHostname(HOSTNAME);

  carregarCredenciaisWifi();

  String ssidConexao = wifiSsidSalvo;
  String senhaConexao = wifiSenhaSalva;
  bool tentarConectar = true;

  if (!temConfigWifiSalva) {
    // Primeira inicialização: usa as constantes do código como semente (mantém unidades antigas funcionando).
    ssidConexao = WIFI_SSID;
    senhaConexao = WIFI_SENHA;
    Serial.println("[WIFI] Nenhuma rede salva na memoria. Usando a rede definida no codigo.");
  } else if (ssidConexao.isEmpty()) {
    tentarConectar = false;
    Serial.println("[WIFI] Nenhuma rede configurada. Iniciando direto no modo AP.");
  }

  if (tentarConectar) {
    ssidConexao.trim();
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssidConexao.c_str(), senhaConexao.c_str());

    Serial.printf("Conectando ao Wi-Fi \"%s\"", ssidConexao.c_str());
    aplicarCorLed(0, 0, 50); // Azul suave

    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TIMEOUT_BOOT_MS) {
      delay(250);
      Serial.print('.');
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      modoAP = false;
      WiFi.setAutoReconnect(true);
      if (!temConfigWifiSalva) {
        salvarCredenciaisWifi(ssidConexao, senhaConexao);
      }
      Serial.print("Conectado com sucesso! IP: http://");
      Serial.println(WiFi.localIP());
      logSerial("[WIFI] Conectado a rede \"" + ssidConexao + "\" - IP " + WiFi.localIP().toString(), "ok");
      iniciarNTP();
    } else {
      entrarModoAP("Wi-Fi \"" + ssidConexao + "\" nao encontrado ou senha incorreta.");
    }
  } else {
    entrarModoAP("Modo de configuracao ativado (nenhuma rede salva).");
  }

  if (MDNS.begin(HOSTNAME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("Disponivel na rede: http://%s.local\n", HOSTNAME);
  }
}

// =====================================================================
// SETUP & LOOP (Core 1)
// =====================================================================

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 2500) delay(10);

  Serial.println("\n==========================================");
  Serial.println("  Controle de Acesso NFC - ESP32-S3 N16R8 ");
  Serial.println("==========================================");

  // Inicializa LED RGB no GPIO 48
  rgb.begin();
  rgb.setBrightness(45);
  aplicarCorLed(0, 30, 60);

  travaDados = xSemaphoreCreateMutex();

#if PINO_SAIDA >= 0
  pinMode(PINO_SAIDA, OUTPUT);
  digitalWrite(PINO_SAIDA, !SAIDA_NIVEL_ATIVO);
#endif

  // Executa diagnóstico detalhado e monta LittleFS ou FFat
  inicializarArquivosDados();

  // Inicia I2C no ESP32-S3 (pinos 8 e 9)
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setTimeOut(50); // Timeout para evitar travamento se os fios do leitor soltarem
  nfcOk = iniciarPN532(true);

  iniciarConexaoWiFi();
  configurarRotasServidor();
  server.begin();

  // Cria a tarefa de leitura do NFC no CORE 0
  xTaskCreatePinnedToCore(
    tarefaNFC,
    "Tarefa_NFC",
    4096,
    NULL,
    1,
    NULL,
    0
  );

  Serial.println("\nSistema operacional! Aproxime uma tag NFC...");
}

void loop() {
  server.handleClient();
  dnsServer.processNextRequest(); // portal cativo (sem efeito fora do modo AP)
  processarTentativaWifi();
  atualizarSaidaFechadura();
  atualizarLedStatus();
  delay(2);
}
