// =====================================================================
// Comunicação com o ESP32-S3 na rede local.
// O firmware expõe CORS liberado; em HTTPS o navegador bloqueia HTTP local.
// =====================================================================

import { normalizarUrlEsp, espBloqueadoPorHttps } from '../lib/config.js';
import { normalizarUid, normalizarBiometriaId } from '../lib/utils.js';

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

export async function sincronizarAluno(uid, nome, ativo, bioId = null) {
  const body = { uid, nome, ativo };
  const bId = normalizarBiometriaId(bioId);
  if (bId !== null) body.bio_id = bId;
  return requisicao('/api/sincronizar_aluno', {
    method: 'POST',
    body
  }, 3000);
}

export async function sincronizarTodos(alunos) {
  const payload = alunos.map((a) => {
    const item = {
      uid: normalizarUid(a.uid_nfc) || a.uid_nfc,
      nome: a.nome_completo,
      ativo: a.ativo
    };
    const bId = normalizarBiometriaId(a.biometria_id);
    if (bId !== null) item.bio_id = bId;
    return item;
  });
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
// Biometria óptica opcional (AS608 / FPM10A)
// ---------------------------------------------------------------------

export async function iniciarCadastroBiometria(id = null) {
  const bId = normalizarBiometriaId(id);
  return requisicao('/api/biometria/iniciar', {
    method: 'POST',
    body: bId !== null ? { id: bId } : {}
  }, 4000);
}

export async function statusCadastroBiometria() {
  return requisicao('/api/biometria/status', {}, 2500);
}

export async function cancelarCadastroBiometria() {
  return requisicao('/api/biometria/cancelar', { method: 'POST', body: {} }, 2500);
}

export async function excluirBiometria(id) {
  const bId = normalizarBiometriaId(id);
  if (bId === null) return null;
  return requisicao('/api/biometria/excluir', {
    method: 'POST',
    body: { id: bId }
  }, 3000);
}

function stErroFatal(erro) {
  const msg = String(erro?.message || '');
  return msg && !/Tempo esgotado ao falar com o ESP32|Failed to fetch/i.test(msg);
}

export async function capturarBiometriaInterativa({ idSugerido = null, timeoutMs = 45000, signal, onStep } = {}) {
  const respostaInicio = await iniciarCadastroBiometria(idSugerido);
  if (respostaInicio?.ok === false) {
    throw new Error(respostaInicio?.erro || 'Não foi possível iniciar o cadastro no leitor de biometria.');
  }

  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (signal?.aborted) {
      await cancelarCadastroBiometria().catch(() => {});
      throw new Error('Cadastro de biometria cancelado.');
    }

    const segundos = Math.round((Date.now() - inicio) / 1000);
    await esperar(600);

    try {
      const st = await statusCadastroBiometria();
      if (onStep && st) onStep({ ...st, segundos });
      if (st?.etapa === 'concluido' && st?.id) {
        return Number(st.id);
      }
      if (st?.etapa === 'erro') {
        throw new Error(st?.mensagem || 'Falha ao gravar a digital no sensor.');
      }
    } catch (erro) {
      if (stErroFatal(erro)) throw erro;
    }
  }

  await cancelarCadastroBiometria().catch(() => {});
  throw new Error('Tempo esgotado para gravar a digital. Tente novamente.');
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
          estado: dados?.nfc_ok === false && dados?.bio_ok !== true ? 'leitor_off' : 'online',
          dados
        });
      }

      if (dados && dados.seq !== undefined && dados.seq !== seqVisto) {
        const mudou = seqVisto !== null;
        const recente = dados.ha === undefined || Number(dados.ha) <= 10;
        const temEvento = Boolean(dados.uid || dados.bio_id || dados.biometria_desconhecida);
        seqVisto = dados.seq;
        if (temEvento && recente && (primeiraLeitura || mudou)) {
          if (onCartao) onCartao(dados.uid, dados);
        }
        primeiraLeitura = false;
      } else if (dados && (dados.uid || dados.bio_id || dados.biometria_desconhecida) && primeiraLeitura) {
        // Primeira leitura com o cartão/digital ainda dentro da janela de 10s.
        if (dados.ha === undefined || Number(dados.ha) <= 10) {
          if (onCartao) onCartao(dados.uid, dados);
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
