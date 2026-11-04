# Instalar o Docker Desktop (Windows)

Este guia serve para preparar outro notebook. O do laboratório já tem tudo pronto.

### Passo 1 — Conferir o Windows

Aperte `Windows + R`, digite o comando e aperte Enter:

```
winver
```

Deve aparecer "Windows 11" e "64 bits".

### Passo 2 — Conferir a memória

Aperte `Ctrl + Shift + Esc`, clique em **Desempenho** e depois em **Memória**. Precisa de pelo menos 8 GB.

> **Em leigo:** RAM é a memória de trabalho. Quanto mais, mais programas rodam juntos.

> **Em leigo:** Gerenciador de Tarefas é a janela que mostra o uso do computador.

### Passo 3 — Conferir a virtualização

Ainda em **Desempenho**, clique em **CPU**. O campo **Virtualização:** deve dizer **Habilitado**.

> **Em leigo:** virtualização é um recurso do processador que permite rodar um sistema dentro do outro. Sem ela, o WSL não funciona.

Se disser **Desabilitado**, entre na BIOS:

1. Reinicie o notebook.
2. Ao ligar, aperte a tecla de configuração (`F2`, `F10`, `Del` ou `Esc`). A tela mostra qual é.
3. Procure **Virtualization Technology (VTx)** em Intel, ou **SVM** em AMD.
4. Ative, salve e saia.

> **Em leigo:** BIOS é a tela de configuração que aparece antes do Windows, ao ligar.

> **Em leigo:** VTx e SVM são os nomes que Intel e AMD dão ao mesmo recurso.

Se o erro for "HCS/Hyper-V not installed", abra o PowerShell como administrador, rode o comando abaixo e reinicie:

```
bcdedit /set hypervisorlaunchtype auto
```

Antivírus e jogos às vezes desligam o hipervisor.

> **Em leigo:** hipervisor é o "gerente" que divide o computador entre o Windows e o Linux do WSL.

### Passo 4 — Conferir o WSL

No PowerShell comum:

```
wsl --version
```

Precisa ser 2.1.5 ou maior. O número aparece em "Versão do WSL".

> **Em leigo:** WSL é um "Windows dentro do Windows". O Docker usa essa parte do Linux para hospedar as caixas.

> **Em leigo:** PowerShell é o terminal do Windows: uma janela preta onde se digita comandos em vez de clicar.

Se der erro ou for antiga, abra o PowerShell como administrador e rode:

```
wsl --update
```

### Passo 5 — Baixar o instalador

Pelo site oficial:

```
https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe
```

Ou pela Microsoft Store.

### Passo 6 — Instalar

1. Duplo clique no arquivo baixado.
2. Siga o instalador até o fim.
3. Deixe marcada **Use WSL 2 instead of Hyper-V** (já vem marcada).
4. Aceite o contrato e conclua.

> **Em leigo:** Hyper-V é outra forma de rodar sistemas virtuais, mais pesada. Por isso usamos o WSL 2.

### Passo 7 — Abrir pela primeira vez

O Docker **não** abre sozinho. Procure "Docker Desktop" no menu Iniciar.

Na primeira vez pode pedir permissão de administrador. Aceite: é usado uma única vez, para ajustar o WSL.

Aceite o contrato dentro do app e espere. No canto inferior esquerdo aparece o status do motor ("Engine running").

> **Em leigo:** Docker Desktop é o app que liga e desliga as caixas. O motor (engine) é o coração dele: sem ele, nenhum comando funciona.

### Passo 8 — Teste que não falha

No PowerShell comum, rode:

```
docker run --rm hello-world
```

Deve imprimir "Hello from Docker!".

> **Em leigo:** `--rm` quer dizer "jogue a caixa fora ao terminar".

### Passo 9 — Internet só na primeira vez

As imagens baixam uma vez, cerca de 2 GB. Depois, tudo funciona sem internet.

> **Em leigo:** imagem é a receita da caixa, como vimos no guia anterior. Fica guardada no notebook.

### Passo 10 — Limitar a memória (se precisar)

O Supabase recomenda 7 GB de RAM ou mais para a pilha completa. Com 8 GB, vale limitar o Docker.

Crie ou edite o arquivo `%UserProfile%\.wslconfig` e deixe assim:

```
[wsl2]
memory=6GB
```

Depois rode:

```
wsl --shutdown
```

> **Em leigo:** isso fecha o WSL inteiro, e com ele o Docker. Reabra o Desktop depois.

Curiosidade: os arquivos do Docker ficam num arquivo em `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`. Não apague.

### Passo 11 — Como fechar

Clique no ícone do Docker perto do relógio e escolha **Quit Docker Desktop**.

> **Em leigo:** bandeja é a setinha perto do relógio, onde ficam os ícones.

⚠️ **Aviso forte:** nunca use **Clean up data** nem **Reset to factory** para "limpar espaço". Isso destrói imagens e containers. Use só quando tudo estiver quebrado de vez.

### Passo 12 — Erros comuns

| Mensagem | O que fazer |
|---|---|
| "Virtualization is not enabled" ou HCS_E_HYPERV_NOT_INSTALLED | Ativar na BIOS (Passo 3) |
| "WSL version too old" ou "WSL 2 installation is incomplete" | Rodar `wsl --update` |
| "Docker Desktop is stopped" | No app, menu de resolução de problemas (ícone de bug ou foguete) > "Restart Docker Desktop" |
| "Access denied" | Usuário fora do grupo docker-users: fazer logoff e login, ou pedir ao TI |

## Resumo em 30 segundos

1. Precisa de Windows 11 64 bits, 8 GB de RAM, virtualização ligada e WSL 2.1.5+.
2. Baixe no site oficial ou na Microsoft Store.
3. Instale mantendo "Use WSL 2 instead of Hyper-V".
4. Abra pelo menu Iniciar e espere o motor subir.
5. Teste com `docker run --rm hello-world`.
6. Internet só na primeira vez, cerca de 2 GB.
7. Feche por "Quit Docker Desktop". Nunca use "Reset to factory".

## Referências

- https://docs.docker.com/desktop/setup/install/windows-install/
- https://learn.microsoft.com/windows/wsl/install
- https://supabase.com/docs/guides/local-development
