# Enciclopédia Prática dos 37 Módulos de Sensores para ESP32-S3

Este guia foi elaborado para ser o seu **manual definitivo** de exploração do seu Kit de 37 Sensores utilizando o **ESP32-S3** e a sua **Placa de Expansão (GPIO Extension Board)**.

Aqui você aprenderá:
* O que cada módulo é e o que ele faz fisicamente (sem termos complicados).
* Ideias de projetos reais para usar cada um.
* A ligação exata nas fileiras da placa de expansão (**G**, **V**, **S**).
* A lógica de código para testar e fazê-los funcionar.

---

## 🧭 O Padrão Universal de Ligação na sua Placa de Expansão

Lembre-se do que vimos no guia anterior sobre as três cores da sua placa:
* **G (Preto):** Conecta no pino negativo do módulo (frequentemente marcado como `-` ou `GND`).
* **V (Vermelho):** Conecta no pino de alimentação (marcado como `+`, `VCC` ou `3.3V/5V`).
* **S (Amarelo):** Conecta no pino de sinal do módulo (marcado como `S`, `OUT`, `DO` ou `AO`).

> [!IMPORTANT]
> **Atenção aos 3.3V do ESP32-S3:**
> Quase todos os módulos analógicos e digitais deste kit funcionam perfeitamente em **3.3V**. Dê sempre preferência para a fileira de 3.3V para proteger as entradas do chip. As poucas exceções (como o Módulo Relé de 5V) estão destacadas no guia.
> Lembre-se também de **nunca usar os pinos 35, 36 e 37** (reservados para a memória PSRAM).

---

## 📑 Índice dos 37 Módulos

### 🔊 Som, Áudio e Luzes (Atuadores e Emissores)
1. Módulo Buzzer Passivo
2. Módulo Buzzer Ativo
3. Módulo Emissor Laser
4. Módulo Sensor de Emissão Infravermelho (LED IR)
5. Módulo LED 3 Cores (RGB 5mm)
6. Módulo LED SMD 3 Cores (RGB de Superfície)
7. Módulo LED Duas Cores (Catodo/Anodo Comum)
8. Módulo LED Bicolor 3mm
9. Módulo LED Pisca Multicolorido Automático (7 Cores)

### 🔘 Toque, Movimento, Vibração e Chaves
10. Módulo de Chave (Botão Táctil / Push-Button)
11. Módulo Sensor de Batida (Knock Sensor)
12. Módulo Sensor de Vibração (Chave de Mola)
13. Módulo Sensor TILT (Inclinação e Impacto com Esfera)
14. Módulo de Inclinação TILT com Chave de Mercúrio
15. Módulo de Inclinação com LED (Magic Light Cup)
16. Módulo Chave Óptica (Sensor de Fenda)
17. Módulo Encoder Rotativo (Knob infinito com clique)
18. Módulo Joystick XY-Eixo com Botão
19. Módulo Sensor de Toque de Metal (Touch)

### 🧲 Sensores Magnéticos
20. Módulo Mini Reed Magnético
21. Módulo Ampola Reed Grande
22. Módulo Sensor Magnético Hall (Digital)
23. Módulo Sensor Hall Linear (Analógico Simples)
24. Módulo Sensor Hall Linear com Ajuste Digital (Trimpot)

### 🌡️ Temperatura, Clima e Fogo
25. Módulo Sensor de Temperatura PTC (Termistor Simples)
26. Módulo Sensor de Temperatura PTC com Ajuste Digital (Trimpot)
27. Módulo Sensor de Temperatura Digital DS18B20 (Alta Precisão 1-Wire)
28. Módulo Sensor de Temperatura e Umidade (DHT11)
29. Módulo Sensor de Chama (Detector de Fogo)

### 👁️ Luz, Visão e Presença
30. Módulo LDR (Sensor de Luminosidade / Fotoresistor)
31. Módulo Receptor Infravermelho 38 kHz (Controles Remotos)
32. Módulo Desvio de Obstáculo Infravermelho (Sensor de Proximidade)
33. Módulo Seguidor de Linha (Sensor de Refletância)
34. Módulo Detector de Batimentos Cardíacos (Fotopletismografia)

### 🎙️ Microfones e Acionamento de Potência
35. Módulo Microfone de Som Pequeno
36. Módulo Microfone de Som Grande com Ajuste Digital
37. Módulo de Relé 5V (Controle de Cargas e Lâmpadas)

---

# 📚 Detalhamento Módulo por Módulo

---

## 1. Módulo Buzzer Passivo

* **O que é e como funciona:** É como um mini alto-falante sem amplificador próprio. Ele possui uma pastilha piezoelétrica que só vibra se você enviar ondas de frequência alternadas (pulsos elétricos rápidos). Se você ligar nele apenas energia contínua (3.3V), ele faz apenas um clique seco e silencia.
* **Para que serve:** Tocar melodias completas, tons de videogame (8-bit), bips de confirmação com frequências variadas, alarmes musicais.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `+` ou meio -> **V** (3.3V)
  * `S` -> **S** (Pino **IO4**)
* **Base de código:**
  ```cpp
  // O ESP32 possui a função tone() nativa
  #define PINO_BUZZER 4
  void setup() {
    tone(PINO_BUZZER, 1000); // Toca tom de 1000 Hz
    delay(500);
    tone(PINO_BUZZER, 2000); // Toca tom de 2000 Hz
    delay(500);
    noTone(PINO_BUZZER);     // Para o som
  }
  void loop() {}
  ```

---

## 2. Módulo Buzzer Ativo

* **O que é e como funciona:** Diferente do passivo, o buzzer ativo possui um oscilador eletrônico embutido dentro da carcaça preta lacrada. Ele só sabe emitir um único tom contínuo e estridente (apito fixo de fábrica).
* **Para que serve:** Sirene de alarme simples, aviso sonoro de porta aberta, aviso de acesso negado no NFC.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `S` -> **S** (Pino **IO4**)
* **Base de código:**
  ```cpp
  #define PINO_BUZZER 4
  void setup() {
    pinMode(PINO_BUZZER, OUTPUT);
    digitalWrite(PINO_BUZZER, HIGH); // Liga o apito
    delay(200);
    digitalWrite(PINO_BUZZER, LOW);  // Desliga o apito
  }
  void loop() {}
  ```

---

## 3. Módulo Emissor Laser

* **O que é e como funciona:** Um diodo laser vermelho de baixa potência (650nm, 5mW) encapsulado com lente colimadora. Emite um feixe de luz vermelha perfeitamente reto e concentrado em formato de ponto.
* **Para que serve:** Barreira de segurança invisível (combinado com o sensor LDR), mira em projetos de precisão, medidores de alinhamento.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `S` -> **S** (Pino **IO5**)
* **Base de código:**
  ```cpp
  #define PINO_LASER 5
  void setup() {
    pinMode(PINO_LASER, OUTPUT);
    digitalWrite(PINO_LASER, HIGH); // Acende o ponto laser
  }
  void loop() {}
  ```

---

## 4. Módulo Sensor de Emissão Infravermelho (LED IR)

* **O que é e como funciona:** É idêntico ao LED que fica na ponta do controle remoto da sua televisão. Emite pulsos de luz infravermelha invisíveis ao olho humano (comprimento de onda de 940 nm).
* **Para que serve:** Construir um controle remoto universal Wi-Fi para comandar TV, ar-condicionado e aparelhos de som pelo celular.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `S` -> **S** (Pino **IO6**)
* **Base de código:**
  Normalmente utilizado com a biblioteca `IRremoteESP8266`.
  ```cpp
  // Exemplo de teste manual (pisca rápido)
  #define PINO_IR 6
  void setup() { pinMode(PINO_IR, OUTPUT); }
  void loop() {
    digitalWrite(PINO_IR, HIGH); delay(100);
    digitalWrite(PINO_IR, LOW); delay(100);
  }
  ```

---

## 5. Módulo LED 3 Cores (RGB 5mm)

* **O que é e como funciona:** Uma lâmpada LED redonda clássica de 5mm que contém 3 filamentos internos independentes: Vermelho (R), Verde (G) e Azul (B). Misturando as intensidades dos três, você pode gerar qualquer cor (amarelo, roxo, ciano, branco).
* **Para que serve:** Lâmpada de notificação visual de status, semáforos, luminária decorativa inteligente.
* **Como ligar no ESP32-S3:**
  * `-` (GND) -> **G**
  * `R` -> **S** (Pino **IO1**)
  * `G` -> **S** (Pino **IO2**)
  * `B` -> **S** (Pino **IO4**)
* **Base de código:**
  ```cpp
  #define PIN_R 1
  #define PIN_G 2
  #define PIN_B 4
  void setup() {
    pinMode(PIN_R, OUTPUT); pinMode(PIN_G, OUTPUT); pinMode(PIN_B, OUTPUT);
    // Acende cor ciano (Verde + Azul)
    digitalWrite(PIN_R, LOW);
    digitalWrite(PIN_G, HIGH);
    digitalWrite(PIN_B, HIGH);
  }
  void loop() {}
  ```

---

## 6. Módulo LED SMD 3 Cores (RGB de Superfície)

* **O que é e como funciona:** Faz exatamente a mesma coisa que o anterior, mas utiliza um componente plano retangular soldado na placa (SMD 5050), tornando-o mais fino e brilhante com difusão angular maior.
* **Para que serve:** Luz piloto de painéis compactos, iluminação embutida em caixas plásticas.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `R` -> **S** (Pino **IO1**)
  * `G` -> **S** (Pino **IO2**)
  * `B` -> **S** (Pino **IO4**)
* **Base de código:** Idêntico ao módulo 5.

---

## 7. Módulo LED Duas Cores (Catodo/Anodo Comum)

* **O que é e como funciona:** Possui um LED de 3 pernas capaz de acender apenas duas cores primárias: Vermelho e Verde. Se você ligar os dois ao mesmo tempo, ele produz uma terceira cor intermediária: Amarelo/Laranja.
* **Para que serve:** Indicador clássico de porta (Verde = Livre / Vermelho = Ocupado) ou carregador de bateria (Carregando = Vermelho / Cheio = Verde).
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * Pino 1 -> **S** (Pino **IO1** - Vermelho)
  * Pino 2 -> **S** (Pino **IO2** - Verde)
* **Base de código:**
  ```cpp
  void setup() {
    pinMode(1, OUTPUT); pinMode(2, OUTPUT);
    digitalWrite(1, HIGH); // Fica vermelho
    digitalWrite(2, LOW);
  }
  void loop() {}
  ```

---

## 8. Módulo LED Bicolor 3mm

* **O que é e como funciona:** Semelhante ao módulo anterior, mas em formato menor (cúpula de 3 mm) e com resistores integrados na plaquinha para proteger o LED contra queima.
* **Para que serve:** Pequenas luzes de painel discreto para caixas de comando.
* **Como ligar no ESP32-S3:**
  * Pinos idênticos ao Módulo 7 (dois pinos de controle de cor e um terra).

---

## 9. Módulo LED Pisca Multicolorido Automático (7 Cores)

* **O que é e como funciona:** É um LED que possui um minúsculo microchip embutido dentro da própria lente plástica. Você só precisa entregar energia positiva e negativa e ele começa a piscar e fazer transições suaves entre 7 cores sozinho, sem precisar de código de programação para alternar as cores.
* **Para que serve:** Efeitos visuais festivos, luz de sinalização chamativa sem gastar memória do microcontrolador.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `S` -> **S** (Pino **IO5**)
* **Base de código:**
  ```cpp
  #define PINO_LED 5
  void setup() {
    pinMode(PINO_LED, OUTPUT);
    digitalWrite(PINO_LED, HIGH); // Apenas alimenta o LED; ele pisca sozinho!
  }
  void loop() {}
  ```

---

## 10. Módulo de Chave (Botão Táctil / Push-Button)

* **O que é e como funciona:** Um botão tátil mecânico montado numa placa já com resistor pull-up/pull-down embutido. Ao ser pressionado, fecha o contato elétrico e entrega um sinal lógico (`HIGH` ou `LOW`).
* **Para que serve:** Botão de campainha, botão manual para destrancar a fechadura por dentro (botoeira), reiniciar contadores.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO6**)
* **Base de código:**
  ```cpp
  #define PINO_BOTAO 6
  void setup() {
    Serial.begin(115200);
    pinMode(PINO_BOTAO, INPUT);
  }
  void loop() {
    if (digitalRead(PINO_BOTAO) == HIGH) {
      Serial.println("Botão pressionado!");
      delay(200);
    }
  }
  ```

---

## 11. Módulo Sensor de Batida (Knock Sensor)

* **O que é e como funciona:** Dentro do cilindro preto existe um contato metálico flexível com um pequeno peso na ponta. Ao bater com os nós dos dedos na mesa ou na porta, o peso balança, encosta no polo lateral e gera um pulso elétrico momentâneo.
* **Para que serve:** Detector de batidas na porta ("Toque na madeira para abrir"), alarme anti-arrombamento.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO7**)
* **Base de código:**
  ```cpp
  #define PINO_KNOCK 7
  void setup() {
    Serial.begin(115200);
    pinMode(PINO_KNOCK, INPUT_PULLUP);
  }
  void loop() {
    if (digitalRead(PINO_KNOCK) == LOW) {
      Serial.println("Batida detectada na porta!");
      delay(100);
    }
  }
  ```

---

## 12. Módulo Sensor de Vibração (Chave de Mola)

* **O que é e como funciona:** Possui um tubo metálico com uma fina mola no centro. Ao sofrer qualquer vibração mecânica contínua (um motor ligando, uma janela vibrando ou alguém mexendo no objeto), a mola toca na carcaça e fecha o circuito centenas de vezes por segundo.
* **Para que serve:** Alarme sísmico, alarme de bicicleta/moto que dispara ao ser tocada, medidor de vibração em bombas d'água.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO7**)
* **Base de código:** Idêntico ao sensor de batida (faz leituras digitais de borda de subida/descida).

---

## 13. Módulo Sensor TILT (Inclinação com Esfera Metálica)

* **O que é e como funciona:** Possui um tubinho dourado ou preto com uma microesfera de aço livre no interior. Quando o sensor está em pé, a bolinha fica no fundo encostando nos dois terminais (circuito fechado). Se inclinar a placa mais de 45 graus, a bolinha rola para o outro lado e o circuito abre.
* **Para que serve:** Alarme de tombamento (desliga aquecedor se cair no chão), sensor de abertura de tampa de lixeira ou tampa de caixa d'água.
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO10**)
* **Base de código:**
  ```cpp
  #define PINO_TILT 10
  void setup() {
    Serial.begin(115200);
    pinMode(PINO_TILT, INPUT_PULLUP);
  }
  void loop() {
    int estado = digitalRead(PINO_TILT);
    Serial.printf("Estado: %s\n", estado ? "Inclinado" : "Na Vertical");
    delay(300);
  }
  ```

---

## 14. Módulo de Inclinação TILT com Chave de Mercúrio

* **O que é e como funciona:** Funciona de forma parecida ao de esfera, mas dentro de uma ampola de vidro selada existe uma gota líquida de mercúrio metálico. O mercúrio conduz eletricidade com suavidade e sem o ruído mecânico da esfera.
* **Para que serve:** Detecção de nível de caçambas, portas de garagem basculantes (saber se o portão está aberto na horizontal ou fechado na vertical).
* **Como ligar no ESP32-S3:**
  * Mesma pinagem e código do módulo 13. *(Nota: manuseie com cuidado para não quebrar o vidro).*

---

## 15. Módulo de Inclinação com LED (Magic Light Cup)

* **O que é e como funciona:** É a união de um sensor de inclinação com um LED na mesma placa. O projeto clássico é usar dois módulos desses em dois copos: quando você "derrama" a luz de um copo inclinando-o, o LED dele apaga e o LED do outro copo acende, criando o efeito de transferir luz de um copo para outro.
* **Para que serve:** Brinquedos interativos, maçanetas inteligentes (acende a luz ao mexer na maçaneta).
* **Como ligar no ESP32-S3:**
  * `G` -> **GND**
  * `+` -> **3.3V**
  * `S` -> **S** (Leitura da inclinação)
  * Pino do LED -> **S** (Acionamento do LED)

---

## 16. Módulo Chave Óptica (Sensor de Fenda)

* **O que é e como funciona:** Possui uma fenda em formato de "U". De um lado da fenda há um LED emissor infravermelho e do outro lado há um fototransistor receptor. Quando qualquer objeto opaco passa pelo vão da fenda, o feixe de luz é interrompido e a placa detecta na hora.
* **Para que serve:** Fim de curso em impressoras 3D, sensor de passagem de moedas, tacômetro (medidor de RPM de rodas dentadas).
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO11**)
* **Base de código:**
  ```cpp
  #define PINO_FOS 11
  void setup() {
    Serial.begin(115200);
    pinMode(PINO_FOS, INPUT);
  }
  void loop() {
    if (digitalRead(PINO_FOS) == HIGH) {
      Serial.println("Objeto bloqueando a fenda!");
    }
    delay(50);
  }
  ```

---

## 17. Módulo Encoder Rotativo

* **O que é e como funciona:** Um botão giratório digital (knob) que gira infinitamente para ambos os lados sem parar. Ele possui duas trilhas de contatos internos (fases A e B) que geram pulsos defasados em quadratura. O ESP32 consegue calcular não só quanto você girou, mas exatamente em qual sentido (horário ou anti-horário). Ele também possui clique ao ser pressionado para baixo.
* **Para que serve:** Navegar em menus de telas LCD/OLED, controle de volume inteligente, termostato digital.
* **Como ligar no ESP32-S3:**
  * `GND` -> **G**
  * `+` -> **V** (3.3V)
  * `CLK` -> **S** (Pino **IO12**)
  * `DT` -> **S** (Pino **IO13**)
  * `SW` -> **S** (Pino **IO14** - Botão do clique)
* **Base de código:**
  ```cpp
  #define PIN_CLK 12
  #define PIN_DT  13
  int ultimoCLK;
  int contador = 0;
  void setup() {
    Serial.begin(115200);
    pinMode(PIN_CLK, INPUT);
    pinMode(PIN_DT, INPUT);
    ultimoCLK = digitalRead(PIN_CLK);
  }
  void loop() {
    int atualCLK = digitalRead(PIN_CLK);
    if (atualCLK != ultimoCLK && atualCLK == 1) {
      if (digitalRead(PIN_DT) != atualCLK) contador++; else contador--;
      Serial.printf("Posição: %d\n", contador);
    }
    ultimoCLK = atualCLK;
  }
  ```

---

## 18. Módulo Joystick XY-Eixo com Botão

* **O que é e como funciona:** Idêntico à alavanca analógica de controle de videogame (PlayStation/Xbox). É formado por dois potenciômetros internos cruzados (um lê o movimento horizontal no eixo X e outro no eixo Y) e uma microchave tática acionada pelo clique para baixo.
* **Para que serve:** Controle de câmeras Pan-Tilt, controle de robôs com rodas, navegação em menus gráficos.
* **Como ligar no ESP32-S3:**
  * `GND` -> **G**
  * `5V` (ou 3.3V) -> **V**
  * `VRx` -> **S** (Pino **IO1** - Entrada Analógica ADC)
  * `VRy` -> **S** (Pino **IO2** - Entrada Analógica ADC)
  * `SW` -> **S** (Pino **IO4** - Clique do botão)
* **Base de código:**
  ```cpp
  void setup() { Serial.begin(115200); pinMode(4, INPUT_PULLUP); }
  void loop() {
    int x = analogRead(1);
    int y = analogRead(2);
    int botao = digitalRead(4);
    Serial.printf("X: %4d | Y: %4d | Botão: %s\n", x, y, botao ? "Solto" : "Clicado");
    delay(150);
  }
  ```

---

## 19. Módulo Sensor de Toque de Metal (Touch)

* **O que é e como funciona:** Possui um transistor de alto ganho ou chip sensor ligado a uma perninha metálica saliente. Ao encostar a ponta do seu dedo diretamente no terminal metálico, a resistência e o campo eletrostático do corpo humano alteram a tensão na base do circuito, comutando a saída.
* **Para que serve:** Interruptores modernos invisíveis, botões que não sofrem desgaste mecânico.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO7**)
* **Base de código:** Lido via `digitalRead(7)`.

---

## 20. Módulo Mini Reed Magnético

* **O que é e como funciona:** Dentro da cápsula de vidro existem duas lâminas ferromagnéticas ultrafinas separadas por uma fração de milímetro. Quando qualquer ímã se aproxima, o campo magnético atrai as duas lâminas e elas se tocam, fechando o contato elétrico.
* **Para que serve:** Sensor de alarme de porta e janela (o ímã fica na folha da porta e o sensor no batente).
* **Como ligar no ESP32-S3:**
  * `-` -> **G** (GND)
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO6**)
* **Base de código:**
  ```cpp
  #define PIN_REED 6
  void setup() {
    Serial.begin(115200);
    pinMode(PIN_REED, INPUT_PULLUP);
  }
  void loop() {
    if (digitalRead(PIN_REED) == LOW) {
      Serial.println("Ímã próximo (Porta Fechada)!");
    } else {
      Serial.println("Sem ímã (Porta Aberta)!");
    }
    delay(300);
  }
  ```

---

## 21. Módulo Ampola Reed Grande

* **O que é e como funciona:** Idêntico ao mini reed, porém com uma ampola de vidro maior, mais resistente à corrente e com maior sensibilidade e distância de atração magnética.
* **Para que serve:** Sensores de hidrômetros (medir fluxo de água com ímã na turbina), velocímetros de bicicleta.
* **Como ligar no ESP32-S3:** Ligação e código idênticos ao Módulo 20.

---

## 22. Módulo Sensor Magnético Hall (Digital)

* **O que é e como funciona:** Ao contrário da ampola reed (que é mecânica), o sensor Hall é um **chip eletrônico semicondutor de estado sólido**. Ele utiliza o efeito quântico/físico de Hall para detectar campos magnéticos sem nenhuma peça móvel interna, o que significa que **ele nunca desgasta**, mesmo ativando 100.000 vezes por segundo.
* **Para que serve:** Medidor de rotação de motores (RPM), sensores de virabrequim automotivo, contadores de alta velocidade.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO7**)
* **Base de código:** Lido via `digitalRead(7)` (vai a nível `LOW` na presença do polo Sul do ímã).

---

## 23. Módulo Sensor Hall Linear (Analógico Simples)

* **O que é e como funciona:** Em vez de responder apenas com "Sim/Não" (digital), este módulo entrega uma **voltagem proporcional à força e à distância do ímã**. Quanto mais perto o ímã chega, maior ou menor fica a voltagem na saída. Ele também reconhece a polaridade (Polo Norte aumenta a tensão, Polo Sul diminui).
* **Para que serve:** Medir corrente elétrica sem cortar fios, medidor de distância magnética, aceleradores eletrônicos de patinete elétrico.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO1** - Entrada Analógica ADC)
* **Base de código:**
  ```cpp
  void setup() { Serial.begin(115200); }
  void loop() {
    int campo = analogRead(1);
    Serial.printf("Intensidade magnética: %d\n", campo);
    delay(100);
  }
  ```

---

## 24. Módulo Sensor Hall Linear com Ajuste Digital (Trimpot)

* **O que é e como funciona:** Combina o sensor analógico anterior com um chip comparador de voltagem (LM393) e um pequeno parafuso de ajuste azul (trimpot). Ele possui **duas saídas ao mesmo tempo**:
  * Uma saída analógica (**AO**): que mostra o valor contínuo da força do campo.
  * Uma saída digital (**DO**): que acende um LED na placa e dispara um sinal digital apenas quando o ímã ultrapassa a distância calibrada no parafuso.
* **Como ligar no ESP32-S3:**
  * `GND` -> **G**
  * `VCC` -> **V** (3.3V)
  * `AO` -> **S** (Leitura Analógica no pino **IO1**)
  * `DO` -> **S** (Disparo Digital no pino **IO2**)

---

## 25. Módulo Sensor de Temperatura PTC (Termistor Simples)

* **O que é e como funciona:** Possui um resistor sensível ao calor (NTC/PTC). À medida que a temperatura ambiente sobe, a resistência elétrica do componente cai, variando a voltagem que chega ao ESP32.
* **Para que serve:** Termômetro analógico simples, proteção contra superaquecimento de caixas eletrônicas.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO1** - Entrada Analógica ADC)
* **Base de código:** Lido via `analogRead(1)` e convertido em graus Celsius por fórmula matemática (equação de Steinhart-Hart).

---

## 26. Módulo Sensor de Temperatura com Ajuste Digital (Trimpot)

* **O que é e como funciona:** É o termistor com o chip comparador LM393. Você gira o parafuso de calibração para definir um limite de temperatura (ex: 40°C). Ao ultrapassar esse limite, o pino digital dispara instantaneamente.
* **Para que serve:** Termostato de ventilador (liga ventoinha sozinho se esquentar).
* **Como ligar no ESP32-S3:** Mesma ligação com pinos `AO` e `DO`.

---

## 27. Módulo Sensor de Temperatura DS18B20 (Digital 1-Wire)

* **O que é e como funciona:** É um sensor de temperatura digital de precisão cirúrgica fabricado pela Dallas/Maxim. Ele possui um conversor analógico-digital de 12 bits interno e se comunica através de um protocolo inteligente chamado **1-Wire**.
* **Vantagem incrível:** Você pode ligar 10 sensores DS18B20 em paralelo no **mesmo único pino** do ESP32, e ele consegue ler a temperatura de cada um individualmente pelo número de série interno deles!
* **Para que serve:** Controle de temperatura de aquários, chocadeiras, cervejarias artesanais.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO4**)
* **Base de código:** Requer as bibliotecas `OneWire` e `DallasTemperature`.
  ```cpp
  #include <OneWire.h>
  #include <DallasTemperature.h>
  OneWire oneWire(4);
  DallasTemperature sensors(&oneWire);
  void setup() {
    Serial.begin(115200);
    sensors.begin();
  }
  void loop() {
    sensors.requestTemperatures();
    Serial.printf("Temperatura: %.2f °C\n", sensors.getTempCByIndex(0));
    delay(1000);
  }
  ```

---

## 28. Módulo Sensor Temperatura e Umidade (DHT11)

* **O que é e como funciona:** Aquela pecinha azul furadinha clássica. Dentro dela há um termistor e um sensor capacitivo de polímero que absorve a umidade do ar. Um chip interno empacota a temperatura e a umidade relativa do ar em um pacote digital serial enviado por um único fio.
* **Para que serve:** Estação meteorológica caseira, controle de umidade de estufas.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO5**)
* **Base de código:** Requer a biblioteca `DHT sensor library` da Adafruit.
  ```cpp
  #include "DHT.h"
  DHT dht(5, DHT11);
  void setup() { Serial.begin(115200); dht.begin(); }
  void loop() {
    float u = dht.readHumidity();
    float t = dht.readTemperature();
    Serial.printf("Temp: %.1f °C | Umidade: %.1f %%\n", t, u);
    delay(2000);
  }
  ```

---

## 29. Módulo Sensor de Chama (Detector de Fogo)

* **O que é e como funciona:** Possui um fototransistor com lente preta na ponta, calibrado especificamente para enxergar o espectro de luz infravermelha emitido pelo fogo real (na faixa de 760 a 1100 nm). Ele não se confunde facilmente com lâmpadas comuns, mas detecta a chama de um isqueiro ou vela a metros de distância.
* **Para que serve:** Detector de incêndio para robôs bombeiros ou automação residencial.
* **Como ligar no ESP32-S3:**
  * `GND` -> **G**
  * `VCC` -> **V** (3.3V)
  * `DO` -> **S** (Pino **IO6** - Dispara com fogo)
* **Base de código:** Lido com `digitalRead(6)`. Se for `LOW`, há presença de fogo.

---

## 30. Módulo LDR (Sensor de Luminosidade / Fotoresistor)

* **O que é e como funciona:** Possui um resistor de Sulfeto de Cádmio com uma trilha ondulada em cima. No escuro, ele bloqueia a passagem de corrente; quando a luz bate nele, elétrons se soltam e a resistência despenca.
* **Para que serve:** Relé fotoelétrico (acender as luzes do jardim automaticamente ao anoitecer), ajuste automático de brilho de telas.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO1** - Entrada Analógica ADC)
* **Base de código:**
  ```cpp
  void setup() { Serial.begin(115200); }
  void loop() {
    int luz = analogRead(1);
    Serial.printf("Claridade ambiente: %d (0=Escuro / 4095=Muito Claro)\n", luz);
    delay(200);
  }
  ```

---

## 31. Módulo Receptor Infravermelho 38 kHz (VS1838B)

* **O que é e como funciona:** É o "olho" que recebe os comandos do controle remoto da TV. Ele possui um filtro óptico metálico que rejeita luz solar e lâmpadas, captando apenas pulsos infravermelhos modulados exatamente na frequência de **38 kHz**.
* **Para que serve:** Comandar seu ESP32 usando o controle remoto que você já tem na sala (apertar botão '1' para abrir a porta, botão '2' para fechar).
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO7**)
* **Base de código:** Utiliza a biblioteca `IRremoteESP8266`.

---

## 32. Módulo Desvio de Obstáculo Infravermelho

* **O que é e como funciona:** Possui dois LEDs na ponta: um LED transparente que emite luz infravermelha para a frente e um LED preto que recebe o reflexo. Se houver uma parede ou obstáculo a poucos centímetros, a luz rebate e o sensor avisa. Possui dois parafusos de ajuste para calibrar a distância de detecção.
* **Para que serve:** Robô aspirador ou carrinho que desvia de paredes sozinho, sensor de torneira automática (detecta a mão embaixo).
* **Como ligar no ESP32-S3:**
  * `GND` -> **G**
  * `VCC` -> **V** (3.3V)
  * `OUT` -> **S** (Pino **IO6**)
* **Base de código:** Quando há obstáculo, o pino `OUT` vai para nível `LOW`.

---

## 33. Módulo Seguidor de Linha (TCRT5000)

* **O que é e como funciona:** Funciona por reflexão óptica como o anterior, mas apontado rente ao chão. A superfície branca reflete a luz infravermelha com facilidade, enquanto a linha preta pintada no chão absorve a luz. O sensor sabe exatamente se está em cima da fita preta ou do chão branco.
* **Para que serve:** Robôs seguidores de linha para competições ou fábricas autônomas.
* **Como ligar no ESP32-S3:**
  * `GND` -> **G**
  * `VCC` -> **V** (3.3V)
  * `OUT` -> **S** (Pino **IO6**)

---

## 34. Módulo Detector de Batimentos Cardíacos

* **O que é e como funciona:** Possui um LED infravermelho de alta intensidade e um fototransistor muito sensível. Ao prensar o dedo indicador entre os dois, o sensor mede a sutil variação da passagem de luz causada pela dilatação dos vasos sanguíneos a cada pulso do coração (fotopletismografia).
* **Para que serve:** Medidores simples de frequência cardíaca didáticos.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO1** - Entrada Analógica ADC)

---

## 35. Módulo Microfone de Som Pequeno

* **O que é e como funciona:** Possui uma cápsula de microfone de eletreto minúscula. Ele capta a pressão acústica do ambiente e entrega pequenas variações de tensão na saída analógica.
* **Para que serve:** Detector de palmas simples ("Ligar luz com duas palmas"), sensor de ruído ambiente.
* **Como ligar no ESP32-S3:**
  * `-` -> **G**
  * `+` -> **V** (3.3V)
  * `S` -> **S** (Pino **IO1** - Entrada Analógica ADC)

---

## 36. Módulo Microfone de Som Grande com Ajuste Digital

* **O que é e como funciona:** Possui uma cápsula de microfone maior e mais sensível, acompanhada do chip amplificador/comparador LM393 e trimpot. Possui saída analógica para ver a onda sonora e saída digital que dispara na hora em que o volume passa do limite calibrado.
* **Para que serve:** Alarme sonoro contra arrombamento de vidros, medidor de decibéis.
* **Como ligar no ESP32-S3:**
  * `GND` -> **G**
  * `VCC` -> **V** (3.3V)
  * `DO` -> **S** (Pino **IO6**)
  * `AO` -> **S** (Pino **IO1**)

---

## 37. Módulo de Relé 5V

* **O que é e como funciona:** É uma chave eletromecânica de alta potência acionada por um eletroímã interno. O ESP32 opera com apenas 3.3V fracos que não têm força para ligar lâmpadas nem fechaduras pesadas. O relé recebe esse pequeno sinal de 3.3V, puxa o contato interno com um "click" audível e permite ligar equipamentos de **110V, 220V ou fechaduras de 12V com total isolamento elétrico**.
* **Para que serve:** Destrancar fechaduras magnéticas, ligar lâmpadas da casa, ligar motores e portões.
* **Como ligar no ESP32-S3:**
  * `-` (GND) -> **G** (GND)
  * `+` (VCC) -> **V da linha de 5V** (A bobina magnética precisa de 5V da fonte/USB para ter força de atracamento)
  * `S` (IN / Sinal) -> **S** (Pino **IO4** do ESP32)
* **Base de código:**
  ```cpp
  #define PINO_RELE 4
  void setup() {
    pinMode(PINO_RELE, OUTPUT);
  }
  void loop() {
    digitalWrite(PINO_RELE, HIGH); // Fecha o contato e liga a fechadura/lâmpada
    delay(3000);
    digitalWrite(PINO_RELE, LOW);  // Abre o contato e desliga
    delay(3000);
  }
  ```

---

## 🛠️ Resumo Geral: Quais tipos de portas usar no ESP32-S3?

| Categoria do Módulo | Exemplos | Como você lê/escreve no código? |
| :--- | :--- | :--- |
| **Digitais Simples** | Botão, TILT, Reed, Batida, Vibração, Chama | `digitalRead(pino)` ou `digitalWrite(pino, HIGH/LOW)` |
| **Analógicos** | LDR, Joystick, Hall Linear, Microfone | `analogRead(pino)` (retorna de 0 a 4095) |
| **PWM (Frequência/Brilho)** | Buzzer Passivo, LED RGB | `tone(pino, freq)` ou `ledcWrite(...)` |
| **Protocolos Especiais** | DS18B20 (1-Wire), DHT11, IR 38kHz, NFC (I2C) | Utiliza bibliotecas dedicadas |
