// =====================================================================
// Configuração de runtime gerada pelo build (config.js) e preferências
// locais que podem variar por dispositivo (ex.: IP do ESP32).
// =====================================================================

const CHAVE_ESP = 'cfg_esp_url';

export function normalizarUrlSupabase(url) {
  if (!url) return '';
  let valor = String(url).trim();
  valor = valor.replace(/\/rest\/v1\/?$/i, '');
  valor = valor.replace(/\/auth\/v1\/?$/i, '');
  valor = valor.replace(/\/storage\/v1\/?$/i, '');
  valor = valor.replace(/\/+$/, '');
  return valor;
}

export function normalizarUrlEsp(url) {
  if (!url) return 'http://nfc.local';
  let valor = String(url).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(valor)) valor = 'http://' + valor;
  return valor;
}

function urlValida(valor) {
  try {
    const parsed = new URL(valor);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

export function validarConfiguracao(raw = {}) {
  const erros = [];
  const supabaseUrl = normalizarUrlSupabase(raw.supabaseUrl);
  const supabaseAnonKey = String(raw.supabaseAnonKey || '').trim();

  if (!supabaseUrl) {
    erros.push('SUPABASE_URL não foi definida no build.');
  } else if (!urlValida(supabaseUrl)) {
    erros.push('SUPABASE_URL não é uma URL http/https válida.');
  }
  if (!supabaseAnonKey) {
    erros.push('SUPABASE_ANON_KEY não foi definida no build.');
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    espUrl: normalizarUrlEsp(raw.espUrl || 'http://nfc.local'),
    appEnv: String(raw.appEnv || 'production'),
    appVersion: String(raw.appVersion || 'dev'),
    valido: erros.length === 0,
    erros
  };
}

export function obterConfiguracao() {
  const raw = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};
  return validarConfiguracao({
    supabaseUrl: raw.supabaseUrl,
    supabaseAnonKey: raw.supabaseAnonKey,
    espUrl: raw.espUrl,
    appEnv: raw.appEnv,
    appVersion: raw.appVersion
  });
}

export function lerStorage(chave, padrao = '') {
  try {
    return localStorage.getItem(chave) || padrao;
  } catch (_) {
    return padrao;
  }
}

export function salvarStorage(chave, valor) {
  try {
    localStorage.setItem(chave, String(valor));
  } catch (_) { /* modo privado / cota */ }
}

export function removerStorage(chave) {
  try {
    localStorage.removeItem(chave);
  } catch (_) { /* ignora */ }
}

// O painel servido pelo próprio ESP32 usa a mesma origem para a API.
// Ex.: http://192.168.0.73/painel/ → API em http://192.168.0.73/api/...
export function caminhoEhPainelEsp(pathname = '') {
  return /^\/painel(?:\/|$)/.test(String(pathname || ''));
}

export function estaNoPainelEsp() {
  try {
    return caminhoEhPainelEsp(window.location.pathname);
  } catch (_) {
    return false;
  }
}

export function obterUrlEsp(configuracao) {
  if (estaNoPainelEsp()) return window.location.origin;
  const salva = lerStorage(CHAVE_ESP, '');
  return normalizarUrlEsp(salva || configuracao?.espUrl || 'http://nfc.local');
}

export function definirUrlEsp(url) {
  const normalizada = normalizarUrlEsp(url);
  salvarStorage(CHAVE_ESP, normalizada);
  return normalizada;
}

// Permite configurar um tablet via link: .../#/portaria?esp=http://192.168.0.73
export function aplicarEspDaQuery() {
  try {
    if (estaNoPainelEsp()) return '';
    const params = new URLSearchParams(window.location.search);
    const esp = params.get('esp');
    if (!esp) return '';
    const normalizada = definirUrlEsp(esp);
    params.delete('esp');
    const query = params.toString();
    const novaUrl = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    window.history.replaceState({}, '', novaUrl);
    return normalizada;
  } catch (_) {
    return '';
  }
}

export function modoLocal() {
  try {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
      /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch (_) {
    return false;
  }
}

export function espBloqueadoPorHttps(urlEsp) {
  try {
    return window.location.protocol === 'https:' && String(urlEsp || '').startsWith('http://');
  } catch (_) {
    return false;
  }
}
