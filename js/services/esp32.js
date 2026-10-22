// =====================================================================
// Comunicação com o ESP32-S3 na rede local.
// O firmware expõe CORS liberado; em HTTPS o navegador bloqueia HTTP local.
// =====================================================================

import { normalizarUrlEsp, espBloqueadoPorHttps } from '../lib/config.js';
import { normalizarUid } from '../lib/utils.js';

let urlAtual = 'http://nfc.local';
let monitor = null;

export function configurarEsp(url) {
  urlAtual = normalizarUrlEsp(url);
  return urlAtual;
}

export function obterUrlEsp() {
  return urlAtual;
}

export function espEmHttpsBloqueado() {
  return espBloqueadoPorHttps(urlAtual);
}

async function requisicao(caminho, opcoes = {}, timeoutMs = 2500) {
  if (espEmHttpsBloqueado()) {
    throw new Error('Página HTTPS não pode acessar o ESP32 em HTTP. Abra o site pelo modo local (http://localhost:5500).');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { method = 'GET', body, headers } = opcoes;

  try {
    const resposta = await fetch(urlAtual + caminho, {
      method,
      headers: body ? { 'Content-Type': 'application/json', ...(headers || {}) } : headers,
      body: body ? JSON.stringify(body) : undefined,
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal
    });

    if (!resposta.ok) {
      throw new Error(`ESP32 respondeu HTTP ${resposta.status}`);
    }

    const texto = await resposta.text();
    return texto ? JSON.parse(texto) : null;
  } catch (erro) {
    if (erro?.name === 'AbortError') {
      throw new Error('Tempo esgotado ao falar com o ESP32.');
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

export function statusSistema() {
  return requisicao('/api/status', {}, 3000);
}

export function ultimoCartao() {
  return requisicao('/api/ultimo', {}, 1500);
}

export function listarCartoes() {
  return requisicao('/api/cartoes', {}, 5000);
}

export async function sincronizarAluno(uid, nome, ativo) {
  return requisicao('/api/sincronizar_aluno', {
    method: 'POST',
    body: { uid, nome, ativo }
  }, 3000);
}

export async function sincronizarTodos(alunos) {
  const payload = alunos.map((a) => ({
    uid: normalizarUid(a.uid_nfc) || a.uid_nfc,
    nome: a.nome_completo,
    ativo: a.ativo
  }));
  return requisicao('/api/sincronizar_todos', { method: 'POST', body: payload }, 12000);
}

export async function removerAluno(uid) {
  return requisicao('/api/remover_aluno', { method: 'POST', body: { uid } }, 3000);
}

export async function testarEsp() {
  const dados = await statusSistema();
  return dados;
}

// ---------------------------------------------------------------------
// Captura do próximo cartão lido (para o formulário da secretaria)
// ---------------------------------------------------------------------

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function capturarProximoUid({ timeoutMs = 30000, signal, onProgress } = {}) {
  const inicial = await ultimoCartao();
  const seqInicial = Number(inicial?.seq || 0);
  const inicio = Date.now();

  while (Date.now() - inicio < timeoutMs) {
    if (signal?.aborted) throw new Error('Captura cancelada.');
    if (onProgress) onProgress(Math.round((Date.now() - inicio) / 1000));
    await esperar(700);
    try {
      const atual = await ultimoCartao();
      if (Number(atual?.seq || 0) !== seqInicial && atual?.uid) {
        return atual.uid;
      }
    } catch (_) {
      // Se o ESP oscilar, continua tentando até o timeout.
    }
  }
  throw new Error('Nenhum cartão novo foi lido. Aproxime o cartão do leitor e tente novamente.');
}

// ---------------------------------------------------------------------
// Monitoramento contínuo da portaria (loop único, com backoff)
// ---------------------------------------------------------------------

export function iniciarMonitoramento({ onStatus, onCartao } = {}) {
  pararMonitoramento();

  if (espEmHttpsBloqueado()) {
    if (onStatus) {
      onStatus({
        estado: 'bloqueado',
        motivo: 'Esta página está em HTTPS e o navegador bloqueia o ESP32 local em HTTP.'
      });
    }
    return;
  }

  let parado = false;
  let timer = null;
  let falhas = 0;
  let seqVisto = null;
  let primeiraLeitura = true;

  const agendar = (ms) => {
    if (parado) return;
    clearTimeout(timer);
    timer = setTimeout(ciclo, ms);
  };

  const aoFicarVisivel = () => {
    if (!parado && document.visibilityState === 'visible') agendar(0);
  };

  async function ciclo() {
    if (parado) return;
    if (document.visibilityState === 'hidden') {
      agendar(1500);
      return;
    }

    try {
      const dados = await ultimoCartao();
      falhas = 0;

      if (onStatus) {
        onStatus({
          estado: dados?.nfc_ok === false ? 'leitor_off' : 'online',
          dados
        });
      }

      if (dados && dados.seq !== undefined && dados.seq !== seqVisto) {
        const mudou = seqVisto !== null;
        const recente = dados.ha === undefined || Number(dados.ha) <= 10;
        seqVisto = dados.seq;
        if (dados.uid && recente && (primeiraLeitura || mudou)) {
          if (onCartao) onCartao(dados.uid);
        }
        primeiraLeitura = false;
      } else if (dados && dados.uid && primeiraLeitura) {
        // Primeira leitura com o cartão ainda dentro da janela de 10s.
        if (dados.ha === undefined || Number(dados.ha) <= 10) {
          if (onCartao) onCartao(dados.uid);
        }
        primeiraLeitura = false;
      }

      agendar(1000);
    } catch (erro) {
      falhas += 1;
      if (onStatus) onStatus({ estado: 'offline', erro: erro?.message || String(erro) });
      agendar(Math.min(1000 * (2 ** Math.min(falhas, 4)), 15000));
    }
  }

  monitor = {
    parar: () => {
      parado = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', aoFicarVisivel);
    }
  };

  document.addEventListener('visibilitychange', aoFicarVisivel);
  ciclo();
}

export function pararMonitoramento() {
  if (monitor) {
    monitor.parar();
    monitor = null;
  }
}
