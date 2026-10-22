#!/usr/bin/env node
/**
 * bootstrap-admin.mjs
 * ---------------------------------------------------------------------------
 * Cria (ou repara) o primeiro administrador do sistema direto no Supabase,
 * usando a service role key — portanto roda SOMENTE na sua máquina.
 *
 * O que faz:
 *   1. Lê `.env` / `.env.local` (mesmo parser do build-config) + process.env;
 *   2. Procura o usuário pelo e-mail na API de administração do Supabase;
 *   3. Se não existir, cria via POST /auth/v1/admin/users com e-mail confirmado;
 *      se já existir, reaproveita (e confirma o e-mail, se necessário);
 *   4. Faz upsert em public.perfis_usuarios (on_conflict=id) com
 *      cargo = "admin", ativo = true e nome_completo;
 *   5. É idempotente: pode ser executado várias vezes sem duplicar nada.
 *
 * Variáveis obrigatórias:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
 * Variável opcional:
 *   ADMIN_NAME (padrão: parte antes do @ do e-mail)
 *
 * Segurança: NUNCA imprime a senha nem a service role key. A service role key
 * ignora o RLS e jamais deve ir para o navegador ou para o repositório.
 *
 * Uso:
 *   npm run admin
 * ---------------------------------------------------------------------------
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadEnv, validarUrlHttp } from './build-config.mjs';

/** Mensagem de falha do bootstrap. */
class BootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootstrapError';
  }
}

/**
 * Lê uma variável de ambiente já mesclada.
 * @param {Record<string, string>} env
 * @param {string} nome
 * @returns {string}
 */
function valor(env, nome) {
  return String(env[nome] ?? '').trim();
}

/**
 * @param {string} serviceKey
 * @param {Record<string, string>} [extras]
 * @returns {Record<string, string>}
 */
function cabecalhosAuth(serviceKey, extras = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extras,
  };
}

/**
 * Requisição HTTP com timeout e parse tolerante de JSON.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown }} [options]
 * @returns {Promise<{ ok: boolean, status: number, dados: unknown }>}
 */
async function requisitar(url, { method = 'GET', headers = {}, body } = {}) {
  let resposta;
  try {
    resposta = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    throw new BootstrapError(
      `Falha de rede ao acessar o Supabase: ${mensagem}. Confira a SUPABASE_URL e sua conexão.`,
    );
  }

  const texto = await resposta.text();
  let dados = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = texto;
    }
  }

  return { ok: resposta.ok, status: resposta.status, dados };
}

/**
 * Extrai uma mensagem legível de um erro da API do Supabase.
 * @param {unknown} dados
 * @returns {string}
 */
function mensagemApi(dados) {
  if (dados && typeof dados === 'object') {
    const objeto = /** @type {Record<string, unknown>} */ (dados);
    for (const chave of ['msg', 'message', 'error_description', 'error', 'details']) {
      if (typeof objeto[chave] === 'string' && objeto[chave]) return objeto[chave];
    }
    try {
      return JSON.stringify(dados);
    } catch {
      return 'erro desconhecido';
    }
  }
  return String(dados ?? 'erro desconhecido');
}

/**
 * Procura um usuário pelo e-mail na listagem administrativa (paginada).
 * @param {string} baseUrl
 * @param {string} serviceKey
 * @param {string} email
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function procurarUsuario(baseUrl, serviceKey, email) {
  const porPagina = 100;
  const alvo = email.toLowerCase();

  for (let pagina = 1; pagina <= 50; pagina += 1) {
    const resposta = await requisitar(
      `${baseUrl}/auth/v1/admin/users?page=${pagina}&per_page=${porPagina}`,
      { headers: cabecalhosAuth(serviceKey) },
    );

    if (!resposta.ok) {
      throw new BootstrapError(
        `Não foi possível listar os usuários (HTTP ${resposta.status}): ${mensagemApi(resposta.dados)}`,
      );
    }

    const dados = resposta.dados;
    const usuarios = Array.isArray(dados)
      ? dados
      : Array.isArray(/** @type {Record<string, unknown>} */ (dados)?.users)
        ? /** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>} */ (dados).users)
        : [];

    const encontrado = usuarios.find(
      (usuario) => String(usuario?.email ?? '').toLowerCase() === alvo,
    );

    if (encontrado) return encontrado;
    if (usuarios.length < porPagina) return null;
  }

  return null;
}

/**
 * Cria o usuário já confirmado.
 * @param {string} baseUrl
 * @param {string} serviceKey
 * @param {{ email: string, password: string, nome: string }} dadosAdmin
 * @returns {Promise<Record<string, unknown> | null>} Usuário criado ou null se já existir.
 */
async function criarUsuario(baseUrl, serviceKey, { email, password, nome }) {
  const resposta = await requisitar(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabecalhosAuth(serviceKey, { 'Content-Type': 'application/json' }),
    body: {
      email,
      password,
      email_confirm: true,
      // O cargo NÃO é confiado ao metadado: o trigger do banco cria o perfil
      // inativo como portaria e o upsert abaixo promove para admin.
      user_metadata: { nome },
    },
  });

  if (resposta.ok) {
    const dados = resposta.dados;
    if (dados && typeof dados === 'object') {
      const objeto = /** @type {Record<string, unknown>} */ (dados);
      if (objeto.user && typeof objeto.user === 'object') {
        return /** @type {Record<string, unknown>} */ (objeto.user);
      }
      if (typeof objeto.id === 'string') return objeto;
    }
    throw new BootstrapError('O usuário foi criado, mas a API não retornou o ID esperado.');
  }

  const detalhe = mensagemApi(resposta.dados);
  if (/already|exist|registered|registrad|duplicad|já cadastrad/i.test(detalhe)) {
    return null;
  }

  throw new BootstrapError(`Não foi possível criar o usuário (HTTP ${resposta.status}): ${detalhe}`);
}

/**
 * Garante que o usuário esteja com o e-mail confirmado.
 * @param {string} baseUrl
 * @param {string} serviceKey
 * @param {Record<string, unknown>} usuario
 * @returns {Promise<void>}
 */
async function garantirEmailConfirmado(baseUrl, serviceKey, usuario) {
  const confirmado = Boolean(usuario.email_confirmed_at || usuario.confirmed_at);
  if (confirmado) return;

  const resposta = await requisitar(
    `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(String(usuario.id))}`,
    {
      method: 'PUT',
      headers: cabecalhosAuth(serviceKey, { 'Content-Type': 'application/json' }),
      body: { email_confirm: true },
    },
  );

  if (!resposta.ok) {
    throw new BootstrapError(
      `Não foi possível confirmar o e-mail do usuário (HTTP ${resposta.status}): ${mensagemApi(resposta.dados)}`,
    );
  }
}

/**
 * Faz upsert do perfil na tabela public.perfis_usuarios.
 * @param {string} baseUrl
 * @param {string} serviceKey
 * @param {{ id: string, email: string, nome: string }} perfil
 * @returns {Promise<void>}
 */
async function salvarPerfil(baseUrl, serviceKey, { id, email, nome }) {
  const resposta = await requisitar(
    `${baseUrl}/rest/v1/perfis_usuarios?on_conflict=id`,
    {
      method: 'POST',
      headers: cabecalhosAuth(serviceKey, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: [
        {
          id,
          email,
          nome_completo: nome,
          cargo: 'admin',
          ativo: true,
        },
      ],
    },
  );

  if (!resposta.ok) {
    throw new BootstrapError(
      `Não foi possível gravar o perfil em public.perfis_usuarios (HTTP ${resposta.status}): ${mensagemApi(resposta.dados)}. ` +
        'Confirme se o arquivo supabase_setup.sql já foi executado no SQL Editor do Supabase.',
    );
  }
}

/**
 * Formata erro para o terminal.
 * @param {unknown} erro
 * @returns {string}
 */
function formatarErro(erro) {
  if (erro instanceof ConfigError) {
    return ['❌ Configuração inválida:', ...erro.messages.map((m) => `  - ${m}`)].join('\n');
  }
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return `❌ Falha no bootstrap do administrador:\n  - ${mensagem}`;
}

/**
 * Executa o bootstrap. Exportado para testes futuros.
 * @param {{ cwd?: string, processEnv?: Record<string, string | undefined>, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [options]
 * @returns {Promise<number>} Código de saída.
 */
export async function run({
  cwd = process.cwd(),
  processEnv = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const { values: env, loadedFiles } = await loadEnv({ cwd, processEnv });

    const url = valor(env, 'SUPABASE_URL');
    const serviceKey = valor(env, 'SUPABASE_SERVICE_ROLE_KEY');
    const email = valor(env, 'ADMIN_EMAIL');
    const password = valor(env, 'ADMIN_PASSWORD');
    const nome = valor(env, 'ADMIN_NAME') || email.split('@')[0] || 'Administrador';

    /** @type {string[]} */
    const faltando = [];
    if (!url) faltando.push('SUPABASE_URL');
    if (!serviceKey) faltando.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!email) faltando.push('ADMIN_EMAIL');
    if (!password) faltando.push('ADMIN_PASSWORD');

    if (faltando.length > 0) {
      throw new BootstrapError(
        `Variáveis ausentes: ${faltando.join(', ')}. ` +
          'Preencha o `.env.local` (veja `.env.example`) ou exporte no terminal. ' +
          'A service role key fica em Project Settings > API > service_role (NUNCA no navegador).',
      );
    }

    const urlValidada = validarUrlHttp(url, 'SUPABASE_URL');
    if (urlValidada.error) throw new BootstrapError(urlValidada.error);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BootstrapError(`ADMIN_EMAIL inválido: "${email}".`);
    }

    if (password.length < 6) {
      throw new BootstrapError('ADMIN_PASSWORD deve ter pelo menos 6 caracteres (regra do Supabase Auth).');
    }

    const baseUrl = urlValidada.value.replace(/\/+$/, '');

    stdout.write('🔐 Bootstrap do administrador (Supabase)\n');
    if (loadedFiles.length > 0) {
      stdout.write(`   Arquivos lidos: ${loadedFiles.map((arquivo) => path.basename(arquivo)).join(', ')}\n`);
    }
    stdout.write(`   Supabase: ${baseUrl}\n`);
    stdout.write(`   E-mail  : ${email}\n`);

    let usuario = await procurarUsuario(baseUrl, serviceKey, email);
    let criado = false;

    if (!usuario) {
      const novoUsuario = await criarUsuario(baseUrl, serviceKey, { email, password, nome });
      if (novoUsuario) {
        usuario = novoUsuario;
        criado = true;
        stdout.write('   ✅ Usuário criado com e-mail já confirmado.\n');
      } else {
        // Corrida: outro processo criou o usuário entre a busca e o POST.
        usuario = await procurarUsuario(baseUrl, serviceKey, email);
        if (!usuario) {
          throw new BootstrapError(
            'A API disse que o usuário já existe, mas ele não foi encontrado na listagem. Verifique manualmente no painel do Supabase.',
          );
        }
      }
    } else {
      stdout.write('   ℹ️  Usuário já existe; reaproveitando (a senha atual NÃO é alterada).\n');
    }

    const id = String(usuario.id ?? '');
    if (!id) throw new BootstrapError('A API do Supabase não retornou o ID do usuário.');

    await garantirEmailConfirmado(baseUrl, serviceKey, usuario);

    await salvarPerfil(baseUrl, serviceKey, {
      id,
      email: String(usuario.email ?? email),
      nome,
    });

    stdout.write(`\n✅ Administrador ${criado ? 'criado' : 'atualizado'} com sucesso!\n`);
    stdout.write(`   Nome  : ${nome}\n`);
    stdout.write(`   E-mail: ${String(usuario.email ?? email)}\n`);
    stdout.write(`   ID    : ${id}\n`);
    stdout.write('   Cargo : admin (ativo)\n');
    stdout.write('   🔒 Senha definida (não exibida por segurança).\n');
    stdout.write('\nAgora você já pode entrar no site com esse e-mail e senha.\n');
    return 0;
  } catch (erro) {
    stderr.write(`${formatarErro(erro)}\n`);
    return 1;
  }
}

const executadoDiretamente = (() => {
  const entrada = process.argv[1];
  if (!entrada) return false;
  try {
    return path.resolve(entrada) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (executadoDiretamente) {
  process.exitCode = await run();
}
