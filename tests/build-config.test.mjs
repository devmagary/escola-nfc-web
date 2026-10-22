/**
 * testes do build-config.mjs
 * ---------------------------------------------------------------------------
 * Cobrem: parser de `.env`, resolução de precedência, validação, geração do
 * `config.js` (via módulo e via CLI) e CONFIG_OUT.
 *
 * Rodam sem rede e sem dependências externas: `npm test`.
 * ---------------------------------------------------------------------------
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  ConfigError,
  DEFAULT_CONFIG,
  EnvParseError,
  buildConfig,
  loadEnv,
  parseEnv,
  parseEnvValue,
  readEnvFiles,
  renderConfig,
  validarUrlHttp,
} from '../scripts/build-config.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, '..');
const SCRIPT_BUILD = path.join(PROJECT_ROOT, 'scripts', 'build-config.mjs');
const CHAVES_CONFIG = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'ESP_URL',
  'APP_ENV',
  'APP_VERSION',
  'CONFIG_OUT',
];

/**
 * Ambiente limpo, sem as variáveis de configuração do projeto.
 * @param {Record<string, string>} [extras]
 * @returns {Record<string, string>}
 */
function ambienteLimpo(extras = {}) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [chave, valor] of Object.entries(process.env)) {
    if (valor !== undefined) env[chave] = valor;
  }
  for (const chave of CHAVES_CONFIG) delete env[chave];
  return { ...env, ...extras };
}

/**
 * Executa o CLI do build-config.
 * @param {{ cwd: string, env?: Record<string, string> }} options
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function executarBuild({ cwd, env = ambienteLimpo() }) {
  return spawnSync(process.execPath, [SCRIPT_BUILD], {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

/**
 * Cria pasta temporária e agenda a limpeza.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function criarPastaTemporaria(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'escola-nfc-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Interpreta o config.js gerado em um contexto isolado (simula o navegador).
 * @param {string} conteudo
 * @returns {Record<string, string>}
 */
function lerConfigGerado(conteudo) {
  const sandbox = { window: {} };
  vm.runInNewContext(conteudo, sandbox);
  const config = sandbox.window.__APP_CONFIG__;
  assert.ok(config, 'window.__APP_CONFIG__ não foi definido');
  return config;
}

// ---------------------------------------------------------------------------
// Parser de arquivos .env
// ---------------------------------------------------------------------------
test('parseEnv lê comentários, export, aspas, comentário inline e duplicatas', () => {
  const env = parseEnv(
    [
      '# comentário inteiro',
      '',
      'SUPABASE_URL=https://abc.supabase.co',
      'export SUPABASE_ANON_KEY=chave-anon-123',
      'ESP_URL="http://192.168.0.73"',
      "APP_ENV='production'",
      'APP_VERSION=1.1.0 # versão exibida no painel',
      'NOME="Linha 1\\nLinha 2"',
      'URL_COM_HASH=https://exemplo.com/#secao',
      'VAZIA=',
      'DUP=primeiro',
      'DUP=segundo',
    ].join('\n'),
  );

  assert.equal(env.SUPABASE_URL, 'https://abc.supabase.co');
  assert.equal(env.SUPABASE_ANON_KEY, 'chave-anon-123');
  assert.equal(env.ESP_URL, 'http://192.168.0.73');
  assert.equal(env.APP_ENV, 'production');
  assert.equal(env.APP_VERSION, '1.1.0');
  assert.equal(env.NOME, 'Linha 1\nLinha 2');
  assert.equal(env.URL_COM_HASH, 'https://exemplo.com/#secao');
  assert.equal(env.VAZIA, '');
  assert.equal(env.DUP, 'segundo');
});

test('parseEnv aceita BOM e CRLF', () => {
  const env = parseEnv('\uFEFFCHAVE=valor\r\nOUTRA=2\r\n');
  assert.deepEqual(env, { CHAVE: 'valor', OUTRA: '2' });
});

test('parseEnvValue remove apenas comentários precedidos de espaço', () => {
  assert.equal(parseEnvValue('valor # comentário'), 'valor');
  assert.equal(parseEnvValue('https://x/#frag'), 'https://x/#frag');
  assert.equal(parseEnvValue('"com # dentro"'), 'com # dentro');
  assert.equal(parseEnvValue("'aspas simples'"), 'aspas simples');
  assert.equal(parseEnvValue(''), '');
});

test('parseEnv rejeita linhas malformadas com número da linha', () => {
  assert.throws(
    () => parseEnv('OK=1\nLINHA_SEM_IGUAL', { source: '.env.local' }),
    (erro) => {
      assert.ok(erro instanceof EnvParseError);
      assert.match(erro.message, /\.env\.local/);
      assert.match(erro.message, /linha 2/);
      return true;
    },
  );

  assert.throws(() => parseEnv('1INVALIDA=valor'), EnvParseError);
});

// ---------------------------------------------------------------------------
// Validação de URL
// ---------------------------------------------------------------------------
test('validarUrlHttp aceita http/https e rejeita ausente/inválida/outro protocolo', () => {
  assert.equal(validarUrlHttp('https://abc.supabase.co', 'SUPABASE_URL').error, null);
  assert.equal(validarUrlHttp('http://192.168.0.73', 'ESP_URL').error, null);

  assert.match(validarUrlHttp('', 'SUPABASE_URL').error ?? '', /SUPABASE_URL/);
  assert.match(validarUrlHttp('não é url', 'SUPABASE_URL').error ?? '', /URL válida/);
  assert.match(validarUrlHttp('ftp://abc.supabase.co', 'SUPABASE_URL').error ?? '', /http/);
});

// ---------------------------------------------------------------------------
// buildConfig
// ---------------------------------------------------------------------------
test('buildConfig aplica padrões e congela o objeto', () => {
  const config = buildConfig({
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_ANON_KEY: 'anon-123',
  });

  assert.deepEqual(
    { ...config },
    {
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-123',
      espUrl: DEFAULT_CONFIG.espUrl,
      appEnv: DEFAULT_CONFIG.appEnv,
      appVersion: DEFAULT_CONFIG.appVersion,
    },
  );
  assert.ok(Object.isFrozen(config));
});

test('buildConfig respeita valores personalizados e remove barra final do ESP_URL', () => {
  const config = buildConfig({
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_ANON_KEY: 'anon-123',
    ESP_URL: 'http://192.168.0.73/',
    APP_ENV: 'staging',
    APP_VERSION: '2.0.0',
  });

  assert.equal(config.espUrl, 'http://192.168.0.73');
  assert.equal(config.appEnv, 'staging');
  assert.equal(config.appVersion, '2.0.0');
});

test('buildConfig falha com mensagens claras quando faltam variáveis', () => {
  assert.throws(
    () => buildConfig({}),
    (erro) => {
      assert.ok(erro instanceof ConfigError);
      const texto = erro.messages.join(' ');
      assert.match(texto, /SUPABASE_URL/);
      assert.match(texto, /SUPABASE_ANON_KEY/);
      return true;
    },
  );

  assert.throws(
    () => buildConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: '   ' }),
    /SUPABASE_ANON_KEY/,
  );

  assert.throws(
    () => buildConfig({ SUPABASE_URL: 'ftp://abc.supabase.co', SUPABASE_ANON_KEY: 'anon' }),
    /http:\/\//,
  );

  assert.throws(
    () =>
      buildConfig({
        SUPABASE_URL: 'https://abc.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        ESP_URL: 'sem-url',
      }),
    /ESP_URL/,
  );
});

// ---------------------------------------------------------------------------
// renderConfig
// ---------------------------------------------------------------------------
test('renderConfig gera window.__APP_CONFIG__ imutável e válido', () => {
  const config = buildConfig({
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_ANON_KEY: 'anon-123',
    ESP_URL: 'http://192.168.0.73',
    APP_ENV: 'staging',
    APP_VERSION: '1.2.3',
  });

  const conteudo = renderConfig(config);
  assert.match(conteudo, /window\.__APP_CONFIG__ = Object\.freeze\(\{/);
  assert.doesNotMatch(conteudo, /SUPABASE_SERVICE_ROLE_KEY/);

  const lido = lerConfigGerado(conteudo);
  assert.deepEqual({ ...lido }, { ...config });
  assert.ok(Object.isFrozen(lido));
});

test('renderConfig escapa aspas e barras invertidas com segurança', () => {
  const conteudo = renderConfig({
    supabaseUrl: 'https://abc.supabase.co',
    supabaseAnonKey: 'chave-com-"aspas"-e-\\barra',
    espUrl: 'http://nfc.local',
    appEnv: 'production',
    appVersion: '1.1.0',
  });

  const lido = lerConfigGerado(conteudo);
  assert.equal(lido.supabaseAnonKey, 'chave-com-"aspas"-e-\\barra');
});

// ---------------------------------------------------------------------------
// Leitura e precedência de .env / .env.local / process.env
// ---------------------------------------------------------------------------
test('loadEnv mescla .env, .env.local e process.env com a precedência correta', async (t) => {
  const dir = criarPastaTemporaria(t);
  writeFileSync(
    path.join(dir, '.env'),
    [
      'SUPABASE_URL=https://do-arquivo-env.supabase.co',
      'SUPABASE_ANON_KEY=anon-do-env',
      'ESP_URL=http://192.168.0.50',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(dir, '.env.local'), 'SUPABASE_ANON_KEY=anon-do-env-local\n', 'utf8');

  const { values, loadedFiles } = await loadEnv({
    cwd: dir,
    processEnv: { SUPABASE_URL: 'https://do-process-env.supabase.co' },
  });

  assert.equal(loadedFiles.length, 2);
  assert.equal(values.SUPABASE_URL, 'https://do-process-env.supabase.co');
  assert.equal(values.SUPABASE_ANON_KEY, 'anon-do-env-local');
  assert.equal(values.ESP_URL, 'http://192.168.0.50');
});

test('readEnvFiles ignora arquivos ausentes e variáveis de ambiente vazias não sobrescrevem', async (t) => {
  const dir = criarPastaTemporaria(t);

  const vazio = await readEnvFiles({ cwd: dir });
  assert.deepEqual(vazio.values, {});
  assert.deepEqual(vazio.loadedFiles, []);

  writeFileSync(path.join(dir, '.env'), 'SUPABASE_URL=https://arquivo.supabase.co\n', 'utf8');
  const { values } = await loadEnv({ cwd: dir, processEnv: { SUPABASE_URL: '' } });
  assert.equal(values.SUPABASE_URL, 'https://arquivo.supabase.co');
});

// ---------------------------------------------------------------------------
// CLI de verdade (processo filho)
// ---------------------------------------------------------------------------
test('CLI sem SUPABASE_URL falha com exit 1 e mensagem útil, sem criar config.js', (t) => {
  const dir = criarPastaTemporaria(t);
  const resultado = executarBuild({ cwd: dir });

  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /SUPABASE_URL/);
  assert.match(resultado.stderr, /SUPABASE_ANON_KEY/);
  assert.match(resultado.stderr, /\.env\.example/);
  assert.equal(existsSync(path.join(dir, 'config.js')), false);
});

test('CLI com variáveis dummy gera config.js válido em CONFIG_OUT', (t) => {
  const dir = criarPastaTemporaria(t);
  const saida = path.join(dir, 'dist', 'config.js');

  const resultado = executarBuild({
    cwd: dir,
    env: ambienteLimpo({
      SUPABASE_URL: 'https://teste.supabase.co',
      SUPABASE_ANON_KEY: 'anon-de-teste',
      ESP_URL: 'http://192.168.0.73/',
      APP_ENV: 'staging',
      APP_VERSION: '2.0.0',
      CONFIG_OUT: saida,
    }),
  });

  assert.equal(resultado.status, 0, resultado.stderr);
  assert.ok(existsSync(saida), 'config.js não foi criado em CONFIG_OUT');
  assert.match(resultado.stdout, /config\.js gerado/);

  const lido = lerConfigGerado(readFileSync(saida, 'utf8'));
  assert.equal(lido.supabaseUrl, 'https://teste.supabase.co');
  assert.equal(lido.supabaseAnonKey, 'anon-de-teste');
  assert.equal(lido.espUrl, 'http://192.168.0.73');
  assert.equal(lido.appEnv, 'staging');
  assert.equal(lido.appVersion, '2.0.0');

  // O arquivo gerado precisa ser JavaScript sintaticamente válido.
  const check = spawnSync(process.execPath, ['--check', saida], { encoding: 'utf8', windowsHide: true });
  assert.equal(check.status, 0, check.stderr);
});

test('CLI lê .env quando não há variáveis no processo', (t) => {
  const dir = criarPastaTemporaria(t);
  writeFileSync(
    path.join(dir, '.env'),
    [
      'SUPABASE_URL=https://do-env.supabase.co',
      'SUPABASE_ANON_KEY=anon-do-env',
      'ESP_URL=http://192.168.0.60',
    ].join('\n'),
    'utf8',
  );

  const resultado = executarBuild({ cwd: dir });
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.match(resultado.stdout, /\.env/);

  const lido = lerConfigGerado(readFileSync(path.join(dir, 'config.js'), 'utf8'));
  assert.equal(lido.supabaseUrl, 'https://do-env.supabase.co');
  assert.equal(lido.espUrl, 'http://192.168.0.60');
});

test('CLI dá precedência a process.env sobre .env', (t) => {
  const dir = criarPastaTemporaria(t);
  writeFileSync(
    path.join(dir, '.env'),
    'SUPABASE_URL=https://do-arquivo.supabase.co\nSUPABASE_ANON_KEY=anon-arquivo\n',
    'utf8',
  );

  const resultado = executarBuild({
    cwd: dir,
    env: ambienteLimpo({
      SUPABASE_URL: 'https://do-processo.supabase.co',
      SUPABASE_ANON_KEY: 'anon-processo',
    }),
  });

  assert.equal(resultado.status, 0, resultado.stderr);
  const lido = lerConfigGerado(readFileSync(path.join(dir, 'config.js'), 'utf8'));
  assert.equal(lido.supabaseUrl, 'https://do-processo.supabase.co');
  assert.equal(lido.supabaseAnonKey, 'anon-processo');
});
