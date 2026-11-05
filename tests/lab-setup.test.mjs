import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  atualizarEnv,
  escolherIps,
  extrairChaves,
  lerEnv,
  precisaPreencher,
  PLACEHOLDER_ANON,
  PLACEHOLDER_SERVICE,
} from '../scripts/lab-setup.mjs';

test('escolherIps ignora interfaces virtuais e endereços inválidos', () => {
  const interfaces = {
    'vEthernet (WSL (Hyper-V firewall))': [{ family: 'IPv4', internal: false, address: '172.23.240.1' }],
    'vEthernet (Default Switch)': [{ family: 'IPv4', internal: false, address: '172.26.80.1' }],
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    'Ethernet 2': [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '169.254.10.20' },
      { family: 'IPv4', internal: false, address: '192.168.0.81' },
    ],
    'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.0.90' }],
  };

  assert.deepEqual(escolherIps(interfaces), ['192.168.0.81', '192.168.0.90']);
});

test('escolherIps remove duplicados e lida com lista vazia', () => {
  const interfaces = {
    Ethernet: [
      { family: 'IPv4', internal: false, address: '10.0.0.5' },
      { family: 'IPv4', internal: false, address: '10.0.0.5' },
    ],
  };
  assert.deepEqual(escolherIps(interfaces), ['10.0.0.5']);
  assert.deepEqual(escolherIps({}), []);
});

test('lerEnv lê valores com e sem aspas e ignora comentários', () => {
  const texto = '# comentário\nSUPABASE_URL="http://192.168.0.81:54321"\nADMIN_PASSWORD=escola123\n\nINVALIDA\n';
  const valores = lerEnv(texto);
  assert.equal(valores.SUPABASE_URL, 'http://192.168.0.81:54321');
  assert.equal(valores.ADMIN_PASSWORD, 'escola123');
  assert.equal(valores.INVALIDA, undefined);
});

test('atualizarEnv troca chaves existentes e acrescenta as que faltam', () => {
  const original = 'SUPABASE_URL=http://192.168.0.10:54321\r\nADMIN_PASSWORD=escola123\r\n';
  const novo = atualizarEnv(original, {
    SUPABASE_URL: 'http://192.168.0.81:54321',
    SUPABASE_ANON_KEY: 'anon-123',
  });

  assert.equal(novo, 'SUPABASE_URL=http://192.168.0.81:54321\r\nADMIN_PASSWORD=escola123\r\nSUPABASE_ANON_KEY=anon-123\r\n');
  assert.match(novo, /ADMIN_PASSWORD=escola123\r\n/, 'não deve apagar configurações que já existiam');
});

test('atualizarEnv preserva o arquivo quando não há mudanças', () => {
  const original = 'A=1\nB=2\n';
  assert.equal(atualizarEnv(original, { A: '1' }), original);
});

test('extrairChaves lê o formato -o env e aceita as chaves novas', () => {
  const saida = 'ANON_KEY="anon-jwt"\nSERVICE_ROLE_KEY="service-jwt"\nAPI_URL="http://127.0.0.1:54321"\n';
  assert.deepEqual(extrairChaves(saida), {
    anon: 'anon-jwt',
    service: 'service-jwt',
    apiUrl: 'http://127.0.0.1:54321',
  });

  const novas = 'PUBLISHABLE_KEY="sb_publishable_x"\nSECRET_KEY="sb_secret_y"\n';
  assert.deepEqual(extrairChaves(novas), { anon: 'sb_publishable_x', service: 'sb_secret_y', apiUrl: undefined });
});

test('precisaPreencher reconhece placeholder, vazio e valor real', () => {
  assert.equal(precisaPreencher('', PLACEHOLDER_ANON), true);
  assert.equal(precisaPreencher(PLACEHOLDER_ANON, PLACEHOLDER_ANON), true);
  assert.equal(precisaPreencher(PLACEHOLDER_SERVICE, PLACEHOLDER_SERVICE), true);
  assert.equal(precisaPreencher('eyJhbGciOi...', PLACEHOLDER_ANON), false);
});
