#!/usr/bin/env node
/**
 * painel-build.mjs
 * ---------------------------------------------------------------------------
 * Monta o pacote do painel web que será enviado ao LittleFS do ESP32.
 *
 * Saída: `painel-dist/` (ignorado pelo git) com:
 *   index.html, style.css, config.js, js/**\/*.js
 *   e uma versão `.gz` de cada arquivo (o firmware serve gzip quando o
 *   navegador aceita, reduzindo o painel de ~183 KB para ~44 KB).
 *
 * Uso:
 *   npm run painel:build
 * ---------------------------------------------------------------------------
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildConfig, loadEnv, renderConfig } from './build-config.mjs';

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PAINEL_DIST = path.join(PROJECT_ROOT, 'painel-dist');

const ARQUIVOS_RAIZ = ['index.html', 'style.css'];

async function listarArquivos(dir, base = '') {
  const itens = await readdir(dir, { withFileTypes: true });
  const arquivos = [];
  for (const item of itens) {
    const relativo = base ? `${base}/${item.name}` : item.name;
    if (item.isDirectory()) {
      arquivos.push(...await listarArquivos(path.join(dir, item.name), relativo));
    } else if (item.isFile()) {
      arquivos.push(relativo);
    }
  }
  return arquivos.sort();
}

/**
 * Gera o pacote em `painel-dist`.
 * @param {{ root?: string, out?: string }} [options]
 * @returns {Promise<{ out: string, files: string[], rawBytes: number, gzipBytes: number }>}
 */
export async function buildPainel({ root = PROJECT_ROOT, out = PAINEL_DIST } = {}) {
  const { values } = await loadEnv({ cwd: root });
  const config = buildConfig(values);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const arquivos = [];
  for (const nome of ARQUIVOS_RAIZ) {
    const origem = path.join(root, nome);
    if (!existsSync(origem)) throw new Error(`Arquivo obrigatório não encontrado: ${nome}`);
    arquivos.push(nome);
  }

  const jsDir = path.join(root, 'js');
  const jsFiles = await listarArquivos(jsDir, 'js');
  arquivos.push(...jsFiles);

  let rawBytes = 0;
  let gzipBytes = 0;
  for (const relativo of arquivos) {
    const destino = path.join(out, relativo);
    await mkdir(path.dirname(destino), { recursive: true });
    const conteudo = await readFile(path.join(root, relativo));
    await writeFile(destino, conteudo);
    const comprimido = gzipSync(conteudo, { level: 9 });
    await writeFile(destino + '.gz', comprimido);
    rawBytes += conteudo.length;
    gzipBytes += comprimido.length;
  }

  const configTexto = renderConfig(config);
  const configBuffer = Buffer.from(configTexto, 'utf8');
  const configGzip = gzipSync(configBuffer, { level: 9 });
  const configDestino = path.join(out, 'config.js');
  await writeFile(configDestino, configBuffer);
  await writeFile(configDestino + '.gz', configGzip);
  rawBytes += configBuffer.length;
  gzipBytes += configGzip.length;
  arquivos.push('config.js');

  const listaManifesto = [];
  for (const relativo of arquivos) {
    listaManifesto.push({
      caminho: `/${relativo}`,
      bytes: (await stat(path.join(out, relativo))).size
    });
  }

  const manifesto = {
    geradoEm: new Date().toISOString(),
    appVersion: config.appVersion,
    arquivos: listaManifesto
  };
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifesto, null, 2));

  return { out, files: arquivos, rawBytes, gzipBytes };
}

export async function run({ root = PROJECT_ROOT, out = PAINEL_DIST } = {}) {
  try {
    const resultado = await buildPainel({ root, out });
    process.stdout.write('📦 Pacote do painel gerado\n');
    process.stdout.write(`   Destino : ${resultado.out}\n`);
    process.stdout.write(`   Arquivos: ${resultado.files.length} (+ versões .gz)\n`);
    process.stdout.write(`   Tamanho : ${(resultado.rawBytes / 1024).toFixed(1)} KB bruto / ${(resultado.gzipBytes / 1024).toFixed(1)} KB gzip\n`);
    process.stdout.write('   Envie com: npm run painel:upload -- --esp http://IP-DO-ESP\n');
    return 0;
  } catch (erro) {
    process.stderr.write(`❌ Falha ao gerar o painel: ${erro instanceof Error ? erro.message : String(erro)}\n`);
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
