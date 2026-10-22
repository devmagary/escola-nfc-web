/**
 * Testes das utilidades puras do frontend (js/lib/utils.js e js/lib/config.js).
 * ---------------------------------------------------------------------------
 * Importa os módulos diretamente (package.json tem "type": "module") e cobre
 * as funções sem dependência de DOM usadas pelo painel/totem.
 * ---------------------------------------------------------------------------
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boolDoCsv,
  csvEscape,
  detectarDelimitador,
  escapeHtml,
  formatarTamanho,
  formatarTelefone,
  mapearCabecalhoCsv,
  mascararChave,
  normalizarTelefone,
  normalizarTexto,
  normalizarUid,
  paraCsv,
  parseCsv,
  telefoneParaWhatsapp,
  uidValido,
  valorDoCsv,
} from '../js/lib/utils.js';

import {
  normalizarUrlEsp,
  normalizarUrlSupabase,
  validarConfiguracao,
} from '../js/lib/config.js';

// ---------------------------------------------------------------------------
// UID / NFC
// ---------------------------------------------------------------------------
test('normalizarUid formata UID hexadecimal como o firmware', () => {
  assert.equal(normalizarUid('04a2b3c4'), '04:A2:B3:C4');
  assert.equal(normalizarUid('04:A2:B3:C4'), '04:A2:B3:C4');
  assert.equal(normalizarUid('0x04-A2-B3-C4'), '04:A2:B3:C4');
  assert.equal(normalizarUid('  04 a2 b3 c4  '), '04:A2:B3:C4');
  assert.equal(normalizarUid('04A2B3C4D5E6F708'), '04:A2:B3:C4:D5:E6:F7:08');
});

test('normalizarUid rejeita valores inválidos', () => {
  assert.equal(normalizarUid(''), '');
  assert.equal(normalizarUid(null), '');
  assert.equal(normalizarUid(undefined), '');
  assert.equal(normalizarUid('ABC'), ''); // curto demais
  assert.equal(normalizarUid('04A2B3C'), ''); // quantidade ímpar de dígitos
  assert.equal(normalizarUid('zzzzzzzz'), ''); // nenhum hex
});

test('uidValido reflete normalizarUid', () => {
  assert.equal(uidValido('04:A2:B3:C4'), true);
  assert.equal(uidValido('123'), false);
  assert.equal(uidValido(null), false);
});

// ---------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------
test('normalizarTelefone mantém apenas dígitos', () => {
  assert.equal(normalizarTelefone('(11) 98765-4321'), '11987654321');
  assert.equal(normalizarTelefone('+55 11 98765-4321'), '5511987654321');
  assert.equal(normalizarTelefone(''), '');
  assert.equal(normalizarTelefone(null), '');
});

test('telefoneParaWhatsapp prefixa 55 quando necessário', () => {
  assert.equal(telefoneParaWhatsapp('(11) 98765-4321'), '5511987654321');
  assert.equal(telefoneParaWhatsapp('5511987654321'), '5511987654321');
  assert.equal(telefoneParaWhatsapp(''), '');
});

test('formatarTelefone formata fixo e celular e preserva outros formatos', () => {
  assert.equal(formatarTelefone('11987654321'), '(11) 98765-4321');
  assert.equal(formatarTelefone('1133334444'), '(11) 3333-4444');
  assert.equal(formatarTelefone('5511987654321'), '(11) 98765-4321');
  assert.equal(formatarTelefone('123'), '123');
  assert.equal(formatarTelefone(''), '');
});

// ---------------------------------------------------------------------------
// Texto / HTML
// ---------------------------------------------------------------------------
test('normalizarTexto remove acentos, caixa e espaços', () => {
  assert.equal(normalizarTexto('  João  '), 'joao');
  assert.equal(normalizarTexto('AÇÃO'), 'acao');
  assert.equal(normalizarTexto('Maçã'), 'maca');
  assert.equal(normalizarTexto(null), '');
});

test('escapeHtml escapa os caracteres perigosos', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("a & b 'c'"), 'a &amp; b &#039;c&#039;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
});

test('mascararChave esconde o miolo de chaves longas', () => {
  assert.equal(mascararChave('12345678'), '••••');
  assert.equal(mascararChave('abcdefghijklmnop'), 'abcd…mnop');
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
test('detectarDelimitador escolhe ; ou , pela primeira linha', () => {
  assert.equal(detectarDelimitador('nome;turma;uid\nAna;1A;04'), ';');
  assert.equal(detectarDelimitador('nome,turma,uid\nAna,1A,04'), ',');
  assert.equal(detectarDelimitador(''), ';');
});

test('csvEscape e paraCsv geram CSV válido com BOM', () => {
  assert.equal(csvEscape('simples'), 'simples');
  assert.equal(csvEscape('com; ponto e vírgula'), '"com; ponto e vírgula"');
  assert.equal(csvEscape('com "aspas"'), '"com ""aspas"""');
  assert.equal(csvEscape('linha\nquebrada'), '"linha\nquebrada"');
  assert.equal(csvEscape(null), '');

  const csv = paraCsv(['nome', 'turma'], [['Ana', '1A'], ['Bia; Cia', '2B']]);
  assert.equal(csv, '\uFEFFnome;turma\r\nAna;1A\r\n"Bia; Cia";2B');
});

test('parseCsv interpreta aspas, BOM, CRLF e remove linhas vazias', () => {
  const csv = '\uFEFFnome;turma;observacao\r\nAna;1A;"texto; com ponto e vírgula"\r\n\r\nBia;2B;"linha 1\nlinha 2"\r\n';
  const { headers, rows, delimitador } = parseCsv(csv);

  assert.equal(delimitador, ';');
  assert.deepEqual(headers, ['nome', 'turma', 'observacao']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].nome, 'Ana');
  assert.equal(rows[0].observacao, 'texto; com ponto e vírgula');
  assert.equal(rows[1].observacao, 'linha 1\nlinha 2');
});

test('parseCsv detecta delimitador e CSV vazio', () => {
  const { headers, rows } = parseCsv('nome,turma\nAna,1A\n');
  assert.deepEqual(headers, ['nome', 'turma']);
  assert.equal(rows[0].turma, '1A');

  const vazio = parseCsv('');
  assert.deepEqual(vazio, { headers: [], rows: [], delimitador: ';' });
});

test('mapearCabecalhoCsv reconhece aliases com e sem acento', () => {
  const mapa = mapearCabecalhoCsv(['Nome Completo', 'Matrícula', 'Turma', 'WhatsApp', 'UID NFC', 'Ativo']);
  assert.equal(mapa.nome_completo, 'Nome Completo');
  assert.equal(mapa.matricula, 'Matrícula');
  assert.equal(mapa.turma, 'Turma');
  assert.equal(mapa.telefone_responsavel, 'WhatsApp');
  assert.equal(mapa.uid_nfc, 'UID NFC');
  assert.equal(mapa.ativo, 'Ativo');
});

test('valorDoCsv e boolDoCsv leem valores do mapeamento', () => {
  const mapa = { nome_completo: 'Nome', ativo: 'Ativo' };
  const row = { Nome: '  Ana  ', Ativo: 'bloqueado' };

  assert.equal(valorDoCsv(row, mapa, 'nome_completo'), 'Ana');
  assert.equal(valorDoCsv(row, mapa, 'inexistente'), '');
  assert.equal(valorDoCsv(row, mapa, 'ativo'), 'bloqueado');

  assert.equal(boolDoCsv('liberado'), true);
  assert.equal(boolDoCsv('sim'), true);
  assert.equal(boolDoCsv('0'), false);
  assert.equal(boolDoCsv('nao'), false);
  assert.equal(boolDoCsv('não'), false);
  assert.equal(boolDoCsv('inativo'), false);
  assert.equal(boolDoCsv('', true), true);
  assert.equal(boolDoCsv('', false), false);
});

// ---------------------------------------------------------------------------
// Diversos
// ---------------------------------------------------------------------------
test('formatarTamanho converte bytes', () => {
  assert.equal(formatarTamanho(512), '512 B');
  assert.equal(formatarTamanho(2048), '2 KB');
  assert.equal(formatarTamanho(1024 * 1024 * 2.5), '2.5 MB');
  assert.equal(formatarTamanho(null), '0 B');
});

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
test('normalizarUrlSupabase remove sufixos de API e barra final', () => {
  assert.equal(normalizarUrlSupabase('https://abc.supabase.co'), 'https://abc.supabase.co');
  assert.equal(normalizarUrlSupabase('https://abc.supabase.co/'), 'https://abc.supabase.co');
  assert.equal(normalizarUrlSupabase('https://abc.supabase.co/rest/v1'), 'https://abc.supabase.co');
  assert.equal(normalizarUrlSupabase('https://abc.supabase.co/auth/v1/'), 'https://abc.supabase.co');
  assert.equal(normalizarUrlSupabase('https://abc.supabase.co/storage/v1'), 'https://abc.supabase.co');
  assert.equal(normalizarUrlSupabase(''), '');
  assert.equal(normalizarUrlSupabase(null), '');
});

test('normalizarUrlEsp aplica esquema http e remove barra final', () => {
  assert.equal(normalizarUrlEsp('192.168.0.73'), 'http://192.168.0.73');
  assert.equal(normalizarUrlEsp('http://nfc.local/'), 'http://nfc.local');
  assert.equal(normalizarUrlEsp('https://esp.exemplo.com/'), 'https://esp.exemplo.com');
  assert.equal(normalizarUrlEsp(''), 'http://nfc.local');
  assert.equal(normalizarUrlEsp(null), 'http://nfc.local');
});

test('validarConfiguracao aceita configuração válida e aplica normalizações', () => {
  const config = validarConfiguracao({
    supabaseUrl: 'https://abc.supabase.co/rest/v1',
    supabaseAnonKey: 'anon-123',
    espUrl: '192.168.0.73/',
    appEnv: 'staging',
    appVersion: '1.2.3',
  });

  assert.equal(config.valido, true);
  assert.deepEqual(config.erros, []);
  assert.equal(config.supabaseUrl, 'https://abc.supabase.co');
  assert.equal(config.supabaseAnonKey, 'anon-123');
  assert.equal(config.espUrl, 'http://192.168.0.73');
  assert.equal(config.appEnv, 'staging');
  assert.equal(config.appVersion, '1.2.3');
});

test('validarConfiguracao informa erros claros quando faltam dados', () => {
  const vazia = validarConfiguracao({});
  assert.equal(vazia.valido, false);
  assert.equal(vazia.espUrl, 'http://nfc.local');
  assert.equal(vazia.appEnv, 'production');
  assert.equal(vazia.appVersion, 'dev');
  assert.match(vazia.erros.join(' '), /SUPABASE_URL/);
  assert.match(vazia.erros.join(' '), /SUPABASE_ANON_KEY/);

  const urlInvalida = validarConfiguracao({
    supabaseUrl: 'ftp://abc.supabase.co',
    supabaseAnonKey: 'anon',
  });
  assert.equal(urlInvalida.valido, false);
  assert.match(urlInvalida.erros.join(' '), /URL http\/https válida/);
});
