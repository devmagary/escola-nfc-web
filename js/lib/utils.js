// =====================================================================
// Utilitários puros compartilhados pelo painel web.
// Sem dependências de DOM além do helper $, para permitir testes no Node.
// =====================================================================

export const $ = (id) => document.getElementById(id);

export function escapeHtml(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function obterAvatarPadrao(nome = '?') {
  const inicial = String(nome || '?').trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <rect width="160" height="160" fill="#1e293b"/>
    <text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="700" fill="#94a3b8" dominant-baseline="middle" text-anchor="middle">${inicial}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Mesmo formato usado pelo firmware: hexadecimal em maiúsculas, pares separados por ":".
export function normalizarUid(valor) {
  const limpo = String(valor || '')
    .toUpperCase()
    .replace(/0X/g, '')
    .replace(/[^0-9A-F]/g, '');
  if (limpo.length < 8 || limpo.length % 2 !== 0) return '';
  return limpo.match(/.{2}/g).join(':');
}

export function uidValido(valor) {
  return normalizarUid(valor) !== '';
}

export function normalizarTelefone(valor) {
  return String(valor || '').replace(/\D/g, '');
}

export function telefoneParaWhatsapp(valor) {
  let digitos = normalizarTelefone(valor);
  if (!digitos) return '';
  if (!digitos.startsWith('55')) digitos = '55' + digitos;
  return digitos;
}

export function formatarTelefone(valor) {
  const digitos = normalizarTelefone(valor);
  if (!digitos) return '';
  const local = digitos.startsWith('55') && digitos.length > 11 ? digitos.slice(2) : digitos;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return local;
}

export function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function formatarDataHora(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatarHora(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function dataParaInput(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function inicioDoDiaISO(data = new Date()) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function fimDoDiaISO(data = new Date()) {
  const d = new Date(data);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function inicioDoDiaDeInput(valor) {
  if (!valor) return null;
  const [ano, mes, dia] = valor.split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(ano, mes - 1, dia, 0, 0, 0, 0).toISOString();
}

export function fimDoDiaDeInput(valor) {
  if (!valor) return null;
  const [ano, mes, dia] = valor.split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(ano, mes - 1, dia, 23, 59, 59, 999).toISOString();
}

export function debounce(fn, espera = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), espera);
  };
}

export function gerarId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (_) { /* ignora */ }
  const aleatorio = Math.random().toString(16).slice(2);
  return `hist-${Date.now()}-${aleatorio}`;
}

export function formatarTamanho(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function baixarArquivo(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvEscape(valor, delimitador = ';') {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (texto.includes('"') || texto.includes(delimitador) || /[\r\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

export function paraCsv(cabecalho, linhas, delimitador = ';') {
  const linhasTexto = [cabecalho, ...linhas].map((linha) =>
    linha.map((valor) => csvEscape(valor, delimitador)).join(delimitador)
  );
  // BOM ajuda o Excel a reconhecer UTF-8.
  return '\uFEFF' + linhasTexto.join('\r\n');
}

export function detectarDelimitador(texto) {
  const primeiraLinha = String(texto || '').split(/\r?\n/)[0] || '';
  const pontoEVirgula = (primeiraLinha.match(/;/g) || []).length;
  const virgula = (primeiraLinha.match(/,/g) || []).length;
  return pontoEVirgula >= virgula ? ';' : ',';
}

// Parser CSV simples e tolerante: suporta aspas, campos multilinha e BOM.
export function parseCsv(texto, delimitador) {
  const entrada = String(texto || '').replace(/^\uFEFF/, '');
  const sep = delimitador || detectarDelimitador(entrada);
  const linhas = [];
  let campo = '';
  let linha = [];
  let dentroDeAspas = false;

  for (let i = 0; i < entrada.length; i += 1) {
    const caractere = entrada[i];
    if (dentroDeAspas) {
      if (caractere === '"') {
        if (entrada[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += caractere;
      }
      continue;
    }

    if (caractere === '"') {
      dentroDeAspas = true;
    } else if (caractere === sep) {
      linha.push(campo);
      campo = '';
    } else if (caractere === '\n') {
      linha.push(campo.replace(/\r$/, ''));
      linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += caractere;
    }
  }

  if (campo.length > 0 || linha.length > 0) {
    linha.push(campo.replace(/\r$/, ''));
    linhas.push(linha);
  }

  const naoVazias = linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
  if (naoVazias.length === 0) return { headers: [], rows: [], delimitador: sep };
  const headers = naoVazias[0].map((h) => String(h || '').trim());
  const rows = naoVazias.slice(1).map((l) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = l[idx] !== undefined ? String(l[idx]).trim() : ''; });
    return obj;
  });
  return { headers, rows, delimitador: sep };
}

const ALIASES_CSV = {
  nome_completo: ['nome_completo', 'nome completo', 'nome', 'aluno', 'estudante'],
  matricula: ['matricula', 'matrícula', 'mat', 'numero matricula', 'nº matricula'],
  turma: ['turma', 'classe', 'serie', 'série'],
  curso: ['curso', 'modalidade'],
  nome_responsavel: ['nome_responsavel', 'nome do responsavel', 'responsavel', 'responsável', 'pai', 'mae', 'mãe'],
  telefone_responsavel: ['telefone_responsavel', 'telefone', 'whatsapp', 'celular', 'fone', 'contato'],
  uid_nfc: ['uid_nfc', 'uid', 'cartao', 'cartão', 'tag', 'nfc', 'codigo nfc'],
  ativo: ['ativo', 'liberado', 'permissao', 'permissão']
};

export function mapearCabecalhoCsv(headers) {
  const mapa = {};
  const normalizados = headers.map((h) => ({ original: h, chave: normalizarTexto(h).replace(/_/g, ' ') }));
  Object.entries(ALIASES_CSV).forEach(([campo, aliases]) => {
    const aliasesNormalizados = aliases.map((a) => normalizarTexto(a).replace(/_/g, ' '));
    const encontrado = normalizados.find(({ chave }) => aliasesNormalizados.includes(chave));
    if (encontrado) mapa[campo] = encontrado.original;
  });
  return mapa;
}

export function valorDoCsv(row, mapa, campo) {
  const coluna = mapa[campo];
  return coluna ? String(row[coluna] ?? '').trim() : '';
}

export function boolDoCsv(valor, padrao = true) {
  if (valor === '' || valor === null || valor === undefined) return padrao;
  const normalizado = normalizarTexto(valor);
  return !['0', 'nao', 'não', 'false', 'bloqueado', 'inativo', 'negado'].includes(normalizado);
}

export function mascararChave(valor) {
  const texto = String(valor || '');
  if (texto.length <= 8) return '••••';
  return `${texto.slice(0, 4)}…${texto.slice(-4)}`;
}
