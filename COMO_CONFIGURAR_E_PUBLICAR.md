# Manual do Sistema de Acesso Escolar NFC (Web & Nuvem)

Este guia explica como configurar o banco de dados Supabase, gerenciar usuários e permissões (RBAC), sincronizar alunos com o ESP32 e publicar o sistema.

---

## 1. Passo 1: Criar o Banco e Permissões no Supabase (Grátis)

O **Supabase** é o backend da escola. Ele armazena o cadastro dos alunos, as fotos compactadas, o histórico de entradas e os perfis dos funcionários com níveis de acesso.

1. Acesse **[supabase.com](https://supabase.com)** e faça login na sua conta gratuita.
2. Clique em **"New Project"** (Novo Projeto).
3. Defina o nome do projeto (ex: `escola-nfc`), crie uma senha forte e escolha a região `South America (São Paulo)`.
4. Aguarde cerca de 1 minuto enquanto o banco é provisionado.

### Executando o Script Oficial com 1 Clique:
1. No menu lateral do Supabase, clique no ícone **SQL Editor** (`>_`).
2. Abra o arquivo **`supabase_setup.sql`** que está nesta pasta.
3. Copie todo o conteúdo e cole na caixa de texto do editor SQL.
4. Clique no botão verde **"Run"**.
5. **Pronto!** O script configurará automaticamente:
   * **Tabela `alunos`:** com políticas de segurança RLS (leitura pela portaria, edição pela secretaria e admin).
   * **Tabela `perfis_usuarios`:** com os cargos institucionais (admin, direção, coordenação, secretaria e portaria).
   * **Tabela `historico_acessos`:** registro das passagens com data e hora.
   * **Cofre de Imagens `fotos-alunos`:** bucket público para fotos 3x4 compactadas.
   * **Funções RPC de Administração:** cadastro de primeiro administrador, alteração de cargos e redefinição de senhas.

### Pegando as Chaves de Conexão:
1. Vá em **Project Settings** (ícone de engrenagem) -> **API**.
2. Copie os dois valores:
   * **Project URL** (ex: `https://abcdefghijk.supabase.co`)
   * **anon public key** (chave longa começando com `eyJhbGci...`)

---

## 2. Passo 2: Primeiro Acesso e Administrador Mestre

Ao abrir o sistema pela primeira vez:

1. Se as chaves do Supabase ainda não estiverem gravadas no navegador, clique no link **"⚙️ Configurar URL e Chaves do Supabase"** e salve as credenciais.
2. O sistema detectará automaticamente que o banco de dados está virgem e exibirá o botão:
   * **👤 Cadastrar 1º Administrador do Sistema**
3. Clique nele, digite seu nome completo, e-mail institucional e uma senha segura (mínimo 6 caracteres).
4. O usuário mestre (**Técnico/Administrador**) será registrado e você entrará diretamente no painel completo!

---

## 3. Passo 3: Perfis de Usuários e Permissões (RBAC)

O sistema conta com **5 níveis de privilégios** institucionais:

| Nível / Cargo | Aba Portaria | Aba Secretaria | Aba Usuários | Aba Configurações | Descrição das Permissões |
| :--- | :---: | :---: | :---: | :---: | :--- |
| 🛠️ **Técnico / Admin** | ✔️ | ✔️ | ✔️ | ✔️ | **Controle Total:** Cria e desativa usuários, redefine senhas, exclui dados e altera configurações. |
| 🏛️ **Direção Escolar** | ✔️ | ✔️ | ❌ | ❌ | **Visão Geral:** Bloqueia/libera alunos, visualiza relatórios e acessa a secretaria. |
| 📚 **Coordenação** | ✔️ | ✔️ | ❌ | ❌ | **Consulta e Acompanhamento:** Consulta fichas de alunos, turmas e históricos. |
| 📝 **Secretaria** | ✔️ | ✔️ | ❌ | ❌ | **Cadastros:** Adiciona novos alunos, tira fotos via webcam/upload e atribui cartões NFC. |
| 🏢 **Portaria** | ✔️ | ❌ | ❌ | ❌ | **Totem Operacional:** Focado 100% na exibição em tempo real de quem passou na catraca/portão. |

### Como o Administrador cadastra novos funcionários:
1. Vá na aba **👥 Usuários** (visível apenas para Administradores).
2. Clique em **➕ Novo Usuário**.
3. Preencha o nome, e-mail institucional, senha inicial e selecione o cargo correspondente.
4. O novo funcionário poderá logar com a conta dele e verá apenas as abas do seu respectivo cargo!

---

## 4. Passo 4: Sincronização com o ESP32 e Modo Offline

Para garantir que a porta ou catraca continue funcionando **mesmo se faltar internet**, o sistema sincroniza a memória do navegador com o microcontrolador ESP32-S3:

### 4.1. Sincronização Instantânea em Tempo Real
* Ao clicar em **"Bloquear"** ou **"Liberar"** um aluno na Secretaria, o site atualiza o Supabase e dispara na hora o novo status para a Flash do ESP32 (`POST /api/sincronizar_aluno`).
* Ao cadastrar um novo aluno ou editar sua tag NFC, o ESP32 é atualizado instantaneamente.
* Ao excluir um aluno, o cartão é removido da memória do ESP32.

### 4.2. Sincronização Completa em Lote (Botão Novo)
* Na aba **Secretaria** (ao lado do contador de alunos) ou na aba **Configurações**, clique em:
  * **`🔄 Sincronizar com ESP32`**
* O sistema baixa todos os alunos cadastrados no Supabase e grava a lista completa na Flash do ESP32 (`cartoes.json`) em uma única operação.

### 4.3. Atalho Rápido de IP no Cabeçalho
* No canto superior direito, clique diretamente no selo **`• ESP32: Online`**.
* Uma caixinha se abrirá para você conferir ou atualizar o IP do ESP32 na hora (ex: `http://192.168.0.73`), sem precisar ir até as Configurações.

---

## 5. Passo 5: Como Operar o Totem da Portaria (Atenção ao HTTPS)

* **No Computador / Tablet da Portaria (Recomendado):**
  * Para se comunicar com o leitor físico via rede local (`http://192.168.0.73`), a tela da portaria deve rodar em protocolo HTTP (ex: `http://localhost:5500` via Live Server do VS Code ou servidor local).
  * **Por que?** Navegadores modernos em **HTTPS** (como `https://escola-nfc.vercel.app`) bloqueiam requisições a IPs locais em HTTP (*Mixed Content / Private Network Access*). O sistema avisa com o selo **`Bloq. HTTPS`** caso você tente conectar ao IP local a partir de uma página pública HTTPS.
* **Acessos Remotos (Direção / Secretaria de Casa):**
  * Podem usar o link da **Vercel** normalmente para cadastrar alunos, conferir relatórios e gerenciar usuários de qualquer lugar do mundo.

---

## 6. Publicação na Vercel (Para Acesso Externo)

1. Faça o commit e envie os arquivos para o repositório no seu GitHub:
   ```bash
   git add .
   git commit -m "Deploy: Painel Escolar com RBAC e Sincronização ESP32"
   git push origin main
   ```
2. No painel da **[vercel.com](https://vercel.com)**, importe o repositório `escola-nfc-web`.
3. Clique em **Deploy**.
4. Em instantes, o link público seguro estará no ar!
