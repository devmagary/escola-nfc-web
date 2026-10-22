import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prepararEventoHistorico } from '../js/services/supabase.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

test('prepararEventoHistorico envia somente colunas reais da tabela', () => {
  const evento = {
    id: UUID_A,
    uid_nfc: '04:A2:B3:C4',
    aluno_id: 'a1',
    nome_identificado: 'Maria',
    turma: 'Informática 2',
    status: 'LIBERADO',
    tipo_evento: 'ENTRADA',
    data_hora: '2026-10-22T11:00:00.000Z',
    foto_url: 'https://exemplo/foto.jpg',
    campoExtra: 'não deve ir para o banco'
  };

  const payload = prepararEventoHistorico(evento);
  assert.deepEqual(payload, {
    id: UUID_A,
    uid_nfc: '04:A2:B3:C4',
    aluno_id: 'a1',
    nome_identificado: 'Maria',
    turma: 'Informática 2',
    data_hora: '2026-10-22T11:00:00.000Z',
    tipo_evento: 'ENTRADA',
    status: 'LIBERADO'
  });
  assert.equal('foto_url' in payload, false);
  assert.equal('campoExtra' in payload, false);
});

test('prepararEventoHistorico aplica padrões para eventos antigos da fila', () => {
  const payload = prepararEventoHistorico({
    id: UUID_B,
    uid_nfc: '11:22:33:44',
    aluno_id: null,
    nome_identificado: 'Não cadastrado',
    foto_url: null
  });
  assert.equal(payload.tipo_evento, 'ENTRADA');
  assert.equal(payload.status, 'NEGADO');
  assert.equal('foto_url' in payload, false);
});

test('prepararEventoHistorico troca id legado inválido por UUID', () => {
  const payload = prepararEventoHistorico({
    id: 'hist-1792681181831-c934e5a7218938',
    uid_nfc: '2C:9D:7E:8E',
    aluno_id: 'a1',
    nome_identificado: 'Aluno',
    status: 'LIBERADO',
    data_hora: '2026-10-22T11:00:00.000Z'
  });
  assert.match(payload.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(payload.id, 'hist-1792681181831-c934e5a7218938');
});
