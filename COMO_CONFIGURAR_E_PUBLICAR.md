# Como Configurar o Supabase e Publicar na Vercel (Passo a Passo)

Este guia explica como colocar a sua plataforma escolar no ar em **menos de 10 minutos**, usando as contas **gratuitas** do Supabase e da Vercel.

---

## 1. Passo 1: Criar o Banco e o Cofre de Fotos no Supabase (Grátis)

O **Supabase** é o local onde ficarão guardados os cadastros dos alunos e as fotos 3x4.

1. Acesse **[supabase.com](https://supabase.com)** e crie uma conta gratuita (pode entrar com o seu GitHub ou Google).
2. Clique em **"New Project"** (Novo Projeto).
3. Dê um nome ao projeto (ex: `escola-nfc`) e defina uma senha para o banco de dados.
4. Escolha a região mais próxima (ex: `South America (São Paulo)`).
5. Aguarde cerca de 1 minuto enquanto o Supabase prepara o servidor.

### Criando as Tabelas e o Cofre de Imagens com 1 Clique:
1. No menu lateral esquerdo do Supabase, clique no ícone **SQL Editor** (parece um terminal com `>_`).
2. Abra o arquivo **`supabase_setup.sql`** que está nesta pasta.
3. Copie todo o conteúdo dele e cole dentro da caixa de texto do SQL Editor do Supabase.
4. Clique no botão verde **"Run"** (no canto inferior direito).
5. **Pronto!** Automaticamente ele cria:
   * A tabela `alunos` (com nome, turma, curso, pais, etc).
   * A tabela `historico_acessos`.
   * O cofre de fotos `fotos-alunos` (com permissão de leitura pública).
   * Um aluno de teste inicial com o cartão `2C:9D:7E:8E`.

### Pegando as suas 2 Chaves de Conexão:
1. No menu lateral esquerdo, clique no ícone de engrenagem **Project Settings** -> **API**.
2. Copie:
   * **Project URL** (algo como: `https://abcdefghijk.supabase.co`)
   * **anon public key** (uma chave longa começando com `eyJhbGci...`)

---

## 2. Passo 2: Testar Localmente no seu Computador

Você não precisa nem subir na internet agora se não quiser; pode testar agora mesmo:
1. Abra a pasta `escola-nfc-web` no seu computador.
2. Dê dois cliques no arquivo **`index.html`** (ele vai abrir no Chrome, Edge ou Firefox).
3. Vá na aba **⚙️ Configurações**:
   * Cole a sua **Project URL** e a sua **anon key** do Supabase.
   * No campo do ESP32, coloque o IP que aparece no Monitor Serial (ex: `http://192.168.1.150` ou `http://nfc.local`).
   * Clique em **"Salvar Configurações"** e depois em **"Testar Conexões"**.
4. Vá na aba **📝 Secretaria**: você já verá o aluno de teste listado! Pode adicionar fotos, editar e cadastrar novos alunos.
5. Vá na aba **🏢 Portaria**: encoste o cartão no seu leitor PN532 do ESP32 e veja a foto aparecer na tela com som de confirmação!

---

## 3. Passo 3: Publicar na Vercel (Para acessar de qualquer lugar)

Para que a secretária e o porteiro possam abrir o sistema em qualquer tablet ou celular:

### Opção Rápida (Via GitHub + Vercel):
1. Suba esta pasta `escola-nfc-web` para um repositório no seu GitHub.
2. Acesse **[vercel.com](https://vercel.com)** e entre com a sua conta GitHub.
3. Clique em **"Add New..."** -> **"Project"**.
4. Selecione o repositório do seu GitHub e clique em **"Deploy"**.
5. Em cerca de 20 segundos, a Vercel gerará um link público seguro (ex: `https://escola-nfc.vercel.app`).
6. Abra o link no tablet ou computador da portaria, preencha as configurações uma única vez e o sistema está pronto para uso oficial!

---

## 4. O que a Secretaria e o Porteiro ganham:
* **Secretária:** Adiciona a foto do aluno arrastando do computador ou tirando direto da webcam com 1 clique (o sistema reduz o tamanho da foto sozinho para 40 KB).
* **Porteiro:** Ao passar a carteirinha, vê a foto grande do aluno, a turma e tem um botão verde para mandar mensagem no WhatsApp dos pais na hora!
* **Escola:** Se faltar internet, o ESP32 continua destravando o portão normalmente no modo offline.
