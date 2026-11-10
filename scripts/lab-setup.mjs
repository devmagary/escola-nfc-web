#!/usr/bin/env node
/**
 * lab-setup.mjs — prepara o .env.local do laboratório automaticamente.
 * ---------------------------------------------------------------------------
 * O que faz:
 *   1. Descobre o IP do notebook na rede local (ignora WSL/Hyper-V/Docker).
 *   2. Cria/atualiza .env.local a partir de .env.lab.example, trocando
 *      SUPABASE_URL pelo IP encontrado (e ESP_URL, se pedido).
 *   3. Tenta preencher ANON_KEY e SERVICE_ROLE_KEY com `supabase status -o env`
 *      (se a pilha estiver ligada). Se não estiver, mantém os placeholders e
 *      explica o próximo passo.
 *
 * Uso:
 *   npm run lab:setup                  (detecta tudo e grava)
 *   npm run lab:setup -- --ip 192.168.0.50
 *   npm run lab:setup -- --esp http://192.168.0.73
 *   npm run lab:setup -- --start       (sobe a pilha antes de buscar as chaves)
 *   npm run lab:setup -- --dry-run     (mostra o que faria, sem gravar)
 *   npm run lab:setup -- --config      (também ajusta o site_url do config.toml)
 *
 * Não imprime chaves completas (mostra só o começo). Nada aqui vai para o git:
 * .env.local é ignorado.
 * ---------------------------------------------------------------------------
 */
import { exec } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ehHotspotWindows, escolherIpPrincipal, listarIpsRede } from './network.mjs';

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARQUIVO_MODELO = '.env.lab.example';
const ARQUIVO_ENV = '.env.local';

export const PLACEHOLDER_ANON = 'COLE-A-CHAVE-ANON-DO-LAB-AQUI';
export const PLACEHOLDER_SERVICE = 'COLE-A-SERVICE-ROLE-KEY-DO-LAB-AQUI';

/**
 * Lista IPv4 utilizáveis da rede física, na ordem em que aparecerem.
 * Interfaces virtuais (WSL, Hyper-V, Docker, Tailscale, ZeroTier, loopback)
 * ficam de fora. Mantido como API pública porque os testes usam este nome.
 * @param {NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>} interfaces
 * @returns {string[]}
 */
export function escolherIps(interfaces) {
  return listarIpsRede(interfaces);
}

/**
 * Lê pares CHAVE=valor de um texto .env (sem expandir nada).
 * @param {string} texto
 * @returns {Record<string, string>}
 */
export function lerEnv(texto) {
  const valores = {};
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const casamento = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!casamento) continue;
    let valor = casamento[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    valores[casamento[1]] = valor;
  }
  return valores;
}

/**
 * Atualiza (ou acrescenta) chaves no conteúdo do .env preservando o resto.
 * @param {string} texto
 * @param {Record<string, string>} valores
 * @returns {string}
 */
export function atualizarEnv(texto, valores) {
  const original = String(texto || '');
  const usaCrlf = /\r\n/.test(original);
  const eol = usaCrlf ? '\r\n' : '\n';
  const terminouComNovaLinha = /\r?\n$/.test(original);
  const chaves = Object.keys(valores);
  const vistas = new Set();
  const linhas = original.split(/\r?\n/);
  if (terminouComNovaLinha) linhas.pop();

  const atualizadas = linhas.map((linha) => {
    const casamento = linha.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!casamento) return linha;
    const chave = casamento[2];
    if (!Object.prototype.hasOwnProperty.call(valores, chave)) return linha;
    vistas.add(chave);
    return `${casamento[1]}${chave}=${valores[chave]}`;
  });
  for (const chave of chaves) {
    if (vistas.has(chave)) continue;
    atualizadas.push(`${chave}=${valores[chave]}`);
  }

  return atualizadas.join(eol) + (terminouComNovaLinha ? eol : '');
}

/**
 * Extrai as chaves da saída de `supabase status -o env`.
 * @param {string} saida
 * @returns {{ anon?: string, service?: string, apiUrl?: string }}
 */
export function extrairChaves(saida) {
  const valores = lerEnv(saida);
  return {
    anon: valores.ANON_KEY || valores.PUBLISHABLE_KEY || undefined,
    service: valores.SERVICE_ROLE_KEY || valores.SECRET_KEY || undefined,
    apiUrl: valores.API_URL || undefined,
  };
}

/**
 * Indica se o valor ainda é placeholder/vazio.
 * @param {string | undefined} valor
 * @param {string} placeholder
 * @returns {boolean}
 */
export function precisaPreencher(valor, placeholder) {
  const texto = String(valor || '').trim();
  return !texto || texto === placeholder;
}

function mascarar(valor) {
  if (!valor) return '(vazia)';
  return valor.length <= 16 ? valor : `${valor.slice(0, 10)}…${valor.slice(-4)}`;
}

function executar(comando) {
  return new Promise((resolve) => {
    exec(comando, { cwd: PROJECT_ROOT, timeout: 180000, windowsHide: true }, (erro, stdout, stderr) => {
      resolve({ ok: !erro, saida: `${stdout || ''}${stderr || ''}` });
    });
  });
}

async function statusSupabase() {
  return executar('npx --yes supabase@2.121.0 status -o env');
}

async function iniciarPilha() {
  return executar('npx --yes supabase@2.121.0 start');
}

function lerArgumentos(argv) {
  const opcoes = { ip: '', esp: '', start: false, dryRun: false, config: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ip') opcoes.ip = String(argv[++i] || '').trim();
    else if (arg === '--esp') opcoes.esp = String(argv[++i] || '').trim();
    else if (arg === '--start') opcoes.start = true;
    else if (arg === '--dry-run') opcoes.dryRun = true;
    else if (arg === '--config') opcoes.config = true;
    else if (arg === '--help' || arg === '-h') opcoes.help = true;
  }
  return opcoes;
}

export async function configurar(opcoes, log = console.log) {
  const ips = listarIpsRede();
  let ip = opcoes.ip;
  if (!ip) {
    if (ips.length === 0) {
      throw new Error('Nenhum IP de rede local encontrado. Conecte o Wi-Fi/cabo, ligue o hotspot (lab-hotspot.cmd) ou use --ip 192.168.x.x.');
    }
    ip = escolherIpPrincipal();
  }

  log('');
  log('  Laboratório offline — configuração automática');
  log('  ' + '-'.repeat(52));
  log(`  IP do notebook : ${ip}`);
  if (ehHotspotWindows(ip)) log('  Rede           : hotspot do laboratório (tablet na rede NFC-Lab)');
  if (ips.length > 1) log(`  (outros IPs vistos: ${ips.filter((item) => item !== ip).join(', ')} — use --ip para escolher outro)`);

  const urlSupabase = `http://${ip}:54321`;
  const urlPainel = `http://${ip}:5500`;
  let texto;
  try {
    texto = await readFile(path.join(PROJECT_ROOT, ARQUIVO_ENV), 'utf8');
    log(`  Arquivo        : ${ARQUIVO_ENV} (existente, atualizando)`);
  } catch {
    texto = await readFile(path.join(PROJECT_ROOT, ARQUIVO_MODELO), 'utf8');
    log(`  Arquivo        : ${ARQUIVO_ENV} (criado a partir de ${ARQUIVO_MODELO})`);
  }

  const existentes = lerEnv(texto);
  const valores = { SUPABASE_URL: urlSupabase };
  if (opcoes.esp) valores.ESP_URL = opcoes.esp;

  let anon = existentes.SUPABASE_ANON_KEY;
  let service = existentes.SUPABASE_SERVICE_ROLE_KEY;
  const faltamChaves = precisaPreencher(anon, PLACEHOLDER_ANON) || precisaPreencher(service, PLACEHOLDER_SERVICE);

  if (faltamChaves) {
    log('  Chaves         : buscando no Supabase local...');
    let status = await statusSupabase();
    if (!status.ok && opcoes.start) {
      log('  Pilha parada    : subindo (pode demorar)...');
      await iniciarPilha();
      status = await statusSupabase();
    }
    if (status.ok) {
      const chaves = extrairChaves(status.saida);
      if (chaves.anon) anon = chaves.anon;
      if (chaves.service) service = chaves.service;
      log('  Chaves         : preenchidas pelo lab:status');
    } else {
      log('  Chaves         : a pilha não está ligada — rode npm run lab:start e depois npm run lab:setup de novo.');
    }
  } else {
    log('  Chaves         : já estavam preenchidas (mantidas)');
  }

  if (!precisaPreencher(anon, PLACEHOLDER_ANON)) valores.SUPABASE_ANON_KEY = anon;
  if (!precisaPreencher(service, PLACEHOLDER_SERVICE)) valores.SUPABASE_SERVICE_ROLE_KEY = service;

  const novoTexto = atualizarEnv(texto, valores);

  if (opcoes.dryRun) {
    log('  Modo demonstração: nada foi gravado.');
  } else {
    await writeFile(path.join(PROJECT_ROOT, ARQUIVO_ENV), novoTexto, 'utf8');
    log(`  Gravado        : ${ARQUIVO_ENV}`);
  }

  log(`  Supabase URL   : ${urlSupabase}`);
  log(`  Painel (tablet): ${urlPainel}`);
  log(`  ANON_KEY       : ${mascarar(anon)}`);
  log(`  SERVICE_ROLE   : ${mascarar(service)}`);

  // site_url/additional_redirect_urls do config.toml afetam apenas redirects
  // de e-mail; o login por senha não depende disso. Avisa (ou ajusta com --config).
  try {
    const caminhoConfig = path.join(PROJECT_ROOT, 'supabase', 'config.toml');
    const config = await readFile(caminhoConfig, 'utf8');
    const alvo = `site_url = "${urlPainel}"`;
    if (!config.includes(alvo)) {
      if (opcoes.config) {
        const atualizado = config
          .replace(/site_url\s*=\s*"[^"]*"/, alvo)
          .replace(/additional_redirect_urls\s*=\s*\[[^\]]*\]/, `additional_redirect_urls = ["${urlPainel}"]`);
        if (!opcoes.dryRun) await writeFile(caminhoConfig, atualizado, 'utf8');
        log('  config.toml    : site_url/redirects ajustados para o painel');
      } else {
        log('  config.toml    : site_url não aponta para este IP (só afeta e-mails; use --config para ajustar)');
      }
    }
  } catch { /* config.toml ausente: outro projeto? */ }

  log('');
  if (precisaPreencher(anon, PLACEHOLDER_ANON) || precisaPreencher(service, PLACEHOLDER_SERVICE)) {
    log('  Faltam as chaves. Rode:');
    log('    npm run lab:start');
    log('    npm run lab:setup');
    log('    npm run lab:admin');
  } else {
    log('  Tudo pronto. Próximos passos (se ainda não fez):');
    log('    npm run lab:start    (sobe o banco; a primeira vez demora)');
    log('    npm run lab:admin    (cria o administrador do laboratório)');
    log('    npm run lab:dev      (liga o painel na 5500)');
  }
  log('');

  return { ip, urlSupabase, urlPainel, anonPreenchida: !precisaPreencher(anon, PLACEHOLDER_ANON), servicePreenchida: !precisaPreencher(service, PLACEHOLDER_SERVICE) };
}

const executadoDiretamente = process.argv[1] && process.argv[1].endsWith('lab-setup.mjs');
if (executadoDiretamente) {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (opcoes.help) {
    console.log('Uso: npm run lab:setup [-- --ip 192.168.x.x] [--esp http://IP] [--start] [--dry-run] [--config]');
  } else {
    try {
      await configurar(opcoes);
    } catch (erro) {
      console.error(`\n  ❌ ${erro instanceof Error ? erro.message : String(erro)}\n`);
      process.exitCode = 1;
    }
  }
}
