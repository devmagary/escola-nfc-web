#!/usr/bin/env node
/**
 * check-syntax.mjs
 * ---------------------------------------------------------------------------
 * Verificação de sintaxe sem dependências externas.
 *
 * Percorre recursivamente `js/**\/*.js` e `scripts/*.mjs` executando
 * `node --check` em cada arquivo.
 *
 * - Se `js/` ainda não existir, apenas avisa e NÃO falha (o frontend modular
 *   pode ainda não ter sido criado).
 * - Qualquer erro de sintaxe faz o comando sair com código 1.
 * ---------------------------------------------------------------------------
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do projeto (pasta que contém `scripts/`). */
export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Pastas cujos `.js` serão verificados. */
const ALVO_JS = path.join(PROJECT_ROOT, 'js');
/** Pasta dos scripts Node (`.mjs`). */
const ALVO_SCRIPTS = path.join(PROJECT_ROOT, 'scripts');

/**
 * Lista recursivamente arquivos com a extensão informada.
 * @param {string} diretorio
 * @param {readonly string[]} extensoes
 * @returns {string[]}
 */
export function listarArquivos(diretorio, extensoes) {
  if (!existsSync(diretorio)) return [];

  /** @type {string[]} */
  const arquivos = [];

  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      arquivos.push(...listarArquivos(caminho, extensoes));
    } else if (entrada.isFile() && extensoes.includes(path.extname(entrada.name))) {
      arquivos.push(caminho);
    }
  }

  return arquivos.sort();
}

/**
 * Executa `node --check` em um arquivo.
 * @param {string} arquivo
 * @returns {{ ok: boolean, saida: string }}
 */
export function verificarSintaxe(arquivo) {
  const resultado = spawnSync(process.execPath, ['--check', arquivo], {
    encoding: 'utf8',
    windowsHide: true,
  });

  const saida = `${resultado.stderr ?? ''}${resultado.stdout ?? ''}`.trim();
  return { ok: resultado.status === 0, saida };
}

/**
 * Executa a verificação completa.
 * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [options]
 * @returns {number} Código de saída.
 */
export function run({ stdout = process.stdout, stderr = process.stderr } = {}) {
  /** @type {string[]} */
  const arquivos = [];

  if (existsSync(ALVO_JS) && statSync(ALVO_JS).isDirectory()) {
    const js = listarArquivos(ALVO_JS, ['.js', '.mjs']);
    if (js.length === 0) {
      stdout.write('⚠️  Diretório js/ existe, mas não há arquivos .js para verificar.\n');
    }
    arquivos.push(...js);
  } else {
    stdout.write(
      '⚠️  Diretório js/ não encontrado — frontend modular ainda não criado; verificação de js/ ignorada.\n',
    );
  }

  const scripts = listarArquivos(ALVO_SCRIPTS, ['.mjs', '.js']);
  if (scripts.length === 0) {
    stderr.write('❌ Nenhum script encontrado em scripts/ para verificar.\n');
    return 1;
  }
  arquivos.push(...scripts);

  if (arquivos.length === 0) {
    stdout.write('⚠️  Nenhum arquivo para verificar.\n');
    return 0;
  }

  let falhas = 0;
  for (const arquivo of arquivos) {
    const relativo = path.relative(PROJECT_ROOT, arquivo).split(path.sep).join('/');
    const { ok, saida } = verificarSintaxe(arquivo);

    if (ok) {
      stdout.write(`✅ sintaxe ok: ${relativo}\n`);
    } else {
      falhas += 1;
      stderr.write(`❌ erro de sintaxe: ${relativo}\n`);
      if (saida) {
        stderr.write(
          saida
            .split(/\r?\n/)
            .map((linha) => `   ${linha}`)
            .join('\n') + '\n',
        );
      }
    }
  }

  if (falhas > 0) {
    stderr.write(`\n❌ ${falhas} arquivo(s) com erro de sintaxe.\n`);
    return 1;
  }

  stdout.write(`\n✅ ${arquivos.length} arquivo(s) verificados sem erros de sintaxe.\n`);
  return 0;
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
  process.exitCode = run();
}
