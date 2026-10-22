#!/usr/bin/env node
/**
 * build-config.mjs
 * ---------------------------------------------------------------------------
 * Gera o arquivo `config.js` do site a partir de variáveis de ambiente,
 * sem depender de bibliotecas externas (sem dotenv).
 *
 * Fontes de configuração (a última vence):
 *   1. `.env`         (opcional, na pasta onde o comando é executado)
 *   2. `.env.local`   (opcional, sobrescreve o `.env`)
 *   3. `process.env`  (sobrescreve os arquivos — é o que a Vercel usa)
 *
 * Variáveis:
 *   Obrigatórias : SUPABASE_URL, SUPABASE_ANON_KEY
 *   Opcionais    : ESP_URL (http://nfc.local), APP_ENV (production),
 *                  APP_VERSION (1.1.0), CONFIG_OUT (config.js)
 *
 * Uso:
 *   node scripts/build-config.mjs
 *   CONFIG_OUT=dist/config.js node scripts/build-config.mjs
 *
 * Saída: `window.__APP_CONFIG__ = Object.freeze({ ... })`.
 * ---------------------------------------------------------------------------
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Arquivos de ambiente lidos, nesta ordem (o último sobrescreve o anterior). */
export const DEFAULT_ENV_FILES = Object.freeze(['.env', '.env.local']);

/** Nome padrão do arquivo gerado. */
export const CONFIG_FILENAME = 'config.js';

/** Valores padrão das variáveis opcionais. */
export const DEFAULT_CONFIG = Object.freeze({
  espUrl: 'http://nfc.local',
  appEnv: 'production',
  appVersion: '1.1.0',
});

/** Variáveis consideradas ao montar a configuração do app. */
export const CONFIG_ENV_KEYS = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'ESP_URL',
  'APP_ENV',
  'APP_VERSION',
]);

/** Erro de configuração/ambiente com uma lista de mensagens em português. */
export class ConfigError extends Error {
  /**
   * @param {string | string[]} messages
   */
  constructor(messages) {
    const lista = Array.isArray(messages) ? messages : [String(messages)];
    super(lista.join('\n'));
    this.name = 'ConfigError';
    this.messages = lista;
  }
}

/** Erro de sintaxe em um arquivo `.env`. */
export class EnvParseError extends Error {
  /**
   * @param {string} source Nome do arquivo.
   * @param {number} lineNumber Número da linha (1-based).
   * @param {string} reason Motivo em português.
   */
  constructor(source, lineNumber, reason) {
    super(`Erro em ${source} (linha ${lineNumber}): ${reason}`);
    this.name = 'EnvParseError';
    this.source = source;
    this.lineNumber = lineNumber;
    this.reason = reason;
  }
}

/**
 * Interpreta o valor bruto de uma variável (remove aspas, comentários etc.).
 * @param {string} raw
 * @returns {string}
 */
export function parseEnvValue(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return '';

  const quote = value[0];
  const quoted = (quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote);

  if (quoted) {
    const inner = value.slice(1, -1);
    if (quote === '"') {
      return inner.replace(/\\(n|r|t|"|'|\\|\$)/g, (_match, char) => {
        switch (char) {
          case 'n': return '\n';
          case 'r': return '\r';
          case 't': return '\t';
          case '"': return '"';
          case "'": return "'";
          case '$': return '$';
          default: return '\\';
        }
      });
    }
    // Aspas simples: conteúdo literal (só \' e \\ são escapes).
    return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }

  // Comentário inline só quando o "#" é precedido por espaço (preserva URLs com #).
  const comentario = value.match(/(^|\s)#/);
  if (comentario && comentario.index !== undefined) {
    value = value.slice(0, comentario.index).trimEnd();
  }
  return value;
}

/**
 * Parser próprio de arquivos `.env` (equivalente ao formato do dotenv).
 *
 * Suporta: linhas em branco, comentários com `#`, prefixo `export`,
 * valores com aspas simples/duplas, comentários inline e quebras `\n`.
 *
 * @param {string} content Conteúdo do arquivo.
 * @param {{ source?: string }} [options]
 * @returns {Record<string, string>}
 */
export function parseEnv(content, { source = '.env' } = {}) {
  /** @type {Record<string, string>} */
  const values = {};
  const texto = String(content ?? '').replace(/^\uFEFF/, '');
  const linhas = texto.split(/\r?\n/);

  for (let index = 0; index < linhas.length; index += 1) {
    let linha = linhas[index].trim();
    if (!linha || linha.startsWith('#')) continue;

    if (/^export\s+/.test(linha)) {
      linha = linha.replace(/^export\s+/, '').trim();
    }

    const separador = linha.indexOf('=');
    if (separador === -1) {
      throw new EnvParseError(source, index + 1, 'esperava o formato CHAVE=valor.');
    }

    const chave = linha.slice(0, separador).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(chave)) {
      throw new EnvParseError(
        source,
        index + 1,
        `nome de variável inválido: "${chave}". Use apenas letras, números e _ (não pode começar com número).`,
      );
    }

    values[chave] = parseEnvValue(linha.slice(separador + 1));
  }

  return values;
}

/**
 * Lê os arquivos de ambiente disponíveis, em ordem, mesclando os valores.
 * Arquivos ausentes são ignorados.
 *
 * @param {{ cwd?: string, files?: readonly string[] }} [options]
 * @returns {Promise<{ values: Record<string, string>, loadedFiles: string[] }>}
 */
export async function readEnvFiles({ cwd = process.cwd(), files = DEFAULT_ENV_FILES } = {}) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const loadedFiles = [];

  for (const arquivo of files) {
    const caminho = path.resolve(cwd, arquivo);
    if (!existsSync(caminho)) continue;

    let conteudo;
    try {
      conteudo = await readFile(caminho, 'utf8');
    } catch (erro) {
      throw new ConfigError(
        `Não foi possível ler "${arquivo}": ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }

    Object.assign(values, parseEnv(conteudo, { source: arquivo }));
    loadedFiles.push(caminho);
  }

  return { values, loadedFiles };
}

/**
 * Ambiente final: arquivos `.env`/`.env.local` + `process.env` (precedência).
 * Variáveis de ambiente vazias são tratadas como "não definidas".
 *
 * @param {{ cwd?: string, files?: readonly string[], processEnv?: Record<string, string | undefined> }} [options]
 * @returns {Promise<{ values: Record<string, string>, loadedFiles: string[] }>}
 */
export async function loadEnv({
  cwd = process.cwd(),
  files = DEFAULT_ENV_FILES,
  processEnv = process.env,
} = {}) {
  const { values, loadedFiles } = await readEnvFiles({ cwd, files });

  for (const [chave, valor] of Object.entries(processEnv)) {
    if (valor === undefined || valor === null) continue;
    if (String(valor) === '') continue;
    values[chave] = String(valor);
  }

  return { values, loadedFiles };
}

/**
 * Valida uma URL HTTP/HTTPS.
 * @param {string} valor
 * @param {string} nomeVariavel
 * @returns {{ value: string, error: string | null }}
 */
export function validarUrlHttp(valor, nomeVariavel) {
  const texto = String(valor ?? '').trim();
  if (!texto) {
    return {
      value: '',
      error: `${nomeVariavel} é obrigatória e não foi definida.`,
    };
  }

  let url;
  try {
    url = new URL(texto);
  } catch {
    return {
      value: texto,
      error: `${nomeVariavel} não é uma URL válida: "${texto}". Exemplo: https://seu-projeto.supabase.co`,
    };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      value: texto,
      error: `${nomeVariavel} deve usar http:// ou https:// (recebido: "${url.protocol}").`,
    };
  }

  if (!url.hostname) {
    return {
      value: texto,
      error: `${nomeVariavel} precisa informar um host (ex.: https://seu-projeto.supabase.co).`,
    };
  }

  return { value: texto, error: null };
}

/**
 * Valida o ambiente e monta o objeto imutável de configuração.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Readonly<{ supabaseUrl: string, supabaseAnonKey: string, espUrl: string, appEnv: string, appVersion: string }>}
 * @throws {ConfigError} quando alguma variável obrigatória está ausente/inválida.
 */
export function buildConfig(env = {}) {
  /** @type {string[]} */
  const erros = [];

  const url = validarUrlHttp(env.SUPABASE_URL, 'SUPABASE_URL');
  if (url.error) {
    erros.push(
      url.error.includes('não foi definida')
        ? 'SUPABASE_URL é obrigatória. Defina a Project URL do Supabase (Project Settings > API).'
        : url.error,
    );
  }

  const anonKey = String(env.SUPABASE_ANON_KEY ?? '').trim();
  if (!anonKey) {
    erros.push(
      'SUPABASE_ANON_KEY é obrigatória. Defina a chave pública "anon" do Supabase (Project Settings > API).',
    );
  }

  const espUrlRaw = String(env.ESP_URL ?? '').trim();
  const espUrlValue = espUrlRaw || DEFAULT_CONFIG.espUrl;
  const esp = validarUrlHttp(espUrlValue, 'ESP_URL');
  if (esp.error) {
    erros.push(esp.error);
  }

  const appEnv = String(env.APP_ENV ?? '').trim() || DEFAULT_CONFIG.appEnv;
  const appVersion = String(env.APP_VERSION ?? '').trim() || DEFAULT_CONFIG.appVersion;

  if (erros.length > 0) {
    throw new ConfigError(erros);
  }

  // Remove barras finais do ESP_URL para não gerar "//api/...".
  const espUrlSemBarra = String(esp.value || espUrlValue).trim().replace(/\/+$/, '');

  return Object.freeze({
    supabaseUrl: url.value,
    supabaseAnonKey: anonKey,
    espUrl: espUrlSemBarra,
    appEnv,
    appVersion,
  });
}

/**
 * Gera o conteúdo de `config.js`.
 * @param {{ supabaseUrl: string, supabaseAnonKey: string, espUrl: string, appEnv: string, appVersion: string }} config
 * @returns {string}
 */
export function renderConfig(config) {
  return [
    '/* =========================================================================',
    '   ATENÇÃO: arquivo gerado automaticamente por scripts/build-config.mjs.',
    '   NÃO edite à mão e NÃO comite este arquivo (ele está no .gitignore).',
    `   Gerado em: ${new Date().toISOString()}`,
    '   ========================================================================= */',
    'window.__APP_CONFIG__ = Object.freeze({',
    `  supabaseUrl: ${JSON.stringify(config.supabaseUrl)},`,
    `  supabaseAnonKey: ${JSON.stringify(config.supabaseAnonKey)},`,
    `  espUrl: ${JSON.stringify(config.espUrl)},`,
    `  appEnv: ${JSON.stringify(config.appEnv)},`,
    `  appVersion: ${JSON.stringify(config.appVersion)},`,
    '});',
    '',
  ].join('\n');
}

/**
 * Escreve o `config.js` no caminho informado (cria pastas se preciso).
 * @param {{ supabaseUrl: string, supabaseAnonKey: string, espUrl: string, appEnv: string, appVersion: string }} config
 * @param {string} outPath
 * @returns {Promise<string>} Caminho absoluto gravado.
 */
export async function writeConfigFile(config, outPath) {
  const destino = path.resolve(outPath);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, renderConfig(config), 'utf8');
  return destino;
}

/**
 * Formata um erro para exibição no terminal (sem vazar segredos).
 * @param {unknown} erro
 * @returns {string}
 */
export function formatError(erro) {
  if (erro instanceof ConfigError) {
    const linhas = erro.messages.map((mensagem) => `  - ${mensagem}`);
    return [
      '❌ Não foi possível gerar o config.js:',
      ...linhas,
      '',
      'Dica: copie `.env.example` para `.env.local` e preencha SUPABASE_URL e SUPABASE_ANON_KEY.',
      'Na Vercel, cadastre essas variáveis em Project Settings > Environment Variables.',
    ].join('\n');
  }

  if (erro instanceof EnvParseError) {
    return [
      '❌ Erro ao ler o arquivo de ambiente:',
      `  - ${erro.message}`,
      '',
      'Corrija a linha indicada (formato esperado: CHAVE=valor).',
    ].join('\n');
  }

  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return `❌ Erro inesperado ao gerar o config.js:\n  - ${mensagem}`;
}

/**
 * Executa o CLI. Exportado para testes.
 * @param {{ cwd?: string, processEnv?: Record<string, string | undefined>, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [options]
 * @returns {Promise<number>} Código de saída (0 = sucesso).
 */
export async function run({
  cwd = process.cwd(),
  processEnv = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const saida = path.resolve(cwd, String(processEnv.CONFIG_OUT ?? '').trim() || CONFIG_FILENAME);

  try {
    const { values, loadedFiles } = await loadEnv({ cwd, processEnv });
    const config = buildConfig(values);
    const arquivo = await writeConfigFile(config, saida);

    stdout.write('🔧 Configuração do site (config.js)\n');
    if (loadedFiles.length > 0) {
      const nomes = loadedFiles.map((arquivoEnv) => path.basename(arquivoEnv)).join(', ');
      stdout.write(`   Arquivos lidos: ${nomes}\n`);
    } else {
      stdout.write('   Arquivos lidos: nenhum .env/.env.local (usando variáveis do ambiente)\n');
    }
    stdout.write(`   Supabase URL : ${config.supabaseUrl}\n`);
    stdout.write(`   ESP32 URL    : ${config.espUrl}\n`);
    stdout.write(`   Ambiente     : ${config.appEnv} | Versão: ${config.appVersion}\n`);
    stdout.write(`✅ config.js gerado em: ${arquivo}\n`);
    return 0;
  } catch (erro) {
    stderr.write(`${formatError(erro)}\n`);
    return 1;
  }
}

const executadoDiretamente = (() => {
  const entrada = process.argv[1];
  if (!entrada) return false;
  try {
    return pathToFileURL(path.resolve(entrada)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (executadoDiretamente) {
  process.exitCode = await run();
}
