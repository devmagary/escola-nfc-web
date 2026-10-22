#!/usr/bin/env node
/**
 * mock-esp.mjs
 * ---------------------------------------------------------------------------
 * ESP32-S3 simulado em memória para testar a portaria/totem sem hardware.
 *
 * Implementa o mesmo contrato HTTP do firmware real
 * (`esp32s3-nfc-acesso.ino`), com CORS liberado, na porta 8787:
 *
 *   GET  /api/ultimo             → { nfc_ok, seq, uid, nome, cadastrado, ha }
 *   GET  /api/status             → telemetria parecida com a do firmware
 *   GET  /api/cartoes            → lista de cartões sincronizados
 *   POST /api/sincronizar_aluno  → { uid, nome, ativo }
 *   POST /api/sincronizar_todos  → [{ uid, nome, ativo }, ...]
 *   POST /api/remover_aluno      → { uid }
 *   GET  /painel/                → painel completo (pasta painel-dist)
 *   POST /api/painel/upload      → upload multipart do painel (Basic auth)
 *   GET  /mock/ler?uid=XX:YY    → simula uma leitura NFC (incrementa seq)
 *   GET  /mock/estado            → estado interno completo do simulador
 *
 * Variáveis:
 *   PORT  porta HTTP (padrão 8787)
 * ---------------------------------------------------------------------------
 */
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Porta padrão do ESP32 simulado. */
export const DEFAULT_PORT = 8787;

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PAINEL_DIST = path.join(PROJECT_ROOT, 'painel-dist');
export const PAINEL_USUARIO = 'admin';
export const PAINEL_SENHA = 'admin123';

const MIME_PAINEL = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Estado em memória (reinicia a cada execução).
 * @typedef {{ uid: string, nome: string, ativo: boolean }} Cartao
 */
export const estado = {
  nfc_ok: true,
  seq: 0,
  /** @type {{ uid: string, nome: string, cadastrado: boolean, ativo: boolean, lidoEm: number } | null} */
  ultimo: null,
  /** @type {Map<string, Cartao>} */
  cartoes: new Map(),
  iniciadoEm: Date.now(),
};

/**
 * Normaliza UID como o firmware: hexadecimal maiúsculo, separado por ":".
 * Se não for hexadecimal válido (>= 8 dígitos, par), devolve o texto bruto
 * em maiúsculas para facilitar testes manuais.
 * @param {unknown} texto
 * @returns {string}
 */
export function normalizarUid(texto) {
  if (typeof texto !== 'string') return '';
  const bruto = texto.trim().toUpperCase().replace(/^0X/, '');
  const hex = bruto.replace(/[^0-9A-F]/g, '');
  if (hex.length >= 8 && hex.length % 2 === 0) {
    return hex.match(/.{2}/g)?.join(':') ?? bruto;
  }
  return bruto;
}

/**
 * Simula a leitura de uma tag NFC.
 * @param {string} uidBruto
 * @returns {{ ok: true, doc: Record<string, unknown> } | { ok: false, erro: string }}
 */
export function lerTag(uidBruto) {
  const uid = normalizarUid(uidBruto);
  if (!uid) return { ok: false, erro: 'UID do cartão ausente!' };

  const cartao = estado.cartoes.get(uid);
  estado.seq += 1;
  estado.ultimo = {
    uid,
    nome: cartao?.nome ?? '',
    cadastrado: Boolean(cartao),
    ativo: cartao?.ativo ?? false,
    lidoEm: Date.now(),
  };

  return { ok: true, doc: montarUltimo() };
}

/**
 * Corpo da resposta de GET /api/ultimo (mesmas chaves do firmware).
 * @returns {Record<string, unknown>}
 */
export function montarUltimo() {
  /** @type {Record<string, unknown>} */
  const doc = { nfc_ok: estado.nfc_ok, seq: estado.seq };

  if (estado.seq > 0 && estado.ultimo) {
    doc.uid = estado.ultimo.uid;
    doc.nome = estado.ultimo.nome;
    doc.cadastrado = estado.ultimo.cadastrado;
    doc.ha = Math.max(0, Math.floor((Date.now() - estado.ultimo.lidoEm) / 1000));
  }

  return doc;
}

/**
 * Normaliza o payload de um cartão.
 * @param {unknown} entrada
 * @returns {{ ok: true, cartao: Cartao } | { ok: false, erro: string }}
 */
export function normalizarCartao(entrada) {
  if (!entrada || typeof entrada !== 'object') {
    return { ok: false, erro: 'Cartão inválido: esperava um objeto JSON.' };
  }

  const dados = /** @type {Record<string, unknown>} */ (entrada);
  const uid = normalizarUid(dados.uid);
  if (!uid) return { ok: false, erro: 'UID do cartão ausente!' };

  const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
  const ativo = dados.ativo === true || dados.ativo === 'true' || dados.ativo === 1 || dados.ativo === '1';

  return { ok: true, cartao: { uid, nome: nome || 'Aluno', ativo } };
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} corpo
 */
function enviarJson(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(texto);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} mensagem
 */
function enviarErro(res, status, mensagem) {
  enviarJson(res, status, { ok: false, erro: mensagem });
}

/**
 * Lê e decodifica o corpo da requisição (JSON ou form-urlencoded).
 * @param {http.IncomingMessage} req
 * @returns {Promise<{ ok: true, dados: unknown } | { ok: false, erro: string }>}
 */
async function lerCorpo(req) {
  const partes = [];
  let total = 0;
  const LIMITE = 2 * 1024 * 1024; // 2 MB

  for await (const parte of req) {
    total += parte.length;
    if (total > LIMITE) return { ok: false, erro: 'Corpo da requisição muito grande (máximo 2 MB).' };
    partes.push(parte);
  }

  const texto = Buffer.concat(partes).toString('utf8').trim();
  if (!texto) return { ok: true, dados: {} };

  const tipo = String(req.headers['content-type'] ?? '').toLowerCase();
  const pareceJson = tipo.includes('application/json') || texto.startsWith('{') || texto.startsWith('[');

  if (pareceJson) {
    try {
      return { ok: true, dados: JSON.parse(texto) };
    } catch {
      return { ok: false, erro: 'JSON inválido no corpo da requisição.' };
    }
  }

  return { ok: true, dados: Object.fromEntries(new URLSearchParams(texto)) };
}

function autorizadoPainel(req) {
  const esperado = 'Basic ' + Buffer.from(`${PAINEL_USUARIO}:${PAINEL_SENHA}`, 'utf8').toString('base64');
  return String(req.headers.authorization ?? '') === esperado;
}

function resolverArquivoPainel(pathname) {
  let relativo;
  try { relativo = decodeURIComponent(pathname); } catch { return null; }
  if (!relativo.startsWith('/painel/')) return null;
  relativo = relativo.slice('/painel/'.length);
  if (!relativo || relativo.endsWith('/')) relativo += 'index.html';
  if (relativo.includes('..') || relativo.includes('\\')) return null;
  const base = path.resolve(PAINEL_DIST);
  const arquivo = path.resolve(base, relativo);
  if (arquivo !== base && !arquivo.startsWith(base + path.sep)) return null;
  return arquivo;
}

async function servirPainel(req, res, pathname) {
  if (pathname === '/painel') {
    res.writeHead(302, { Location: '/painel/', 'Cache-Control': 'no-store' });
    res.end('Redirecionando para /painel/');
    return;
  }

  const arquivo = resolverArquivoPainel(pathname);
  if (!arquivo) {
    enviarTexto(res, 400, 'Caminho do painel inválido.');
    return;
  }

  let info;
  try { info = await stat(arquivo); } catch { info = null; }
  if (!info?.isFile()) {
    enviarTexto(res, 404, 'Painel ainda não enviado. Rode: npm run painel:build && npm run painel:upload -- --esp http://127.0.0.1:8787');
    return;
  }

  let envio = arquivo;
  let gzip = false;
  if (String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
    try {
      await stat(arquivo + '.gz');
      envio = arquivo + '.gz';
      gzip = true;
    } catch { /* sem .gz */ }
  }

  const conteudo = await readFile(envio);
  const ext = path.extname(arquivo).toLowerCase();
  const headers = {
    'Content-Type': MIME_PAINEL[ext] ?? 'application/octet-stream',
    'Content-Length': conteudo.length,
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
  if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  res.writeHead(200, headers);
  res.end(conteudo);
}

function enviarTexto(res, status, mensagem) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(mensagem);
}

async function uploadPainel(req, res, url) {
  if (!autorizadoPainel(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="ESP32-S3 NFC"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Autenticação necessária.');
    return;
  }

  const destinoRelativo = url.searchParams.get('path') ?? '';
  if (!destinoRelativo.startsWith('/painel/') || destinoRelativo.includes('..') || destinoRelativo.includes('\\')) {
    enviarErro(res, 400, 'path inválido; use /painel/...');
    return;
  }

  let corpo;
  try {
    const partes = [];
    let total = 0;
    for await (const parte of req) {
      total += parte.length;
      if (total > 2 * 1024 * 1024) throw new Error('arquivo maior que 2 MB');
      partes.push(parte);
    }
    corpo = Buffer.concat(partes);
  } catch (erro) {
    enviarErro(res, 400, erro instanceof Error ? erro.message : String(erro));
    return;
  }

  try {
    const request = new Request(`http://mock${req.url}`, {
      method: 'POST',
      headers: { 'content-type': String(req.headers['content-type'] ?? '') },
      body: corpo
    });
    const form = await request.formData();
    const arquivo = form.get('arquivo');
    if (!arquivo || typeof arquivo.arrayBuffer !== 'function') {
      enviarErro(res, 400, 'campo multipart "arquivo" ausente');
      return;
    }
    const base = path.resolve(PAINEL_DIST);
    const destino = path.resolve(base, destinoRelativo.slice('/painel/'.length));
    if (destino !== base && !destino.startsWith(base + path.sep)) {
      enviarErro(res, 400, 'destino inválido');
      return;
    }
    await mkdir(path.dirname(destino), { recursive: true });
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    await writeFile(destino, bytes);
    enviarJson(res, 200, { ok: true, bytes: bytes.length, path: destinoRelativo });
  } catch (erro) {
    enviarErro(res, 400, `multipart inválido: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

/**
 * Handler HTTP do mock.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
export async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    enviarErro(res, 400, 'URL inválida.');
    return;
  }

  const rota = url.pathname.replace(/\/+$/, '') || '/';
  const metodo = req.method ?? 'GET';

  try {
    if (metodo === 'GET' && (url.pathname === '/painel' || url.pathname.startsWith('/painel/'))) {
      await servirPainel(req, res, url.pathname);
      return;
    }

    if (metodo === 'POST' && rota === '/api/painel/upload') {
      await uploadPainel(req, res, url);
      return;
    }

    if (metodo === 'GET' && (rota === '/' || rota === '/mock')) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        [
          '🤖 Mock do ESP32-S3 (NFC) — sem hardware',
          '',
          'GET  /painel/                → painel completo (painel-dist)',
          'POST /api/painel/upload      → upload multipart do painel (Basic auth)',
          'GET  /api/ultimo',
          'GET  /api/status',
          'GET  /api/cartoes',
          'POST /api/sincronizar_aluno   (JSON: { "uid": "...", "nome": "...", "ativo": true })',
          'POST /api/sincronizar_todos   (JSON: [ { "uid": "...", "nome": "...", "ativo": true } ])',
          'POST /api/remover_aluno       (JSON: { "uid": "..." })',
          'GET  /mock/ler?uid=04:A2:B3:C4',
          'GET  /mock/estado',
          '',
          'Exemplo: curl "http://localhost:8787/mock/ler?uid=04:A2:B3:C4"',
          '',
        ].join('\n'),
      );
      return;
    }

    if (metodo === 'GET' && rota === '/api/ultimo') {
      enviarJson(res, 200, montarUltimo());
      return;
    }

    if (metodo === 'GET' && rota === '/api/status') {
      enviarJson(res, 200, {
        modo: 'STA',
        ssid: 'MOCK-ESP32',
        ip: '127.0.0.1',
        rssi: -55,
        ssid_salvo: 'MOCK-ESP32',
        tem_rede_salva: true,
        clientes_ap: 0,
        chip: 'ESP32-S3 (mock)',
        chip_revisao: 0,
        chip_nucleos: 2,
        wifi_padrao: '2.4GHz',
        wifi_faixas: '2.4 GHz',
        bluetooth: true,
        nfc: estado.nfc_ok,
        psram: 8,
        flash: 16,
        fs: 'LittleFS (mock)',
        uptime: Math.floor((Date.now() - estado.iniciadoEm) / 1000),
        cartoes_total: estado.cartoes.size,
        mock: true,
      });
      return;
    }

    if (metodo === 'GET' && rota === '/api/cartoes') {
      enviarJson(res, 200, Array.from(estado.cartoes.values()));
      return;
    }

    if (metodo === 'GET' && rota === '/mock/ler') {
      const resultado = lerTag(url.searchParams.get('uid') ?? '');
      if (!resultado.ok) {
        enviarErro(res, 400, resultado.erro);
        return;
      }
      enviarJson(res, 200, {
        ok: true,
        ...resultado.doc,
        cartao: estado.ultimo,
      });
      return;
    }

    if (metodo === 'GET' && rota === '/mock/estado') {
      enviarJson(res, 200, {
        nfc_ok: estado.nfc_ok,
        seq: estado.seq,
        ultimo: estado.ultimo,
        cartoes: Array.from(estado.cartoes.values()),
        total_cartoes: estado.cartoes.size,
        uptime: Math.floor((Date.now() - estado.iniciadoEm) / 1000),
      });
      return;
    }

    if (metodo === 'POST' && rota === '/api/sincronizar_aluno') {
      const corpo = await lerCorpo(req);
      if (!corpo.ok) {
        enviarErro(res, 400, corpo.erro);
        return;
      }

      const resultado = normalizarCartao(corpo.dados);
      if (!resultado.ok) {
        enviarErro(res, 400, resultado.erro);
        return;
      }

      estado.cartoes.set(resultado.cartao.uid, resultado.cartao);
      enviarJson(res, 200, { ok: true, cartao: resultado.cartao });
      return;
    }

    if (metodo === 'POST' && rota === '/api/sincronizar_todos') {
      const corpo = await lerCorpo(req);
      if (!corpo.ok) {
        enviarErro(res, 400, corpo.erro);
        return;
      }

      if (!Array.isArray(corpo.dados)) {
        enviarErro(res, 400, 'Array JSON de alunos inválido!');
        return;
      }

      /** @type {Map<string, Cartao>} */
      const novos = new Map();
      for (const item of corpo.dados) {
        const resultado = normalizarCartao(item);
        if (!resultado.ok) {
          enviarErro(res, 400, `${resultado.erro} (item inválido na lista)`);
          return;
        }
        novos.set(resultado.cartao.uid, resultado.cartao);
      }

      estado.cartoes = novos;
      enviarJson(res, 200, { ok: true, total: novos.size });
      return;
    }

    if (metodo === 'POST' && rota === '/api/remover_aluno') {
      const corpo = await lerCorpo(req);
      if (!corpo.ok) {
        enviarErro(res, 400, corpo.erro);
        return;
      }

      const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
      const uid = normalizarUid(
        /** @type {Record<string, unknown>} */ (dados).uid ?? url.searchParams.get('uid') ?? '',
      );

      if (!uid) {
        enviarErro(res, 400, 'UID ausente!');
        return;
      }

      const removido = estado.cartoes.delete(uid);
      enviarJson(res, 200, { ok: true, removido });
      return;
    }

    enviarErro(res, 404, `Rota não encontrada: ${metodo} ${rota}`);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    process.stderr.write(`❌ Erro no mock-esp: ${mensagem}\n`);
    if (!res.headersSent) enviarErro(res, 500, 'Erro interno do simulador.');
    else res.destroy();
  }
}

/**
 * Cria o servidor do mock (sem iniciar).
 * @returns {http.Server}
 */
export function criarServidor() {
  return http.createServer((req, res) => {
    handler(req, res).catch((erro) => {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      process.stderr.write(`❌ Erro no mock-esp: ${mensagem}\n`);
      if (!res.headersSent) enviarErro(res, 500, 'Erro interno do simulador.');
      else res.destroy();
    });
  });
}

/**
 * Inicia o mock.
 * @param {{ port?: number }} [options]
 * @returns {Promise<http.Server>}
 */
export async function iniciar({ port = DEFAULT_PORT } = {}) {
  const servidor = criarServidor();

  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(port, '0.0.0.0', () => {
      servidor.off('error', reject);
      resolve(undefined);
    });
  });

  const linha = '─'.repeat(58);
  process.stdout.write(`${linha}\n`);
  process.stdout.write('🤖 Mock do ESP32-S3 NFC (simulador em memória)\n');
  process.stdout.write(`${linha}\n`);
  process.stdout.write(`   API     : http://localhost:${port}/api/ultimo\n`);
  process.stdout.write(`   Painel  : http://localhost:${port}/painel/ (após painel:upload)\n`);
  process.stdout.write(`   Simular : http://localhost:${port}/mock/ler?uid=04:A2:B3:C4\n`);
  process.stdout.write(`   Estado  : http://localhost:${port}/mock/estado\n`);
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
          process.stdout.write('\n⏹️  Encerrando mock do ESP32...\n');
          servidor.close(() => process.exit(0));
        });
      }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      if (mensagem.includes('EADDRINUSE')) {
        process.stderr.write(
          `❌ A porta ${porta} já está em uso. Feche o outro processo ou use outra porta: PORT=${porta + 1} npm run mock\n`,
        );
      } else {
        process.stderr.write(`❌ Não foi possível iniciar o mock: ${mensagem}\n`);
      }
      process.exitCode = 1;
    }
  }
}
