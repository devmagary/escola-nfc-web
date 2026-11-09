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
#include <string.h>
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

// Sensor Biométrico Óptico AS608 / FPM10A / DY50 via UART1 (Opcional / Híbrido)
// Pino 1 (VCC) -> 3.3V | Pino 2 (TX) -> GPIO 18 | Pino 3 (RX) -> GPIO 17 | Pino 4 (GND) -> GND
#define BIO_RX_PIN  18
#define BIO_TX_PIN  17
#define BIO_BAUD    57600

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

// Versão desta build de diagnóstico (aparece em /api/status e /api/diagnostico).
#define FW_VERSAO "2.1.3"

// Watchdog do leitor: sem nenhuma leitura por 15 min, tenta um reinício
// completo (que também cobre corredor vazio, sem custo perceptível); no
// máximo uma tentativa a cada 10 min para não ciclar.
#define NFC_WATCHDOG_OCIOSO_MS    (15UL * 60UL * 1000UL)
#define NFC_WATCHDOG_INTERVALO_MS (10UL * 60UL * 1000UL)

// Limiares do diagnóstico de desempenho (ms). Eventos acima disso são
// registrados no buffer circular e, com rate-limit, no console.
#define DIAG_LIMIAR_LOOP_MS  50
#define DIAG_LIMIAR_HTTP_MS  80
#define DIAG_LIMIAR_NFC_MS   50
#define DIAG_LIMIAR_FS_MS    25
#define MAX_EVENTOS_DIAG     32

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

// Cache da varredura de redes exibida na página /wifi.
// Invariante: estes campos são tocados SOMENTE pelo Core 1 (loop + rotas HTTP).
String   scanCacheJson   = "[]";
uint32_t scanCacheMs     = 0;
bool     scanCacheValido = false;
// Varredura assíncrona: a página consulta /api/wifi/scan até scanning=false.
// Só é permitida no modo AP (em STA a rede já está escolhida e trocar exige
// "Esquecer rede"), então o servidor web nunca fica 2,8 s bloqueado.
bool     wifiScanEmAndamento = false;
uint32_t wifiScanInicioMs = 0;

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
bool    otaUploadAutorizado = false;

// Sincronização entre Cores (Core 0 para NFC, Core 1 para Web)
SemaphoreHandle_t  travaDados;
SemaphoreHandle_t  travaLog = nullptr;
SemaphoreHandle_t  travaDiag = nullptr;
// Protege o "último cartão" (Strings escritas no Core 0 e lidas pelo Core 1).
SemaphoreHandle_t  travaUltimo = nullptr;
// Protege o estado textual do cadastro biométrico (Strings escritas no Core 0
// e lidas/alteradas pelas rotas HTTP no Core 1).
SemaphoreHandle_t  travaBio = nullptr;
// Evita que uma gravação na SPI flash comece no meio de uma transação I2C do
// PN532: gravar na flash desliga o cache para os DOIS núcleos, e a transação
// interrompida podia deixar o módulo sem responder até o próximo reset.
SemaphoreHandle_t  travaNfcFlash = nullptr;

// Dono único do barramento I2C/PN532: somente a tarefa NFC (Core 0) fala com o
// módulo. O Core 1 apenas registra um pedido de diagnóstico e lê o resultado
// publicado, evitando que duas tarefas intercalem comando/resposta do PN532.
enum PedidoNfc : uint8_t { NFC_SEM_PEDIDO = 0, NFC_PEDIR_PING = 1 };
SemaphoreHandle_t  travaResultadoNfc = nullptr;
volatile uint8_t   pedidoNfcPendente = NFC_SEM_PEDIDO;
volatile uint32_t  pedidoNfcSeq = 0;
volatile uint32_t  pedidoNfcAtendido = 0;
String             resultadoPedidoNfc = "";

// Diagnóstico de desempenho / engasgos.
struct EventoDiag {
  uint32_t    ms;
  uint32_t    durMs;
  const char* tipo;
  char        detalhe[72];
  uint32_t    heap;
  int16_t     rssi;
};

EventoDiag bufferDiag[MAX_EVENTOS_DIAG];
int        diagIndex = 0;
int        diagTotal = 0;
volatile uint32_t diagLoopMaxMs = 0;
volatile uint32_t diagLoopSomaMs = 0;
volatile uint32_t diagLoopAmostras = 0;
volatile uint32_t diagHttpMaxMs = 0;
volatile uint32_t diagNfcMaxMs = 0;
volatile uint32_t diagFsMaxMs = 0;
volatile uint32_t diagEngasgos = 0;
volatile uint32_t diagUltimoLoopMs = 0;
volatile uint32_t diagUltimoLogMs = 0;
volatile uint32_t diagNfcStackMin = 0;
// Tempo da última validação de cartão (leitura do PN532 + consulta em RAM).
volatile uint32_t nfcUltimaDuracaoMs = 0;
uint32_t diagUltimoHeartbeatMs = 0;

// Informações do último cartão lido
String   ultimoUidLido = "";
String   ultimoNomeLido = "";
bool     ultimoCadastrado = false;
uint32_t ultimoSeq = 0;
uint32_t ultimoLidoMs = 0;
uint32_t ultimoVistoMs = 0;

bool     nfcOk = false;
bool     bioOk = false;
String   ultimoMetodoLido = "nfc";
uint16_t ultimoBioIdLido = 0;

// Máquina de estados para cadastro de biometria (Core 0 <-> API HTTP Core 1)
volatile bool     bioCadastroAtivo = false;
volatile uint16_t bioCadastroId = 0;
String            bioCadastroEtapa = "inativo";
String            bioCadastroMsg = "";
uint32_t          bioCadastroInicioMs = 0;

// Exclusão de modelo biométrico: a UART1 pertence à tarefa NFC (Core 0), então
// a rota HTTP apenas enfileira o pedido e aguarda o resultado publicado.
volatile bool     bioExcluirPendente = false;
volatile bool     bioExcluirPronto = false;
volatile uint16_t bioExcluirId = 0;
volatile int      bioExcluirResultado = -1;

// Copia/define o estado textual do cadastro sob travaBio (Strings não são
// seguras para escrita e leitura simultâneas em núcleos diferentes).
void bioDefinirEtapa(const String& etapa, const String& msg) {
  if (travaBio) xSemaphoreTake(travaBio, portMAX_DELAY);
  bioCadastroEtapa = etapa;
  bioCadastroMsg = msg;
  if (travaBio) xSemaphoreGive(travaBio);
}

String bioEtapaAtual() {
  String etapa;
  if (travaBio) xSemaphoreTake(travaBio, portMAX_DELAY);
  etapa = bioCadastroEtapa;
  if (travaBio) xSemaphoreGive(travaBio);
  return etapa;
}

void bioCopiarEstado(String& etapa, String& msg) {
  if (travaBio) xSemaphoreTake(travaBio, portMAX_DELAY);
  etapa = bioCadastroEtapa;
  msg = bioCadastroMsg;
  if (travaBio) xSemaphoreGive(travaBio);
}

bool     modoAP = false;
bool     ntpSincronizado = false;
// Só o Core 0 (tarefa NFC) mexe neste contador.
uint8_t  falhasHeartbeatNfc = 0;

// Recuperação do leitor. O PN532 pode ficar "zumbi" após uma reconexão: responde
// ao GetFirmwareVersion (LED azul normal) mas não lê cartão. Contadores e
// pedidos usados pelo watchdog, pelo console e pelo /api/status.
volatile bool pedidoReinicioNfc = false; // solicitado pelo Core 1 (console/página)
uint32_t nfcReinicios = 0;               // reinícios completos executados
uint32_t nfcReconexoes = 0;              // reconexões bem-sucedidas após queda
uint32_t nfcUltimoReinicioMs = 0;
uint32_t nfcUltimaLeituraMs = 0;
bool     nfcSamOk = false;               // último SAMConfig (arma o RF)

// Controle de cor temporária do LED RGB
// volatile: o Core 0 (NFC) escreve e o Core 1 (loop/servidor) lê.
volatile uint32_t ledTemporarioAte = 0;
volatile uint8_t  ledTempR = 0, ledTempG = 0, ledTempB = 0;

#if PINO_SAIDA >= 0
bool     saidaLigada = false;
uint32_t saidaInicio = 0;
#endif

// =====================================================================
// Controle do LED RGB (WS2812B no GPIO 48)
// =====================================================================

void aplicarCorLed(uint8_t r, uint8_t g, uint8_t b) {
  // O WS2812 desliga interrupções durante o envio. Antes isto rodava a cada
  // iteração do loop (~500x/s) mesmo com a cor repetida; agora só envia quando
  // a cor muda e no máximo ~30x por segundo (suficiente para a respiração).
  static uint8_t  ultimoR = 255, ultimoG = 255, ultimoB = 255;
  static uint32_t ultimoEnvioMs = 0;

  if (r == ultimoR && g == ultimoG && b == ultimoB) return;
  uint32_t agora = millis();
  if (agora - ultimoEnvioMs < 33) return;

  ultimoR = r;
  ultimoG = g;
  ultimoB = b;
  ultimoEnvioMs = agora;
  rgb.setPixelColor(0, rgb.Color(r, g, b));
  rgb.show();
}

void acionarLedFeedback(uint8_t r, uint8_t g, uint8_t b, uint32_t duracaoMs) {
  ledTempR = r;
  ledTempG = g;
  ledTempB = b;
  ledTemporarioAte = millis() + duracaoMs;
  // A aplicação no WS2812 fica somente no Core 1 (atualizarLedStatus),
  // evitando chamadas concorrentes de rgb.show() nos dois núcleos.
}

void atualizarLedStatus() {
  uint32_t agora = millis();

  // 1. Prioridade máxima: Feedback temporário de aproximação de cartão
  if (agora < ledTemporarioAte) {
    aplicarCorLed(ledTempR, ledTempG, ledTempB);
    return;
  }

  // 2. Alerta de Falha Crítica de Hardware: Leitor NFC Desconectado ou sem comunicação
  if (!nfcOk && !bioOk) {
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
  // Timeout 0: só consulta o relógio. Com 50 ms esta função esperava o SNTP
  // sincronizar e bloqueava até 50 ms em cada log (causa dos "engasgos").
  if (!getLocalTime(&infoTempo, 0)) {
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
  bool travado = false;
  if (travaLog) travado = (xSemaphoreTake(travaLog, portMAX_DELAY) == pdTRUE);

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
  if (travado) xSemaphoreGive(travaLog);
}

// Registra um evento lento no buffer circular e (com rate-limit) no console.
// Não usar dentro de travaLog/travaDiag: esta função adquire travaDiag e
// chama logSerial.
void registrarEventoDiag(const char* tipo, uint32_t durMs, const String& detalhe) {
  uint32_t agora = millis();

  if (travaDiag) xSemaphoreTake(travaDiag, portMAX_DELAY);
  EventoDiag& evento = bufferDiag[(diagIndex + diagTotal) % MAX_EVENTOS_DIAG];
  evento.ms = agora;
  evento.durMs = durMs;
  evento.tipo = tipo;
  strncpy(evento.detalhe, detalhe.c_str(), sizeof(evento.detalhe) - 1);
  evento.detalhe[sizeof(evento.detalhe) - 1] = '\0';
  evento.heap = ESP.getFreeHeap();
  evento.rssi = (int16_t)WiFi.RSSI();
  if (diagTotal < MAX_EVENTOS_DIAG) {
    diagTotal++;
  } else {
    diagIndex = (diagIndex + 1) % MAX_EVENTOS_DIAG;
  }
  if (travaDiag) xSemaphoreGive(travaDiag);

  // Evita que um problema persistente inunde o console e piore o engasgo.
  if (agora - diagUltimoLogMs < 1500) return;
  diagUltimoLogMs = agora;

  char linha[180];
  snprintf(linha, sizeof(linha), "%s lento: %lu ms | heap %lu | RSSI %d | %s",
           tipo, (unsigned long)durMs, (unsigned long)ESP.getFreeHeap(),
           WiFi.RSSI(), detalhe.c_str());
  const char* nivel = "info";
  if (strcmp(tipo, "LOOP") == 0) nivel = "err";
  else if (strcmp(tipo, "FS") == 0 || strcmp(tipo, "HTTP") == 0) nivel = "wa";
  logSerial(String("[DIAG] ") + linha, nivel);
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

  // Monta primeiro a partição que realmente existe na placa. Antes o código
  // chamava LittleFS.begin(true) sempre (mesmo sem partição "spiffs"), o que
  // imprimia o erro "partition spiffs could not be found" a cada boot e, em
  // caso de falha, FORMATAVA a flash sem perguntar. Agora tenta montar sem
  // formatar e só formata como último recurso, avisando no console.
  auto montarFs = [&](bool usarLittleFs) -> bool {
    if (usarLittleFs) {
      if (LittleFS.begin(false)) { fsPtr = &LittleFS; nomeFsAtivo = "LittleFS"; return true; }
      Serial.println("  [AVISO] LittleFS nao montou; os dados atuais NAO foram apagados.");
      Serial.println("  [AVISO] Tentando formatar a particao LittleFS (dados anteriores serao perdidos)...");
      if (LittleFS.begin(true)) { fsPtr = &LittleFS; nomeFsAtivo = "LittleFS (formatado)"; return true; }
      return false;
    }
    if (FFat.begin(false)) { fsPtr = &FFat; nomeFsAtivo = "FFat (FATFS)"; return true; }
    Serial.println("  [AVISO] FATFS nao montou; os dados atuais NAO foram apagados.");
    Serial.println("  [AVISO] Tentando formatar a particao FATFS (dados anteriores serao perdidos)...");
    if (FFat.begin(true)) { fsPtr = &FFat; nomeFsAtivo = "FFat (FATFS formatado)"; return true; }
    return false;
  };

  bool montou = false;
  if (temFat && !temSpiffs) {
    montou = montarFs(false);
  } else if (temSpiffs && !temFat) {
    montou = montarFs(true);
  } else {
    montou = montarFs(true) || montarFs(false);
  }

  if (montou) {
    Serial.println("  [SUCESSO] Partição de dados montada com sucesso!");
    Serial.printf("  Sistema de arquivos ativo: %s\n", nomeFsAtivo);
    Serial.println("--------------------------------------------------\n");
    return;
  }

  // Nenhuma partição de dados montou: imprime instrução direta
  fsPtr = nullptr;
  nomeFsAtivo = "Indisponível";
  Serial.println("\n  [ERRO CRÍTICO] Não foi possível montar nem LittleFS nem FFat.");
  Serial.println("  Motivo provável: O esquema de partição selecionado na Arduino IDE não contém partição de dados.");
  Serial.println("  COMO RESOLVER EM 10 SEGUNDOS:");
  Serial.println("  1. No menu superior da Arduino IDE, vá em: Ferramentas -> Partition Scheme");
  Serial.println("  2. Selecione: 'Default 4MB with spiffs' OU '8M with spiffs' OU 'ESP SR 16M (3MB APP/6MB SPIFFS)'");
  Serial.println("  3. Clique novamente no botão de Upload.");
  Serial.println("--------------------------------------------------\n");
}

bool salvarJsonNoArquivo(const char* caminho, const JsonDocument& doc) {
  if (!fsPtr) return false;
  uint32_t inicio = micros();

  if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
  bool gravou = false;
  File arq = fsPtr->open(caminho, "w");
  if (arq) {
    serializeJson(doc, arq);
    arq.close();
    gravou = true;
  }
  if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);

  if (!gravou) return false;

  uint32_t durMs = (micros() - inicio) / 1000;
  if (durMs > diagFsMaxMs) diagFsMaxMs = durMs;
  if (durMs >= DIAG_LIMIAR_FS_MS) registrarEventoDiag("FS", durMs, String("gravar ") + caminho);
  return true;
}

bool carregarJsonDoArquivo(const char* caminho, JsonDocument& doc) {
  if (!fsPtr || !fsPtr->exists(caminho)) return false;
  uint32_t inicio = micros();
  File arq = fsPtr->open(caminho, "r");
  if (!arq) return false;
  DeserializationError erro = deserializeJson(doc, arq);
  arq.close();

  uint32_t durMs = (micros() - inicio) / 1000;
  if (durMs > diagFsMaxMs) diagFsMaxMs = durMs;
  if (durMs >= DIAG_LIMIAR_FS_MS) registrarEventoDiag("FS", durMs, String("ler ") + caminho);
  return (erro == DeserializationError::Ok);
}

// =====================================================================
// Cache em RAM de cartões e histórico (na PSRAM, que ficava ociosa)
//
// Antes, CADA aproximação de cartão lia cartoes.json da flash e o histórico
// era lido+reescrito inteiro. Com a base sincronizada do Supabase isso vira
// centenas de ms por leitura, segurando a trava de dados. Agora a flash só é
// tocada no boot e nas alterações; a validação do cartão é uma busca em RAM.
// =====================================================================

struct CartaoRam {
  char     uid[40];   // UID de 10 bytes formatado ("AA:..:JJ") ocupa 29 caracteres
  char     nome[128];
  bool     ativo;
  uint16_t bio_id;
};

struct HistoricoRam {
  char     uid[40];
  char     nome[128];
  char     dh[24];
  uint32_t tempo;
  uint8_t  res;
};

CartaoRam*   cartoesRam = nullptr;
uint16_t     cartoesRamTotal = 0;
uint16_t     cartoesRamCapacidade = 0;
bool         cartoesRamValido = false;

HistoricoRam* historicoRam = nullptr;
uint16_t      historicoRamTotal = 0;
bool          historicoSujo = false;
uint32_t      historicoUltimaGravacaoMs = 0;
uint32_t      historicoUltimoEventoMs = 0; // último cartão: grava só quando o fluxo parar
uint32_t      historicoSeqGerado = 0; // detecta eventos novos durante a gravação

void* alocarRamPreferindoPsram(size_t bytes) {
  void* p = nullptr;
  if (ESP.getPsramSize() > 0) p = ps_malloc(bytes);
  if (!p) p = malloc(bytes);
  return p;
}

// (Re)constrói o índice de cartões a partir de um documento já carregado.
bool indiceDoDocumento(JsonDocument& doc) {
  JsonArray arr = doc.as<JsonArray>();
  uint16_t necessario = (uint16_t)arr.size() + 8;

  // A capacidade só cresce: cadastrar/remover um cartão não realoca a lista
  // inteira a cada edição. Se faltar memória, mantém o ponteiro antigo e marca
  // o índice como inválido (a validação volta a ler a flash, que já foi gravada).
  if (necessario > cartoesRamCapacidade) {
    CartaoRam* novo = (CartaoRam*)alocarRamPreferindoPsram(sizeof(CartaoRam) * necessario);
    if (!novo) {
      cartoesRamValido = false;
      Serial.println("[RAM] Sem memoria para o indice de cartoes; mantendo a leitura da Flash.");
      return false;
    }
    if (cartoesRam) free(cartoesRam);
    cartoesRam = novo;
    cartoesRamCapacidade = necessario;
  }

  cartoesRamTotal = 0;
  for (JsonObject c : arr) {
    if (cartoesRamTotal >= cartoesRamCapacidade) break;
    CartaoRam& item = cartoesRam[cartoesRamTotal++];
    strlcpy(item.uid, c["uid"].as<String>().c_str(), sizeof(item.uid));
    strlcpy(item.nome, c["nome"].as<String>().c_str(), sizeof(item.nome));
    item.ativo = c["ativo"].as<bool>();
    item.bio_id = c["bio_id"] | 0;
  }
  cartoesRamValido = true;
  return true;
}

bool reconstruirIndiceCartoes() {
  if (!fsPtr) { cartoesRamValido = false; return false; }
  JsonDocument doc;
  if (!carregarJsonDoArquivo(ARQ_CARTOES, doc)) { cartoesRamValido = false; return false; }
  return indiceDoDocumento(doc);
}

// Busca sem tocar na flash. Retorna false se o UID não estiver cadastrado.
bool consultarCartaoRam(const String& uid, bool* ativo, String* nome) {
  if (!cartoesRamValido || !cartoesRam) return false;
  for (uint16_t i = 0; i < cartoesRamTotal; i++) {
    if (strcasecmp(cartoesRam[i].uid, uid.c_str()) == 0) {
      if (ativo) *ativo = cartoesRam[i].ativo;
      if (nome) *nome = cartoesRam[i].nome;
      return true;
    }
  }
  return false;
}

void garantirHistoricoRam() {
  if (historicoRam) return;
  // Se a alocação falhar, evita tentar de novo a cada cartão (backoff de 60 s).
  static uint32_t ultimaTentativaMs = 0;
  if (ultimaTentativaMs != 0 && millis() - ultimaTentativaMs < 60000) return;
  ultimaTentativaMs = millis();

  historicoRam = (HistoricoRam*)alocarRamPreferindoPsram(sizeof(HistoricoRam) * MAX_HISTORICO_LOG);
  if (!historicoRam) {
    Serial.println("[RAM] Sem memoria para o historico; voltando a gravar direto na Flash.");
  }
}

void carregarHistoricoRam() {
  garantirHistoricoRam();
  if (!historicoRam || !fsPtr) return;
  historicoRamTotal = 0;

  JsonDocument doc;
  if (!carregarJsonDoArquivo(ARQ_HISTORICO, doc)) return;
  JsonArray arr = doc.as<JsonArray>();
  for (JsonObject item : arr) {
    if (historicoRamTotal >= MAX_HISTORICO_LOG) break;
    HistoricoRam& h = historicoRam[historicoRamTotal++];
    strlcpy(h.uid, item["uid"].as<String>().c_str(), sizeof(h.uid));
    strlcpy(h.nome, item["nome"].as<String>().c_str(), sizeof(h.nome));
    strlcpy(h.dh, item["dh"].as<String>().c_str(), sizeof(h.dh));
    h.tempo = item["tempo"].as<uint32_t>();
    h.res = item["res"].as<uint8_t>();
  }
}

// Insere no início da lista circular (mais novo primeiro), sem gravar na flash.
void adicionarHistoricoRam(const String& uid, const String& nome, uint8_t res) {
  if (!historicoRam) {
    garantirHistoricoRam();
    if (!historicoRam) return;
    // A RAM passou a existir agora: traz o histórico que estava na flash para
    // não sobrescrevê-lo com um único evento na próxima gravação.
    carregarHistoricoRam();
  }

  uint16_t total = historicoRamTotal;
  if (total < MAX_HISTORICO_LOG) total++;
  // Desloca o bloco de uma vez (memmove trata a sobreposição; o loop copiava
  // struct por struct a cada leitura de cartão/digital).
  if (total > 1) {
    memmove(&historicoRam[1], &historicoRam[0], (size_t)(total - 1) * sizeof(HistoricoRam));
  }

  HistoricoRam& h = historicoRam[0];
  strlcpy(h.uid, uid.c_str(), sizeof(h.uid));
  strlcpy(h.nome, nome.c_str(), sizeof(h.nome));
  String dh = obterDataHoraAtual();
  strlcpy(h.dh, dh.c_str(), sizeof(h.dh));
  h.tempo = millis();
  h.res = res;

  historicoRamTotal = total;
  historicoSeqGerado++;
  historicoSujo = true;
  historicoUltimoEventoMs = millis();
  if (historicoUltimaGravacaoMs == 0) historicoUltimaGravacaoMs = millis();
}

// Grava o histórico no máximo a cada 1,5 s (agrupa acessos seguidos e poupa a
// flash). Roda no Core 1; a cópia é feita sob a trava de dados.
void gravarHistoricoInterno(bool forcar) {
  if (!historicoSujo || !historicoRam || !fsPtr) return;
  if (!forcar) {
    // Espera o "movimento" acabar: um cartão isolado ou uma fila de alunos vira
    // UMA gravação (386 ms cada nesta flash), e não uma por cartão.
    if (millis() - historicoUltimoEventoMs < 3000) return;
    if (millis() - historicoUltimaGravacaoMs < 1500) return;
  }

  JsonDocument doc;
  uint32_t seqDaCopia;

  xSemaphoreTake(travaDados, portMAX_DELAY);
  seqDaCopia = historicoSeqGerado;
  JsonArray arr = doc.to<JsonArray>();
  for (uint16_t i = 0; i < historicoRamTotal; i++) {
    JsonObject item = arr.add<JsonObject>();
    item["uid"] = historicoRam[i].uid;
    item["nome"] = historicoRam[i].nome;
    item["res"] = historicoRam[i].res;
    item["dh"] = historicoRam[i].dh;
    item["tempo"] = historicoRam[i].tempo;
  }
  xSemaphoreGive(travaDados);

  bool gravou = salvarJsonNoArquivo(ARQ_HISTORICO, doc);

  // Só considera "limpo" se a gravação deu certo E nenhum evento novo entrou
  // enquanto o arquivo era escrito. Antes o flag caía antes da gravação, então
  // uma falha de FS perdia os eventos daquela janela para sempre.
  xSemaphoreTake(travaDados, portMAX_DELAY);
  if (gravou && historicoSeqGerado == seqDaCopia) historicoSujo = false;
  xSemaphoreGive(travaDados);

  historicoUltimaGravacaoMs = millis();
}

// Chamado pelo loop: respeita a janela de 1,5 s.
void gravarHistoricoSePreciso() {
  gravarHistoricoInterno(false);
}

// Usado antes de reiniciar: não perde os últimos acessos da janela de 1,5 s.
void gravarHistoricoAgora() {
  gravarHistoricoInterno(true);
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

  // Carrega uma vez para a PSRAM: daqui em diante a leitura de cartão e a
  // listagem do histórico não tocam mais na flash.
  reconstruirIndiceCartoes();
  carregarHistoricoRam();
  String resumoRam = "[RAM] Indice de cartoes: " + String(cartoesRamTotal) +
                     " | historico: " + String(historicoRamTotal) + " evento(s)";
  Serial.println(resumoRam);
  logSerial(resumoRam, "info"); // aparece também no console web (/console)
}

void registrarAcessoNoHistorico(String uid, String nome, uint8_t res) {
  if (!fsPtr) return;
  garantirHistoricoRam();
  if (historicoRam) {
    adicionarHistoricoRam(uid, nome, res);
    return;
  }

  // Fallback sem RAM (PSRAM/heap esgotados): grava direto na flash.
  JsonDocument doc;
  carregarJsonDoArquivo(ARQ_HISTORICO, doc);

  // doc.as<JsonArray>() fica nulo se o arquivo ainda não existe ou está corrompido.
  JsonArray arr = doc.is<JsonArray>() ? doc.as<JsonArray>() : doc.to<JsonArray>();

  // Monta a lista nova (evento atual primeiro) diretamente num documento
  // separado. O código anterior anexava o objeto ao array carregado e depois o
  // removia (createNestedObject + arr.remove); funcionava, mas dependia de API
  // obsoleta e fazia duas cópias. Assim fica direto e sem ambiguidade.
  JsonDocument docNovo;
  JsonArray arrNovo = docNovo.to<JsonArray>();

  JsonObject novo = arrNovo.add<JsonObject>();
  novo["uid"] = uid;
  novo["nome"] = nome;
  novo["res"] = res;
  String dh = obterDataHoraAtual();
  novo["dh"] = dh.isEmpty() ? "" : dh;
  novo["tempo"] = millis();

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

// Libera um barramento I2C preso: o PN532 pode segurar SDA em LOW depois de uma
// transação interrompida. São 9 pulsos de clock + STOP, o procedimento padrão.
void recuperarBarramentoI2C() {
  pinMode(SDA_PIN, INPUT_PULLUP);
  pinMode(SCL_PIN, OUTPUT);
  digitalWrite(SCL_PIN, HIGH);
  delayMicroseconds(5);
  for (int i = 0; i < 9; i++) {
    digitalWrite(SCL_PIN, LOW);
    delayMicroseconds(5);
    digitalWrite(SCL_PIN, HIGH);
    delayMicroseconds(5);
  }
  pinMode(SDA_PIN, OUTPUT);
  digitalWrite(SDA_PIN, LOW);
  delayMicroseconds(5);
  digitalWrite(SCL_PIN, HIGH);
  delayMicroseconds(5);
  digitalWrite(SDA_PIN, HIGH);
  delayMicroseconds(5);
  pinMode(SDA_PIN, INPUT_PULLUP);
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setTimeOut(50);
}

bool iniciarPN532(bool verboso) {
  nfc.begin();
  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    if (verboso) {
      Serial.println("Erro: Modulo PN532 nao encontrado no I2C (pinos 8 e 9).");
      Serial.println("1. Verifique se Chave 1=ON e Chave 2=OFF no modulo.");
      Serial.println("2. Verifique se SDA esta no pino 8 e SCL no pino 9.");
    }
    nfcSamOk = false;
    return false;
  }
  if (verboso) {
    Serial.printf("PN532 Detectado! Firmware %d.%d\n", (versiondata >> 16) & 0xFF, (versiondata >> 8) & 0xFF);
  }
  // O SAMConfig arma o campo de RF. Guardamos o resultado para o diagnóstico e
  // para o reinício completo exigir versão + SAM (o boot continua aceitando só
  // a versão, para não marcar como ausente um módulo que responde).
  bool samOk = false;
  for (uint8_t tentativa = 0; tentativa < 3 && !samOk; tentativa++) {
    samOk = nfc.SAMConfig();
    if (!samOk) delay(80);
  }
  nfcSamOk = samOk;
  if (verboso && !samOk) {
    Serial.println("Aviso: PN532 respondeu a versao, mas o SAMConfig falhou (RF pode nao armar).");
  }
  return true;
}

// Reinício completo do leitor, replicando o que o boot faz. O caminho antigo
// chamava Wire.begin() sem Wire.end() e aceitava o módulo apenas pela versão:
// depois de reconectar o sensor ele podia responder ao GetFirmwareVersion mas
// não ler cartão (estado "zumbi"). Aqui o barramento é fechado, recuperado e
// reaberto; a versão é conferida com retries e o SAMConfig (que arma o RF)
// precisa passar para o leitor ser considerado saudável.
bool reiniciarLeitorCompleto(bool verboso) {
  if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);

  Wire.end();
  delay(30);
  recuperarBarramentoI2C(); // wiggle de 9 clocks + Wire.begin + timeout

  nfc.begin();              // Adafruit: RST (GPIO5, se ligado) + Wire.begin

  bool versaoOk = false;
  for (uint8_t tentativa = 0; tentativa < 3 && !versaoOk; tentativa++) {
    if (nfc.getFirmwareVersion()) versaoOk = true;
    else delay(150);
  }

  bool samOk = false;
  if (versaoOk) {
    for (uint8_t tentativa = 0; tentativa < 3 && !samOk; tentativa++) {
      samOk = nfc.SAMConfig();
      if (!samOk) delay(150);
    }
  }

  nfcSamOk = samOk;
  nfcUltimoReinicioMs = millis();
  nfcReinicios++;
  if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);

  if (verboso) {
    Serial.printf("[NFC] reinicio completo: versao=%s sam=%s (total %lu)\n",
                  versaoOk ? "ok" : "falhou",
                  samOk ? "ok" : "falhou",
                  (unsigned long)nfcReinicios);
  }
  return versaoOk && samOk;
}

void processarLeituraNfc(String uidFormatado) {
  uint32_t inicioUs = micros();

  // O "último cartão" é lido pelo Core 1 (/api/ultimo): Strings exigem trava.
  xSemaphoreTake(travaUltimo, portMAX_DELAY);
  ultimoUidLido = uidFormatado;
  ultimoMetodoLido = "nfc";
  ultimoBioIdLido = 0;
  ultimoLidoMs = millis();
  ultimoSeq++;
  xSemaphoreGive(travaUltimo);

  xSemaphoreTake(travaDados, portMAX_DELAY);

  bool encontrado = false;
  bool ativo = false;
  String nome = "";

  // Mede apenas a busca: travessia do índice em RAM (ou, no fallback raro, a
  // leitura da flash). A espera pelas travas e o log/histórico ficam de fora.
  uint32_t inicioBuscaUs = micros();

  // Busca no índice em RAM (sem tocar na flash). Se o índice não pôde ser
  // montado, cai no caminho antigo lendo o arquivo.
  if (cartoesRamValido) {
    encontrado = consultarCartaoRam(uidFormatado, &ativo, &nome);
  } else if (fsPtr) {
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

  xSemaphoreTake(travaUltimo, portMAX_DELAY);
  ultimoCadastrado = encontrado;
  ultimoNomeLido = nome;
  xSemaphoreGive(travaUltimo);

  // Com o cache ativo fica em 0-1 ms mesmo com a base inteira de alunos.
  uint32_t durValidacaoMs = (micros() - inicioBuscaUs) / 1000;
  nfcUltimaDuracaoMs = durValidacaoMs;

  uint8_t res = (!encontrado) ? 1 : (ativo ? 0 : 2); // 0=Liberado, 1=Nao cadastrado, 2=Bloqueado

  // Só o histórico precisa da trava de dados; libera antes de montar Strings.
  registrarAcessoNoHistorico(uidFormatado, nome, res);

  xSemaphoreGive(travaDados);

  String tempoValidacao = " | validacao " + String(durValidacaoMs) + " ms";
  String msgLog;
  const char* nivelLog = "wa";
  if (res == 0) {
    msgLog = "ACESSO LIBERADO: " + nome + " [" + uidFormatado + "]" + tempoValidacao;
    nivelLog = "ok";
    acionarLedFeedback(0, 255, 0, 1800); // LED Verde vibrante
    acionarSaidaFechadura();
  } else if (res == 2) {
    msgLog = "ACESSO NEGADO (Bloqueado): " + nome + " [" + uidFormatado + "]" + tempoValidacao;
    nivelLog = "err";
    acionarLedFeedback(255, 0, 0, 1800); // LED Vermelho
  } else {
    msgLog = "ACESSO NEGADO (Nao Cadastrado): [" + uidFormatado + "]" + tempoValidacao;
    acionarLedFeedback(255, 0, 0, 1800); // LED Vermelho
  }

  // Log fora da trava de dados: não acopla a ordem travaDados -> travaLog
  // (evita inversão futura) e encurta o tempo com o mutex ocupado.
  Serial.println("\n====================================");
  Serial.printf("Cartao Detectado: %s\n", uidFormatado.c_str());
  if (encontrado) Serial.printf("Titular: %s\n", nome.c_str());
  Serial.println("====================================");

  logSerial(msgLog, nivelLog);

  uint32_t durMs = (micros() - inicioUs) / 1000;
  if (durMs > diagNfcMaxMs) diagNfcMaxMs = durMs;
  if (durMs >= DIAG_LIMIAR_NFC_MS) {
    registrarEventoDiag("NFC", durMs, String("cartao ") + uidFormatado);
  }
}

// Publica o resultado do diagnóstico para o Core 1 (que apenas lê, sob trava).
void publicarResultadoNfc(const String& texto, uint32_t pedidoConcluido) {
  if (travaResultadoNfc) xSemaphoreTake(travaResultadoNfc, portMAX_DELAY);
  resultadoPedidoNfc = texto;
  if (travaResultadoNfc) xSemaphoreGive(travaResultadoNfc);
  pedidoNfcAtendido = pedidoConcluido;
  // Só limpa o pedido se nenhum outro chegou enquanto este era atendido.
  if (pedidoNfcSeq == pedidoConcluido) pedidoNfcPendente = NFC_SEM_PEDIDO;
}

// Executa o pedido de diagnóstico no Core 0, que é o único dono do I2C.
// Pode levar ~1 s (varredura); nunca roda no Core 1 junto com a leitura.
void atenderPedidoNfc() {
  uint32_t pedido = pedidoNfcSeq;
  if (pedidoNfcSeq == pedido) pedidoNfcPendente = NFC_SEM_PEDIDO;

  if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);

  String resposta;
  bool ok = false;
  uint32_t v = nfc.getFirmwareVersion();
  if (v) {
    resposta = "PN532 Ativo! Firmware " + String((v >> 16) & 0xFF) + "." + String((v >> 8) & 0xFF);
    ok = true;
  } else {
    // Varredura I2C com timeout curto para não segurar o Core 1 nem o barramento.
    String achados = "";
    Wire.setTimeOut(10);
    for (uint8_t addr = 0x08; addr <= 0x77; addr++) {
      Wire.beginTransmission(addr);
      if (Wire.endTransmission() == 0) {
        if (achados.length()) achados += ", ";
        achados += "0x" + String(addr, HEX);
      }
      if ((addr & 0x0F) == 0) vTaskDelay(1); // devolve CPU durante a varredura
    }
    Wire.setTimeOut(50);

    resposta = "FALHA: PN532 nao respondeu no I2C (Pinos 8 e 9).";
    if (achados.length() == 0) {
      resposta += " Varredura: NENHUM dispositivo no barramento. Verifique 1) chave 1=ON e 2=OFF no modulo; 2) fios SDA->GPIO8, SCL->GPIO9 (nao invertidos); 3) alimentacao VCC/GND (use 3V3).";
    } else if (achados.startsWith("0x24")) {
      // O módulo responde no barramento: pode ser falha momentânea do I2C.
      for (uint8_t tentativas = 0; tentativas < 3 && !ok; tentativas++) {
        vTaskDelay(pdMS_TO_TICKS(150));
        if (iniciarPN532(false)) {
          uint32_t v2 = nfc.getFirmwareVersion();
          resposta = "PN532 recuperado! Firmware " + String((v2 >> 16) & 0xFF) + "." + String((v2 >> 8) & 0xFF) + " (detectado em 0x24, havia falha momentanea no I2C)";
          ok = true;
          nfcOk = true;
          falhasHeartbeatNfc = 0;
        }
      }
      if (!ok) {
        resposta += " Varredura: dispositivo em 0x24 (o modulo responde!) mas sem versao de firmware. Confira as chaves de novo: 1=ON e 2=OFF (modo I2C, nao HSU).";
      }
    } else {
      resposta += " Varredura: dispositivo estranho em " + achados + " (esperado 0x24).";
    }
  }

  if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);

  publicarResultadoNfc(resposta, pedido);
  logSerial(resposta, ok ? "ok" : "err");
}

// =====================================================================
// Driver Nativo UART para Sensor Biométrico Óptico AS608 / FPM10A / DY50
// (Sem dependência de bibliotecas externas — protocolo Synochip padrão)
// =====================================================================

String gerarUidVirtualBio(uint16_t id) {
  char buf[16];
  snprintf(buf, sizeof(buf), "FB:10:%02X:%02X", (id >> 8) & 0xFF, id & 0xFF);
  return String(buf);
}

int bioEnviarComando(const uint8_t* payload, uint16_t len, uint8_t* respPayload, uint16_t* respLen, uint32_t timeoutMs = 450) {
  while (Serial1.available()) Serial1.read();

  uint16_t pktLen = len + 2;
  uint16_t soma = 0x01 + ((pktLen >> 8) & 0xFF) + (pktLen & 0xFF);

  uint8_t cabecalho[9] = {
    0xEF, 0x01,
    0xFF, 0xFF, 0xFF, 0xFF,
    0x01,
    (uint8_t)((pktLen >> 8) & 0xFF),
    (uint8_t)(pktLen & 0xFF)
  };
  Serial1.write(cabecalho, sizeof(cabecalho));
  for (uint16_t i = 0; i < len; i++) {
    Serial1.write(payload[i]);
    soma += payload[i];
  }
  Serial1.write((uint8_t)((soma >> 8) & 0xFF));
  Serial1.write((uint8_t)(soma & 0xFF));
  Serial1.flush();

  uint8_t rx[64];
  uint16_t idx = 0;
  uint16_t esperado = 9;
  uint32_t t0 = millis();

  while (millis() - t0 < timeoutMs) {
    while (Serial1.available()) {
      uint8_t b = (uint8_t)Serial1.read();
      if (idx == 0 && b != 0xEF) continue;
      if (idx == 1 && b != 0x01) { idx = 0; continue; }
      if (idx < sizeof(rx)) rx[idx++] = b;
      if (idx == 9) {
        uint16_t rLen = ((uint16_t)rx[7] << 8) | rx[8];
        esperado = 9 + rLen;
        if (esperado > sizeof(rx)) esperado = sizeof(rx);
      }
      if (idx >= esperado && idx >= 12) {
        if (rx[6] != 0x07) return -2; // Não é pacote ACK
        uint16_t dadosLen = esperado - 11;
        if (respPayload && respLen) {
          uint16_t copiar = (dadosLen > *respLen) ? *respLen : dadosLen;
          if (copiar > 1) memcpy(respPayload, &rx[10], copiar - 1);
          *respLen = (copiar > 0) ? (copiar - 1) : 0;
        }
        return rx[9]; // Código de confirmação (0x00 = OK)
      }
    }
    vTaskDelay(pdMS_TO_TICKS(2));
  }
  return -1; // Timeout
}

bool iniciarBiometria(bool verboso) {
  Serial1.begin(BIO_BAUD, SERIAL_8N1, BIO_RX_PIN, BIO_TX_PIN);
  delay(40);
  uint8_t cmdVfy[5] = { 0x13, 0x00, 0x00, 0x00, 0x00 };
  uint8_t resp[8];
  uint16_t rLen = sizeof(resp);
  int rc = bioEnviarComando(cmdVfy, sizeof(cmdVfy), resp, &rLen, 250);
  if (rc == 0x00) {
    if (verboso) {
      Serial.printf("Sensor Biometrico AS608/FPM10A Detectado na UART1 (RX=%d, TX=%d)!\n", BIO_RX_PIN, BIO_TX_PIN);
    }
    return true;
  }
  if (verboso) {
    Serial.printf("[BIO] Sensor biometrico ausente nos pinos RX=%d / TX=%d (modo somente NFC ativo).\n", BIO_RX_PIN, BIO_TX_PIN);
  }
  return false;
}

int bioCapturarImagem() {
  uint8_t cmd[1] = { 0x01 };
  uint8_t resp[4];
  uint16_t rLen = sizeof(resp);
  return bioEnviarComando(cmd, 1, resp, &rLen, 350);
}

int bioImagemParaTz(uint8_t slot) {
  uint8_t cmd[2] = { 0x02, slot };
  uint8_t resp[4];
  uint16_t rLen = sizeof(resp);
  return bioEnviarComando(cmd, 2, resp, &rLen, 400);
}

int bioCriarModelo() {
  uint8_t cmd[1] = { 0x05 };
  uint8_t resp[4];
  uint16_t rLen = sizeof(resp);
  return bioEnviarComando(cmd, 1, resp, &rLen, 450);
}

int bioSalvarModelo(uint16_t id) {
  uint8_t cmd[4] = { 0x06, 0x01, (uint8_t)((id >> 8) & 0xFF), (uint8_t)(id & 0xFF) };
  uint8_t resp[4];
  uint16_t rLen = sizeof(resp);
  return bioEnviarComando(cmd, 4, resp, &rLen, 500);
}

int bioExcluirModelo(uint16_t id) {
  uint8_t cmd[5] = { 0x0C, (uint8_t)((id >> 8) & 0xFF), (uint8_t)(id & 0xFF), 0x00, 0x01 };
  uint8_t resp[4];
  uint16_t rLen = sizeof(resp);
  return bioEnviarComando(cmd, 5, resp, &rLen, 450);
}

int bioBuscarDigital(uint16_t* idEncontrado, uint16_t* score) {
  uint8_t cmd[6] = { 0x04, 0x01, 0x00, 0x00, 0x01, 0x2C }; // páginas 0..300
  uint8_t resp[8] = {0};
  uint16_t rLen = sizeof(resp);
  int rc = bioEnviarComando(cmd, 6, resp, &rLen, 500);
  if (rc == 0x00 && rLen >= 4) {
    *idEncontrado = ((uint16_t)resp[0] << 8) | resp[1];
    *score = ((uint16_t)resp[2] << 8) | resp[3];
  }
  return rc;
}

void processarLeituraBiometria(uint16_t bioId) {
  uint32_t inicioUs = micros();

  String uidVirtual = gerarUidVirtualBio(bioId);
  String uidResolvido = uidVirtual;
  bool encontrado = false;
  bool ativo = false;
  String nome = "";

  uint32_t inicioBuscaUs = micros();

  xSemaphoreTake(travaDados, portMAX_DELAY);
  if (cartoesRamValido && cartoesRam) {
    for (uint16_t i = 0; i < cartoesRamTotal; i++) {
      if (cartoesRam[i].bio_id == bioId || strcasecmp(cartoesRam[i].uid, uidVirtual.c_str()) == 0) {
        encontrado = true;
        ativo = cartoesRam[i].ativo;
        nome = cartoesRam[i].nome;
        if (cartoesRam[i].uid[0] != '\0') uidResolvido = cartoesRam[i].uid;
        break;
      }
    }
  } else if (fsPtr) {
    JsonDocument doc;
    carregarJsonDoArquivo(ARQ_CARTOES, doc);
    JsonArray arr = doc.as<JsonArray>();

    for (JsonObject c : arr) {
      uint16_t cBio = c["bio_id"] | 0;
      String cUid = c["uid"].as<String>();
      if (cBio == bioId || cUid.equalsIgnoreCase(uidVirtual)) {
        encontrado = true;
        ativo = c["ativo"].as<bool>();
        nome = c["nome"].as<String>();
        if (!cUid.isEmpty()) uidResolvido = cUid;
        break;
      }
    }
  }

  uint32_t durValidacaoMs = (micros() - inicioBuscaUs) / 1000;
  nfcUltimaDuracaoMs = durValidacaoMs;

  uint8_t res = (!encontrado) ? 1 : (ativo ? 0 : 2);

  registrarAcessoNoHistorico(uidResolvido, nome, res);
  xSemaphoreGive(travaDados);

  xSemaphoreTake(travaUltimo, portMAX_DELAY);
  ultimoUidLido = uidResolvido;
  ultimoMetodoLido = "biometria";
  ultimoBioIdLido = bioId;
  ultimoLidoMs = millis();
  ultimoSeq++;
  ultimoCadastrado = encontrado;
  ultimoNomeLido = nome;
  xSemaphoreGive(travaUltimo);

  String tempoValidacao = " | validacao " + String(durValidacaoMs) + " ms";
  String msgLog;
  const char* nivelLog = "wa";

  Serial.println("\n====================================");
  Serial.printf("Biometria Detectada: Posicao #%u (%s)\n", bioId, uidResolvido.c_str());
  if (encontrado) Serial.printf("Titular: %s\n", nome.c_str());

  if (res == 0) {
    msgLog = "BIOMETRIA LIBERADA: " + nome + " [#" + String(bioId) + " / " + uidResolvido + "]" + tempoValidacao;
    nivelLog = "ok";
    acionarLedFeedback(0, 255, 0, 1800);
    acionarSaidaFechadura();
  } else if (res == 2) {
    msgLog = "BIOMETRIA NEGADA (Bloqueado): " + nome + " [#" + String(bioId) + "]" + tempoValidacao;
    nivelLog = "err";
    acionarLedFeedback(255, 0, 0, 1800);
  } else {
    msgLog = "BIOMETRIA NAO VINCULADA: [#" + String(bioId) + " / " + uidResolvido + "]" + tempoValidacao;
    acionarLedFeedback(255, 0, 0, 1800);
  }
  Serial.println("====================================");

  logSerial(msgLog, nivelLog);

  uint32_t durMs = (micros() - inicioUs) / 1000;
  if (durMs > diagNfcMaxMs) diagNfcMaxMs = durMs;
}

void processarCicloBiometria(uint32_t& ultimoVistoBioMs) {
  if (!bioOk) return;

  // Modo 1: Cadastro interativo em 2 toques iniciado pelo Painel Web
  if (bioCadastroAtivo) {
    if (millis() - bioCadastroInicioMs > 30000) {
      bioCadastroAtivo = false;
      bioDefinirEtapa("erro", "Tempo esgotado (30s) para encostar o dedo no sensor.");
      acionarLedFeedback(255, 0, 0, 1500);
      return;
    }

    String etapaCadastro = bioEtapaAtual();
    if (etapaCadastro == "aguardando_dedo_1") {
      if (bioCapturarImagem() == 0x00) {
        if (bioImagemParaTz(1) == 0x00) {
          bioDefinirEtapa("remova_dedo", "1a leitura capturada! Retire o dedo do sensor...");
          acionarLedFeedback(0, 140, 255, 800);
        } else {
          bioDefinirEtapa("aguardando_dedo_1", "Imagem borrada. Tente encostar o dedo novamente...");
        }
      }
      return;
    }

    if (etapaCadastro == "remova_dedo") {
      if (bioCapturarImagem() == 0x02) { // 0x02 = sem dedo no sensor
        bioDefinirEtapa("aguardando_dedo_2", "Encoste o MESMO dedo novamente para confirmar (2a leitura)...");
      }
      return;
    }

    if (etapaCadastro == "aguardando_dedo_2") {
      if (bioCapturarImagem() == 0x00) {
        uint16_t idGravado = bioCadastroId;
        if (bioImagemParaTz(2) == 0x00 &&
            bioCriarModelo() == 0x00 &&
            bioSalvarModelo(idGravado) == 0x00) {
          bioCadastroAtivo = false;
          bioDefinirEtapa("concluido", "Biometria gravada com sucesso na posicao #" + String(idGravado) + "!");
          acionarLedFeedback(0, 255, 0, 1800);
          logSerial("[BIO] Digital gravada na posicao #" + String(idGravado), "ok");
        } else {
          bioCadastroAtivo = false;
          bioDefinirEtapa("erro", "As duas leituras nao coincidiram. Tente novamente.");
          acionarLedFeedback(255, 0, 0, 1800);
          logSerial("[BIO] Falha ao combinar digitais na posicao #" + String(idGravado), "err");
        }
      }
      return;
    }
    return;
  }

  // Modo 2: Leitura passiva contínua na portaria (1:N)
  int rcImg = bioCapturarImagem();
  if (rcImg == 0x00) {
    if (bioImagemParaTz(1) == 0x00) {
      uint16_t idEncontrado = 0;
      uint16_t score = 0;
      int rcBusca = bioBuscarDigital(&idEncontrado, &score);
      uint32_t agora = millis();
      if (rcBusca == 0x00 && idEncontrado >= 1) {
        if (idEncontrado == ultimoBioIdLido && (agora - ultimoVistoBioMs < 2000)) {
          ultimoVistoBioMs = agora;
        } else {
          ultimoVistoBioMs = agora;
          processarLeituraBiometria(idEncontrado);
        }
      } else {
        if (agora - ultimoVistoBioMs >= 2000) {
          ultimoVistoBioMs = agora;
          logSerial("BIOMETRIA NAO RECONHECIDA no sensor optico", "wa");
          acionarLedFeedback(255, 0, 0, 1400);
        }
      }
    }
  }
}

// Tarefa dedicada do Core 0 (FreeRTOS)
void tarefaNFC(void* parametro) {
  Serial.println("[Core 0] Tarefa do Leitor NFC em execucao.");
  uint8_t uidBuffer[10];
  uint8_t uidLength = 0;
  uint32_t ultimoHeartbeatNfc = 0;
  uint32_t ultimaLeituraOk = millis();
  nfcUltimaLeituraMs = millis();
  uint32_t ultimoWatchdogNfc = 0;
  uint32_t ultimoVistoBioMs = 0;
  uint32_t ultimaTentativaBioMs = 0;

  for (;;) {
    // 0a. Reinício do leitor pedido pelo Core 1 (console/página, sem reboot).
    if (pedidoReinicioNfc) {
      pedidoReinicioNfc = false;
      bool ok = reiniciarLeitorCompleto(true);
      nfcOk = ok;
      if (ok) {
        falhasHeartbeatNfc = 0;
      }
      continue;
    }

    // 0b. Pedidos de diagnóstico vindos do Core 1 (ping/varredura I2C)
    if (pedidoNfcPendente != NFC_SEM_PEDIDO) {
      atenderPedidoNfc();
      continue;
    }

    // 0c. Exclusão de modelo biométrico pedida pelo Core 1. A UART1 pertence a
    // esta tarefa; a rota HTTP apenas enfileira e recebe o resultado, evitando
    // dois pacotes intercalados no mesmo fio (antes o Core 1 escrevia direto).
    if (bioExcluirPendente) {
      uint16_t idExcluir = bioExcluirId;
      bioExcluirResultado = bioOk ? bioExcluirModelo(idExcluir) : -1;
      bioExcluirPronto = true;
      bioExcluirPendente = false;
      continue;
    }

    // 1. Se o módulo estiver desconectado, tenta reconectar periodicamente.
    // A recuperação do barramento + reset do módulo rodam sob a trava para não
    // colidir com uma gravação na flash (que suspende os dois núcleos).
    if (!nfcOk && !bioOk) {
      vTaskDelay(pdMS_TO_TICKS(1500));
      bool reconectou = reiniciarLeitorCompleto(true);
      if (reconectou) {
        nfcOk = true;
        nfcReconexoes++;
        falhasHeartbeatNfc = 0;
        Serial.println("\n[HARDWARE] Leitor NFC PN532 reconectado (versao + SAM conferidos).");
      }
      if (!bioOk) {
        bioOk = iniciarBiometria(false);
      }
      continue;
    }

    // Sensor biométrico ausente no boot: tenta reconectar a cada 10 s mesmo
    // com o NFC saudável (antes a biometria só era tentada quando os dois
    // leitores estavam fora, então um cabo solto no AS608 ficava sem retry).
    if (nfcOk && !bioOk && millis() - ultimaTentativaBioMs >= 10000) {
      ultimaTentativaBioMs = millis();
      if (iniciarBiometria(false)) {
        bioOk = true;
        logSerial("[BIO] Sensor biometrico reconectado na UART1.", "ok");
      }
    }

    uint32_t agora = millis();

    // 2. Heartbeat I2C a cada 5 s, com histerese: uma falha isolada não derruba
    // o leitor (antes o LED laranja piscava por qualquer ruído no barramento).
    // Também não sonda logo após uma leitura bem-sucedida: ela já provou que vive.
    if (nfcOk && agora - ultimoHeartbeatNfc >= 5000 && agora - ultimaLeituraOk > 3000) {
      ultimoHeartbeatNfc = agora;
      if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
      uint32_t versao = nfc.getFirmwareVersion();
      if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
      if (!versao) {
        if (++falhasHeartbeatNfc >= 3) {
          nfcOk = false;
          falhasHeartbeatNfc = 0;
          Serial.println("\n[ALERTA HARDWARE] Modulo PN532 parou de responder! Verifique SDA (GPIO 8), SCL (GPIO 9) e a solda do RST no GPIO 5.");
          continue;
        }
      } else {
        falhasHeartbeatNfc = 0;
        uint32_t pilha = uxTaskGetStackHighWaterMark(NULL);
        if (diagNfcStackMin == 0 || pilha < diagNfcStackMin) diagNfcStackMin = pilha;
      }
    }

    // 2b. Watchdog de leitura: muito tempo sem nenhum cartão pode ser corredor
    // vazio, mas também pode ser o estado "zumbi" (responde à versão e não lê).
    // O reinício completo é barato (só I2C) e devolve o leitor sozinho; fica
    // limitado a uma tentativa a cada 10 min.
    if (nfcOk && agora - nfcUltimaLeituraMs > NFC_WATCHDOG_OCIOSO_MS &&
        agora - ultimoWatchdogNfc > NFC_WATCHDOG_INTERVALO_MS) {
      ultimoWatchdogNfc = agora;
      bool recuperou = reiniciarLeitorCompleto(true);
      if (!recuperou) {
        nfcOk = false;
        falhasHeartbeatNfc = 0;
        Serial.println("[ALERTA] Watchdog nao conseguiu recuperar o PN532; LED laranja.");
      }
      continue;
    }

    // 3. Leitura passiva com timeout curto (50ms), sem gravação de flash em voo.
    bool detectado = false;
    if (nfcOk) {
      if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
      detectado = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uidBuffer, &uidLength, 50);
      if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
    }

    if (detectado && uidLength > 0 && uidLength <= 10) {
      ultimaLeituraOk = millis();
      nfcUltimaLeituraMs = ultimaLeituraOk;
      ultimoHeartbeatNfc = ultimaLeituraOk; // Se leu cartão, o hardware está 100% responsivo
      falhasHeartbeatNfc = 0;
      String uidStr = uidBytesParaTexto(uidBuffer, uidLength);
      agora = millis();

      // Evita disparar repetidas vezes enquanto o cartão continua encostado
      String uidAnterior;
      xSemaphoreTake(travaUltimo, portMAX_DELAY);
      uidAnterior = ultimoUidLido;
      xSemaphoreGive(travaUltimo);

      if (uidStr.equalsIgnoreCase(uidAnterior) && (agora - ultimoVistoMs < 2000)) {
        ultimoVistoMs = agora;
      } else {
        ultimoVistoMs = agora;
        processarLeituraNfc(uidStr);
      }
    }

    processarCicloBiometria(ultimoVistoBioMs);
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

  JsonDocument doc;
  xSemaphoreTake(travaDados, portMAX_DELAY);
  if (cartoesRamValido && cartoesRam) {
    // Lista direto do índice em PSRAM: o painel consulta esta rota com
    // frequência e não precisa reler/desserializar a Flash a cada poll.
    JsonArray arr = doc.to<JsonArray>();
    for (uint16_t i = 0; i < cartoesRamTotal; i++) {
      JsonObject item = arr.add<JsonObject>();
      item["uid"] = cartoesRam[i].uid;
      item["nome"] = cartoesRam[i].nome;
      item["ativo"] = cartoesRam[i].ativo;
      if (cartoesRam[i].bio_id > 0) item["bio_id"] = cartoesRam[i].bio_id;
    }
  } else {
    carregarJsonDoArquivo(ARQ_CARTOES, doc);
  }
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
  indiceDoDocumento(doc); // mantém a validação em RAM sincronizada com a flash
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
  indiceDoDocumento(doc); // mantém a validação em RAM sincronizada com a flash
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
  indiceDoDocumento(doc); // mantém a validação em RAM sincronizada com a flash
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
  indiceDoDocumento(doc); // mantém a validação em RAM sincronizada com a flash
  xSemaphoreGive(travaDados);

  responderJson(200, "{\"ok\":true}");
}

// Sincronização individual em tempo real pelo Painel Web
void rotaSincronizarAluno() {
  if (!fsPtr) return responderErro(500, "Memória Flash não montada.");

  String uid = "";
  String nome = "";
  bool ativo = true;
  uint16_t bioId = 0;

  // Uma única desserialização: o corpo JSON é lido uma vez e reaproveitado
  // tanto no update quanto na inserção (antes o parse era repetido até 3x).
  if (server.hasArg("plain")) {
    JsonDocument body;
    if (deserializeJson(body, server.arg("plain")) == DeserializationError::Ok) {
      uid = normalizarUid(body["uid"].as<String>());
      nome = body["nome"].as<String>();
      ativo = body["ativo"].as<bool>();
      bioId = (uint16_t)(body["bio_id"] | 0);
      if (bioId >= 1 && bioId <= 300) server.sendHeader("X-Bio-Id", String(bioId));
      else bioId = 0;
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
      if (bioId > 0) c["bio_id"] = bioId;
      achou = true;
      break;
    }
  }

  if (!achou) {
    JsonObject novo = arr.add<JsonObject>();
    novo["uid"] = uid;
    novo["nome"] = nome.isEmpty() ? "Aluno" : nome;
    novo["ativo"] = ativo;
    if (bioId > 0) novo["bio_id"] = bioId;
  }

  salvarJsonNoArquivo(ARQ_CARTOES, doc);
  indiceDoDocumento(doc); // mantém a validação em RAM sincronizada com a flash
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
  indiceDoDocumento(doc); // mantém a validação em RAM sincronizada com a flash
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
    indiceDoDocumento(doc);
  }
  xSemaphoreGive(travaDados);

  logSerial("[SYNC] Cartão removido da Flash: " + uid, "wa");
  responderJson(200, "{\"ok\":true}");
}

void rotaUltimoCartao() {
  // Rota de leitura pública para totens e portaria web na rede local.
  // Copia o estado sob trava antes de serializar: as Strings são escritas no Core 0.
  String uid, nome, metodo;
  bool cadastrado = false;
  uint32_t seq = 0, lidoMs = 0;
  uint16_t bioId = 0;

  xSemaphoreTake(travaUltimo, portMAX_DELAY);
  uid = ultimoUidLido;
  nome = ultimoNomeLido;
  cadastrado = ultimoCadastrado;
  metodo = ultimoMetodoLido;
  bioId = ultimoBioIdLido;
  seq = ultimoSeq;
  lidoMs = ultimoLidoMs;
  xSemaphoreGive(travaUltimo);

  JsonDocument doc;
  doc["nfc_ok"] = nfcOk;
  doc["bio_ok"] = bioOk;
  doc["seq"] = seq;
  if (seq > 0) {
    doc["uid"] = uid;
    doc["nome"] = nome;
    doc["cadastrado"] = cadastrado;
    doc["metodo"] = metodo;
    if (bioId > 0) doc["bio_id"] = bioId;
    doc["ha"] = (millis() - lidoMs) / 1000;
  }
  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaObterLog() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderJson(200, "[]");

  // Serve do cache em RAM: nenhuma leitura de flash por poll do painel/página.
  JsonDocument doc;
  uint32_t agora = millis();

  if (historicoRam) {
    xSemaphoreTake(travaDados, portMAX_DELAY);
    JsonArray arr = doc.to<JsonArray>();
    for (uint16_t i = 0; i < historicoRamTotal; i++) {
      JsonObject item = arr.add<JsonObject>();
      item["uid"] = historicoRam[i].uid;
      item["nome"] = historicoRam[i].nome;
      item["res"] = historicoRam[i].res;
      item["dh"] = historicoRam[i].dh;
      item["tempo"] = historicoRam[i].tempo;
      item["ha"] = (agora >= historicoRam[i].tempo) ? (agora - historicoRam[i].tempo) / 1000 : 0;
    }
    xSemaphoreGive(travaDados);
  } else {
    // Sem RAM (alocação falhou): mantém o comportamento antigo lendo a flash.
    xSemaphoreTake(travaDados, portMAX_DELAY);
    carregarJsonDoArquivo(ARQ_HISTORICO, doc);
    xSemaphoreGive(travaDados);

    JsonArray arr = doc.as<JsonArray>();
    for (JsonObject item : arr) {
      uint32_t tempo = item["tempo"].as<uint32_t>();
      item["ha"] = (agora >= tempo) ? (agora - tempo) / 1000 : 0;
    }
  }

  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaLimparLog() {
  if (!autenticarRequisicao()) return;
  if (!fsPtr) return responderJson(200, "{\"ok\":true}");

  xSemaphoreTake(travaDados, portMAX_DELAY);
  if (historicoRam) historicoRamTotal = 0;
  historicoSeqGerado++;
  JsonDocument doc;
  doc.to<JsonArray>();
  bool gravou = salvarJsonNoArquivo(ARQ_HISTORICO, doc);
  historicoSujo = !gravou;
  xSemaphoreGive(travaDados);
  responderJson(200, "{\"ok\":true}");
}

void rotaStatusSistema() {
  // Rota de telemetria pública para monitoramento do totem/portaria
  JsonDocument doc;
  doc["versao"] = FW_VERSAO;
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
  doc["bio"] = bioOk;
  doc["bio_ok"] = bioOk;
  doc["psram"] = ESP.getPsramSize() / (1024 * 1024);
  doc["psram_livre"] = ESP.getFreePsram();
  doc["flash"] = ESP.getFlashChipSize() / (1024 * 1024);
  doc["fs"] = nomeFsAtivo;
  doc["heap_livre"] = ESP.getFreeHeap();
  doc["heap_min"] = ESP.getMinFreeHeap();
  doc["loop_max_ms"] = diagLoopMaxMs;
  doc["http_max_ms"] = diagHttpMaxMs;
  doc["nfc_max_ms"] = diagNfcMaxMs;
  doc["nfc_ultimo_ms"] = nfcUltimaDuracaoMs;
  doc["nfc_sam_ok"] = nfcSamOk;
  doc["nfc_reinicios"] = nfcReinicios;
  doc["nfc_reconexoes"] = nfcReconexoes;
  doc["nfc_ultima_leitura_s"] = nfcUltimaLeituraMs ? (millis() - nfcUltimaLeituraMs) / 1000 : 0;
  doc["nfc_ultimo_reinicio_s"] = nfcUltimoReinicioMs ? (millis() - nfcUltimoReinicioMs) / 1000 : 0;
  doc["cartoes_ram"] = cartoesRamTotal;
  doc["historico_ram"] = historicoRamTotal;
  doc["historico_pendente"] = historicoSujo;
  doc["ram_cache_bytes"] = (uint32_t)(cartoesRamCapacidade * sizeof(CartaoRam) +
                                      (historicoRam ? MAX_HISTORICO_LOG * sizeof(HistoricoRam) : 0));
  doc["fs_max_ms"] = diagFsMaxMs;
  doc["engasgos"] = diagEngasgos;
  doc["uptime"] = millis() / 1000;
  doc["hora"] = obterDataHoraAtual();

  String s;
  serializeJson(doc, s);
  responderJson(200, s);
}

void rotaDiagnostico() {
  JsonDocument doc;
  doc["versao"] = FW_VERSAO;
  doc["uptime_s"] = millis() / 1000;
  doc["nfc_ok"] = nfcOk;
  doc["nfc_sam_ok"] = nfcSamOk;
  doc["nfc_reinicios"] = nfcReinicios;
  doc["nfc_reconexoes"] = nfcReconexoes;
  doc["rssi"] = WiFi.RSSI();
  doc["heap_livre"] = ESP.getFreeHeap();
  doc["heap_min"] = ESP.getMinFreeHeap();
  doc["psram_livre"] = ESP.getFreePsram();
  doc["stack_loop"] = (unsigned)uxTaskGetStackHighWaterMark(NULL);
  doc["stack_nfc"] = (unsigned)diagNfcStackMin;
  doc["loop_max_ms"] = diagLoopMaxMs;
  doc["loop_avg_ms"] = diagLoopAmostras ? (diagLoopSomaMs / diagLoopAmostras) : 0;
  doc["http_max_ms"] = diagHttpMaxMs;
  doc["nfc_max_ms"] = diagNfcMaxMs;
  doc["fs_max_ms"] = diagFsMaxMs;
  doc["engasgos"] = diagEngasgos;
  doc["eventos_total"] = diagTotal;

  JsonArray eventos = doc["eventos"].to<JsonArray>();
  if (travaDiag) xSemaphoreTake(travaDiag, portMAX_DELAY);
  for (int i = 0; i < diagTotal; i++) {
    EventoDiag& e = bufferDiag[(diagIndex + i) % MAX_EVENTOS_DIAG];
    JsonObject item = eventos.add<JsonObject>();
    item["ms"] = e.ms;
    item["dur_ms"] = e.durMs;
    item["tipo"] = e.tipo;
    item["detalhe"] = e.detalhe;
    item["heap"] = e.heap;
    item["rssi"] = e.rssi;
  }
  if (travaDiag) xSemaphoreGive(travaDiag);

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

  // Em STA a rede já está escolhida e a troca exige "Esquecer rede" (modo AP).
  // Varrer aqui só bloqueava o servidor por ~2,8 s sem utilidade.
  if (!modoAP) {
    responderJson(200, "{\"ok\":true,\"scanning\":false,\"redes\":[],\"motivo\":\"conectado\"}");
    return;
  }

  bool forcar = server.hasArg("forcar") && server.arg("forcar") != "0";
  uint32_t agora = millis();

  // Já existe uma varredura em andamento: responde na hora e o loop coleta.
  if (wifiScanEmAndamento) {
    if (agora - wifiScanInicioMs > 20000) { // trava de segurança do rádio
      wifiScanEmAndamento = false;
      WiFi.scanDelete();
    } else {
      responderJson(200, "{\"ok\":true,\"scanning\":true,\"redes\":[]}");
      return;
    }
  }

  bool cacheOk = scanCacheValido && !forcar && (agora - scanCacheMs) < SCAN_CACHE_MS;
  if (!cacheOk) {
    int16_t inicio = WiFi.scanNetworks(true, true, false, 120); // true = assíncrono
    if (inicio == WIFI_SCAN_RUNNING) {
      wifiScanEmAndamento = true;
      wifiScanInicioMs = agora;
      responderJson(200, "{\"ok\":true,\"scanning\":true,\"redes\":[]}");
      return;
    }
    if (inicio < 0) {
      scanCacheValido = false;
      logSerial("[WIFI] Varredura de redes falhou.", "err");
      return responderErro(502, "Nao foi possivel escanear as redes agora. Tente novamente.");
    }
    // Terminou de imediato (raro): monta o cache direto.
    scanCacheJson = montarRedesJson(inicio);
    scanCacheMs = millis();
    scanCacheValido = true;
    WiFi.scanDelete();
    logSerial("[WEB] Varredura Wi-Fi: " + String(inicio) + " rede(s) encontrada(s).", "info");
  }

  String s = "{\"ok\":true,\"scanning\":false,\"ts\":" + String(scanCacheMs) + ",\"redes\":" + scanCacheJson + "}";
  responderJson(200, s);
}

// Chamado no loop (Core 1): coleta a varredura assíncrona quando o rádio termina.
void processarScanWifi() {
  if (!wifiScanEmAndamento) return;

  int16_t total = WiFi.scanComplete();
  if (total == WIFI_SCAN_RUNNING) return;

  wifiScanEmAndamento = false;
  if (total < 0) {
    scanCacheValido = false;
    WiFi.scanDelete();
    logSerial("[WIFI] Varredura de redes falhou.", "err");
    return;
  }

  scanCacheJson = montarRedesJson(total);
  scanCacheMs = millis();
  scanCacheValido = true;
  WiFi.scanDelete();
  logSerial("[WEB] Varredura Wi-Fi: " + String(total) + " rede(s) encontrada(s).", "info");
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
    gravarHistoricoAgora();
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
  doc["bio"] = bioOk;
  doc["bio_ok"] = bioOk;
  doc["ip"] = (modoAP ? WiFi.softAPIP() : WiFi.localIP()).toString();

  JsonArray arr = doc["logs"].to<JsonArray>();

  // O Core 0 escreve no buffer de logs; sem a trava o Core 1 pode copiar
  // Strings no meio de uma escrita e devolver texto corrompido (ou cair).
  if (travaLog) xSemaphoreTake(travaLog, portMAX_DELAY);
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
  if (travaLog) xSemaphoreGive(travaLog);

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
    // O I2C pertence à tarefa NFC (Core 0). Aqui apenas enfileiramos o pedido e
    // aguardamos o resultado publicado — nenhum acesso ao PN532 a partir do Core 1.
    pedidoNfcSeq++;
    uint32_t alvo = pedidoNfcSeq;
    pedidoNfcPendente = NFC_PEDIR_PING;

    uint32_t esperaInicio = millis();
    while (pedidoNfcAtendido != alvo && (millis() - esperaInicio) < 3000) {
      delay(20); // cede o Core 1 enquanto o Core 0 executa o diagnóstico
    }

    if (travaResultadoNfc) xSemaphoreTake(travaResultadoNfc, portMAX_DELAY);
    bool concluido = (pedidoNfcAtendido == alvo) && !resultadoPedidoNfc.isEmpty();
    resposta = concluido ? resultadoPedidoNfc
                         : "Sem resposta: a tarefa NFC nao concluiu o diagnostico em 3 s. Tente novamente.";
    if (travaResultadoNfc) xSemaphoreGive(travaResultadoNfc);
  } else if (cmd == "status") {
    resposta = "IP: " + (modoAP ? WiFi.softAPIP() : WiFi.localIP()).toString() +
               " | RSSI: " + String(WiFi.RSSI()) + " dBm" +
               " | Heap: " + String(ESP.getFreeHeap() / 1024) + " KB" +
               " | PSRAM: " + String(ESP.getFreePsram() / 1024) + " KB";
    logSerial(resposta, "info");
  } else if (cmd == "led_verde") {
    acionarLedFeedback(0, 255, 0, 5000);
    resposta = "LED verde por 5 segundos.";
    logSerial(resposta, "ok");
  } else if (cmd == "led_vermelho") {
    acionarLedFeedback(255, 0, 0, 5000);
    resposta = "LED vermelho por 5 segundos.";
    logSerial(resposta, "err");
  } else if (cmd == "led_azul") {
    acionarLedFeedback(0, 80, 255, 5000);
    resposta = "LED azul por 5 segundos.";
    logSerial(resposta, "info");
  } else if (cmd == "led_off") {
    ledTemporarioAte = 0;
    aplicarCorLed(0, 0, 0);
    resposta = "LED apagado.";
    logSerial(resposta, "info");
  } else if (cmd == "limpar") {
    logTotal = 0;
    logIndexInicio = 0;
    resposta = "Logs de memoria limpos.";
    logSerial(resposta, "wa");
  } else if (cmd == "reset_nfc") {
    // A tarefa NFC (Core 0) é a dona do I2C; aqui só levantamos a bandeira.
    pedidoReinicioNfc = true;
    resposta = "Reinicio do leitor NFC solicitado (atende em ate 1 s).";
    logSerial("[NFC] " + resposta, "wa");
  } else if (cmd == "nfc_status") {
    resposta = String("NFC: ") + (nfcOk ? "ok" : "off") +
               " | SAM: " + (nfcSamOk ? "ok" : "falhou") +
               " | reinicios: " + String(nfcReinicios) +
               " | reconexoes: " + String(nfcReconexoes);
    logSerial(resposta, nfcOk ? "info" : "wa");
  } else if (cmd == "reboot") {
    logSerial("[SISTEMA] Reiniciando ESP32 por comando remoto...", "err");
    responderJson(200, "{\"ok\":true, \"msg\":\"Reiniciando placa em 1 segundo...\"}");
    gravarHistoricoAgora();
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
  gravarHistoricoAgora();
  delay(1000);
  ESP.restart();
}

void rotaOtaUpload() {
  HTTPUpload& upload = server.upload();
  if (upload.status == UPLOAD_FILE_START) {
    // O corpo multipart é recebido antes da rota final; sem checar aqui, um
    // POST sem login gravaria firmware mesmo com a página /ota protegida.
    otaUploadAutorizado = server.authenticate(ADMIN_USUARIO, ADMIN_SENHA);
    if (!otaUploadAutorizado) {
      logSerial("[OTA] Upload recusado: credenciais ausentes ou invalidas.", "err");
      return;
    }
    logSerial("[OTA] Iniciando gravacao de firmware: " + upload.filename, "wa");
    uint32_t maxSpace = (ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000;
    if (!Update.begin(maxSpace, U_FLASH)) {
      Update.printError(Serial);
      logSerial("[OTA] Erro no Update.begin: " + String(Update.errorString()), "err");
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (!otaUploadAutorizado) return;
    if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
    size_t gravou = Update.write(upload.buf, upload.currentSize);
    if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
    if (gravou != upload.currentSize) {
      Update.printError(Serial);
      logSerial("[OTA] Erro no Update.write", "err");
    }
    // Cede a CPU a cada 32 blocos: a gravação de firmware inteira sem pausa pode
    // estourar o task watchdog (TG1WDT_SYS_RST) em rede lenta.
    static uint32_t blocosOta = 0;
    if ((++blocosOta & 0x1F) == 0) delay(1);
  } else if (upload.status == UPLOAD_FILE_END) {
    if (!otaUploadAutorizado) return;
    if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
    bool ok = Update.end(true);
    if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
    if (ok) {
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
    // Confere o cabecalho gzip (magic 1F 8B) antes de anunciar a versao comprimida.
    // Se o .gz estiver corrompido no flash, cai para o arquivo bruto em vez de
    // devolver uma pagina que o navegador nao consegue decodificar
    // (ERR_CONTENT_DECODING_FAILED).
    File teste = fsPtr->open((caminho + ".gz").c_str(), "r");
    if (teste) {
      uint8_t magic[2] = {0, 0};
      size_t lidos = teste.read(magic, 2);
      teste.close();
      usarGzip = (lidos == 2 && magic[0] == 0x1F && magic[1] == 0x8B);
    }
    if (usarGzip) envio = caminho + ".gz";
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

  // O WebServer (_streamFileCore) ja adiciona "Content-Encoding: gzip" quando o
  // nome do arquivo termina em ".gz". Nao repetir o header aqui: duplicado, o
  // navegador tenta descomprimir duas vezes e cancela o carregamento
  // (net::ERR_CONTENT_DECODING_FAILED).
  server.sendHeader("Vary", "Accept-Encoding");
  if (caminho.startsWith("/painel/vendor/")) {
    // Bibliotecas com a versao no nome do arquivo nunca mudam: podem ficar em
    // cache. Os demais arquivos do painel usam no-store para que um novo
    // painel:deploy apareca imediatamente no tablet.
    server.sendHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    // O painel e atualizado por upload; sem cache evita rodar JS antigo.
    server.sendHeader("Cache-Control", "no-store, max-age=0");
  }
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
    if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
    if (fsPtr->exists(painelUploadCaminho.c_str())) fsPtr->remove(painelUploadCaminho.c_str());
    painelUploadArquivo = fsPtr->open(painelUploadCaminho.c_str(), "w");
    if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
    if (!painelUploadArquivo) {
      painelUploadFalhou = true;
      painelUploadErro = "falha ao criar arquivo temporario";
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (!painelUploadAutorizado || painelUploadFalhou) return;

    if (painelUploadBytes + upload.currentSize > PAINEL_MAX_ARQUIVO) {
      painelUploadFalhou = true;
      painelUploadErro = "arquivo maior que 512 KB";
      if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
      if (painelUploadArquivo) painelUploadArquivo.close();
      if (fsPtr && fsPtr->exists(painelUploadCaminho.c_str())) fsPtr->remove(painelUploadCaminho.c_str());
      if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
      return;
    }

    // Gravar na flash desliga o cache dos dois núcleos: sem a trava, a escrita
    // pode cair no meio de uma transação I2C do PN532 (Core 0).
    if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
    bool gravouBloco = painelUploadArquivo &&
                       painelUploadArquivo.write(upload.buf, upload.currentSize) == upload.currentSize;
    if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);

    if (!gravouBloco) {
      painelUploadFalhou = true;
      painelUploadErro = "falha ao gravar na Flash";
      if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
      if (painelUploadArquivo) painelUploadArquivo.close();
      if (fsPtr && fsPtr->exists(painelUploadCaminho.c_str())) fsPtr->remove(painelUploadCaminho.c_str());
      if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
      return;
    }
    painelUploadBytes += upload.currentSize;
  } else if (upload.status == UPLOAD_FILE_END) {
    if (!painelUploadAutorizado) return;
    if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
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
    if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
    if (painelUploadArquivo) painelUploadArquivo.close();
    if (fsPtr && !painelUploadCaminho.isEmpty() && fsPtr->exists(painelUploadCaminho.c_str())) {
      fsPtr->remove(painelUploadCaminho.c_str());
    }
    if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
    painelUploadFalhou = true;
    painelUploadErro = "upload abortado";
  }
}

void rotaBioIniciar() {
  if (!bioOk) return responderErro(503, "Sensor biometrico AS608/FPM10A nao detectado nos pinos 18/17.");
  uint16_t id = 0;
  if (server.hasArg("plain")) {
    JsonDocument body;
    if (deserializeJson(body, server.arg("plain")) == DeserializationError::Ok) {
      id = body["id"] | 0;
    }
  }
  if (id == 0 && server.hasArg("id")) id = server.arg("id").toInt();
  if (id < 1 || id > 300) return responderErro(400, "Posicao de biometria invalida (use 1 a 300).");

  bioCadastroId = id;
  bioCadastroInicioMs = millis();
  bioCadastroAtivo = true;
  String msgInicio = "Posicao #" + String(id) + ": encoste o dedo no sensor optico (1a leitura)...";
  bioDefinirEtapa("aguardando_dedo_1", msgInicio);

  JsonDocument resp;
  resp["ok"] = true;
  resp["id"] = id;
  resp["etapa"] = bioEtapaAtual();
  resp["mensagem"] = msgInicio;
  String s;
  serializeJson(resp, s);
  responderJson(200, s);
}

void rotaBioStatus() {
  String etapa, msg;
  bioCopiarEstado(etapa, msg);
  uint16_t id = bioCadastroId;

  JsonDocument resp;
  resp["ok"] = true;
  resp["ativo"] = bioCadastroAtivo;
  resp["id"] = id;
  resp["etapa"] = etapa;
  resp["mensagem"] = msg;
  if (etapa == "concluido" && id >= 1) {
    resp["uid_virtual"] = gerarUidVirtualBio(id);
  }
  String s;
  serializeJson(resp, s);
  responderJson(200, s);
}

void rotaBioCancelar() {
  bioCadastroAtivo = false;
  bioDefinirEtapa("inativo", "Cadastro cancelado.");
  responderJson(200, "{\"ok\":true,\"cancelado\":true}");
}

void rotaBioExcluir() {
  if (!bioOk) return responderErro(503, "Sensor biometrico ausente.");
  uint16_t id = 0;
  if (server.hasArg("plain")) {
    JsonDocument body;
    if (deserializeJson(body, server.arg("plain")) == DeserializationError::Ok) {
      id = body["id"] | 0;
    }
  }
  if (id == 0 && server.hasArg("id")) id = server.arg("id").toInt();
  if (id < 1 || id > 300) return responderErro(400, "Posicao de biometria invalida (use 1 a 300).");

  // A UART1 é da tarefa NFC (Core 0): enfileira o pedido e aguarda o resultado
  // em vez de escrever no mesmo fio enquanto a leitura passiva acontece.
  bioExcluirId = id;
  bioExcluirResultado = -1;
  bioExcluirPronto = false;
  bioExcluirPendente = true;

  uint32_t esperaInicio = millis();
  while (!bioExcluirPronto && (millis() - esperaInicio) < 1500) delay(10);

  int rc = bioExcluirPronto ? bioExcluirResultado : -2;
  if (!bioExcluirPronto) bioExcluirPendente = false;

  JsonDocument resp;
  resp["ok"] = (rc == 0x00);
  resp["id"] = id;
  resp["removido"] = (rc == 0x00);
  if (rc == -2) resp["erro"] = "A tarefa NFC nao concluiu a exclusao em 1,5 s.";
  String s;
  serializeJson(resp, s);
  responderJson(200, s);
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
  server.on("/api/biometria/iniciar",  HTTP_POST, rotaBioIniciar);
  server.on("/api/biometria/status",   HTTP_GET,  rotaBioStatus);
  server.on("/api/biometria/cancelar", HTTP_POST, rotaBioCancelar);
  server.on("/api/biometria/excluir",  HTTP_POST, rotaBioExcluir);
  server.on("/api/ultimo",    HTTP_GET,    rotaUltimoCartao);
  server.on("/api/log",       HTTP_GET,    rotaObterLog);
  server.on("/api/log",       HTTP_DELETE, rotaLimparLog);
  server.on("/api/status",    HTTP_GET,    rotaStatusSistema);
  server.on("/api/diagnostico", HTTP_GET,  rotaDiagnostico);
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

  uint32_t bootInicio = millis();
  travaLog = xSemaphoreCreateMutex();
  travaDiag = xSemaphoreCreateMutex();

  Serial.println("\n==========================================");
  Serial.println("  Controle de Acesso NFC - ESP32-S3 N16R8 ");
  Serial.println("==========================================");
  logSerial(String("[BOOT] Versao ") + FW_VERSAO + " | heap inicial " + String(ESP.getFreeHeap()) + " bytes", "info");

  // Inicializa LED RGB no GPIO 48
  rgb.begin();
  rgb.setBrightness(45);
  aplicarCorLed(0, 30, 60);

  travaDados = xSemaphoreCreateMutex();
  travaUltimo = xSemaphoreCreateMutex();
  travaBio = xSemaphoreCreateMutex();
  travaResultadoNfc = xSemaphoreCreateMutex();
  travaNfcFlash = xSemaphoreCreateMutex();

#if PINO_SAIDA >= 0
  pinMode(PINO_SAIDA, OUTPUT);
  digitalWrite(PINO_SAIDA, !SAIDA_NIVEL_ATIVO);
#endif

  // Executa diagnóstico detalhado e monta LittleFS ou FFat
  uint32_t marcaFs = millis();
  inicializarArquivosDados();
  logSerial(String("[BOOT] Sistema de arquivos pronto em ") + String(millis() - marcaFs) + " ms | heap " + String(ESP.getFreeHeap()), "info");

  // Inicia I2C no ESP32-S3 (pinos 8 e 9)
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setTimeOut(50); // Timeout para evitar travamento se os fios do leitor soltarem
  uint32_t marcaNfc = millis();
  if (travaNfcFlash) xSemaphoreTake(travaNfcFlash, portMAX_DELAY);
  nfcOk = iniciarPN532(true);
  if (travaNfcFlash) xSemaphoreGive(travaNfcFlash);
  bioOk = iniciarBiometria(true);
  logSerial(String("[BOOT] Biometria AS608/FPM10A ") + (bioOk ? "OK" : "AUSENTE (opcional)"), bioOk ? "ok" : "info");
  logSerial(String("[BOOT] PN532 ") + (nfcOk ? "OK" : "AUSENTE") + " em " + String(millis() - marcaNfc) + " ms", nfcOk ? "ok" : "err");

  // Cria a tarefa de leitura do NFC no CORE 0 ANTES do Wi-Fi: o leitor funciona
  // mesmo que a rede demore (o boot espera até 20 s pelo roteador, e antes
  // nenhum cartão era lido nesse intervalo). Stack maior porque a tarefa
  // desserializa JSON ao validar o cartão.
  xTaskCreatePinnedToCore(
    tarefaNFC,
    "Tarefa_NFC",
    8192,
    NULL,
    1,
    NULL,
    0
  );

  uint32_t marcaWifi = millis();
  iniciarConexaoWiFi();
  logSerial(String("[BOOT] Wi-Fi tratado em ") + String(millis() - marcaWifi) + " ms | IP " + (modoAP ? WiFi.softAPIP().toString() : WiFi.localIP().toString()), "info");
  configurarRotasServidor();
  server.begin();
  logSerial(String("[BOOT] Servidor HTTP iniciado | heap ") + String(ESP.getFreeHeap()) + " | PSRAM " + String(ESP.getFreePsram()), "info");

  diagUltimoLoopMs = millis();
  diagUltimoHeartbeatMs = millis();
  logSerial(String("[BOOT] Sistema operacional em ") + String(millis() - bootInicio) + " ms | heap " + String(ESP.getFreeHeap()) + " | stack loop " + String(uxTaskGetStackHighWaterMark(NULL)), "ok");
  Serial.println("\nSistema operacional! Aproxime uma tag NFC...");
}

void loop() {
  uint32_t inicioLoopUs = micros();
  uint32_t agoraMs = millis();

  // Gap entre iterações: agora mede do FIM da iteração anterior até o início
  // desta. Antes era de início para início, então qualquer requisição HTTP
  // lenta (ex.: /api/log lendo 39 ms de flash) era contada como "engasgo".
  if (diagUltimoLoopMs != 0) {
    uint32_t gapMs = agoraMs - diagUltimoLoopMs;
    if (gapMs >= DIAG_LIMIAR_LOOP_MS) {
      diagEngasgos++;
      registrarEventoDiag("LOOP", gapMs, "gap entre iteracoes do loop");
    }
  }

  uint32_t inicioHttpUs = micros();
  server.handleClient();
  uint32_t httpMs = (micros() - inicioHttpUs) / 1000;
  if (httpMs > diagHttpMaxMs) diagHttpMaxMs = httpMs;
  if (httpMs >= DIAG_LIMIAR_HTTP_MS) {
    registrarEventoDiag("HTTP", httpMs, server.uri());
  }

  dnsServer.processNextRequest(); // portal cativo (sem efeito fora do modo AP)
  processarTentativaWifi();
  processarScanWifi();           // coleta a varredura de Wi-Fi assíncrona
  atualizarSaidaFechadura();
  atualizarLedStatus();
  gravarHistoricoSePreciso(); // grava o histórico em lote (no máximo a cada 1,5 s)

  uint32_t totalMs = (micros() - inicioLoopUs) / 1000;
  if (totalMs > diagLoopMaxMs) diagLoopMaxMs = totalMs;
  diagLoopSomaMs += totalMs;
  diagLoopAmostras++;

  if (millis() - diagUltimoHeartbeatMs >= 60000) {
    diagUltimoHeartbeatMs = millis();
    uint32_t mediaMs = diagLoopAmostras ? (diagLoopSomaMs / diagLoopAmostras) : 0;
    char linha[240];
    snprintf(linha, sizeof(linha),
             "loop avg %lu max %lu ms | HTTP max %lu | NFC max %lu | FS max %lu | engasgos %lu | heap %lu min %lu | PSRAM %lu | RSSI %d | stack loop %u NFC %u",
             (unsigned long)mediaMs, (unsigned long)diagLoopMaxMs,
             (unsigned long)diagHttpMaxMs, (unsigned long)diagNfcMaxMs,
             (unsigned long)diagFsMaxMs, (unsigned long)diagEngasgos,
             (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMinFreeHeap(),
             (unsigned long)ESP.getFreePsram(), WiFi.RSSI(),
             (unsigned)uxTaskGetStackHighWaterMark(NULL),
             (unsigned)diagNfcStackMin);
    logSerial(String("[DIAG] ") + linha, "info");
    // A média é do intervalo de 60 s; zerar evita erro depois de ~50 dias de
    // uptime, quando o somatório de 32 bits estoura.
    diagLoopSomaMs = 0;
    diagLoopAmostras = 0;
  }

  diagUltimoLoopMs = millis();
  delay(2);
}
