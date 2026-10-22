#!/usr/bin/env node
/**
 * serve-local.mjs
 * ---------------------------------------------------------------------------
 * Servidor HTTP estático local, sem dependências externas.
 *
 * Serve os arquivos de `escola-nfc-web` (index.html, app.js, style.css,
 * config.js, js/, imagens etc.) para abrir o totem/portaria em
 * http://localhost:5500 — ou pelo IP da máquina na rede local.
 *
 * Variáveis:
 *   PORT  porta HTTP (padrão 5500)
 *
 * Segurança:
 *   - bloqueia path traversal (inclusive com %2e%2e codificado);
 *   - não serve dotfiles (.env, .git...), node_modules, scripts/ e tests/.
 * ---------------------------------------------------------------------------
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz servida: a pasta que contém `scripts/` (ou seja, escola-nfc-web). */
export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Porta padrão do totem/portaria local. */
export const DEFAULT_PORT = 5500;

/** Mapa de extensões → Content-Type. */
export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
});

/** Extensões que nunca devem ser cacheadas no servidor local. */
const SEM_CACHE = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json']);

/** Segmentos de caminho que não podem ser servidos. */
const SEGMENTOS_BLOQUEADOS = new Set(['node_modules', 'scripts', 'tests', '.github']);

/**
 * @param {string} pathname
 * @returns {string | null} Caminho relativo seguro, ou null se inválido.
 */
export function normalizarCaminho(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  if (pathname.includes('\0')) return null;

  let decodificado;
  try {
    decodificado = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decodificado.includes('\0')) return null;

  const relativo = decodificado.replace(/^\/+/, '');
  const segmentos = relativo.split(/[\\/]+/).filter(Boolean);
  if (segmentos.some((segmento) => segmento === '..' || segmento.startsWith('.'))) return null;
  if (segmentos.some((segmento) => SEGMENTOS_BLOQUEADOS.has(segmento.toLowerCase()))) return null;

  return segmentos.join('/');
}

/**
 * Resolve um caminho de URL para um arquivo dentro da raiz (ou null).
 * @param {string} pathname
 * @param {{ root?: string }} [options]
 * @returns {string | null}
 */
export function resolverArquivo(pathname, { root = PROJECT_ROOT } = {}) {
  const relativo = normalizarCaminho(pathname);
  if (relativo === null) return null;

  const caminho = path.resolve(root, relativo);
  const raizNormalizada = path.resolve(root);
  if (caminho !== raizNormalizada && !caminho.startsWith(raizNormalizada + path.sep)) {
    return null;
  }
  return caminho;
}

/**
 * @param {string} caminho
 * @returns {string}
 */
function contentType(caminho) {
  return MIME_TYPES[path.extname(caminho).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * @param {string} caminho
 * @returns {string}
 */
function cacheControl(caminho) {
  const extensao = path.extname(caminho).toLowerCase();
  if (SEM_CACHE.has(extensao) || path.basename(caminho) === 'config.js') {
    return 'no-store, max-age=0';
  }
  return 'public, max-age=3600';
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} mensagem
 * @param {Record<string, string>} [headers]
 */
function responderTexto(res, status, mensagem, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(mensagem);
}

/**
 * Handler HTTP do servidor estático.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ root?: string }} [options]
 */
export async function handler(req, res, { root = PROJECT_ROOT } = {}) {
  const metodo = req.method ?? 'GET';
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    responderTexto(res, 405, 'Método não permitido. Use GET ou HEAD.', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
  } catch {
    responderTexto(res, 400, 'URL inválida.');
    return;
  }

  const arquivo = resolverArquivo(pathname, { root });
  if (!arquivo) {
    responderTexto(res, 403, 'Acesso negado: caminho inválido.');
    return;
  }

  let info;
  try {
    info = await stat(arquivo);
  } catch {
    info = null;
  }

  let caminhoFinal = arquivo;
  if (info?.isDirectory()) {
    caminhoFinal = path.join(arquivo, 'index.html');
    try {
      info = await stat(caminhoFinal);
    } catch {
      info = null;
    }
  }

  if (!info?.isFile()) {
    const dica =
      path.basename(caminhoFinal) === 'config.js'
        ? 'config.js não encontrado. Rode "npm run build" (ou "npm run dev") antes de abrir o totem.'
        : 'Arquivo não encontrado.';
    responderTexto(res, 404, dica);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType(caminhoFinal),
    'Content-Length': info.size,
    'Cache-Control': cacheControl(caminhoFinal),
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  });

  if (metodo === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(caminhoFinal);
  stream.on('error', () => {
    if (!res.headersSent) {
      responderTexto(res, 500, 'Erro ao ler o arquivo.');
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

/**
 * Lista os IPv4 da rede local para exibir no terminal.
 * @returns {string[]}
 */
export function listarIpsLocais() {
  /** @type {string[]} */
  const ips = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces ?? []) {
      if (item.family === 'IPv4' && !item.internal) ips.push(item.address);
    }
  }
  return ips;
}

/**
 * Cria (sem iniciar) o servidor HTTP.
 * @param {{ root?: string }} [options]
 * @returns {http.Server}
 */
export function criarServidor({ root = PROJECT_ROOT } = {}) {
  return http.createServer((req, res) => {
    handler(req, res, { root }).catch((erro) => {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      process.stderr.write(`❌ Erro ao servir ${req.url}: ${mensagem}\n`);
      if (!res.headersSent) responderTexto(res, 500, 'Erro interno do servidor.');
      else res.destroy();
    });
  });
}

/**
 * Inicia o servidor.
 * @param {{ port?: number, root?: string }} [options]
 * @returns {Promise<http.Server>}
 */
export async function iniciar({ port = DEFAULT_PORT, root = PROJECT_ROOT } = {}) {
  const servidor = criarServidor({ root });

  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(port, '0.0.0.0', () => {
      servidor.off('error', reject);
      resolve(undefined);
    });
  });

  const linha = '─'.repeat(58);
  process.stdout.write(`${linha}\n`);
  process.stdout.write('🖥️  Servidor local do totem/portaria (escola-nfc-web)\n');
  process.stdout.write(`${linha}\n`);
  process.stdout.write(`   Local: http://localhost:${port}\n`);
  for (const ip of listarIpsLocais()) {
    process.stdout.write(`   Rede : http://${ip}:${port}\n`);
  }
  process.stdout.write(`   Raiz : ${root}\n`);
  process.stdout.write('   Pare com Ctrl+C.\n');
  process.stdout.write(`${linha}\n`);

  return servidor;
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
  const porta = process.env.PORT === undefined || process.env.PORT === '' ? DEFAULT_PORT : Number(process.env.PORT);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    process.stderr.write(`❌ PORT inválida: "${process.env.PORT}". Use um número entre 1 e 65535.\n`);
    process.exitCode = 1;
  } else {
    try {
      const servidor = await iniciar({ port: porta });
      for (const sinal of ['SIGINT', 'SIGTERM']) {
        process.on(sinal, () => {
          process.stdout.write('\n⏹️  Encerrando servidor local...\n');
          servidor.close(() => process.exit(0));
        });
      }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      if (mensagem.includes('EADDRINUSE')) {
        process.stderr.write(
          `❌ A porta ${porta} já está em uso. Feche o outro processo ou use outra porta: PORT=${porta + 1} npm run totem\n`,
        );
      } else {
        process.stderr.write(`❌ Não foi possível iniciar o servidor local: ${mensagem}\n`);
      }
      process.exitCode = 1;
    }
  }
}
