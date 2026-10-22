/**
 * Ponto de entrada dos testes.
 * ---------------------------------------------------------------------------
 * O Node 24 não aceita mais um diretório como argumento direto do test runner
 * (`node --test tests/`), diferente do Node 20. Este `index.mjs` permite que
 * `npm test` continue sendo exatamente `node --test tests/` em todas as
 * versões suportadas: o runner executa este arquivo, que registra todos os
 * testes dos módulos abaixo.
 * ---------------------------------------------------------------------------
 */
import './build-config.test.mjs';
import './utils.test.mjs';
import './bootstrap-admin.test.mjs';
