import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildPainel, PROJECT_ROOT } from '../scripts/painel-build.mjs';

const SUPABASE_LOCAL = 'vendor/supabase-js-2.45.4.js';

test('index.html nao depende de scripts externos (CDN)', async () => {
  const html = await readFile(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
  const externos = [...html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
  assert.deepEqual(externos, [], `scripts externos encontrados: ${externos.join(', ')}`);
});

test('pacote do painel inclui o Supabase local e as versoes .gz', async (t) => {
  const destino = await mkdtemp(path.join(os.tmpdir(), 'painel-dist-'));
  t.after(() => rm(destino, { recursive: true, force: true }));

  const resultado = await buildPainel({ out: destino });

  const biblioteca = await stat(path.join(destino, SUPABASE_LOCAL));
  assert.ok(biblioteca.size > 100_000, 'biblioteca local do Supabase ausente ou incompleta');
  assert.ok(resultado.files.includes(SUPABASE_LOCAL), 'build nao listou a pasta vendor');

  for (const nome of ['index.html', 'style.css', 'js/app.js', SUPABASE_LOCAL]) {
    const gzip = await stat(path.join(destino, `${nome}.gz`));
    assert.ok(gzip.size > 0, `versao .gz ausente para ${nome}`);
    assert.ok(gzip.size < (await stat(path.join(destino, nome))).size, `${nome}.gz deveria ser menor que o original`);
  }

  const html = await readFile(path.join(destino, 'index.html'), 'utf8');
  assert.match(html, /src="vendor\/supabase-js-2\.45\.4\.js"/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
});
