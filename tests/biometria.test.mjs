import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizarBiometriaId,
  biometriaIdValido,
  gerarUidVirtualBiometria,
  ehUidVirtualBiometria,
  extrairBiometriaIdDeUid,
  mapearCabecalhoCsv,
  valorDoCsv,
} from '../js/lib/utils.js';

import {
  estado,
  uidVirtualBio,
  lerBiometria,
  normalizarCartao,
  montarUltimo,
} from '../scripts/mock-esp.mjs';

test('normalizarBiometriaId aceita posicoes de 1 a 300 e rejeita fora da faixa', () => {
  assert.equal(normalizarBiometriaId(1), 1);
  assert.equal(normalizarBiometriaId('42'), 42);
  assert.equal(normalizarBiometriaId('#300'), 300);
  assert.equal(normalizarBiometriaId(0), null);
  assert.equal(normalizarBiometriaId(301), null);
  assert.equal(normalizarBiometriaId(''), null);
  assert.equal(normalizarBiometriaId(null), null);
  assert.equal(biometriaIdValido(7), true);
  assert.equal(biometriaIdValido('999'), false);
});

test('gerarUidVirtualBiometria, ehUidVirtualBiometria e extrairBiometriaIdDeUid sao reversiveis', () => {
  const uid7 = gerarUidVirtualBiometria(7);
  assert.equal(uid7, 'FB:10:00:07');
  assert.equal(ehUidVirtualBiometria(uid7), true);
  assert.equal(extrairBiometriaIdDeUid(uid7), 7);

  const uid300 = gerarUidVirtualBiometria(300);
  assert.equal(uid300, 'FB:10:01:2C');
  assert.equal(ehUidVirtualBiometria(uid300), true);
  assert.equal(extrairBiometriaIdDeUid(uid300), 300);

  assert.equal(ehUidVirtualBiometria('04:A2:B3:C4'), false);
  assert.equal(extrairBiometriaIdDeUid('04:A2:B3:C4'), null);
});

test('mapearCabecalhoCsv reconhece coluna de biometria', () => {
  const mapa = mapearCabecalhoCsv(['Nome Completo', 'Digital', 'Turma']);
  assert.equal(mapa.biometria_id, 'Digital');
  const linha = { 'Nome Completo': 'Daniela Rocha', Digital: '7', Turma: '6º Ano B' };
  assert.equal(valorDoCsv(linha, mapa, 'biometria_id'), '7');
});

test('mock-esp: lerBiometria resolve aluno hibrido (NFC + Biometria) e aluno somente biometria', () => {
  estado.cartoes.clear();

  // Aluno 1: Híbrido (tem cartão físico 04:A2:B3:C4 e digital na posição #1)
  const r1 = normalizarCartao({ uid: '04:A2:B3:C4', nome: 'Ana Beatriz', ativo: true, bio_id: 1 });
  assert.equal(r1.ok, true);
  if (r1.ok) estado.cartoes.set(r1.cartao.uid, r1.cartao);

  // Aluno 2: Somente Biometria (UID virtual FB:10:00:07 e digital na posição #7)
  const r2 = normalizarCartao({ uid: uidVirtualBio(7), nome: 'Daniela Rocha', ativo: true, bio_id: 7 });
  assert.equal(r2.ok, true);
  if (r2.ok) estado.cartoes.set(r2.cartao.uid, r2.cartao);

  const leituraHibrida = lerBiometria(1);
  assert.equal(leituraHibrida.ok, true);
  const ultimo1 = montarUltimo();
  assert.equal(ultimo1.uid, '04:A2:B3:C4');
  assert.equal(ultimo1.nome, 'Ana Beatriz');
  assert.equal(ultimo1.cadastrado, true);
  assert.equal(ultimo1.metodo, 'biometria');
  assert.equal(ultimo1.bio_id, 1);

  const leituraSomenteBio = lerBiometria(7);
  assert.equal(leituraSomenteBio.ok, true);
  const ultimo2 = montarUltimo();
  assert.equal(ultimo2.uid, 'FB:10:00:07');
  assert.equal(ultimo2.nome, 'Daniela Rocha');
  assert.equal(ultimo2.cadastrado, true);
  assert.equal(ultimo2.metodo, 'biometria');
  assert.equal(ultimo2.bio_id, 7);
});
