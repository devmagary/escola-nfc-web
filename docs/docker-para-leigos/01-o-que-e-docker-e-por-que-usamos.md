# O que é Docker e por que usamos

O laboratório do projeto usa um "Supabase local". Esse nome esconde vários programas pequenos que trabalham juntos. Um guarda os dados. Outro cuida do login. Outro guarda as fotos. Outro avisa as telas quando algo muda.

Instalar tudo isso "na mão" no Windows dá trabalho e quebra fácil. O Docker resolve isso.

## Para que serve

O Docker empacota cada programinha em uma caixa fechada. Ele baixa a caixa pronta da internet e liga todas na ordem certa. No fim, desliga tudo e o notebook volta ao normal.

Na prática: um comando liga o sistema inteiro, o painel abre no navegador e o tablet da portaria conversa com ele.

> **Em leigo:** painel é o site do sistema, onde o laboratório vê e testa o que foi montado.

## A analogia da caixa de isopor

Imagine uma festa. Em vez de espalhar comida pela cozinha, cada prato vai numa caixa de isopor fechada, com o gelo e o tempero. Nada escorre para o chão. O Docker monta a mesa e, no fim, leva tudo embora.

> **Em leigo:** container é uma caixa fechada com um programa dentro. Ela não vê nem mexe no resto do computador.

> **Em leigo:** imagem é a receita da caixa. O Docker guarda a receita e fabrica quantas caixas iguais quiser.

> **Em leigo:** volume é a gaveta que fica fora da caixa. Se a caixa for jogada fora, os dados continuam nela. No laboratório, guarda banco e fotos.

> **Em leigo:** porta é o número da campainha. O navegador bate nesse número para falar com o programa certo.

## Os 7 principais programas do laboratório

| Programa | O que faz | Em leigo |
|---|---|---|
| Kong | API: a porta da frente | O portão que recebe os pedidos e manda cada um para a sala certa. |
| Postgres | Banco: a gaveta dos dados | O armário de fichas da escola. |
| GoTrue | Login: o porteiro das contas | Quem confere a identidade de quem chega. |
| Storage | Fotos: a pasta dos retratos | O álbum onde ficam as fotos dos alunos. |
| Realtime | Tempo real: o rádio dos avisos | O aviso chega na hora, sem ninguém perguntar. |
| Studio | Administração: a sala de vidro | Uma janela para olhar dentro do armário. |
| Mailpit | E-mail de teste: a caixa postal local | Um correio de mentira, só no notebook. |

> **Em leigo:** API é o conjunto de endereços que um programa oferece para outros programas falarem com ele.

## Por que não instalamos tudo direto no Windows

Cada programa pede uma versão específica de outras peças. O Postgres quer uma. O Studio quer outra. Instalados direto no Windows, eles brigam e o computador fica imprevisível.

> **Em leigo:** dependência é uma peça que um programa precisa para funcionar, como uma tomada especial.

O Docker isola cada programa na sua caixa. Cada caixa tem a versão que precisa. Se algo der errado, apagamos a caixa e baixamos de novo. O Windows nem sente.

## O que isso NÃO é

- **Não é a nuvem do Supabase.** É uma cópia que roda dentro do notebook.
- **Os dados ficam no notebook.** Se ele quebrar, a escola não perde nada.
- **É para testes e desenvolvimento.** Serve para conferir antes de ir para a escola de verdade.
- **Nada aqui afeta a escola de verdade.** O laboratório é uma maquete.

> **Em leigo:** nuvem é quando o programa roda num computador de outra empresa, longe de você.

## Resumo em 30 segundos

1. O laboratório usa o Supabase local: vários programinhas pequenos.
2. O Docker empacota cada um em uma caixa fechada.
3. Container é a caixa. Imagem é a receita. Volume guarda dados. Porta é a campainha.
4. Os 7 principais sobem: Kong, Postgres, GoTrue, Storage, Realtime, Studio e Mailpit. No Docker Desktop podem aparecer mais alguns, em segundo plano.
5. Tudo roda isolado, sem sujar o Windows.
6. É uma maquete: os dados ficam no notebook e nada afeta a escola.
7. Para desligar, basta parar o Docker. Nada se perde.

## Referências

- https://docs.docker.com/get-started/docker-overview/
- https://supabase.com/docs/guides/local-development
- https://docs.docker.com/engine/storage/volumes/
