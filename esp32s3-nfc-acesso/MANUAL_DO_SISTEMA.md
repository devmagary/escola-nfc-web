# Manual Completo: Sistema de Controle de Acesso NFC no ESP32-S3

Este guia foi elaborado para explicar detalhadamente como o sistema foi construído, como ligar os componentes físicos, como gravar o programa na placa, como utilizar as ferramentas sem fio (Console e OTA) e como sincronizar a memória com a plataforma escolar na nuvem.

---

## 1. O que é este sistema e como ele funciona?

Pense neste projeto como uma **fechadura digital inteligente e autônoma**, projetada para portarias escolares e corporativas.

Ele une **dupla camada de segurança**:
1. **Operação 100% Offline (Local):** Mesmo se a internet da escola cair, o ESP32 continua liberando ou bloqueando alunos em **0 milissegundos**, consultando sua memória Flash interna (`cartoes.json`).
2. **Sincronização com a Nuvem (Supabase):** Quando conectado ao Wi-Fi, o ESP32 recebe atualizações em tempo real enviadas pela Secretaria ou Direção através da plataforma web.

### Arquitetura de Dois Núcleos (FreeRTOS Dual-Core):
* **Núcleo 0 (Core 0):** Cuida exclusivamente da leitura contínua das tags NFC (PN532 a 13.56 MHz) e da verificação ativa da saúde do leitor via I2C a cada 2.5s.
* **Núcleo 1 (Core 1):** Mantém no ar o Servidor Web completo, a API REST com suporte a CORS, o Console Serial Web e o atualizador OTA sem fio.
* **Resultado:** Você pode monitorar pelo celular ou enviar um novo firmware e, no mesmo milissegundo, encostar um cartão: **o sistema não trava nem engasga**.

### 1.1. O que o rádio do ESP32-S3 realmente suporta (Wi-Fi 5 x Wi-Fi 4)

É comum confundir os nomes. O ESP32-S3 tem **Bluetooth 5 (LE)** — esse "5" é do Bluetooth — e **Wi-Fi 4 (802.11 b/g/n)**, que opera **apenas em 2,4 GHz**. Ele **não possui rádio de 5 GHz**, portanto **não conecta em redes Wi-Fi 5 (802.11ac) nem Wi-Fi 6 (802.11ax)**. Isso é característica do hardware, não do firmware: nenhum ajuste no código do ESP32-S3 habilita 5 GHz.

| Recurso | ESP32-S3 | Usado neste sistema? |
| :--- | :--- | :--- |
| Wi-Fi 4 — 802.11 b/g/n, 2,4 GHz | ✅ Sim | ✅ Sim (painel, AP de configuração, sincronização) |
| Wi-Fi 5 / Wi-Fi 6 — 802.11ac/ax, 5 GHz | ❌ Não | ❌ Impossível neste chip |
| Bluetooth 5 (LE), com 2 Mbps PHY e Coded PHY (long range) | ✅ Sim | ❌ Não (disponível para evoluções futuras) |
| Bluetooth Classic (A2DP, SPP) | ❌ Não | — |

> [!IMPORTANT]
> Se a rede da escola existir **somente em 5 GHz**, o ESP32-S3 não conseguirá conectá-la. Nesse caso, habilite o SSID de 2,4 GHz no roteador (a maioria dos roteadores oferece as duas faixas) ou troque a placa por uma com rádio dual-band (por exemplo, o **ESP32-C5**, que também faria mudanças no código e na pinagem).
>
> Para conferir o modelo real da placa, veja o campo `chip` em `GET /api/status` ou a página `/wifi`. Fontes oficiais: [ESP32-S3 na Espressif](https://www.espressif.com/en/products/socs/esp32-s3) e [datasheet do ESP32-S3](https://documentation.espressif.com/esp32-s3_datasheet_en.pdf).

---

## 2. Montagem Física e Conexões

### 2.1. Componentes Utilizados
* **Placa YD-ESP32-S3 (versão N16R8):**
  * 16 Megabytes de memória Flash interna.
  * 8 Megabytes de memória Octal PSRAM rápida.
  * Duas portas USB-C (USB Nativo OTG e UART/COM).
  * LED RGB multicolorido WS2812B soldado na placa (GPIO 48).
* **Módulo Leitor PN532 (placa vermelha):**
  * Responsável por emitir o campo de rádio e ler as tags Mifare / NFC (13.56 MHz).

---

### 2.2. Configuração das Chaves Seletoras do PN532
O módulo PN532 possui duas pequenas chavinhas brancas numeradas **1** e **2**. Elas definem o protocolo de comunicação. Para operar em **I2C**, configure:
* **Chave 1:** `ON` (Ligada / para cima)
* **Chave 2:** `OFF` (Desligada / para baixo)

---

### 2.3. Ligação dos Fios (Passo a Passo)

| Pino do Leitor PN532 | Pino no ESP32-S3 | Função | Explicação |
| :--- | :--- | :--- | :--- |
| **VCC** | **3V3** (ou **5V**) | Alimentação | Entrega energia ao leitor. *(3.3V recomendado).* |
| **GND** | **GND** | Terra (Negativo) | Referência elétrica comum. |
| **SDA** | **GPIO 8** (Barra amarela) | Dados I2C | Linha de comunicação de dados. |
| **SCL** | **GPIO 9** (Barra amarela) | Clock I2C | Linha de sincronismo do barramento I2C. |

> [!WARNING]
> **Pinos Protegidos no S3 N16R8:**
> Os pinos **35, 36 e 37** são dedicados à memória PSRAM de 8 MB da placa. **Nunca ligue nada neles**, sob risco de travamento do microcontrolador.

---

### 2.4. Ligação Opcional de Relé / Fechadura
Para acionar uma fechadura eletroímã, solenoide ou catraca:
* Conecte o sinal de controle do relé em um pino seguro (ex: **GPIO 4** ou **GPIO 6**).
* No código `esp32s3-nfc-acesso.ino`, altere `#define PINO_SAIDA -1` para `#define PINO_SAIDA 4`.

---

## 3. O LED RGB Integrado (Tabela de Cores e Estados)

O LED RGB soldado na placa (no **GPIO 48**) fornece diagnóstico visual imediato sem ambiguidade:

| Cor do LED | Comportamento | O que significa? |
| :--- | :--- | :--- |
| 🌊 **Ciano Suave** | Efeito respiração (*breathing*) contínuo | **Standby Normal:** Wi-Fi conectado e leitor PN532 online, pronto para leitura. |
| 🟢 **Verde Brilhante** | Aceso fixo por 2 segundos | **Acesso Liberado! (Exclusivo):** Aluno/usuário cadastrado e ativo. Fechadura acionada. |
| 🔴 **Vermelho Vivo** | Aceso fixo por 2 segundos | **Acesso Negado:** Cartão não cadastrado ou aluno bloqueado pela direção. |
| 🚨 **Vermelho Piscando** | Pisca rápido repetidamente | **Falha de Hardware PN532:** Módulo solto, desconectado ou sem resposta no I2C (pinos 8/9). |
| 🟣 **Roxo Suave** | Aceso fixo | **Modo Ponto de Acesso (AP):** Wi-Fi não encontrado; rede própria `ControleAcesso-S3` ativa. |
| 🔷 **Azul Piscando** | Pisca a cada ~0,7 s | **Conectando:** A placa está tentando entrar na rede escolhida na página `/wifi`. |
| 🔵 **Azul Suave** | Aceso fixo durante o boot | **Inicializando:** Conectando ao Wi-Fi e montando sistema de arquivos Flash. |

---

## 4. Como Gravar o Programa na Placa

### 4.1. Bibliotecas Necessárias na Arduino IDE
No **Gerenciador de Bibliotecas** (`Ctrl + Shift + I`), instale:
* **Adafruit PN532** (e confirme a dependência *Adafruit BusIO*).
* **Adafruit NeoPixel** (para o LED WS2812B).
* **ArduinoJson** (versão 7.x).

---

### 4.2. Configuração da Arduino IDE para ESP32-S3 N16R8
No menu **Ferramentas (Tools)**:
* **Placa:** `ESP32S3 Dev Module`
* **USB CDC On Boot:** `Enabled`
* **Flash Size:** `16MB (128Mb)`
* **PSRAM:** `OPI PSRAM`
* **Partition Scheme:** Escolha uma partição com suporte a OTA, como:
  * `16M Flash (3MB APP/9.9MB FATFS)` ou `16M Flash (2x 3MB App, 8MB FatFS)`.

---

### 4.3. Configurando Wi-Fi e Credenciais

A rede Wi-Fi pode ser configurada **sem recompilar o código**, direto pelo celular (veja a seção 5.3). As constantes no início de `esp32s3-nfc-acesso.ino` servem apenas como **semente para a primeira inicialização** (ou para placas que nunca foram configuradas pela web):

```cpp
const char* WIFI_SSID  = "SuaRedeWifi";
const char* WIFI_SENHA = "SuaSenhaWifi";

const char* AP_SSID  = "ControleAcesso-S3";
const char* AP_SENHA = "12345678";   // senha mínima de 8 caracteres (WPA2)

const char* ADMIN_USUARIO = "admin";
const char* ADMIN_SENHA   = "admin123"; // Altere para sua senha segura!
```

> [!NOTE]
> Depois que a rede é configurada pela página `/wifi`, a placa passa a usar a rede gravada na memória **NVS** — que sobrevive a desligamentos e a atualizações OTA. As constantes acima deixam de ser usadas até que você use o botão “Esquecer rede”.

---

## 5. Ferramentas Web Sem Cabos (Desenvolvimento e Monitoramento)

Uma vez gravado o código na placa, você **não precisa mais do cabo USB**. Todas as ferramentas rodam pelo navegador do celular ou PC:

### 5.1. Console Serial Remoto via Wi-Fi (`/console`)
* **Endereço:** `http://<ip-do-esp>/console` *(ex: `http://192.168.0.73/console` ou `http://nfc.local/console`)*
* **Recursos do Console:**
  * Terminal com auto-scroll e cores para cada evento.
  * **📡 Botão "Testar PN532":** Executa ping I2C e exibe versão do firmware do leitor.
  * **📊 Botão "Diagnóstico":** Exibe IP, sinal RSSI, Uptime e memória RAM livre (Heap interna e PSRAM).
  * **🔄 Botão "Reiniciar ESP32":** Reinicialização remota com 1 toque.
  * **⏸️ Pausar Rolagem / Limpar Tela:** Para inspecionar mensagens pausadas.

---

### 5.2. Atualização de Firmware Sem Cabos OTA (`/ota`)
* **Endereço:** `http://<ip-do-esp>/ota`
* **Fluxo de atualização sem cabo USB:**
  1. No computador, altere o código na Arduino IDE.
  2. Vá em **Sketch > Exportar Binário Compilado** (`Ctrl + Alt + S`). O arquivo `.bin` será gerado.
  3. No celular ou PC, abra `http://<ip-do-esp>/ota`.
  4. Toque no quadro de arquivo, selecione o arquivo `.bin` exportado e clique em **"Gravar Firmware via Wi-Fi"**.
  5. A barra de progresso mostrará o envio (0% a 100%) e a placa reiniciará automaticamente com o novo código!

---

### 5.3. Configuração de Wi-Fi Sem Recompilar (`/wifi`)

Se a placa não encontrar a rede salva (escola mudou a senha, roteador novo, primeira instalação), ela cria a rede de configuração:

1. No celular, abra as redes Wi-Fi e conecte em **`ControleAcesso-S3`** com a senha `12345678` (definida em `AP_SENHA`).
2. O **portal cativo** abre sozinho. Se não abrir, acesse `http://192.168.4.1/wifi` no navegador.
3. Toque na rede desejada na lista (somente **2,4 GHz** aparecem — redes de 5 GHz não são visíveis para o ESP32).
4. Digite a senha e toque em **“Conectar e salvar”**.
   * A lista atualiza sozinha a cada 5 s; o botão **🔄 Atualizar** força uma nova varredura.
   * O LED fica **azul piscando** enquanto a tentativa está em andamento (até 20 s).
   * Senha errada: a página mostra o motivo e a placa **continua no modo AP**, sem reiniciar.
   * Senha correta: a rede é gravada na NVS, o LED fica verde e a placa **reinicia já conectada**. Anote o IP mostrado (ou use `http://nfc.local`).
5. Depois do reinício, conecte o celular na mesma rede Wi-Fi da escola e abra `http://<ip>/` ou `http://nfc.local/`.

**Trocar de rede mais tarde:** abra o painel e toque em **⚙️ Configurar Wi-Fi** → **“Esquecer rede e voltar ao modo AP”**. A placa reinicia na rede `ControleAcesso-S3` e você repete o passo 3.

**Recuperação:** a rede `ControleAcesso-S3` sempre volta a aparecer quando a rede salva não é encontrada no boot. Se você esquecer a senha do AP, ela está em `AP_SENHA`, no código-fonte.

> [!WARNING]
> O ESP32-S3 não é compatível com redes **5 GHz** (o rádio é 802.11 b/g/n em 2,4 GHz — veja a seção 1.1) nem com **WPA2-Enterprise** (aquelas com usuário e senha da escola). Use a rede de 2,4 GHz com senha única (WPA2/WPA3-Pessoal) ou uma rede aberta.

---

## 6. Sincronização Híbrida com a Plataforma Escolar

O ESP32 trabalha de forma integrada com a aplicação web escolar ([escola-nfc-web](file:///c:/Users/devma/.gemini/antigravity/scratch/sigeduc-auto/escola-nfc-web)):

### Rotas de Sincronização da API REST:
* `POST /api/sincronizar_aluno`:
  * Envia `{ "uid": "2C:9D:7E:8E", "nome": "Lucas Silva", "ativo": false }`.
  * Atualiza o status do aluno na Flash imediatamente. O LED já responderá vermelho no próximo toque.
* `POST /api/sincronizar_todos`:
  * Envia um array JSON com todos os alunos cadastrados no Supabase.
  * Grava a base inteira em lote na Flash com persistência permanente.
* `POST /api/remover_aluno`:
  * Remove o UID da lista interna quando o aluno é excluído do sistema.
* `GET /api/ultimo`:
  * Fornece à tela da Portaria o último cartão lido com contador de sequência (`seq`) para disparo instantâneo da ficha do aluno.

### Rotas do Painel Web (LittleFS):
* `GET /painel/`: serve o painel web completo (HTML/CSS/JS) na mesma origem da API. É público (o login é feito no Supabase dentro do painel).
* `GET /painel/...`: serve arquivos estáticos; se existir a versão `.gz` e o navegador aceitar gzip, envia comprimido.
* `POST /api/painel/upload?path=/painel/...`: recebe um arquivo multipart (campo `arquivo`) e grava no LittleFS. Exige o login Basic do painel da placa (`ADMIN_USUARIO`/`ADMIN_SENHA`).
* O envio é feito pelo repositório web: `npm run painel:deploy -- --esp http://IP-DO-ESP`.

### Rotas de Configuração de Wi-Fi:
* `GET /wifi`: Página de configuração (aberta no modo AP; exige login do painel quando já conectado).
* `GET /api/wifi/estado`: Modo atual, rede salva, IP, clientes do AP e andamento da tentativa de conexão. **Nunca devolve a senha.**
* `GET /api/wifi/scan`: Lista de redes 2,4 GHz (`ssid`, `rssi`, `canal`, `seguranca`, `aberta`), com cache de 4 s; `?forcar=1` refaz a varredura.
* `POST /api/wifi/conectar`: Corpo JSON `{"ssid":"...","senha":"..."}`. Inicia a tentativa em segundo plano (não bloqueia o NFC nem o painel) e devolve `202`.
* `POST /api/wifi/esquecer`: Apaga a rede da NVS e reinicia no modo AP.

---

## 7. Estrutura de Arquivos do Módulo ESP32

```text
esp32s3-nfc-acesso/
├── esp32s3-nfc-acesso.ino     -> Firmware principal (FreeRTOS Dual-Core, LittleFS, PN532, API REST)
├── pagina_web.h               -> Interface web do Painel Autônomo da placa
├── pagina_wifi.h              -> Página de configuração de Wi-Fi (varredura, senha e conexão)
├── web_ferramentas.h          -> Código HTML/JS do Console Serial Web e do Atualizador OTA
├── GUIA_DE_PINOS_E_EXPANSAO.md -> Mapeamento de pinos do ESP32-S3 e periféricos
├── GUIA_37_SENSORES_ESP32.md   -> Guia prático de integração de sensores extras
└── MANUAL_DO_SISTEMA.md       -> Este manual oficial
```
