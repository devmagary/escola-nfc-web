# Glossário e guia rápido

Consulta rápida. Cada palavra em uma linha, na primeira vez.

> **Em leigo:** não precisa decorar. Use como dicionário quando uma palavra aparecer.

## Parte 1 — Palavras

| Palavra | Em leigo |
|---|---|
| Docker | Programa que roda "computadores dentro do computador" |
| Docker Desktop | O aplicativo que liga o Docker no Windows |
| Engine | O motor que executa as caixas |
| Container | Caixa isolada onde um programa roda |
| Imagem | O molde de onde o container nasce |
| Volume | A gaveta onde os dados sobrevivem ao desligar |
| Porta | Janela numerada por onde um programa atende |
| IP da rede | O número do aparelho na rede local |
| WSL2 | Camada do Windows que roda o Linux usado pelo Docker |
| Supabase | Banco + login + tempo real do laboratório |
| Postgres | O banco de dados das tabelas |
| migration | Arquivo que diz como as tabelas são construídas |
| `.env.local` | Configuração do notebook (IP, senha do admin) |
| `config.js` | Arquivo gerado pelo `lab:dev` com os endereços |
| anon key | Chave pública, usada pelo painel no navegador |
| service role key | Chave-mestra; nunca vai para o navegador |
| RLS | Regras de quem pode ver e alterar cada linha |
| totem | A tela fixa da portaria |
| ESP32 | A placa leitora, com Wi-Fi próprio |

## Parte 2 — Os 3 cenários

**A) Primeira vez**

1. Instale o Docker Desktop: veja [02-instalar-o-docker-desktop.md](02-instalar-o-docker-desktop.md).
2. Duplo clique em `lab-firewall-liberar.cmd` e clique em "Sim".
3. `npm run lab:start` (baixa ~2 GB).
4. `npm run lab:check` — deve dizer "LABORATÓRIO PRONTO.".
5. `npm run lab:admin`.
6. `npm run lab:dev`, deixando a janela aberta.
7. No tablet: `http://192.168.0.81:5500`.

**B) Dia normal**

1. `npm run lab:start`.
2. `npm run lab:dev`.
3. Use o painel no tablet.
4. Fim do dia: Ctrl+C nas duas janelas e `npm run lab:stop`.

**C) Recomeçar do zero**

1. `npm run lab:reset` — apaga o banco e recria o exemplo.
2. `npm run lab:admin` — recria o administrador.
3. `npm run lab:dev` — liga o painel.

> **Em leigo:** o cenário C é o "botão de fábrica": joga fora o que você cadastrou.

## Parte 3 — Cheat sheet

| Comando | O que faz |
|---|---|
| `npm run lab:start` | Liga o Supabase local |
| `npm run lab:dev` | Gera o `config.js` e liga o painel na 5500 |
| `npm run lab:stop` | Para o Supabase; os dados ficam |
| `npm run lab:status` | Mostra se o Supabase está no ar |
| `npm run lab:ip` | Imprime os endereços |
| `npm run lab:check` | Diagnóstico com dicas |
| `npm run lab:reset` | Recria o banco com os 6 alunos de exemplo |
| `npm run lab:admin` | Recria o primeiro administrador |
| `npm run lab:backup` | Gera `supabase/backup.sql` |

**Atalho único** na área de trabalho (`Servidor NFC`, criado por `lab-criar-atalhos.cmd`): abre o menu de luzes com setas — dentro dele ficam ligar, desligar, checar, abrir painel, endereços, firewall, backup e zerar. Na pasta do projeto, `lab.cmd` faz o mesmo, e `lab-ligar.cmd`/`lab-desligar.cmd`/`lab-checar.cmd` continuam como atalhos de emergência.

Todos rodam na pasta do projeto, com o Docker aberto.

## Parte 4 — Antes de esquecer

- Projeto: pasta `escola-nfc-web-offline`.
- O IP pode mudar: confira com `npm run lab:ip`.
- Outro computador? Leia o [02](02-instalar-o-docker-desktop.md) e o [03](03-usar-o-laboratorio-no-dia-a-dia.md).

## Resumo em 30 segundos

- Dia normal: `lab:start`, `lab:dev`, usar, `lab:stop`.
- Zerar: `lab:reset` e `lab:admin`.
- Endereços: `lab:ip`. Problema: `lab:check`.
- Tudo no notebook; sem internet depois de instalado.
