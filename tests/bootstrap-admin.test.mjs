/**
 * Testes do bootstrap-admin.mjs sem rede.
 * ---------------------------------------------------------------------------
 * Cobrem apenas a validação de entrada / mensagens de erro: a criação real do
 * administrador depende de um Supabase configurado e não roda no CI.
 * Garantem também que a senha nunca aparece na saída.
 * ---------------------------------------------------------------------------
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { run } from '../scripts/bootstrap-admin.mjs';

/**
 * Cria pasta temporária + buffers de saída.
 * @param {import('node:test').TestContext} t
 */
function preparar(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'escola-nfc-admin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let stdout = '';
  let stderr = '';
  const saida = { write: (texto) => { stdout += String(texto); return true; } };
  const erro = { write: (texto) => { stderr += String(texto); return true; } };

  return { dir, saida, erro, ler: () => ({ stdout, stderr }) };
}

test('bootstrap-admin falha com mensagem clara quando não há configuração', async (t) => {
  const { dir, saida, erro, ler } = preparar(t);

  const codigo = await run({ cwd: dir, processEnv: {}, stdout: saida, stderr: erro });
  const { stderr } = ler();

  assert.equal(codigo, 1);
  assert.match(stderr, /SUPABASE_URL/);
  assert.match(stderr, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(stderr, /ADMIN_EMAIL/);
  assert.match(stderr, /ADMIN_PASSWORD/);
  assert.match(stderr, /\.env\.local/);
});

test('bootstrap-admin rejeita URL, e-mail e senha inválidos antes de acessar a rede', async (t) => {
  const { dir, saida, erro, ler } = preparar(t);

  const base = {
    SUPABASE_URL: 'https://exemplo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
    ADMIN_EMAIL: 'admin@escola.exemplo.br',
    ADMIN_PASSWORD: 'senha-secreta-123',
    ADMIN_NAME: 'Admin Teste',
  };

  const urlRuim = await run({
    cwd: dir,
    processEnv: { ...base, SUPABASE_URL: 'ftp://exemplo.supabase.co' },
    stdout: saida,
    stderr: erro,
  });
  assert.equal(urlRuim, 1);
  assert.match(ler().stderr, /http:\/\/ ou https:\/\//);

  const emailRuim = await run({
    cwd: dir,
    processEnv: { ...base, ADMIN_EMAIL: 'sem-arroba' },
    stdout: saida,
    stderr: erro,
  });
  assert.equal(emailRuim, 1);
  assert.match(ler().stderr, /ADMIN_EMAIL inválido/);

  const senhaCurta = await run({
    cwd: dir,
    processEnv: { ...base, ADMIN_PASSWORD: '123' },
    stdout: saida,
    stderr: erro,
  });
  assert.equal(senhaCurta, 1);
  assert.match(ler().stderr, /ADMIN_PASSWORD deve ter pelo menos 6/);
});

test('bootstrap-admin nunca imprime a senha na saída', async (t) => {
  const { dir, saida, erro, ler } = preparar(t);
  const senhaSecreta = 'S3nh4-Super-Secreta-Que-Nao-Pode-Vazar';

  const codigo = await run({
    cwd: dir,
    processEnv: {
      SUPABASE_URL: 'https://exemplo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
      ADMIN_EMAIL: 'email-sem-arroba',
      ADMIN_PASSWORD: senhaSecreta,
      ADMIN_NAME: 'Admin Teste',
    },
    stdout: saida,
    stderr: erro,
  });

  assert.equal(codigo, 1);
  const { stdout, stderr } = ler();
  assert.doesNotMatch(stdout + stderr, new RegExp(senhaSecreta));
});
