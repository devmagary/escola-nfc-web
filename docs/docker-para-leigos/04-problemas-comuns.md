# Problemas comuns e o que fazer

Antes de caçar defeito, rode o diagnóstico. Ele fala em português e dá dicas:

```
npm run lab:check
```

Se terminar com "LABORATÓRIO PRONTO.", o laboratório está bom. O problema está em outro lugar.

> **Em leigo:** sintoma é o que você vê. Causa provável é o motivo mais comum. Nem sempre é o seu caso — comece por ela e confira.

## Tabela de sintomas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| A primeira vez demora muito e não termina | Está baixando ~2 GB de imagens | Deixe o terminal aberto e acompanhe as linhas; não cancele |
| "Docker não está executando"; baleia parada; "Engine stopped" | O motor do Docker está parado | Abra o Docker Desktop e espere; se não voltar, menu da baleia na bandeja > Restart |
| "Port ... already in use" ou "Bind failed" | Outra coisa ocupando a porta | Reinicie o PC: resolve na maioria. Para ver quem usa: `netstat -aon | findstr 54321` |
| O tablet não abre o painel | Rede diferente, firewall ou IP mudou | Confira o mesmo Wi-Fi; rode `lab-firewall-liberar.cmd`; rode `npm run lab:ip` |
| Login não entra | Admin não criado, config antiga, ou site errado | Rode `npm run lab:admin`; reabra o `lab:dev` (ele regenera o `config.js`); confira se a barra começa com `http://192.168.0.81:5500` e não com o endereço https da Vercel |
| Banner "você está offline" no painel | O painel não encontrou a rede | Normal só quando realmente não há rede. Depois da instalação, o laboratório funciona sem internet |
| A foto do aluno não aparece | `.env.local` aponta para `127.0.0.1` | Troque pelo IP real do notebook e reabra o `lab:dev` |
| "Tirar foto" no celular mostrava erro de câmera | Página em HTTP na rede (fora de localhost) | **Já corrigido**: o botão abre a câmera nativa do aparelho. Se ainda aparecer o aviso antigo, atualize a página (recarregue); alternativa: **Escolher arquivo** |
| A placa ESP32 não responde | Placa desligada, outra rede, endereço errado | Abra `http://192.168.0.73/api/status` no navegador do notebook; ajuste o endereço do leitor na aba Configurações |
| O Windows não deixa ligar o Hotspot | A tela do Windows exige outra rede conectada | Use `lab-hotspot.cmd` (ou o item **Hotspot NFC-Lab** na TUI): ele cria a rede `NFC-Lab` sem internet |
| O tablet não acha a rede `NFC-Lab` | Hotspot desligado ou adaptador sem modo AP | Rode `npm run lab:hotspot:status`; se der erro, use um adaptador USB Wi-Fi |
| No hotspot, o tablet não abre o painel | `.env.local` no IP antigo ou firewall | Rode `npm run lab:setup`, `lab-firewall-liberar.cmd` e abra `http://192.168.137.1:5500` |
| O histórico não atualiza sozinho | A escuta em tempo real caiu | Aperte F5 e confira no Studio (`http://192.168.0.81:54323`) |
| O notebook adormeceu e tudo parou | Suspensão do Windows derrubou os programas | Acorde o notebook e rode `npm run lab:start` de novo |
| O terminal parece travado no meio | Resource Saver do Docker: o motor dormiu | Espere alguns segundos; ele acorda sozinho |
| Mensagem comprida do Supabase sobre versão nova | Checagem online da ferramenta | Ignore; não trava nada |

> **Em leigo:** porta é a "janela numerada" por onde um programa atende. Se dois programas querem a mesma janela, um deles falha.

## Os três casos que mais confundem

**Firewall.** O Windows bloqueia visitas de outros aparelhos por padrão. Na pasta do projeto, dê duplo clique em `lab-firewall-liberar.cmd` e clique em "Sim" na permissão de administrador. As regras valem para qualquer perfil de rede, mas só aceitam as redes locais (Wi-Fi, cabo e hotspot) — não é preciso mudar o Wi-Fi para "Privado".

**Endereço no tablet.** Se a barra do navegador mostrar algo como `escola-nfc.vercel.app`, você está no site de produção, não no laboratório. No Wi-Fi da escola, use `http://IP-DO-NOTEBOOK:5500`; no hotspot `NFC-Lab`, use `http://192.168.137.1:5500`, sempre com `http://`.

**Placa e painel.** São coisas separadas. O painel é o site; a placa é o leitor. Configurar um não configura o outro: o endereço da placa se ajusta na aba Configurações do painel.

## Como desistir sem perder o projeto

Pode simplesmente fechar as janelas. Nada do projeto se perde: os arquivos continuam na pasta e o banco continua no disco do Docker.

Para parar o banco com calma:

```
npm run lab:stop
```

Desinstalar o Docker Desktop é outra decisão, separada deste projeto. Só faça isso se tiver certeza de que não vai usar o laboratório.

> **Em leigo:** o projeto é uma pasta de arquivos. O Docker é só o programa que executa o banco. Apagar um não apaga o outro.

## Resumo em 30 segundos

1. Rode `npm run lab:check` e leia as dicas.
2. Docker parado? Abra o Docker Desktop.
3. Porta ocupada? Reinicie o PC.
4. Tablet não abre? Rede, firewall (`lab-firewall-liberar.cmd`) e IP (`npm run lab:ip`).
5. Placa muda? Teste `http://192.168.0.73/api/status`.

Mais detalhes do dia a dia: [03-usar-o-laboratorio-no-dia-a-dia.md](03-usar-o-laboratorio-no-dia-a-dia.md). Palavras difíceis: [05-glossario-e-guia-rapido.md](05-glossario-e-guia-rapido.md).
