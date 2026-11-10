# Usar o laboratório no dia a dia

Se o Docker Desktop e o projeto ainda não estão instalados, veja [02-instalar-o-docker-desktop.md](02-instalar-o-docker-desktop.md).

> **Em leigo:** o laboratório é uma "escola de mentira" que roda dentro do notebook: um banco de dados e um painel. A placa ESP32 fica na mesma rede e conversa com os dois.

## Jeito fácil: atalho na área de trabalho

**Um atalho comanda tudo: "Servidor NFC".** Dê duplo clique nele e abre o **painel de luzes** com o menu completo:

| Luz no topo | O que mostra |
|:---|:---|
| Docker | O programa que segura o banco ligado |
| Banco | O Supabase local (o que responde o sistema) |
| Painel | O site que o tablet usa |
| Placa | O ESP32 (verde = pronto; amarelo = placa viva mas leitor fora; vermelho = placa sumida) |
| Hotspot | A rede Wi-Fi `NFC-Lab` criada pelo notebook (verde = ligada; cinza = desligada) |

Itens do menu (setas + Enter, ou número + Enter):

1. **Ligar tudo** — abre o Docker, espera ligar, cria/usa o hotspot quando não há rede, sobe o banco, grava o IP no `.env.local` e abre a janela **"Painel NFC"** (o site; não feche essa janela enquanto estiver usando).
2. **Desligar tudo** — fecha o painel, guarda o banco e desliga o hotspot. Nada é apagado.
3. **Checar a saúde** — diagnóstico completo com dicas em português.
4. **Abrir o painel no navegador** — manda o navegador direto para o site.
5. **Ver os endereços** — os números para digitar no tablet (o hotspot aparece marcado).
6. **Hotspot NFC-Lab** — liga ou desliga a rede Wi-Fi do laboratório e atualiza o IP no `.env.local`.
7. **Liberar o firewall** — pede a permissão de administrador e libera a rede da escola e o hotspot.
8. **Fazer backup** — salva uma cópia dos dados na pasta do projeto.
9. **Recomeçar do zero** — APAGA tudo (pede que você digite ZERAR para confirmar).
10. **Configurar este notebook** — descobre o IP, grava as chaves no `.env.local` e mostra o endereço do painel (se a pilha estiver desligada, pergunta se quer subir para buscar as chaves).

Aperte **ESC** (ou o número **0**) para sair da tela; o que estiver ligado continua ligado.

Se preferir continuar na mão, o jeito tradicional de janelas está abaixo.

## Jeito manual: duas janelas de terminal

1. Abra o **Docker Desktop** pelo menu Iniciar e espere a baleia parar de girar.

2. No Explorador de Arquivos, entre na pasta do projeto:

```
C:\Users\devma\.gemini\antigravity\scratch\sigeduc-auto\escola-nfc-web-offline
```

Clique na barra de endereço, digite `powershell` e aperte Enter.

3. Na **janela 1**, digite:

```
npm run lab:start
```

Espere. Na primeira vez baixa cerca de 2 GB e demora minutos. No fim aparece uma mensagem de sucesso com a "API URL".

4. Abra uma **janela 2** do mesmo jeito e rode:

```
npm run lab:dev
```

Ela gera o arquivo de configuração e liga o painel em `http://192.168.0.81:5500`. **Deixe esta janela aberta.**

> **Em leigo:** `lab:start` liga o cofre de dados (Supabase). `lab:dev` liga o site (painel). São dois programas diferentes, por isso duas janelas.

## Sem internet ou sem Wi-Fi?

O Windows não deixa ligar o Hotspot normal sem estar conectado a outra rede. O laboratório tem um atalho próprio que contorna isso:

1. **Na primeira vez**, rode `lab-firewall-liberar.cmd` (pede administrador). Ele libera as portas do painel e do banco só para a rede local.
2. Duplo clique em `lab-hotspot.cmd` (ou use o item **Hotspot NFC-Lab** na TUI).
   - Ele cria a rede Wi-Fi **NFC-Lab** (senha `nfc-lab-2026`).
   - O notebook fica no endereço `192.168.137.1`.
3. No notebook, rode `npm run lab:setup` e depois `npm run lab:dev`.
   - O `lab:setup` grava `192.168.137.1` no `.env.local`; é esse IP que o Docker/Supabase e o painel passam a usar.
4. No tablet, conecte na rede **NFC-Lab** e abra **`http://192.168.137.1:5500`**.
5. No fim, duplo clique em `lab-hotspot-desligar.cmd` (ou use o item Hotspot da TUI).

> **Em leigo:** o hotspot é uma rede Wi-Fi criada pelo próprio notebook. Ela não tem internet — e não precisa: o painel e o banco rodam dentro do notebook. O tablet só precisa estar conectado nessa rede e usar o endereço `192.168.137.1`.
>
> O **"Ligar tudo"** da TUI já faz essa ordem sozinho: Docker → hotspot/rede → banco → grava o IP no `.env.local` → painel. O comportamento é controlado por `LAB_HOTSPOT_MODO` no `.env.local`: `auto` (só quando não há rede), `sempre` (todo dia) ou `nunca`.

## Entrando no tablet

1. Conecte o tablet no **mesmo Wi-Fi** do notebook (ou na rede **NFC-Lab**, se estiver usando o hotspot).

2. No navegador do tablet, digite o endereço do notebook:

```
http://192.168.0.81:5500      (no Wi-Fi da escola)
http://192.168.137.1:5500     (na rede NFC-Lab)
```

3. Faça login:

```
E-mail: admin@lab.local
Senha:  escola123
```

A senha é o `ADMIN_PASSWORD` do `.env.local`. Neste laboratório está como `escola123`.

4. Toque em **Entrar**. O administrador vê todas as abas: Portaria, Secretaria, Histórico, Usuários e Configurações.

O primeiro acesso traz **6 alunos de demonstração**. Repare em dois:

- **Felipe Duarte** (2026006) está **bloqueado**: a permissão de acesso dele está desativada.
- **Elisa Rios** (2026005) tem o cartão gravado como `04FF11AA`, sem os dois-pontos que separam os pares do código.

> **Em leigo:** "UID" é o número de identidade gravado dentro do cartão. Ele não muda.

## Cadastrando um aluno e a foto

1. Abra a aba **Secretaria**.

2. Preencha os campos (asterisco = obrigatório):

```
Nome completo do aluno *   Ex: Maria Clara Souza
Matrícula                  Ex: 20261001
Turma *                    Ex: 9º Ano A
Curso                      Ex: Ensino Fundamental
Nome do responsável        Ex: Carlos Souza
WhatsApp do responsável    Ex: (84) 99999-9999
```

3. Em **Cartão NFC (UID hexadecimal)**, digite o código ou clique em **Puxar do leitor** e passe o cartão na placa.

4. Deixe marcado **Permissão de acesso ativa**.

5. Na foto, clique em **Escolher arquivo** (JPG/PNG até 10 MB) ou em **Tirar foto** para usar a câmera.

6. Clique em **Salvar Aluno**.

> **Em leigo:** a foto serve para a portaria reconhecer o rosto. Quem libera a entrada é o cartão.

## Tornando o cartão funcional na placa

O cadastro no painel **não** chega sozinho na placa.

1. Na aba Secretaria, clique no botão de sincronizar (aparece como **Sincronizar ESP32**).
2. Espere a mensagem de sucesso.
3. Vá para a aba **Portaria** e passe o cartão de verdade. O nome deve aparecer na tela.

> **Em leigo:** a placa guarda a "lista de jogos" dela na memória flash. Decide sozinha, sem internet e sem consultar o painel. Sem receber a lista, não conhece o aluno novo.

O envio é automático quando você cria, altera ou remove um aluno. O botão serve para forçar. Na aba **Configurações** o mesmo botão se chama **Sincronizar base**.

### Vendo o resultado

O histórico chega sozinho, sem F5. Isso é o **Realtime**: o painel fica escutando o banco.

Para conferir na fonte, abra o Studio no notebook:

```
http://192.168.0.81:54323
```

Ele mostra as tabelas. Procure a de histórico de acessos.

## Descobrindo se o IP mudou

O endereço do notebook pode mudar se o modem reiniciar. Rode:

```
npm run lab:ip
```

Se não for `192.168.0.81`:

1. Corrija a linha `SUPABASE_URL` no `.env.local` (Notepad) e salve.
2. Na janela do `lab:dev`, aperte Ctrl+C e rode `npm run lab:dev` de novo.
3. Atualize o endereço no tablet e o do leitor na aba Configurações.

> **Em leigo:** IP é o "número da casa" do notebook na rede. O modem o empresta e pode trocá-lo.

## Encerrando o dia

1. Aperte **Ctrl+C** na janela do painel.
2. Aperte **Ctrl+C** na janela do Supabase.
3. Em qualquer janela da pasta, rode:

```
npm run lab:stop
```

Os dados ficam guardados. Amanhã, comece pelo `lab:start`.

## Recomeçar do zero

```
npm run lab:reset
npm run lab:admin
```

`lab:reset` apaga o banco e o recria com as migrations e os 6 alunos de demonstração. `lab:admin` recria o primeiro administrador.

> **Em leigo:** migrations são as plantas do banco: dizem como as tabelas são construídas.

**Aviso:** o reset apaga **tudo**, inclusive alunos, históricos e usuários que você cadastrou.

## Backup opcional

```
npm run lab:backup
```

Cria `supabase/backup.sql` com os dados das tabelas. Não inclui usuários do login nem arquivos de fotos.

Para restaurar:

```
npm run lab:reset
npx --yes supabase@2.121.0 db query -f supabase/backup.sql
```

## Resumo em 30 segundos

1. Docker Desktop aberto.
2. Janela 1: `npm run lab:start`.
3. Janela 2: `npm run lab:dev`.
4. Tablet: `http://192.168.0.81:5500`, login `admin@lab.local`.
5. Cadastrou aluno? Sincronize e passe o cartão na portaria.
6. Fim do dia: Ctrl+C nas duas janelas e `npm run lab:stop`.

Deu ruim? [04-problemas-comuns.md](04-problemas-comuns.md). Palavra estranha? [05-glossario-e-guia-rapido.md](05-glossario-e-guia-rapido.md).
