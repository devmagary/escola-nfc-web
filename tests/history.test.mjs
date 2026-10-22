import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prepararEventoHistorico } from '../js/services/supabase.js';

test('prepararEventoHistorico envia somente colunas reais da tabela', () => {
  const evento = {
    id: 'e1',
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
    id: 'e1',
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
    id: 'e2',
    uid_nfc: '11:22:33:44',
    aluno_id: null,
    nome_identificado: 'Não cadastrado',
    foto_url: null
  });
  assert.equal(payload.tipo_evento, 'ENTRADA');
  assert.equal(payload.status, 'NEGADO');
  assert.equal('foto_url' in payload, false);
});
