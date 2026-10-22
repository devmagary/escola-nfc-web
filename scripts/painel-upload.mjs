#!/usr/bin/env node
/**
 * painel-upload.mjs
 * ---------------------------------------------------------------------------
 * Envia o pacote `painel-dist/` para o LittleFS do ESP32 via HTTP multipart.
 * O firmware precisa ter a rota `/api/painel/upload` (versão nova).
 *
 * Uso:
 *   npm run painel:build
 *   npm run painel:upload -- --esp http://192.168.0.73
 *
 * Variáveis (ou flags):
 *   ESP_URL              endereço do ESP32
 *   ESP_ADMIN_USER       usuário do painel da placa (padrão: admin)
 *   ESP_ADMIN_PASSWORD   senha do painel da placa (padrão: admin123)
 *
 * Segurança: a senha é usada só para o Basic Auth do upload; nunca é impressa.
 * ---------------------------------------------------------------------------
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './build-config.mjs';
import { normalizarUrlEsp } from '../js/lib/config.js';

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PAINEL_DIST = path.join(PROJECT_ROOT, 'painel-dist');

function lerArgumentos(argv) {
  const opcoes = { esp: '', user: '', password: '', dist: PAINEL_DIST };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--esp') opcoes.esp = argv[++i] || '';
    else if (arg === '--user') opcoes.user = argv[++i] || '';
    else if (arg === '--password') opcoes.password = argv[++i] || '';
    else if (arg === '--dist') opcoes.dist = path.resolve(argv[++i] || PAINEL_DIST);
  }
  return opcoes;
}

async function listarArquivos(dir, base = '') {
  const itens = await readdir(dir, { withFileTypes: true });
  const arquivos = [];
  for (const item of itens) {
    const relativo = base ? `${base}/${item.name}` : item.name;
    if (item.isDirectory()) arquivos.push(...await listarArquivos(path.join(dir, item.name), relativo));
    else if (item.isFile()) arquivos.push(relativo);
  }
  return arquivos.sort();
}

function autorizacaoBasic(usuario, senha) {
  return 'Basic ' + Buffer.from(`${usuario}:${senha}`, 'utf8').toString('base64');
}

async function enviarArquivo(baseUrl, relativo, arquivo, auth) {
  const destino = `/painel/${relativo.split(path.sep).join('/')}`;
  const conteudo = await readFile(arquivo);
  const form = new FormData();
  form.append('arquivo', new Blob([conteudo]), path.basename(relativo));

  const resposta = await fetch(`${baseUrl}/api/painel/upload?path=${encodeURIComponent(destino)}`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      // O WebServer do ESP32 fecha a conexão; evita o parser keep-alive do
      // undici (Node 24) reclamar de socket encerrado no fim do processo.
      Connection: 'close'
    },
    body: form,
    signal: AbortSignal.timeout(30000)
  });

  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`${destino}: HTTP ${resposta.status} — ${texto.slice(0, 180)}`);
  }
  let json = null;
  try { json = JSON.parse(texto); } catch (_) { /* resposta não JSON */ }
  if (json && json.ok === false) throw new Error(`${destino}: ${json.erro || 'falha no upload'}`);
  return { destino, bytes: conteudo.length, resposta: texto };
}

/**
 * Envia todos os arquivos de `painel-dist` (incluindo `.gz`).
 * @param {{ espUrl?: string, user?: string, password?: string, dist?: string, log?: (msg: string) => void }} [options]
 * @returns {Promise<{ total: number, bytes: number, url: string }>}
 */
export async function uploadPainel({
  espUrl = '',
  user = 'admin',
  password = 'admin123',
  dist = PAINEL_DIST,
  log = (msg) => process.stdout.write(msg + '\n')
} = {}) {
  if (!existsSync(dist)) {
    throw new Error('painel-dist não existe. Rode primeiro: npm run painel:build');
  }

  const baseUrl = normalizarUrlEsp(espUrl || 'http://nfc.local');
  const auth = autorizacaoBasic(user, password);
  const arquivos = await listarArquivos(dist);
  if (arquivos.length === 0) throw new Error('painel-dist está vazio.');

  let bytes = 0;
  log(`📡 Enviando ${arquivos.length} arquivo(s) para ${baseUrl}/painel/`);
  for (let i = 0; i < arquivos.length; i += 1) {
    const relativo = arquivos[i];
    const resultado = await enviarArquivo(baseUrl, relativo, path.join(dist, relativo), auth);
    bytes += resultado.bytes;
    log(`   [${i + 1}/${arquivos.length}] ${relativo} (${(resultado.bytes / 1024).toFixed(1)} KB)`);
  }

  const verificacao = await fetch(`${baseUrl}/painel/`, {
    headers: { Connection: 'close' },
    signal: AbortSignal.timeout(10000)
  });
  // Consome o corpo antes de encerrar; sem isso o parser do undici pode
  // disparar "assert(!this.paused)" ao fechar o socket do ESP32.
  const corpoVerificacao = await verificacao.text();
  if (!verificacao.ok) {
    throw new Error(`Upload concluído, mas ${baseUrl}/painel/ respondeu HTTP ${verificacao.status}: ${corpoVerificacao.slice(0, 120)}`);
  }

  log('');
  log(`✅ Painel enviado: ${baseUrl}/painel/`);
  log(`   Total: ${(bytes / 1024).toFixed(1)} KB (${arquivos.length} arquivos)`);
  return { total: arquivos.length, bytes, url: `${baseUrl}/painel/` };
}

export async function run({ argv = process.argv.slice(2), cwd = PROJECT_ROOT } = {}) {
  try {
    const opcoes = lerArgumentos(argv);
    const { values } = await loadEnv({ cwd });
    const espUrl = opcoes.esp || values.ESP_URL || 'http://nfc.local';
    const user = opcoes.user || values.ESP_ADMIN_USER || 'admin';
    const password = opcoes.password || values.ESP_ADMIN_PASSWORD || 'admin123';
    await uploadPainel({
      espUrl,
      user,
      password,
      dist: opcoes.dist,
      log: (msg) => process.stdout.write(msg + '\n')
    });
    return 0;
  } catch (erro) {
    process.stderr.write(`❌ Falha ao enviar o painel: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.stderr.write('   Confira o IP do ESP32 e a senha do painel da placa (ESP_ADMIN_PASSWORD).\n');
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
