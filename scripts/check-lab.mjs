#!/usr/bin/env node
/**
 * check-lab.mjs
 * ---------------------------------------------------------------------------
 * Verifica se o laboratório offline está saudável, explicando cada item em
 * linguagem simples (o leitor pode ser alguém sem experiência técnica).
 *
 * Uso:
 *   node scripts/check-lab.mjs          roda TODAS as verificações
 *   node scripts/check-lab.mjs --ip     mostra os endereços para o tablet
 *
 * Verifica:
 *   1. Docker Desktop rodando
 *   2. Variáveis do .env.local (URL do Supabase local + chaves)
 *   3. API do Supabase responde (/auth/v1/health)
 *   4. Tabela alunos acessível com os dados do seed
 *   5. (com service role) Bucket fotos-alunos e primeiro admin criados
 * ---------------------------------------------------------------------------
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

import { loadEnv } from './build-config.mjs';

const LINHA = '─'.repeat(64);

function info(msg) { process.stdout.write(`${msg}\n`); }
function ok(msg) { process.stdout.write(`✅ ${msg}\n`); }
function falha(msg) { process.stdout.write(`❌ ${msg}\n`); }
function dica(msg) { process.stdout.write(`\n   ↪ ${msg}\n`); }

/** Executa um comando e devolve { codigo, saida } sem lançar exceção. */
function executar(comando, args) {
  return new Promise((resolve) => {
    const filho = spawn(comando, args, { windowsHide: true });
    let saida = '';
    filho.stdout?.on('data', (pedaco) => { saida += pedaco; });
    filho.stderr?.on('data', (pedaco) => { saida += pedaco; });
    filho.on('error', () => resolve({ codigo: -1, saida }));
    filho.on('close', (codigo) => resolve({ codigo: codigo ?? -1, saida }));
  });
}

/**
 * Lista os IPv4 da rede física local (o tablet usa um destes endereços).
 * Exclui loopback, link-local e interfaces virtuais (WSL/Hyper-V).
 */
export function listarIpsRede() {
  /** @type {string[]} */
  const ips = [];
  for (const [alias, interfaces] of Object.entries(os.networkInterfaces())) {
    if (/wsl|hyper|virtual|loopback|docker|vethernet/i.test(alias)) continue;
    for (const item of interfaces ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (/^169\.254\./.test(item.address)) continue;
      ips.push(item.address);
    }
  }
  return [...new Set(ips)];
}

/**
 * @param {{ ip?: boolean }} args
 */
export async function verificarLaboratorio(args = {}) {
  if (args.ip) {
    info('🖥️  Endereços do notebook na rede local (digite no tablet):');
    for (const ip of listarIpsRede()) {
      info(`   Painel          → http://${ip}:5500`);
      info(`   Studio Supabase → http://${ip}:54323`);
    }
    return { ok: true, checks: [] };
  }

  const resultados = [];

  // 1 ─ Docker rodando?
  const docker = await executar('docker', ['info', '--format', '{{.ServerVersion}}']);
  resultados.push({
    nome: 'Docker Desktop',
    ok: docker.codigo === 0,
    comoResolver: 'Abra o Docker Desktop (menu Iniciar) e espere o motor iniciar (dentro do programa aparece "Engine running").',
  });
  if (docker.codigo === 0) ok(`Docker Desktop rodando (motor ${docker.saida.trim()}).`);
  else { falha('Docker Desktop não respondeu.'); dica(resultados.at(-1).comoResolver); }

  // 2 ─ Variáveis do .env.local
  const env = await loadEnv({ cwd: process.cwd() });
  const url = (env.values.SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = env.values.SUPABASE_ANON_KEY || '';
  const service = env.values.SUPABASE_SERVICE_ROLE_KEY || '';
  const apontaParaLocal = Boolean(url) && !/supabase\.co$/i.test(new URL(url, 'http://x.invalid').hostname);
  resultados.push({
    nome: 'Configuração (.env.local)',
    ok: Boolean(url && anon && apontaParaLocal),
    comoResolver: 'Copie .env.lab.example para .env.local e preencha com os valores de: npm run lab:status',
  });
  if (url && anon && apontaParaLocal) ok(`Configuração aponta para o Supabase local: ${url}`);
  else {
    falha(!url || !anon ? '.env.local sem SUPABASE_URL/SUPABASE_ANON_KEY.' : `SUPABASE_URL (${url}) não é local; o laboratório precisa de http://IP-DO-NOTEBOOK:54321.`);
    dica(resultados.at(-1).comoResolver);
  }

  if (!url || !anon) {
    return { ok: false, checks: resultados };
  }

  // 3 ─ API viva?
  let apiOk = false;
  try {
    const resposta = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(8000) });
    apiOk = resposta.ok;
  } catch { apiOk = false; }
  resultados.push({
    nome: 'API do Supabase local',
    ok: apiOk,
    comoResolver: 'Rode: npm run lab:start   (a primeira vez demora minutos baixando as imagens)',
  });
  if (apiOk) ok('API do Supabase respondeu.');
  else { falha('A API do Supabase não respondeu.'); dica(resultados.at(-1).comoResolver); }

  // 4 ─ Tabela alunos com seed?
  //     Com a chave anon o RLS pode devolver lista vazia SEM que o banco esteja
  //     vazio (só usuários autenticados/acionistas leem alunos). Por isso o
  //     teste usa a service role quando ela está disponível; sem ela, apenas
  //     confirmar que a tabela responde (HTTP 200) já é suficiente.
  let alunosOk = false;
  let detalheAlunos = '';
  const chaveAlunos = service || anon;
  try {
    const resposta = await fetch(`${url}/rest/v1/alunos?select=uid_nfc&limit=100`, {
      headers: { apikey: chaveAlunos, Authorization: `Bearer ${chaveAlunos}` },
      signal: AbortSignal.timeout(8000),
    });
    const dados = resposta.ok ? await resposta.json() : null;
    if (Array.isArray(dados)) {
      if (service) {
        alunosOk = dados.length > 0;
        detalheAlunos = `${dados.length} aluno(s) do seed`;
      } else {
        // Sem service role não dá para contar dados reais (RLS); tabela viva basta.
        alunosOk = true;
        detalheAlunos = 'tabela responde (RLS pode filtrar leituras anônimas)';
      }
    }
  } catch { alunosOk = false; }
  resultados.push({
    nome: 'Banco com dados de demonstração',
    ok: alunosOk,
    comoResolver: 'Rode: npm run lab:reset   (recria o banco e insere os alunos de exemplo)',
  });
  if (alunosOk) ok(`Banco acessível — ${detalheAlunos}.`);
  else { falha('Não consegui ler a tabela alunos (banco vazio ou sem acesso).'); dica(resultados.at(-1).comoResolver); }

  // 5 ─ Com service role: bucket + admin
  if (service) {
    let bucketOk = false;
    let adminOk = false;
    try {
      const resposta = await fetch(`${url}/storage/v1/bucket`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
        signal: AbortSignal.timeout(8000),
      });
      const buckets = resposta.ok ? await resposta.json() : [];
      bucketOk = Array.isArray(buckets) && buckets.some((b) => b?.id === 'fotos-alunos');
    } catch { bucketOk = false; }
    try {
      const resposta = await fetch(`${url}/rest/v1/perfis_usuarios?select=id&limit=1`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
        signal: AbortSignal.timeout(8000),
      });
      const perfis = resposta.ok ? await resposta.json() : [];
      adminOk = Array.isArray(perfis) && perfis.length > 0;
    } catch { adminOk = false; }

    resultados.push({
      nome: 'Bucket fotos-alunos',
      ok: bucketOk,
      comoResolver: 'Rode: npm run lab:reset (o schema do laboratório cria o bucket)',
    });
    if (bucketOk) ok('Bucket de fotos (fotos-alunos) existe.');
    else { falha('Bucket fotos-alunos não encontrado.'); dica(resultados.at(-1).comoResolver); }

    resultados.push({
      nome: 'Primeiro administrador criado',
      ok: adminOk,
      comoResolver: 'Preencha ADMIN_EMAIL e ADMIN_PASSWORD no .env.local e rode: npm run lab:admin',
    });
    if (adminOk) ok('Existe administrador com perfil no banco.');
    else { falha('Nenhum administrador criado ainda.'); dica(resultados.at(-1).comoResolver); }
  } else {
    info('ℹ️ Sem SUPABASE_SERVICE_ROLE_KEY no .env.local: deixei de fora a checagem de bucket/admin.');
  }

  const tudoOk = resultados.every((r) => r.ok);
  info(LINHA);
  if (tudoOk) {
    ok('LABORATÓRIO PRONTO.');
    for (const ip of listarIpsRede()) {
      info(`   No tablet: painel http://${ip}:5500 · Studio http://${ip}:54323`);
    }
  } else {
    falha('Há itens a resolver antes do uso (veja as dicas acima).');
  }
  info(LINHA);
  return { ok: tudoOk, checks: resultados };
}

const executadoDiretamente = process.argv[1] && process.argv[1].endsWith('check-lab.mjs');
if (executadoDiretamente) {
  const args = { ip: process.argv.includes('--ip') };
  const resultado = await verificarLaboratorio(args);
  process.exitCode = resultado.ok ? 0 : 1;
}
