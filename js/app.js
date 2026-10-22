// =====================================================================
// Painel web do Sistema de Acesso Escolar NFC.
// Configuração vem de config.js (gerado no build); não há cadastro de
// URL/chave do Supabase em nenhum navegador.
// =====================================================================

import { obterConfiguracao, obterUrlEsp, definirUrlEsp, aplicarEspDaQuery, lerStorage, salvarStorage, removerStorage } from './lib/config.js';
import {
  $, escapeHtml, obterAvatarPadrao, normalizarUid, normalizarTelefone, normalizarTexto,
  formatarDataHora, formatarHora, formatarTelefone, telefoneParaWhatsapp, dataParaInput,
  inicioDoDiaISO, fimDoDiaISO, inicioDoDiaDeInput, fimDoDiaDeInput, debounce, gerarId,
  formatarTamanho, baixarArquivo, paraCsv, parseCsv, mapearCabecalhoCsv, valorDoCsv, boolDoCsv
} from './lib/utils.js';
import * as Supabase from './services/supabase.js';
import * as Esp32 from './services/esp32.js';

// =====================================================================
// Perfis e estado
// =====================================================================

const PERFIS = {
  portaria: {
    rotulo: '🏢 Portaria', classe: 'cargo-portaria',
    abas: ['portaria'], editarAlunos: false, excluirAlunos: false,
    gerenciarUsuarios: false, verHistorico: false, exportar: false, sincronizarEsp: false
  },
  secretaria: {
    rotulo: '📝 Secretaria', classe: 'cargo-secretaria',
    abas: ['portaria', 'secretaria', 'historico'], editarAlunos: true, excluirAlunos: true,
    gerenciarUsuarios: false, verHistorico: true, exportar: true, sincronizarEsp: true
  },
  coordenacao: {
    rotulo: '📚 Coordenação', classe: 'cargo-coordenacao',
    abas: ['portaria', 'secretaria', 'historico'], editarAlunos: true, excluirAlunos: false,
    gerenciarUsuarios: false, verHistorico: true, exportar: true, sincronizarEsp: false
  },
  direcao: {
    rotulo: '🏛️ Direção', classe: 'cargo-direcao',
    abas: ['portaria', 'secretaria', 'historico'], editarAlunos: true, excluirAlunos: true,
    gerenciarUsuarios: false, verHistorico: true, exportar: true, sincronizarEsp: true
  },
  admin: {
    rotulo: '🛠️ Admin/Técnico', classe: 'cargo-admin',
    abas: ['portaria', 'secretaria', 'historico', 'usuarios', 'config'], editarAlunos: true, excluirAlunos: true,
    gerenciarUsuarios: true, verHistorico: true, exportar: true, sincronizarEsp: true
  }
};

const ROTULOS_ABAS = {
  portaria: 'Portaria',
  secretaria: 'Secretaria',
  historico: 'Histórico',
  usuarios: 'Usuários',
  config: 'Configurações'
};

const state = {
  config: null,
  usuario: null,
  perfil: null,
  alunos: [],
  usuarios: [],
  alunosFiltro: { busca: '', status: '' },
  alunoEditandoId: null,
  alunoOriginal: null,
  fotoBlob: null,
  fotoPathOriginal: null,
  removerFoto: false,
  streamWebcam: null,
  audioCtx: null,
  somAtivo: false,
  wakeLock: null,
  modoTotem: false,
  espEstado: 'desconhecido',
  espOnline: false,
  recentes: [],
  eventosVistos: new Set(),
  acessosHoje: 0,
  ultimoAcesso: null,
  filaHistorico: [],
  timerFila: null,
  timerRelogio: null,
  timerRecentes: null,
  timerHistorico: null,
  historicoAtualizadoEm: null,
  carregandoHistorico: false,
  historicoReq: 0,
  canalRealtime: null,
  processandoCartao: false,
  cartaoPendente: null,
  ultimoProcessamento: new Map(),
  nfcAbort: null,
  importPreview: null,
  confirmResolver: null,
  carregandoAlunos: false,
  carregandoPerfil: null,
  abaAtual: 'portaria',
  iniciado: false,
  historico: { rows: [], total: 0, page: 0, pageSize: 50, filtros: {} },
  historicoAlunoAtual: null
};

// =====================================================================
// Utilitários de UI
// =====================================================================

function toast(mensagem, tipo = '') {
  const elemento = $('toast');
  if (!elemento) return;
  elemento.textContent = mensagem;
  elemento.className = `show ${tipo}`.trim();
  clearTimeout(elemento._timer);
  elemento._timer = setTimeout(() => { elemento.className = ''; }, tipo === 'err' ? 5500 : 3800);
}

function mensagemErro(erro) {
  const mensagem = String(erro?.message || erro || 'Erro inesperado');
  const mapa = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'E-mail ainda não confirmado. Fale com o administrador.',
    'User already registered': 'Este e-mail já possui conta.',
    'Failed to fetch': 'Falha de rede. Verifique sua internet e tente novamente.',
    'Load failed': 'Falha de rede. Verifique sua internet e tente novamente.',
    'JWT expired': 'Sua sessão expirou. Entre novamente.',
    'Invalid Refresh Token': 'Sua sessão expirou. Entre novamente.',
    'new row violates row-level security policy': 'Seu perfil não tem permissão para esta ação.',
    'duplicate key value violates unique constraint "alunos_uid_nfc_key"': 'Este cartão NFC já está cadastrado para outro aluno.',
    'duplicate key value violates unique constraint "alunos_matricula_key"': 'Esta matrícula já está cadastrada para outro aluno.'
  };
  if (mapa[mensagem]) return mapa[mensagem];
  if (/foto_path/i.test(mensagem)) return 'Banco desatualizado: execute a migração SQL de hardening antes de usar fotos.';
  if (/permission denied/i.test(mensagem)) return 'Permissão negada pelo banco de dados. Verifique o cargo do usuário e as políticas RLS.';
  return mensagem;
}

function definirErroLogin(mensagem) {
  const alvo = $('loginErro');
  if (!alvo) return;
  alvo.textContent = mensagem || '';
  alvo.classList.toggle('visivel', Boolean(mensagem));
}

function limparErroLogin() {
  definirErroLogin('');
}

function definirErroFormularioAluno(mensagem) {
  const alvo = $('erroFormAluno');
  if (!alvo) return;
  alvo.textContent = mensagem || '';
  alvo.classList.toggle('visivel', Boolean(mensagem));
}

function limparErroFormularioAluno() {
  definirErroFormularioAluno('');
}

function mostrar(elemento, visivel) {
  if (!elemento) return;
  elemento.classList.toggle('hidden', !visivel);
}

function botaoCarregando(botao, carregando, texto = 'Aguarde...') {
  if (!botao) return;
  if (carregando) {
    if (!botao.dataset.textoOriginal) botao.dataset.textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = texto;
  } else {
    botao.disabled = false;
    if (botao.dataset.textoOriginal) {
      botao.textContent = botao.dataset.textoOriginal;
      delete botao.dataset.textoOriginal;
    }
  }
}

// Modais ---------------------------------------------------------------

const modaisAbertos = [];
let ultimoFoco = null;

function abrirModal(id) {
  const modal = $(id);
  if (!modal) return;
  ultimoFoco = document.activeElement;
  modal.classList.add('aberto');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sem-scroll');
  if (!modaisAbertos.includes(id)) modaisAbertos.push(id);
  const focavel = modal.querySelector('input:not([type="hidden"]):not(.hidden), select:not(.hidden), textarea:not(.hidden), button:not(.hidden)');
  setTimeout(() => { try { focavel?.focus(); } catch (_) { /* ignora */ } }, 30);
}

function fecharModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('aberto');
  modal.setAttribute('aria-hidden', 'true');
  const indice = modaisAbertos.indexOf(id);
  if (indice >= 0) modaisAbertos.splice(indice, 1);
  if (modaisAbertos.length === 0) {
    document.body.classList.remove('sem-scroll');
    try { ultimoFoco?.focus(); } catch (_) { /* ignora */ }
  }
  if (id === 'modalCamera') fecharCamera();
  if (id === 'modalNfc') cancelarCapturaUid();
}

function fecharModalDoTopo() {
  const id = modaisAbertos[modaisAbertos.length - 1];
  if (!id) return false;
  if (id === 'modalConfirm') {
    resolverConfirmacao(false);
  } else {
    fecharModal(id);
  }
  return true;
}

function confirmar({ titulo, mensagem, textoOk = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    if (state.confirmResolver) state.confirmResolver(false);
    state.confirmResolver = resolve;
    if ($('tituloConfirm')) $('tituloConfirm').textContent = titulo || 'Confirmar ação';
    if ($('textoConfirm')) $('textoConfirm').textContent = mensagem || '';
    const botaoOk = $('btnConfirmarOk');
    if (botaoOk) {
      botaoOk.textContent = textoOk;
      botaoOk.classList.toggle('perigo', perigo);
    }
    abrirModal('modalConfirm');
  });
}

function resolverConfirmacao(valor) {
  const resolver = state.confirmResolver;
  state.confirmResolver = null;
  fecharModal('modalConfirm');
  if (resolver) resolver(valor);
}

// =====================================================================
// Inicialização e autenticação
// =====================================================================

function iniciar() {
  if (state.iniciado) return;
  state.iniciado = true;

  state.config = obterConfiguracao();
  aplicarEspDaQuery();
  Esp32.configurarEsp(obterUrlEsp(state.config));

  ligarEventos();
  atualizarBuildInfo();
  atualizarRelogio();
  limparFormularioAluno();
  resetarTotem();

  if (!state.config.valido) {
    mostrarAvisoConfig(state.config.erros);
    mostrarTelaLogin();
    return;
  }

  try {
    Supabase.inicializarSupabase();
    limparAvisoConfig();
  } catch (erro) {
    mostrarAvisoConfig([mensagemErro(erro)]);
    mostrarTelaLogin();
    return;
  }

  Supabase.observarAuth((evento, sessao) => {
    if (evento === 'SIGNED_OUT') {
      estadoDeslogado();
      return;
    }
    if (evento === 'TOKEN_REFRESHED' && !sessao) return;
    if (sessao?.user) {
      tratarSessao(sessao).catch((erro) => {
        console.error('[auth] falha ao carregar sessão', erro);
        toast(mensagemErro(erro), 'err');
      });
    } else if (!state.usuario) {
      mostrarTelaLogin();
    }
  });

  Supabase.obterSessao()
    .then((sessao) => {
      if (sessao?.user) return tratarSessao(sessao);
      mostrarTelaLogin();
      return null;
    })
    .catch((erro) => {
      console.error('[auth] falha ao recuperar sessão', erro);
      mostrarTelaLogin();
    });

  // Fila de histórico e relógio do totem.
  state.filaHistorico = carregarFilaHistorico();
  atualizarIndicadorFila();
  state.timerFila = setInterval(sincronizarFilaHistorico, 30000);

  window.addEventListener('online', () => {
    toast('Conexão restaurada. Sincronizando pendências...', 'ok');
    sincronizarFilaHistorico();
  });
  window.addEventListener('offline', () => toast('Você está offline. Os acessos ficarão na fila local.', 'err'));
}

function mostrarAvisoConfig(erros) {
  const aviso = $('avisoConfig');
  const texto = $('avisoConfigTexto');
  if (aviso) aviso.classList.remove('hidden');
  if (texto) {
    texto.innerHTML = `${escapeHtml((erros && erros[0]) || 'Configuração ausente.')}<br><small>Execute <code>npm run build</code> com as variáveis de ambiente configuradas ou contate o administrador.</small>`;
  }
  const botao = $('btnEntrarLogin');
  if (botao) botao.disabled = true;
}

function limparAvisoConfig() {
  const aviso = $('avisoConfig');
  if (aviso) aviso.classList.add('hidden');
  const botao = $('btnEntrarLogin');
  if (botao) botao.disabled = false;
}

function mostrarTelaLogin() {
  document.title = 'Acesso Escolar NFC';
  $('telaLogin')?.classList.remove('hidden');
  $('conteudoPrincipal')?.classList.add('hidden');
  $('menuUsuario')?.classList.add('hidden');
  if ($('loginSenha')) $('loginSenha').value = '';
}

function mostrarPainelPrincipal() {
  $('telaLogin')?.classList.add('hidden');
  $('conteudoPrincipal')?.classList.remove('hidden');
  $('menuUsuario')?.classList.remove('hidden');
}

function estadoDeslogado() {
  Supabase.cancelarAssinaturaHistorico();
  state.canalRealtime = null;
  Esp32.pararMonitoramento();
  pararTotem();
  if (state.timerRelogio) {
    clearInterval(state.timerRelogio);
    state.timerRelogio = null;
  }
  if (state.timerRecentes) {
    clearInterval(state.timerRecentes);
    state.timerRecentes = null;
  }
  if (state.timerHistorico) {
    clearInterval(state.timerHistorico);
    state.timerHistorico = null;
  }
  state.usuario = null;
  state.perfil = null;
  state.alunos = [];
  state.usuarios = [];
  state.recentes = [];
  state.eventosVistos.clear();
  state.acessosHoje = 0;
  state.ultimoAcesso = null;
  state.alunoEditandoId = null;
  state.alunoOriginal = null;
  state.fotoBlob = null;
  state.removerFoto = false;
  if (state.confirmResolver) resolverConfirmacao(false);
  [...modaisAbertos].forEach((id) => fecharModal(id));
  limparTabelas();
  mostrarTelaLogin();
  limparErroLogin();
}

async function tratarSessao(sessao) {
  if (!sessao?.user) {
    estadoDeslogado();
    return;
  }
  if (state.usuario?.id === sessao.user.id && !$('conteudoPrincipal')?.classList.contains('hidden')) {
    return;
  }
  if (state.carregandoPerfil) return state.carregandoPerfil;
  state.carregandoPerfil = carregarPerfilUsuario(sessao.user).finally(() => {
    state.carregandoPerfil = null;
  });
  return state.carregandoPerfil;
}

async function carregarPerfilUsuario(authUser) {
  let perfil = null;
  try {
    perfil = await Supabase.obterMeuPerfil();
  } catch (erro) {
    console.warn('[perfil] não foi possível ler obter_meu_perfil', erro);
  }

  if (!perfil) {
    const meta = authUser.user_metadata || {};
    perfil = {
      id: authUser.id,
      email: authUser.email,
      nome_completo: meta.nome || String(authUser.email || '').split('@')[0],
      cargo: 'portaria',
      ativo: true
    };
  }

  if (!perfil.ativo) {
    toast('Sua conta está desativada. Fale com a direção ou o suporte técnico.', 'err');
    try { await Supabase.sair(); } catch (_) { /* ignora */ }
    estadoDeslogado();
    definirErroLogin('Sua conta está desativada. Fale com o administrador.');
    return;
  }

  state.usuario = {
    id: perfil.id || authUser.id,
    email: perfil.email || authUser.email,
    nome_completo: perfil.nome_completo || authUser.email,
    cargo: perfil.cargo || 'portaria',
    ativo: perfil.ativo !== false
  };
  state.perfil = PERFIS[state.usuario.cargo] || PERFIS.portaria;

  aplicarPermissoes();
  mostrarPainelPrincipal();
  limparErroLogin();
  if ($('dotNuvem')) $('dotNuvem').className = 'dot online';
  if ($('txtStatusNuvem')) $('txtStatusNuvem').textContent = 'Conectado';
  iniciarServicosDaSessao();
  await carregarDadosIniciais();
}

function aplicarPermissoes() {
  const perfil = state.perfil;
  if (!perfil) return;

  if ($('nomeUsuarioTopo')) $('nomeUsuarioTopo').textContent = state.usuario.nome_completo;
  if ($('avatarUsuario')) $('avatarUsuario').textContent = String(state.usuario.nome_completo || 'U').charAt(0).toUpperCase();
  if ($('cargoUsuarioTopo')) {
    $('cargoUsuarioTopo').textContent = perfil.rotulo;
    $('cargoUsuarioTopo').className = `badge-cargo ${perfil.classe}`;
  }

  document.querySelectorAll('.nav-btn').forEach((botao) => {
    const aba = botao.dataset.tab;
    const visivel = perfil.abas.includes(aba);
    botao.classList.toggle('hidden', !visivel);
  });

  mostrar($('btnImportarCsv'), perfil.editarAlunos);
  mostrar($('btnExportarCsv'), perfil.exportar);
  mostrar($('btnSyncEspSec'), perfil.sincronizarEsp);
  mostrar($('btnSyncEspConfig'), perfil.sincronizarEsp);
  mostrar($('btnCompararEsp'), perfil.sincronizarEsp);
  mostrar($('btnExportarJson'), perfil.exportar);
  mostrar($('btnExportarCsvConfig'), perfil.exportar);
  mostrar($('btnExportarHistorico'), perfil.exportar);

  const permitida = perfil.abas.includes(state.abaAtual) ? state.abaAtual : perfil.abas[0];
  navegar(permitida, { atualizarHash: false });

  const hash = (window.location.hash.match(/^#\/([a-z]+)/) || [])[1];
  if (hash && perfil.abas.includes(hash)) navegar(hash, { atualizarHash: false });
  else if (window.location.hash !== `#/${permitida}`) {
    window.history.replaceState({}, '', `#/${permitida}`);
  }
}

function iniciarServicosDaSessao() {
  if (!state.canalRealtime) {
    try {
      state.canalRealtime = Supabase.assinarHistorico(aoNovoEventoHistorico);
    } catch (erro) {
      console.warn('[realtime] indisponível, usando polling', erro);
    }
  }

  if (state.timerRelogio) clearInterval(state.timerRelogio);
  state.timerRelogio = setInterval(atualizarRelogio, 1000);

  // Fallback do Realtime: mantém a lista da portaria atualizada mesmo se o
  // canal em tempo real estiver indisponível.
  if (state.timerRecentes) clearInterval(state.timerRecentes);
  state.timerRecentes = setInterval(() => {
    if (state.abaAtual === 'portaria' && state.usuario) carregarRecentesHoje();
  }, 30000);

  // Acompanhamento remoto: a direção pode deixar a aba Histórico aberta no
  // Vercel e receber atualizações mesmo se o Realtime não estiver publicado.
  if (state.timerHistorico) clearInterval(state.timerHistorico);
  state.timerHistorico = setInterval(() => {
    if (state.abaAtual === 'historico' && state.usuario && !document.hidden) {
      carregarHistorico(state.historico.page, { silencioso: true });
    }
  }, 10000);

  sincronizarFilaHistorico();

  // Em modo remoto (HTTPS), não tenta sincronizar o leitor local.
  Esp32.configurarEsp(obterUrlEsp(state.config));
  if (!Esp32.espEmHttpsBloqueado()) {
    Esp32.iniciarMonitoramento({
      onStatus: aoStatusEsp,
      onCartao: (uid) => processarCartao(uid)
    });
  } else {
    aoStatusEsp({ estado: 'bloqueado' });
  }
}

async function carregarDadosIniciais() {
  const tarefas = [carregarAlunos(), carregarRecentesHoje()];
  if (state.perfil?.gerenciarUsuarios) tarefas.push(carregarUsuarios());
  const resultados = await Promise.allSettled(tarefas);
  resultados.forEach((resultado) => {
    if (resultado.status === 'rejected') {
      console.error('[dados] falha ao carregar', resultado.reason);
      toast(mensagemErro(resultado.reason), 'err');
    }
  });
}

function aoEntrar(evento) {
  evento.preventDefault();
  const email = $('loginEmail')?.value.trim() || '';
  const senha = $('loginSenha')?.value || '';
  const botao = $('btnEntrarLogin');

  limparErroLogin();
  if (!email || !senha) {
    definirErroLogin('Informe e-mail e senha.');
    return;
  }

  botaoCarregando(botao, true, 'Entrando...');
  Supabase.entrar(email, senha)
    .then(() => {
      toast('Login realizado. Bem-vindo!', 'ok');
      return Supabase.obterSessao().then((sessao) => (sessao ? tratarSessao(sessao) : null));
    })
    .catch((erro) => {
      console.error('[login]', erro);
      if ($('dotNuvem')) $('dotNuvem').className = 'dot offline';
      if ($('txtStatusNuvem')) $('txtStatusNuvem').textContent = 'Erro';
      definirErroLogin(mensagemErro(erro));
    })
    .finally(() => botaoCarregando(botao, false));
}

async function sairDaConta() {
  const confirmado = await confirmar({
    titulo: 'Sair da conta',
    mensagem: 'Deseja encerrar a sessão neste dispositivo?',
    textoOk: 'Sair'
  });
  if (!confirmado) return;
  try {
    await Supabase.sair();
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
  estadoDeslogado();
  toast('Sessão encerrada.', '');
}

// =====================================================================
// Navegação
// =====================================================================

function navegar(aba, { atualizarHash = true } = {}) {
  if (!state.perfil) return;
  const destino = state.perfil.abas.includes(aba) ? aba : state.perfil.abas[0];
  state.abaAtual = destino;

  document.querySelectorAll('.tab-pane').forEach((painel) => {
    painel.classList.toggle('active', painel.id === `aba-${destino}`);
  });
  document.querySelectorAll('.nav-btn').forEach((botao) => {
    botao.classList.toggle('active', botao.dataset.tab === destino);
    botao.setAttribute('aria-selected', String(botao.dataset.tab === destino));
  });

  document.title = `${ROTULOS_ABAS[destino] || destino} · Acesso Escolar NFC`;
  if (atualizarHash && window.location.hash !== `#/${destino}`) {
    window.location.hash = `#/${destino}`;
  }

  if (destino === 'portaria') {
    atualizarKpis();
    if (state.acessosHoje === 0 && state.recentes.length === 0) carregarRecentesHoje();
  }
  if (destino === 'secretaria') carregarAlunos();
  if (destino === 'historico') carregarHistorico(0);
  if (destino === 'usuarios') carregarUsuarios();
  if (destino === 'config') {
    carregarDiagnosticoNuvem();
    if ($('cfgEspUrl')) $('cfgEspUrl').value = Esp32.obterUrlEsp();
  }
}

function aoMudarHash() {
  if (!state.perfil) return;
  const aba = (window.location.hash.match(/^#\/([a-z]+)/) || [])[1];
  navegar(aba || state.perfil.abas[0], { atualizarHash: false });
}

// =====================================================================
// Helpers de tabela / permissões
// =====================================================================

function limparTabelas() {
  ['corpoTabelaAlunos', 'corpoTabelaUsuarios', 'corpoTabelaHistorico', 'listaRecentes'].forEach((id) => {
    if ($(id)) $(id).innerHTML = '';
  });
  if ($('contagemAlunos')) $('contagemAlunos').textContent = '0';
  if ($('contagemUsuarios')) $('contagemUsuarios').textContent = '0';
  if ($('contagemHistorico')) $('contagemHistorico').textContent = '0';
  resetarTotem();
  atualizarKpis();
}

function td(texto, rotulo) {
  const celula = document.createElement('td');
  if (rotulo) celula.dataset.label = rotulo;
  if (texto instanceof Node) celula.appendChild(texto);
  else celula.textContent = texto ?? '';
  return celula;
}

function tdHtml(html, rotulo) {
  const celula = document.createElement('td');
  if (rotulo) celula.dataset.label = rotulo;
  celula.innerHTML = html;
  return celula;
}

function criarBotao(texto, classe, aoClicar, titulo = '') {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = classe;
  botao.textContent = texto;
  if (titulo) botao.title = titulo;
  botao.addEventListener('click', aoClicar);
  return botao;
}

function avatarImg(nome, url, classe = 'aluno-mini-thumb') {
  const img = document.createElement('img');
  img.className = classe;
  img.alt = `Foto de ${nome || 'aluno'}`;
  img.src = url || obterAvatarPadrao(nome);
  img.addEventListener('error', () => { img.src = obterAvatarPadrao(nome); }, { once: true });
  return img;
}

// =====================================================================
// Portaria / totem
// =====================================================================

function aoStatusEsp(status) {
  const dados = status?.dados || {};
  state.espEstado = status?.estado || 'desconhecido';
  state.espOnline = status?.estado === 'online';

  const dot = $('dotEsp');
  const texto = $('txtStatusEsp');
  const badge = $('badgeEsp');
  const banner = $('bannerEsp');
  const bannerTexto = $('bannerEspTexto');

  if (status?.estado === 'bloqueado') {
    if (dot) dot.className = 'dot offline';
    if (texto) texto.textContent = 'Bloq. HTTPS';
    if (badge) badge.title = 'Página HTTPS não pode acessar o ESP32 em HTTP local.';
    if (banner && bannerTexto) {
      banner.classList.remove('hidden');
      bannerTexto.textContent = 'Esta página está em HTTPS e o navegador bloqueia o leitor local. Para usar a portaria, abra o modo local (http://localhost:5500).';
    }
    return;
  }

  if (status?.estado === 'offline') {
    if (dot) dot.className = 'dot offline';
    if (texto) texto.textContent = 'Offline';
    if (badge) badge.title = `Sem resposta de ${Esp32.obterUrlEsp()}. Clique para configurar.`;
    if (banner && bannerTexto) {
      banner.classList.remove('hidden');
      bannerTexto.textContent = `Não foi possível falar com o leitor em ${Esp32.obterUrlEsp()}. Verifique se o ESP32 está ligado e na mesma rede.`;
    }
    return;
  }

  if (status?.estado === 'leitor_off') {
    if (dot) dot.className = 'dot offline';
    if (texto) texto.textContent = 'Leitor OFF';
    if (badge) badge.title = 'ESP32 online, mas o leitor PN532 não respondeu.';
    mostrar(banner, false);
    return;
  }

  if (dot) dot.className = 'dot online';
  if (texto) texto.textContent = 'Online';
  if (badge) badge.title = `Conectado ao ESP32 em ${Esp32.obterUrlEsp()}. Clique para alterar.`;
  if (dados?.nfc_ok === false) {
    if (dot) dot.className = 'dot offline';
    if (texto) texto.textContent = 'Leitor OFF';
  }
  mostrar(banner, false);
}

async function processarCartao(uid) {
  if (state.processandoCartao) {
    state.cartaoPendente = uid;
    return;
  }
  state.processandoCartao = true;

  try {
    const normalizado = normalizarUid(uid) || uid;
    const agora = Date.now();
    const ultimo = state.ultimoProcessamento.get(normalizado) || 0;
    if (agora - ultimo < 2500) return;
    state.ultimoProcessamento.set(normalizado, agora);

    let aluno = null;
    try {
      aluno = await Supabase.buscarAlunoPorUid(normalizado);
    } catch (erroConsulta) {
      // Sem internet, usa a base já carregada/cacheada neste dispositivo.
      const doCache = state.alunos.find((a) => normalizarUid(a.uid_nfc) === normalizado);
      if (!doCache) throw erroConsulta;
      aluno = doCache;
      toast('Nuvem indisponível. Exibindo dados da base local em cache.', 'err');
    }
    const momento = new Date();
    const evento = {
      id: gerarId(),
      uid_nfc: normalizado,
      aluno_id: aluno?.id || null,
      nome_identificado: aluno?.nome_completo || 'Não cadastrado',
      turma: aluno?.turma || null,
      foto_url: aluno?.foto_url || null,
      tipo_evento: 'ENTRADA',
      status: aluno ? (aluno.ativo ? 'LIBERADO' : 'BLOQUEADO') : 'NEGADO',
      data_hora: momento.toISOString()
    };

    if (aluno) {
      renderizarTotem(aluno, aluno.ativo);
      emitirBip(aluno.ativo ? 'ok' : 'erro');
      montarWhatsapp(aluno, momento);
    } else {
      renderizarTotemDesconhecido(normalizado);
      emitirBip('erro');
      montarWhatsapp(null);
    }

    registrarEventoHistorico(evento);
  } catch (erro) {
    console.error('[portaria] falha ao processar cartão', erro);
    toast(mensagemErro(erro), 'err');
  } finally {
    state.processandoCartao = false;
    if (state.cartaoPendente) {
      const proximo = state.cartaoPendente;
      state.cartaoPendente = null;
      setTimeout(() => processarCartao(proximo), 150);
    }
  }
}

function renderizarTotem(aluno, liberado) {
  const card = $('cardTotem');
  const badge = $('totemStatusBadge');
  const foto = $('totemFoto');
  if (!card || !badge || !foto) return;

  foto.src = aluno.foto_url || obterAvatarPadrao(aluno.nome_completo);
  foto.alt = `Foto de ${aluno.nome_completo}`;
  $('totemNome').textContent = aluno.nome_completo || '—';
  $('totemMatricula').textContent = aluno.matricula || '—';
  $('totemTurma').textContent = aluno.turma || '—';
  $('totemCurso').textContent = aluno.curso || '—';
  $('totemResponsavel').textContent = aluno.nome_responsavel || '—';
  card.className = `card-totem ${liberado ? 'liberado' : 'bloqueado'}`;
  badge.className = `tag-status-acesso ${liberado ? 'status-liberado' : 'status-negado'}`;
  badge.textContent = liberado ? 'ACESSO LIBERADO' : 'ACESSO BLOQUEADO';
}

function renderizarTotemDesconhecido(uid) {
  const card = $('cardTotem');
  const badge = $('totemStatusBadge');
  const foto = $('totemFoto');
  if (!card || !badge || !foto) return;
  foto.src = obterAvatarPadrao('?');
  foto.alt = 'Cartão não cadastrado';
  $('totemNome').textContent = 'Cartão Desconhecido';
  $('totemMatricula').textContent = '—';
  $('totemTurma').textContent = '—';
  $('totemCurso').textContent = '—';
  $('totemResponsavel').textContent = '—';
  card.className = 'card-totem bloqueado';
  badge.className = 'tag-status-acesso status-negado';
  badge.textContent = `NÃO CADASTRADO (${uid})`;
}

function resetarTotem() {
  const card = $('cardTotem');
  const badge = $('totemStatusBadge');
  if (!card || !badge) return;
  card.className = 'card-totem';
  badge.className = 'tag-status-acesso status-liberado';
  badge.textContent = 'AGUARDANDO CARTÃO';
  const foto = $('totemFoto');
  if (foto) foto.src = obterAvatarPadrao('?');
  ['totemNome', 'totemMatricula', 'totemTurma', 'totemCurso', 'totemResponsavel'].forEach((id, indice) => {
    const elemento = $(id);
    if (elemento) elemento.textContent = indice === 0 ? 'Aguardando Aproximação...' : '—';
  });
  montarWhatsapp(null);
}

function montarWhatsapp(aluno, data) {
  const botao = $('btnWhatsapp');
  if (!botao) return;
  if (!aluno?.telefone_responsavel) {
    botao.classList.add('hidden');
    botao.removeAttribute('href');
    return;
  }
  const numero = telefoneParaWhatsapp(aluno.telefone_responsavel);
  const hora = data ? data.toLocaleTimeString('pt-BR') : new Date().toLocaleTimeString('pt-BR');
  const mensagem = `Olá ${aluno.nome_responsavel || ''}! Informamos que ${aluno.nome_completo} passou na portaria da escola às ${hora}.`;
  botao.href = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
  botao.classList.remove('hidden');
}

function eventoEhHoje(evento) {
  if (!evento?.data_hora) return false;
  const data = new Date(evento.data_hora);
  if (Number.isNaN(data.getTime())) return false;
  return dataParaInput(data) === dataParaInput();
}

function atualizarKpis(evento = null) {
  const ativos = state.alunos.filter((a) => a.ativo).length;
  const bloqueados = state.alunos.length - ativos;
  if ($('kpiAlunosAtivos')) $('kpiAlunosAtivos').textContent = ativos;
  if ($('kpiBloqueados')) $('kpiBloqueados').textContent = bloqueados;

  if (evento && eventoEhHoje(evento)) {
    state.acessosHoje += 1;
    state.ultimoAcesso = evento;
  }
  if ($('kpiAcessosHoje')) $('kpiAcessosHoje').textContent = state.acessosHoje;
  if ($('kpiUltimoAcesso')) {
    $('kpiUltimoAcesso').textContent = state.ultimoAcesso ? formatarHora(state.ultimoAcesso.data_hora) : '—';
  }
}

function adicionarNaListaRecentes(evento) {
  const lista = $('listaRecentes');
  if (!lista) return;
  if (state.eventosVistos.has(evento.id)) return;
  state.eventosVistos.add(evento.id);
  const item = montarItemRecente(evento);
  lista.prepend(item);
  while (lista.children.length > 50) lista.lastElementChild.remove();
  if ($('contadorRecentes')) $('contadorRecentes').textContent = `(${lista.children.length})`;
}

function montarItemRecente(evento) {
  const li = document.createElement('li');
  li.className = 'recente-item';
  const foto = avatarImg(evento.nome_identificado, evento.foto_url, 'recente-thumb');
  const info = document.createElement('div');
  info.className = 'recente-info';
  const nome = document.createElement('div');
  nome.className = 'recente-nome';
  nome.textContent = evento.nome_identificado || 'Não cadastrado';
  const turma = document.createElement('div');
  turma.className = 'recente-turma';
  turma.textContent = evento.turma || evento.uid_nfc || '';
  info.append(nome, turma);
  const direita = document.createElement('div');
  direita.className = 'recente-direita';
  const hora = document.createElement('div');
  hora.className = 'recente-hora';
  hora.textContent = formatarHora(evento.data_hora);
  const status = document.createElement('span');
  status.className = `status-pill ${evento.status === 'LIBERADO' ? 'ativo' : 'bloqueado'}`;
  status.textContent = evento.status || '—';
  direita.append(hora, status);
  li.append(foto, info, direita);
  return li;
}

async function carregarRecentesHoje() {
  if (!state.usuario) return;
  const lista = $('listaRecentes');
  if (lista && lista.children.length === 0) {
    lista.innerHTML = '<li class="recente-item vazio">Carregando acessos de hoje...</li>';
  }
  try {
    const { rows, total } = await Supabase.listarHistorico({
      inicio: inicioDoDiaISO(),
      fim: fimDoDiaISO(),
      page: 0,
      pageSize: 20
    });
    state.recentes = rows;
    state.acessosHoje = total;
    state.ultimoAcesso = rows[0] || null;
    state.eventosVistos.clear();
    if (lista) {
      lista.innerHTML = '';
      if (rows.length === 0) {
        lista.innerHTML = '<li class="recente-item vazio">Nenhum acesso registrado hoje.</li>';
      } else {
        rows.forEach((evento) => {
          state.eventosVistos.add(evento.id);
          lista.appendChild(montarItemRecente(evento));
        });
      }
      if ($('contadorRecentes')) $('contadorRecentes').textContent = `(${total})`;
    }
    atualizarKpis();
  } catch (erro) {
    console.error('[portaria] falha ao carregar acessos', erro);
    toast(mensagemErro(erro), 'err');
  }
}

function aoNovoEventoHistorico(evento) {
  if (!evento?.id || state.eventosVistos.has(evento.id)) return;
  if (!eventoEhHoje(evento)) return;
  state.eventosVistos.add(evento.id);
  state.acessosHoje += 1;
  state.ultimoAcesso = evento;
  const lista = $('listaRecentes');
  if (lista) {
    const vazio = lista.querySelector('.vazio');
    if (vazio) vazio.remove();
    lista.prepend(montarItemRecente(evento));
    while (lista.children.length > 50) lista.lastElementChild.remove();
    if ($('contadorRecentes')) $('contadorRecentes').textContent = `(${state.acessosHoje})`;
  }
  atualizarKpis();
  if (state.abaAtual === 'historico') {
    clearTimeout(state._timerHistorico);
    state._timerHistorico = setTimeout(() => carregarHistorico(state.historico.page), 800);
  }
  if (state.eventosVistos.size > 800) {
    state.eventosVistos = new Set(Array.from(state.eventosVistos).slice(-400));
  }
}

// =====================================================================
// Fila local de histórico (resiliência a queda de internet)
// =====================================================================

const CHAVE_FILA = 'fila_historico_v1';
const CHAVE_CACHE_ALUNOS = 'cache_alunos_v1';

function carregarFilaHistorico() {
  try {
    const bruto = JSON.parse(lerStorage(CHAVE_FILA, '[]'));
    if (!Array.isArray(bruto)) return [];
    // A fila guarda apenas acessos de alunos identificados. Eventos antigos de
    // cartão desconhecido (aluno_id ausente/nulo) não devem ocupar a fila.
    const filtrados = bruto
      .filter((evento) => evento && evento.aluno_id)
      .slice(-200);
    if (filtrados.length !== bruto.length) {
      salvarStorage(CHAVE_FILA, JSON.stringify(filtrados));
    }
    return filtrados;
  } catch (_) {
    return [];
  }
}

function persistirFilaHistorico() {
  salvarStorage(CHAVE_FILA, JSON.stringify(state.filaHistorico.slice(-200)));
  atualizarIndicadorFila();
}

function atualizarIndicadorFila() {
  const pendentes = state.filaHistorico.length;
  const badge = $('filaPendente');
  if (!badge) return;
  badge.textContent = pendentes ? `⏳ ${pendentes} acesso(s) na fila` : '';
  badge.classList.toggle('hidden', pendentes === 0);
}

function registrarEventoHistorico(evento) {
  if (!state.eventosVistos.has(evento.id)) {
    adicionarNaListaRecentes(evento);
    atualizarKpis(evento);
  }
  Supabase.inserirHistorico(evento).catch((erro) => {
    // Tentativas de cartão não cadastrado não são acessos de aluno e não
    // devem ocupar a fila de sincronização (qualquer tag NFC as geraria).
    if (!evento.aluno_id) {
      console.warn('[historico] tentativa de cartão não cadastrado não será enfileirada', erro);
      return;
    }
    console.warn('[historico] salvando na fila local', erro);
    state.filaHistorico.push(evento);
    persistirFilaHistorico();
    toast('Sem conexão com a nuvem. O acesso foi guardado e será enviado depois.', 'err');
  });
}

async function sincronizarFilaHistorico() {
  if (!state.usuario || state.filaHistorico.length === 0) return;
  const pendentes = [...state.filaHistorico];
  const restantes = [];
  for (const evento of pendentes) {
    if (!evento.aluno_id) {
      // Eventos antigos de cartão desconhecido: tenta enviar uma vez, mas não
      // mantém para sempre na fila.
      try { await Supabase.inserirHistorico(evento); } catch (_) { /* descarta */ }
      continue;
    }
    try {
      await Supabase.inserirHistorico(evento);
    } catch (_) {
      restantes.push(evento);
    }
  }
  state.filaHistorico = restantes;
  persistirFilaHistorico();
  if (pendentes.length !== restantes.length) {
    toast(`${pendentes.length - restantes.length} acesso(s) pendente(s) sincronizado(s).`, 'ok');
  }
}

// =====================================================================
// Totem: tela cheia, som e relógio
// =====================================================================

async function alternarTelaCheia() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (erro) {
    toast('O navegador não permitiu tela cheia: ' + mensagemErro(erro), 'err');
  }
}

function aoMudarTelaCheia() {
  const ativo = Boolean(document.fullscreenElement);
  state.modoTotem = ativo;
  document.body.classList.toggle('modo-totem', ativo);
  mostrar($('btnSairTotem'), ativo);
  if (ativo) ativarWakeLock();
  else liberarWakeLock();
}

async function ativarWakeLock() {
  try {
    if ('wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    }
  } catch (_) { /* sem suporte */ }
}

function liberarWakeLock() {
  try { state.wakeLock?.release(); } catch (_) { /* ignora */ }
  state.wakeLock = null;
}

function pararTotem() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  state.modoTotem = false;
  document.body.classList.remove('modo-totem');
  mostrar($('btnSairTotem'), false);
  liberarWakeLock();
}

function ativarSom() {
  state.somAtivo = !state.somAtivo;
  if (state.somAtivo) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!state.audioCtx) state.audioCtx = new AudioCtx();
        state.audioCtx.resume();
      }
      toast('Som de confirmação ativado.', 'ok');
    } catch (_) {
      toast('Não foi possível ativar o som neste navegador.', 'err');
    }
  } else {
    toast('Som de confirmação desativado.', '');
  }
  const botao = $('btnAtivarSom');
  if (botao) botao.textContent = state.somAtivo ? '🔊 Som ativo' : '🔇 Ativar som';
  botao?.classList.toggle('ativo', state.somAtivo);
}

function emitirBip(tipo = 'ok') {
  if (!state.somAtivo) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!state.audioCtx) state.audioCtx = new AudioCtx();
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (tipo === 'ok') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (_) { /* áudio bloqueado */ }
}

function atualizarRelogio() {
  const agora = new Date();
  const texto = agora.toLocaleTimeString('pt-BR');
  const data = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  if ($('relogioTotem')) $('relogioTotem').textContent = texto;
  if ($('dataTotem')) $('dataTotem').textContent = data;
}

// =====================================================================
// Secretaria: alunos
// =====================================================================

async function carregarAlunos() {
  if (!state.usuario || state.carregandoAlunos) return;
  state.carregandoAlunos = true;
  const corpo = $('corpoTabelaAlunos');
  if (corpo) corpo.innerHTML = '<tr><td colspan="5" class="celula-vazia">Carregando alunos...</td></tr>';
  try {
    state.alunos = await Supabase.listarAlunos();
    try {
      salvarStorage(CHAVE_CACHE_ALUNOS, JSON.stringify(state.alunos));
    } catch (_) { /* cache local é opcional */ }
    renderizarTabelaAlunos();
    atualizarKpis();
  } catch (erro) {
    console.error('[alunos]', erro);
    // Sem internet, a portaria ainda consegue identificar cartões já vistos
    // nesta máquina usando a última base carregada.
    let cache = null;
    try {
      const bruto = lerStorage(CHAVE_CACHE_ALUNOS, '');
      if (bruto) cache = JSON.parse(bruto);
    } catch (_) { cache = null; }

    if (Array.isArray(cache) && cache.length > 0) {
      state.alunos = cache;
      renderizarTabelaAlunos();
      atualizarKpis();
      toast('Nuvem indisponível. Usando a última base de alunos salva neste dispositivo.', 'err');
      return;
    }

    toast(mensagemErro(erro), 'err');
    if (corpo) corpo.innerHTML = `<tr><td colspan="5" class="celula-vazia">Falha ao carregar alunos: ${escapeHtml(mensagemErro(erro))}</td></tr>`;
  } finally {
    state.carregandoAlunos = false;
  }
}

function alunosFiltrados() {
  const busca = normalizarTexto(state.alunosFiltro.busca);
  const status = state.alunosFiltro.status;
  return state.alunos.filter((aluno) => {
    if (status === 'ativo' && !aluno.ativo) return false;
    if (status === 'bloqueado' && aluno.ativo) return false;
    if (!busca) return true;
    return [
      aluno.nome_completo, aluno.matricula, aluno.turma, aluno.curso,
      aluno.nome_responsavel, aluno.telefone_responsavel, aluno.uid_nfc
    ].some((valor) => normalizarTexto(valor).includes(busca));
  });
}

function renderizarTabelaAlunos() {
  const corpo = $('corpoTabelaAlunos');
  if (!corpo) return;
  const lista = alunosFiltrados();
  const total = state.alunos.length;
  if ($('contagemAlunos')) {
    $('contagemAlunos').textContent = lista.length === total ? String(total) : `${lista.length} de ${total}`;
  }
  corpo.innerHTML = '';

  if (lista.length === 0) {
    const tr = document.createElement('tr');
    const celula = document.createElement('td');
    celula.colSpan = 5;
    celula.className = 'celula-vazia';
    celula.textContent = state.alunos.length === 0
      ? 'Nenhum aluno cadastrado. Comece cadastrando o primeiro aluno.'
      : 'Nenhum aluno encontrado com os filtros atuais.';
    tr.appendChild(celula);
    corpo.appendChild(tr);
    return;
  }

  lista.forEach((aluno) => {
    const tr = document.createElement('tr');

    const tdAluno = document.createElement('td');
    tdAluno.dataset.label = 'Aluno';
    tdAluno.className = 'aluno-col-info';
    const info = document.createElement('div');
    info.innerHTML = `<strong>${escapeHtml(aluno.nome_completo)}</strong><br><small class="texto-suave">Matrícula: ${escapeHtml(aluno.matricula || '—')}</small>`;
    tdAluno.append(avatarImg(aluno.nome_completo, aluno.foto_url), info);

    const tdTurma = tdHtml(`<strong>${escapeHtml(aluno.turma || '—')}</strong><br><small class="texto-suave">${escapeHtml(aluno.curso || '—')}</small>`, 'Turma / Curso');

    const telefone = aluno.telefone_responsavel ? telefoneParaWhatsapp(aluno.telefone_responsavel) : '';
    const tdResp = tdHtml(
      `<div>${escapeHtml(aluno.nome_responsavel || '—')}</div><small>${telefone
        ? `<a class="link-whatsapp" href="https://wa.me/${telefone}" target="_blank" rel="noopener">📱 ${escapeHtml(formatarTelefone(aluno.telefone_responsavel))}</a>`
        : '—'}</small>`,
      'Responsável'
    );

    const tdUid = tdHtml(`<span class="uid-chip">${escapeHtml(aluno.uid_nfc)}</span>`, 'Cartão NFC');

    const tdAcoes = document.createElement('td');
    tdAcoes.dataset.label = 'Ações';
    tdAcoes.className = 'celula-acoes';
    if (state.perfil.editarAlunos) {
      tdAcoes.appendChild(criarBotao(aluno.ativo ? 'Bloquear' : 'Liberar', 'btn-secundario btn-mini', () => alternarAtivoAluno(aluno), 'Alterar permissão de acesso'));
      tdAcoes.appendChild(criarBotao('Editar', 'btn-secundario btn-mini', () => iniciarEdicaoAluno(aluno), 'Editar cadastro'));
    }
    if (state.perfil.excluirAlunos) {
      tdAcoes.appendChild(criarBotao('Excluir', 'btn-secundario btn-mini btn-perigo', () => excluirAluno(aluno), 'Excluir aluno'));
    }
    if (state.perfil.verHistorico) {
      tdAcoes.appendChild(criarBotao('Histórico', 'btn-secundario btn-mini', () => abrirHistoricoAluno(aluno), 'Ver histórico do aluno'));
    }

    tr.append(tdAluno, tdTurma, tdResp, tdUid, tdAcoes);
    corpo.appendChild(tr);
  });
}

function aoFiltrarAlunos() {
  state.alunosFiltro.busca = $('buscaAlunos')?.value || '';
  state.alunosFiltro.status = $('filtroStatusAluno')?.value || '';
  renderizarTabelaAlunos();
}

function iniciarEdicaoAluno(aluno) {
  state.alunoEditandoId = aluno.id;
  state.alunoOriginal = aluno;
  state.fotoBlob = null;
  state.fotoPathOriginal = aluno.foto_path || null;
  state.removerFoto = false;

  $('campoNome').value = aluno.nome_completo || '';
  $('campoMatricula').value = aluno.matricula || '';
  $('campoTurma').value = aluno.turma || '';
  $('campoCurso').value = aluno.curso || '';
  $('campoResponsavel').value = aluno.nome_responsavel || '';
  $('campoTelefone').value = aluno.telefone_responsavel ? formatarTelefone(aluno.telefone_responsavel) : '';
  $('campoUid').value = aluno.uid_nfc || '';
  $('campoAtivo').checked = Boolean(aluno.ativo);
  if ($('previewFotoForm')) $('previewFotoForm').src = aluno.foto_url || obterAvatarPadrao(aluno.nome_completo);
  if ($('fotoInfo')) $('fotoInfo').textContent = aluno.foto_url ? 'Foto atual. Escolha outra para substituir.' : 'Nenhuma foto cadastrada.';

  $('tituloFormAluno').textContent = `✏️ Editando: ${aluno.nome_completo}`;
  $('btnSalvarAluno').textContent = 'Atualizar Aluno';
  mostrar($('btnCancelarEdicao'), true);
  limparErroFormularioAluno();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limparFormularioAluno() {
  state.alunoEditandoId = null;
  state.alunoOriginal = null;
  state.fotoBlob = null;
  state.fotoPathOriginal = null;
  state.removerFoto = false;
  $('formAluno')?.reset();
  if ($('campoAtivo')) $('campoAtivo').checked = true;
  if ($('previewFotoForm')) $('previewFotoForm').src = obterAvatarPadrao('Novo');
  if ($('fotoInfo')) $('fotoInfo').textContent = 'A foto é opcional. JPG/PNG até 10 MB; será reduzida automaticamente.';
  if ($('tituloFormAluno')) $('tituloFormAluno').textContent = '➕ Cadastrar Aluno';
  if ($('btnSalvarAluno')) $('btnSalvarAluno').textContent = 'Salvar Aluno';
  mostrar($('btnCancelarEdicao'), false);
  limparErroFormularioAluno();
}

function validarFormularioAluno() {
  const nome = $('campoNome')?.value.trim() || '';
  const turma = $('campoTurma')?.value.trim() || '';
  const uid = normalizarUid($('campoUid')?.value || '');

  if (nome.length < 3) return 'Informe o nome completo do aluno (mínimo 3 caracteres).';
  if (!turma) return 'Informe a turma do aluno.';
  if (!uid) return 'Cartão NFC inválido. Use o formato hexadecimal, por exemplo 2C:9D:7E:8E.';

  const duplicadoUid = state.alunos.find((a) => a.id !== state.alunoEditandoId && normalizarUid(a.uid_nfc) === uid);
  if (duplicadoUid) return `Este cartão já está cadastrado para ${duplicadoUid.nome_completo}.`;

  const matricula = $('campoMatricula')?.value.trim() || '';
  if (matricula) {
    const duplicada = state.alunos.find((a) => a.id !== state.alunoEditandoId && (a.matricula || '').toLowerCase() === matricula.toLowerCase());
    if (duplicada) return `Esta matrícula já está cadastrada para ${duplicada.nome_completo}.`;
  }
  return '';
}

async function salvarAluno(evento) {
  evento.preventDefault();
  limparErroFormularioAluno();
  if (!state.perfil?.editarAlunos) {
    toast('Seu perfil não pode cadastrar ou editar alunos.', 'err');
    return;
  }

  const erroValidacao = validarFormularioAluno();
  if (erroValidacao) {
    definirErroFormularioAluno(erroValidacao);
    toast(erroValidacao, 'err');
    return;
  }

  const botao = $('btnSalvarAluno');
  botaoCarregando(botao, true, 'Salvando...');

  const uid = normalizarUid($('campoUid').value);
  let novoUpload = null;

  try {
    if (state.fotoBlob) {
      botaoCarregando(botao, true, 'Enviando foto...');
      novoUpload = await Supabase.uploadFotoAluno(uid, state.fotoBlob);
    }

    const alunoOriginal = state.alunoOriginal;
    let fotoUrl = state.removerFoto ? null : (alunoOriginal?.foto_url || null);
    let fotoPath = state.removerFoto ? null : (alunoOriginal?.foto_path || null);
    if (novoUpload) {
      fotoUrl = novoUpload.url;
      fotoPath = novoUpload.path;
    }

    const payload = {
      uid_nfc: uid,
      nome_completo: $('campoNome').value.trim(),
      matricula: $('campoMatricula').value.trim() || null,
      turma: $('campoTurma').value.trim(),
      curso: $('campoCurso').value.trim() || null,
      nome_responsavel: $('campoResponsavel').value.trim() || null,
      telefone_responsavel: normalizarTelefone($('campoTelefone').value) || null,
      foto_url: fotoUrl,
      foto_path: fotoPath,
      ativo: Boolean($('campoAtivo').checked)
    };

    botaoCarregando(botao, true, 'Salvando no banco...');
    await Supabase.salvarAluno(payload, state.alunoEditandoId);

    if (novoUpload && alunoOriginal?.foto_path && alunoOriginal.foto_path !== novoUpload.path) {
      await Supabase.removerFotoAluno(alunoOriginal.foto_path);
    }
    if (!novoUpload && (state.removerFoto || (alunoOriginal?.foto_path && alunoOriginal.foto_path !== fotoPath))) {
      await Supabase.removerFotoAluno(alunoOriginal?.foto_path);
    }

    if (!Esp32.espEmHttpsBloqueado()) {
      Esp32.sincronizarAluno(uid, payload.nome_completo, payload.ativo).catch((erro) => {
        console.warn('[esp32] não sincronizou aluno', erro);
        toast('Aluno salvo na nuvem, mas o ESP32 não confirmou a sincronização.', 'err');
      });
    }
    if (!Esp32.espEmHttpsBloqueado() && alunoOriginal?.uid_nfc && normalizarUid(alunoOriginal.uid_nfc) !== uid) {
      Esp32.removerAluno(normalizarUid(alunoOriginal.uid_nfc)).catch(() => {});
    }

    toast(state.alunoEditandoId ? 'Aluno atualizado com sucesso.' : 'Aluno cadastrado com sucesso.', 'ok');
    limparFormularioAluno();
    await carregarAlunos();
  } catch (erro) {
    console.error('[alunos] falha ao salvar', erro);
    if (novoUpload) await Supabase.removerFotoAluno(novoUpload.path);
    const mensagem = mensagemErro(erro);
    definirErroFormularioAluno(mensagem);
    toast(mensagem, 'err');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function alternarAtivoAluno(aluno) {
  const novoStatus = !aluno.ativo;
  if (!novoStatus) {
    const confirmado = await confirmar({
      titulo: 'Bloquear acesso',
      mensagem: `Bloquear a entrada de ${aluno.nome_completo}? O cartão continuará cadastrado, mas o acesso será negado.`,
      textoOk: 'Bloquear',
      perigo: true
    });
    if (!confirmado) return;
  }
  try {
    await Supabase.alterarAtivoAluno(aluno.id, novoStatus);
    aluno.ativo = novoStatus;
    if (!Esp32.espEmHttpsBloqueado()) {
      Esp32.sincronizarAluno(normalizarUid(aluno.uid_nfc) || aluno.uid_nfc, aluno.nome_completo, novoStatus).catch(() => {
        toast('Status salvo na nuvem; o ESP32 não confirmou a atualização.', 'err');
      });
    }
    toast(novoStatus ? 'Aluno liberado.' : 'Aluno bloqueado.', 'ok');
    renderizarTabelaAlunos();
    atualizarKpis();
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
}

async function excluirAluno(aluno) {
  const confirmado = await confirmar({
    titulo: 'Excluir aluno',
    mensagem: `Excluir permanentemente o cadastro de ${aluno.nome_completo}? O histórico de acessos será mantido, mas o cartão será removido do leitor.`,
    textoOk: 'Excluir',
    perigo: true
  });
  if (!confirmado) return;

  try {
    await Supabase.excluirAluno(aluno.id);
    if (aluno.foto_path) await Supabase.removerFotoAluno(aluno.foto_path);
    if (!Esp32.espEmHttpsBloqueado()) Esp32.removerAluno(normalizarUid(aluno.uid_nfc) || aluno.uid_nfc).catch(() => {});
    toast('Aluno excluído da nuvem e do leitor.', 'ok');
    await carregarAlunos();
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
}

// =====================================================================
// Fotos
// =====================================================================

function redimensionarEComprimirImagem(img) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = $('canvasCompressor') || document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const maxDim = 500;
      const largura = img.width || img.naturalWidth;
      const altura = img.height || img.naturalHeight;
      const tamanho = Math.min(largura, altura);
      const srcX = (largura - tamanho) / 2;
      const srcY = (altura - tamanho) / 2;
      canvas.width = maxDim;
      canvas.height = maxDim;
      ctx.drawImage(img, srcX, srcY, tamanho, tamanho, 0, 0, maxDim, maxDim);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Não foi possível comprimir a foto.'));
      }, 'image/jpeg', 0.85);
    } catch (erro) {
      reject(erro);
    }
  });
}

function processarArquivoFoto(evento) {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!arquivo) return;
  if (!arquivo.type.startsWith('image/')) {
    toast('Escolha um arquivo de imagem (JPG ou PNG).', 'err');
    return;
  }
  if (arquivo.size > 10 * 1024 * 1024) {
    toast('A imagem é maior que 10 MB. Escolha uma foto menor.', 'err');
    return;
  }

  const leitor = new FileReader();
  leitor.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      try {
        state.fotoBlob = await redimensionarEComprimirImagem(img);
        state.removerFoto = false;
        const url = URL.createObjectURL(state.fotoBlob);
        if ($('previewFotoForm')) $('previewFotoForm').src = url;
        if ($('fotoInfo')) $('fotoInfo').textContent = `Foto pronta para envio (${formatarTamanho(state.fotoBlob.size)}).`;
        toast(`Foto otimizada para ${formatarTamanho(state.fotoBlob.size)}.`, 'ok');
      } catch (erro) {
        toast(mensagemErro(erro), 'err');
      }
    };
    img.onerror = () => toast('Não foi possível ler esta imagem.', 'err');
    img.src = e.target.result;
  };
  leitor.onerror = () => toast('Não foi possível abrir o arquivo.', 'err');
  leitor.readAsDataURL(arquivo);
}

async function abrirCamera() {
  const video = $('videoWebcam');
  if (!video) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Este navegador não oferece acesso à câmera. Use o upload de arquivo.', 'err');
    return;
  }
  abrirModal('modalCamera');
  try {
    state.streamWebcam = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' }
    });
    video.srcObject = state.streamWebcam;
  } catch (erro) {
    toast('Não foi possível acessar a câmera: ' + mensagemErro(erro), 'err');
    fecharModal('modalCamera');
  }
}

function fecharCamera() {
  if (state.streamWebcam) {
    state.streamWebcam.getTracks().forEach((track) => track.stop());
    state.streamWebcam = null;
  }
  const video = $('videoWebcam');
  if (video) video.srcObject = null;
}

async function capturarFotoWebcam() {
  const video = $('videoWebcam');
  if (!video || !video.videoWidth) {
    toast('A câmera ainda está iniciando. Tente novamente.', 'err');
    return;
  }
  const canvas = $('canvasCompressor') || document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg');
  const img = new Image();
  img.onload = async () => {
    try {
      state.fotoBlob = await redimensionarEComprimirImagem(img);
      state.removerFoto = false;
      if ($('previewFotoForm')) $('previewFotoForm').src = URL.createObjectURL(state.fotoBlob);
      if ($('fotoInfo')) $('fotoInfo').textContent = `Foto capturada (${formatarTamanho(state.fotoBlob.size)}).`;
      fecharModal('modalCamera');
      toast('Foto capturada e otimizada.', 'ok');
    } catch (erro) {
      toast(mensagemErro(erro), 'err');
    }
  };
  img.src = dataUrl;
}

function removerFotoSelecionada() {
  state.fotoBlob = null;
  state.removerFoto = true;
  if ($('previewFotoForm')) $('previewFotoForm').src = obterAvatarPadrao('?');
  if ($('fotoInfo')) $('fotoInfo').textContent = 'A foto será removida ao salvar.';
}

// =====================================================================
// Captura de UID pelo leitor
// =====================================================================

function abrirCapturaUid() {
  if (Esp32.espEmHttpsBloqueado()) {
    toast('Para ler o cartão, abra o site pelo modo local (http://localhost:5500).', 'err');
    abrirModalEsp();
    return;
  }
  state.nfcAbort = new AbortController();
  if ($('nfcStatus')) $('nfcStatus').textContent = 'Aproxime o cartão do leitor...';
  if ($('nfcUid')) $('nfcUid').textContent = '—';
  abrirModal('modalNfc');
  Esp32.capturarProximoUid({
    signal: state.nfcAbort.signal,
    onProgress: (segundos) => {
      if ($('nfcStatus')) $('nfcStatus').textContent = `Aguardando cartão... (${segundos}s)`;
    }
  })
    .then((uid) => {
      if ($('campoUid')) $('campoUid').value = normalizarUid(uid) || uid;
      if ($('nfcUid')) $('nfcUid').textContent = uid;
      if ($('nfcStatus')) $('nfcStatus').textContent = 'Cartão capturado!';
      toast('Cartão capturado: ' + uid, 'ok');
      setTimeout(() => fecharModal('modalNfc'), 800);
    })
    .catch((erro) => {
      if ($('nfcStatus')) $('nfcStatus').textContent = mensagemErro(erro);
      toast(mensagemErro(erro), 'err');
    })
    .finally(() => { state.nfcAbort = null; });
}

function cancelarCapturaUid() {
  if (state.nfcAbort) {
    state.nfcAbort.abort();
    state.nfcAbort = null;
  }
}

// =====================================================================
// Importação / exportação CSV
// =====================================================================

function baixarModeloCsv() {
  const cabecalho = ['nome_completo', 'matricula', 'turma', 'curso', 'nome_responsavel', 'telefone_responsavel', 'uid_nfc', 'ativo'];
  const exemplo = ['Maria Clara Souza', '20241002', 'Informática 2', 'Técnico em Informática', 'Carlos Roberto Souza', '84998765432', '2C:9D:7E:8E', 'sim'];
  baixarArquivo('modelo_alunos.csv', paraCsv(cabecalho, [exemplo]));
}

function exportarAlunosCsv() {
  if (state.alunos.length === 0) {
    toast('Nenhum aluno cadastrado para exportar.', 'err');
    return;
  }
  const cabecalho = ['nome_completo', 'matricula', 'turma', 'curso', 'nome_responsavel', 'telefone_responsavel', 'uid_nfc', 'ativo', 'foto_url'];
  const linhas = state.alunos.map((a) => [
    a.nome_completo, a.matricula || '', a.turma, a.curso || '', a.nome_responsavel || '',
    a.telefone_responsavel || '', a.uid_nfc, a.ativo ? 'sim' : 'nao', a.foto_url || ''
  ]);
  baixarArquivo(`alunos_${dataParaInput()}.csv`, paraCsv(cabecalho, linhas));
  toast('Arquivo CSV exportado.', 'ok');
}

function aoSelecionarArquivoCsv(evento) {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!arquivo) return;
  if (arquivo.size > 5 * 1024 * 1024) {
    toast('O CSV é maior que 5 MB.', 'err');
    return;
  }

  const leitor = new FileReader();
  leitor.onload = (e) => prepararImportacao(String(e.target.result || ''));
  leitor.onerror = () => toast('Não foi possível ler o CSV.', 'err');
  leitor.readAsText(arquivo, 'utf-8');
}

function prepararImportacao(texto) {
  try {
    const { headers, rows } = parseCsv(texto);
    if (!headers.length || !rows.length) throw new Error('O CSV está vazio ou não tem cabeçalho.');
    const mapa = mapearCabecalhoCsv(headers);
    if (!mapa.nome_completo || !mapa.turma || !mapa.uid_nfc) {
      throw new Error('O CSV precisa ter as colunas nome_completo, turma e uid_nfc (ou seus apelidos: nome, turma, uid).');
    }

    const existentesUid = new Map(state.alunos.map((a) => [normalizarUid(a.uid_nfc), a]));
    const existentesMatricula = new Map(state.alunos.filter((a) => a.matricula).map((a) => [String(a.matricula).toLowerCase(), a]));
    const vistosUid = new Set();
    const vistosMatricula = new Set();
    const validas = [];
    const erros = [];

    rows.forEach((row, indice) => {
      const numero = indice + 2;
      const nome = valorDoCsv(row, mapa, 'nome_completo');
      const turma = valorDoCsv(row, mapa, 'turma');
      const uid = normalizarUid(valorDoCsv(row, mapa, 'uid_nfc'));
      const matricula = valorDoCsv(row, mapa, 'matricula');
      const errosLinha = [];

      if (nome.length < 3) errosLinha.push('nome inválido');
      if (!turma) errosLinha.push('turma vazia');
      if (!uid) errosLinha.push('UID inválido');
      if (uid && vistosUid.has(uid)) errosLinha.push('UID repetido no arquivo');
      if (uid && existentesUid.has(uid)) errosLinha.push(`UID já cadastrado (${existentesUid.get(uid).nome_completo})`);
      if (matricula && vistosMatricula.has(matricula.toLowerCase())) errosLinha.push('matrícula repetida no arquivo');
      if (matricula && existentesMatricula.has(matricula.toLowerCase())) errosLinha.push(`matrícula já cadastrada (${existentesMatricula.get(matricula.toLowerCase()).nome_completo})`);

      if (errosLinha.length) {
        erros.push({ linha: numero, nome: nome || '(sem nome)', motivo: errosLinha.join('; ') });
        return;
      }

      vistosUid.add(uid);
      if (matricula) vistosMatricula.add(matricula.toLowerCase());
      validas.push({
        uid_nfc: uid,
        nome_completo: nome,
        matricula: matricula || null,
        turma,
        curso: valorDoCsv(row, mapa, 'curso') || null,
        nome_responsavel: valorDoCsv(row, mapa, 'nome_responsavel') || null,
        telefone_responsavel: normalizarTelefone(valorDoCsv(row, mapa, 'telefone_responsavel')) || null,
        foto_url: null,
        foto_path: null,
        ativo: boolDoCsv(valorDoCsv(row, mapa, 'ativo'), true)
      });
    });

    state.importPreview = { validas, erros, total: rows.length };
    renderizarPreviaImportacao();
    abrirModal('modalImport');
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
}

function renderizarPreviaImportacao() {
  const preview = state.importPreview;
  if (!preview) return;
  if ($('importResumo')) {
    $('importResumo').innerHTML = `<strong>${preview.validas.length}</strong> linha(s) prontas para importar de <strong>${preview.total}</strong> lida(s).` +
      (preview.erros.length ? ` <span class="texto-perigo">${preview.erros.length} com erro (serão ignoradas).</span>` : '');
  }
  const corpo = $('importTabela');
  if (corpo) {
    corpo.innerHTML = '';
    preview.validas.slice(0, 20).forEach((linha) => {
      const tr = document.createElement('tr');
      tr.append(td(linha.nome_completo), td(linha.matricula || '—'), td(linha.turma), td(linha.uid_nfc));
      corpo.appendChild(tr);
    });
    if (preview.validas.length === 0) {
      corpo.innerHTML = '<tr><td colspan="4" class="celula-vazia">Nenhuma linha válida para importar.</td></tr>';
    }
  }
  const erros = $('importErros');
  if (erros) {
    erros.innerHTML = '';
    if (preview.erros.length) {
      const titulo = document.createElement('p');
      titulo.className = 'texto-perigo';
      titulo.textContent = 'Linhas com erro:';
      erros.appendChild(titulo);
      const lista = document.createElement('ul');
      preview.erros.slice(0, 30).forEach((erro) => {
        const li = document.createElement('li');
        li.textContent = `Linha ${erro.linha}: ${erro.nome} — ${erro.motivo}`;
        lista.appendChild(li);
      });
      erros.appendChild(lista);
    }
  }
  const botao = $('btnConfirmarImport');
  if (botao) botao.disabled = preview.validas.length === 0;
}

async function confirmarImportacao() {
  const preview = state.importPreview;
  if (!preview?.validas?.length) return;
  const botao = $('btnConfirmarImport');
  botaoCarregando(botao, true, 'Importando...');
  let inseridos = 0;
  const falhas = [];

  try {
    const tamanhoLote = 50;
    for (let i = 0; i < preview.validas.length; i += tamanhoLote) {
      const lote = preview.validas.slice(i, i + tamanhoLote);
      try {
        await Supabase.inserirAlunos(lote);
        inseridos += lote.length;
      } catch (erroLote) {
        for (const linha of lote) {
          try {
            await Supabase.inserirAlunos([linha]);
            inseridos += 1;
          } catch (erroLinha) {
            falhas.push(`${linha.nome_completo}: ${mensagemErro(erroLinha)}`);
          }
        }
      }
      if ($('importResumo')) $('importResumo').textContent = `Importando... ${inseridos}/${preview.validas.length}`;
    }

    fecharModal('modalImport');
    state.importPreview = null;
    await carregarAlunos();
    if (falhas.length) {
      toast(`${inseridos} aluno(s) importado(s); ${falhas.length} falhou(aram).`, 'err');
      console.warn('[importação] falhas', falhas);
    } else {
      toast(`${inseridos} aluno(s) importado(s) com sucesso.`, 'ok');
    }
    if (!Esp32.espEmHttpsBloqueado()) Esp32.sincronizarTodos(state.alunos).catch(() => {});
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  } finally {
    botaoCarregando(botao, false);
  }
}

// =====================================================================
// Histórico e relatórios
// =====================================================================

function lerFiltrosHistorico() {
  return {
    inicio: inicioDoDiaDeInput($('histDataInicio')?.value) || inicioDoDiaISO(),
    fim: fimDoDiaDeInput($('histDataFim')?.value) || fimDoDiaISO(),
    busca: $('histBusca')?.value.trim() || '',
    status: $('histStatus')?.value || ''
  };
}

async function carregarHistorico(page = 0, { silencioso = false } = {}) {
  if (!state.perfil?.verHistorico) return;
  if (state.carregandoHistorico && silencioso) return;
  const requisicao = ++state.historicoReq;
  state.carregandoHistorico = true;
  const hoje = dataParaInput();
  if ($('histDataInicio') && !$('histDataInicio').value) $('histDataInicio').value = hoje;
  if ($('histDataFim') && !$('histDataFim').value) $('histDataFim').value = hoje;
  const filtros = lerFiltrosHistorico();
  state.historico.filtros = filtros;
  state.historico.page = Math.max(0, page);
  const corpo = $('corpoTabelaHistorico');
  if (corpo && !silencioso) corpo.innerHTML = '<tr><td colspan="6" class="celula-vazia">Carregando histórico...</td></tr>';

  try {
    const { rows, total } = await Supabase.listarHistorico({
      ...filtros,
      page: state.historico.page,
      pageSize: state.historico.pageSize
    });
    if (requisicao !== state.historicoReq) return;
    state.historico.rows = rows;
    state.historico.total = total;
    state.historicoAtualizadoEm = new Date();
    renderizarHistorico();
  } catch (erro) {
    console.error('[histórico]', erro);
    if (requisicao === state.historicoReq && !silencioso) {
      toast(mensagemErro(erro), 'err');
      if (corpo) corpo.innerHTML = `<tr><td colspan="6" class="celula-vazia">Falha ao carregar: ${escapeHtml(mensagemErro(erro))}</td></tr>`;
    }
  } finally {
    if (requisicao === state.historicoReq) state.carregandoHistorico = false;
  }
}

function renderizarHistorico() {
  const corpo = $('corpoTabelaHistorico');
  if (!corpo) return;
  const { rows, total, page, pageSize } = state.historico;
  corpo.innerHTML = '';

  if ($('contagemHistorico')) $('contagemHistorico').textContent = String(total);
  const liberados = rows.filter((r) => r.status === 'LIBERADO').length;
  const negados = rows.filter((r) => r.status !== 'LIBERADO').length;
  if ($('histTotalLiberado')) $('histTotalLiberado').textContent = liberados;
  if ($('histTotalNegado')) $('histTotalNegado').textContent = negados;

  if (rows.length === 0) {
    corpo.innerHTML = '<tr><td colspan="6" class="celula-vazia">Nenhum acesso encontrado para o período e filtros selecionados.</td></tr>';
  } else {
    rows.forEach((linha) => {
      const tr = document.createElement('tr');
      tr.className = linha.aluno_id ? 'linha-clicavel' : '';
      const nome = linha.nome_identificado || 'Não cadastrado';
      tr.append(
        td(formatarDataHora(linha.data_hora), 'Data / hora'),
        td(nome, 'Aluno'),
        td(linha.turma || '—', 'Turma'),
        tdHtml(`<span class="uid-chip">${escapeHtml(linha.uid_nfc || '—')}</span>`, 'Cartão'),
        tdHtml(`<span class="status-pill ${linha.status === 'LIBERADO' ? 'ativo' : 'bloqueado'}">${escapeHtml(linha.status || '—')}</span>`, 'Status'),
        td(linha.tipo_evento || 'ENTRADA', 'Evento')
      );
      if (linha.aluno_id) {
        tr.addEventListener('click', () => {
          const aluno = state.alunos.find((a) => a.id === linha.aluno_id) || {
            id: linha.aluno_id,
            nome_completo: linha.nome_identificado,
            turma: linha.turma
          };
          abrirHistoricoAluno(aluno);
        });
      }
      corpo.appendChild(tr);
    });
  }

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
  if ($('histInfoPagina')) $('histInfoPagina').textContent = `Página ${page + 1} de ${totalPaginas}`;
  if ($('histAtualizadoEm')) {
    $('histAtualizadoEm').textContent = state.historicoAtualizadoEm
      ? `Atualizado às ${state.historicoAtualizadoEm.toLocaleTimeString('pt-BR')} · atualização automática`
      : '';
  }
  if ($('btnHistAnterior')) $('btnHistAnterior').disabled = page <= 0;
  if ($('btnHistProxima')) $('btnHistProxima').disabled = page + 1 >= totalPaginas;
}

async function exportarHistorico(evento) {
  const botao = evento?.currentTarget || $('btnExportarHistorico');
  botaoCarregando(botao, true, 'Exportando...');
  try {
    const filtros = lerFiltrosHistorico();
    const rows = [];
    let pagina = 0;
    const tamanhoPagina = 1000;
    while (pagina < 20) {
      const resultado = await Supabase.listarHistorico({ ...filtros, page: pagina, pageSize: tamanhoPagina });
      rows.push(...resultado.rows);
      if (resultado.rows.length < tamanhoPagina) break;
      pagina += 1;
    }
    if (rows.length === 0) {
      toast('Nenhum acesso encontrado para exportar com esses filtros.', 'err');
      return;
    }
    const cabecalho = ['data_hora', 'nome_identificado', 'turma', 'uid_nfc', 'status', 'tipo_evento', 'aluno_id'];
    const linhas = rows.map((r) => [
      formatarDataHora(r.data_hora), r.nome_identificado || '', r.turma || '',
      r.uid_nfc || '', r.status || '', r.tipo_evento || '', r.aluno_id || ''
    ]);
    baixarArquivo(`historico_${dataParaInput()}.csv`, paraCsv(cabecalho, linhas));
    toast(`${rows.length} acesso(s) exportado(s) em CSV.`, 'ok');
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function abrirHistoricoAluno(aluno) {
  state.historicoAlunoAtual = aluno;
  if ($('tituloHistoricoAluno')) $('tituloHistoricoAluno').textContent = `Histórico de ${aluno.nome_completo || 'aluno'}`;
  const corpo = $('corpoHistoricoAluno');
  if (corpo) corpo.innerHTML = '<tr><td colspan="4" class="celula-vazia">Carregando...</td></tr>';
  abrirModal('modalHistoricoAluno');
  try {
    const rows = await Supabase.historicoDoAluno(aluno.id);
    if (!corpo) return;
    corpo.innerHTML = '';
    if (rows.length === 0) {
      corpo.innerHTML = '<tr><td colspan="4" class="celula-vazia">Nenhum acesso registrado para este aluno.</td></tr>';
      return;
    }
    rows.forEach((linha) => {
      const tr = document.createElement('tr');
      tr.append(
        td(formatarDataHora(linha.data_hora), 'Data / hora'),
        td(linha.status || '—', 'Status'),
        td(linha.tipo_evento || 'ENTRADA', 'Evento'),
        td(linha.turma || '—', 'Turma')
      );
      corpo.appendChild(tr);
    });
  } catch (erro) {
    if (corpo) corpo.innerHTML = `<tr><td colspan="4" class="celula-vazia">${escapeHtml(mensagemErro(erro))}</td></tr>`;
  }
}

// =====================================================================
// Usuários
// =====================================================================

async function carregarUsuarios() {
  if (!state.perfil?.gerenciarUsuarios) return;
  const corpo = $('corpoTabelaUsuarios');
  if (corpo) corpo.innerHTML = '<tr><td colspan="5" class="celula-vazia">Carregando usuários...</td></tr>';
  try {
    state.usuarios = await Supabase.listarUsuarios();
    renderizarTabelaUsuarios();
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
    if (corpo) corpo.innerHTML = `<tr><td colspan="5" class="celula-vazia">${escapeHtml(mensagemErro(erro))}</td></tr>`;
  }
}

function renderizarTabelaUsuarios() {
  const corpo = $('corpoTabelaUsuarios');
  if (!corpo) return;
  const busca = normalizarTexto($('buscaUsuarios')?.value || '');
  const lista = state.usuarios.filter((u) => {
    if (!busca) return true;
    return [u.nome_completo, u.email, u.cargo].some((v) => normalizarTexto(v).includes(busca));
  });
  if ($('contagemUsuarios')) $('contagemUsuarios').textContent = String(lista.length);
  corpo.innerHTML = '';

  if (lista.length === 0) {
    corpo.innerHTML = '<tr><td colspan="5" class="celula-vazia">Nenhum usuário encontrado.</td></tr>';
    return;
  }

  lista.forEach((usuario) => {
    const perfil = PERFIS[usuario.cargo] || { rotulo: usuario.cargo, classe: 'cargo-portaria' };
    const tr = document.createElement('tr');
    tr.append(
      td(usuario.nome_completo, 'Nome'),
      td(usuario.email, 'E-mail'),
      tdHtml(`<span class="badge-cargo ${perfil.classe}">${escapeHtml(perfil.rotulo)}</span>`, 'Cargo'),
      tdHtml(`<span class="status-pill ${usuario.ativo ? 'ativo' : 'bloqueado'}">${usuario.ativo ? 'Ativo' : 'Bloqueado'}</span>`, 'Status')
    );

    const acoes = document.createElement('td');
    acoes.dataset.label = 'Ações';
    acoes.className = 'celula-acoes';
    acoes.appendChild(criarBotao('Editar', 'btn-secundario btn-mini', () => iniciarEdicaoUsuario(usuario)));
    acoes.appendChild(criarBotao('Senha', 'btn-secundario btn-mini', () => abrirRedefinirSenha(usuario)));
    const ehProprio = state.usuario?.id === usuario.id;
    if (!ehProprio) {
      acoes.appendChild(criarBotao(usuario.ativo ? 'Bloquear' : 'Ativar', 'btn-secundario btn-mini', () => alternarStatusUsuario(usuario)));
      acoes.appendChild(criarBotao('Excluir', 'btn-secundario btn-mini btn-perigo', () => excluirUsuario(usuario)));
    }
    tr.appendChild(acoes);
    corpo.appendChild(tr);
  });
}

function abrirNovoUsuario() {
  $('tituloModalUsuario').textContent = '➕ Novo Usuário';
  $('usuarioEditandoId').value = '';
  $('campoUsuarioNome').value = '';
  $('campoUsuarioEmail').value = '';
  $('campoUsuarioEmail').disabled = false;
  $('campoUsuarioSenha').value = '';
  $('campoUsuarioSenha').required = true;
  mostrar($('boxSenhaUsuario'), true);
  $('campoUsuarioCargo').value = 'secretaria';
  $('campoUsuarioAtivo').checked = true;
  abrirModal('modalUsuario');
}

function iniciarEdicaoUsuario(usuario) {
  $('tituloModalUsuario').textContent = '✏️ Editar Usuário';
  $('usuarioEditandoId').value = usuario.id;
  $('campoUsuarioNome').value = usuario.nome_completo;
  $('campoUsuarioEmail').value = usuario.email;
  $('campoUsuarioEmail').disabled = true;
  mostrar($('boxSenhaUsuario'), false);
  $('campoUsuarioSenha').required = false;
  $('campoUsuarioCargo').value = usuario.cargo;
  $('campoUsuarioAtivo').checked = usuario.ativo;
  abrirModal('modalUsuario');
}

async function salvarUsuario(evento) {
  evento.preventDefault();
  if (!state.perfil?.gerenciarUsuarios) return;
  const id = $('usuarioEditandoId').value;
  const nome = $('campoUsuarioNome').value.trim();
  const email = $('campoUsuarioEmail').value.trim();
  const cargo = $('campoUsuarioCargo').value;
  const ativo = $('campoUsuarioAtivo').checked;
  const botao = $('btnSalvarUsuario');

  if (!nome || (!id && !email)) {
    toast('Preencha nome e e-mail.', 'err');
    return;
  }
  if (!id) {
    const senha = $('campoUsuarioSenha').value;
    if (senha.length < 6) {
      toast('A senha provisória deve ter pelo menos 6 caracteres.', 'err');
      return;
    }
  }

  botaoCarregando(botao, true, 'Salvando...');
  let usuarioCriado = null;
  try {
    if (id) {
      await Supabase.atualizarUsuario(id, nome, cargo, ativo);
      toast('Usuário atualizado.', 'ok');
    } else {
      usuarioCriado = await Supabase.criarUsuarioAuth(email, $('campoUsuarioSenha').value, nome);
      try {
        await Supabase.atualizarUsuario(usuarioCriado.id, nome, cargo, ativo);
        toast('Usuário criado e ativado com sucesso.', 'ok');
      } catch (erroAtivacao) {
        fecharModal('modalUsuario');
        await carregarUsuarios().catch(() => {});
        throw new Error(`A conta foi criada, mas o cargo não pôde ser aplicado. O usuário ${email} ficou inativo; use "Ativar" na lista. Detalhe: ${mensagemErro(erroAtivacao)}`);
      }
    }
    fecharModal('modalUsuario');
    await carregarUsuarios();
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  } finally {
    botaoCarregando(botao, false);
  }
}

function abrirRedefinirSenha(usuario) {
  $('usuarioSenhaId').value = usuario.id;
  $('descRedefinirSenha').textContent = `Defina a nova senha para "${usuario.nome_completo}".`;
  $('campoNovaSenha').value = '';
  abrirModal('modalSenhaUsuario');
}

async function confirmarRedefinicaoSenha(evento) {
  evento.preventDefault();
  const id = $('usuarioSenhaId').value;
  const novaSenha = $('campoNovaSenha').value;
  if (novaSenha.length < 6) {
    toast('A nova senha deve ter pelo menos 6 caracteres.', 'err');
    return;
  }
  try {
    await Supabase.redefinirSenhaUsuario(id, novaSenha);
    fecharModal('modalSenhaUsuario');
    toast('Senha alterada com sucesso.', 'ok');
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
}

async function alternarStatusUsuario(usuario) {
  const novo = !usuario.ativo;
  if (!novo) {
    const confirmado = await confirmar({
      titulo: 'Bloquear usuário',
      mensagem: `Bloquear o acesso de ${usuario.nome_completo} ao sistema?`,
      textoOk: 'Bloquear',
      perigo: true
    });
    if (!confirmado) return;
  }
  try {
    await Supabase.atualizarUsuario(usuario.id, null, null, novo);
    toast(novo ? 'Usuário ativado.' : 'Usuário bloqueado.', 'ok');
    await carregarUsuarios();
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
}

async function excluirUsuario(usuario) {
  const confirmado = await confirmar({
    titulo: 'Excluir usuário',
    mensagem: `Excluir permanentemente a conta de ${usuario.nome_completo}? Esta ação não pode ser desfeita.`,
    textoOk: 'Excluir',
    perigo: true
  });
  if (!confirmado) return;
  try {
    await Supabase.excluirUsuario(usuario.id);
    toast('Usuário excluído.', 'ok');
    await carregarUsuarios();
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
}

function abrirMinhaConta() {
  $('formMinhaConta')?.reset();
  abrirModal('modalMinhaConta');
}

async function salvarMinhaConta(evento) {
  evento.preventDefault();
  const senha = $('campoMinhaSenha').value;
  const confirmacao = $('campoMinhaSenha2').value;
  if (senha.length < 6) {
    toast('A nova senha deve ter pelo menos 6 caracteres.', 'err');
    return;
  }
  if (senha !== confirmacao) {
    toast('As senhas não conferem.', 'err');
    return;
  }
  try {
    await Supabase.alterarMinhaSenha(senha);
    fecharModal('modalMinhaConta');
    toast('Sua senha foi alterada.', 'ok');
  } catch (erro) {
    toast(mensagemErro(erro), 'err');
  }
}

// =====================================================================
// Configurações e diagnóstico
// =====================================================================

function atualizarBuildInfo() {
  const alvo = $('buildInfo');
  if (!alvo) return;
  const config = state.config || obterConfiguracao();
  alvo.textContent = `Versão ${config.appVersion} · ambiente ${config.appEnv} · ${config.supabaseUrl ? new URL(config.supabaseUrl).host : 'sem projeto Supabase'}`;
}

async function carregarDiagnosticoNuvem() {
  const alvo = $('diagNuvem');
  if (alvo) alvo.innerHTML = '<li class="diag-item">Verificando conexão com a nuvem...</li>';
  const dot = $('dotNuvem');
  const texto = $('txtStatusNuvem');
  try {
    const checks = await Supabase.diagnosticarNuvem();
    if (alvo) {
      alvo.innerHTML = '';
      checks.forEach((check) => {
        const li = document.createElement('li');
        li.className = `diag-item ${check.ok ? 'ok' : 'erro'}`;
        const icone = document.createElement('span');
        icone.textContent = check.ok ? '✓' : '✕';
        const descricao = document.createElement('span');
        descricao.innerHTML = `<strong>${escapeHtml(check.descricao)}</strong><small>${escapeHtml(check.detalhe)}</small>`;
        li.append(icone, descricao);
        alvo.appendChild(li);
      });
    }
    const algumErro = checks.some((c) => !c.ok);
    if (dot) dot.className = `dot ${algumErro ? 'offline' : 'online'}`;
    if (texto) texto.textContent = algumErro ? 'Atenção' : 'Conectado';
  } catch (erro) {
    if (alvo) alvo.innerHTML = `<li class="diag-item erro">✕ ${escapeHtml(mensagemErro(erro))}</li>`;
    if (dot) dot.className = 'dot offline';
    if (texto) texto.textContent = 'Erro';
  }
}

async function testarTudo() {
  const botao = $('btnTestarTudo');
  botaoCarregando(botao, true, 'Testando...');
  try {
    await Supabase.testarConexaoNuvem();
    toast('Nuvem conectada.', 'ok');
  } catch (erro) {
    toast('Nuvem: ' + mensagemErro(erro), 'err');
  }
  try {
    const dados = await Esp32.testarEsp();
    if ($('diagEsp')) {
      $('diagEsp').innerHTML = `<div class="diag-bloco ok">✓ ESP32 online em ${escapeHtml(Esp32.obterUrlEsp())}<br><small>Wi-Fi: ${escapeHtml(dados?.ssid || '—')} · IP: ${escapeHtml(dados?.ip || '—')} · sinal: ${escapeHtml(String(dados?.rssi ?? '—'))} dBm</small></div>`;
    }
    toast('ESP32 conectado.', 'ok');
  } catch (erro) {
    if ($('diagEsp')) $('diagEsp').innerHTML = `<div class="diag-bloco erro">✕ ${escapeHtml(mensagemErro(erro))}</div>`;
    toast('ESP32: ' + mensagemErro(erro), 'err');
  }
  await carregarDiagnosticoNuvem();
  botaoCarregando(botao, false);
}

function salvarEspConfig() {
  const valor = $('cfgEspUrl')?.value || '';
  const normalizado = definirUrlEsp(valor);
  Esp32.configurarEsp(normalizado);
  if ($('cfgEspUrl')) $('cfgEspUrl').value = normalizado;
  if (state.usuario && !Esp32.espEmHttpsBloqueado()) {
    Esp32.pararMonitoramento();
    Esp32.iniciarMonitoramento({ onStatus: aoStatusEsp, onCartao: (uid) => processarCartao(uid) });
  } else if (Esp32.espEmHttpsBloqueado()) {
    aoStatusEsp({ estado: 'bloqueado' });
  }
  toast('Endereço do ESP32 atualizado para ' + normalizado, 'ok');
}

async function testarEspConfig() {
  const alvo = $('diagEsp');
  if (alvo) alvo.innerHTML = '<div class="diag-bloco">Testando ESP32...</div>';
  const urlTeste = $('cfgEspUrl')?.value || Esp32.obterUrlEsp();
  const anterior = Esp32.obterUrlEsp();
  Esp32.configurarEsp(urlTeste);
  try {
    const dados = await Esp32.testarEsp();
    if (alvo) alvo.innerHTML = `<div class="diag-bloco ok">✓ Online em ${escapeHtml(Esp32.obterUrlEsp())}<br><small>Wi-Fi: ${escapeHtml(dados?.ssid || '—')} · IP: ${escapeHtml(dados?.ip || '—')} · sinal: ${escapeHtml(String(dados?.rssi ?? '—'))} dBm</small></div>`;
    toast('ESP32 respondeu. Clique em "Salvar endereço" para usar este endereço.', 'ok');
  } catch (erro) {
    if (alvo) alvo.innerHTML = `<div class="diag-bloco erro">✕ ${escapeHtml(mensagemErro(erro))}</div>`;
    toast(mensagemErro(erro), 'err');
  } finally {
    Esp32.configurarEsp(anterior);
  }
}

async function sincronizarTodosAlunos(botao = $('btnSyncEspSec') || $('btnSyncEspConfig')) {
  if (!state.perfil?.sincronizarEsp) {
    toast('Seu perfil não pode sincronizar o leitor.', 'err');
    return;
  }
  if (Esp32.espEmHttpsBloqueado()) {
    toast('Sincronização indisponível em HTTPS. Use o modo local (http://localhost:5500).', 'err');
    abrirModalEsp();
    return;
  }
  botaoCarregando(botao, true, 'Sincronizando...');
  try {
    const alunos = await Supabase.listarAlunos();
    if (!alunos.length) throw new Error('Nenhum aluno cadastrado para sincronizar.');
    await Esp32.sincronizarTodos(alunos);
    toast(`${alunos.length} aluno(s) gravados na memória do ESP32.`, 'ok');
  } catch (erro) {
    toast('Falha ao sincronizar: ' + mensagemErro(erro), 'err');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function compararBaseEsp() {
  const alvo = $('diagEsp');
  if (Esp32.espEmHttpsBloqueado()) {
    toast('Comparação indisponível em HTTPS. Use o modo local (http://localhost:5500).', 'err');
    return;
  }
  if (alvo) alvo.innerHTML = '<div class="diag-bloco">Lendo a base do ESP32...</div>';
  try {
    const cartoes = await Esp32.listarCartoes();
    const lista = Array.isArray(cartoes) ? cartoes : [];
    const mapa = new Map(lista.map((c) => [normalizarUid(c.uid), c]));
    const faltando = [];
    const desatualizados = [];
    const extras = [];

    state.alunos.forEach((aluno) => {
      const uid = normalizarUid(aluno.uid_nfc);
      const remoto = mapa.get(uid);
      if (!remoto) faltando.push(aluno);
      else if (Boolean(remoto.ativo) !== Boolean(aluno.ativo)) desatualizados.push(aluno);
    });
    const uidsLocais = new Set(state.alunos.map((a) => normalizarUid(a.uid_nfc)));
    lista.forEach((c) => {
      if (!uidsLocais.has(normalizarUid(c.uid))) extras.push(c);
    });

    if (alvo) {
      alvo.innerHTML = `
        <div class="diag-bloco ${faltando.length || desatualizados.length ? 'erro' : 'ok'}">
          <strong>Base do ESP32: ${lista.length} cartão(ões)</strong><br>
          Faltando no leitor: ${faltando.length} · Status divergente: ${desatualizados.length} · Sobrando no leitor: ${extras.length}
        </div>
        ${(faltando.length || desatualizados.length) ? '<p class="texto-suave">Use “Sincronizar base” para corrigir.</p>' : ''}
      `;
    }
  } catch (erro) {
    if (alvo) alvo.innerHTML = `<div class="diag-bloco erro">✕ ${escapeHtml(mensagemErro(erro))}</div>`;
  }
}

function exportarAlunosJson() {
  if (state.alunos.length === 0) {
    toast('Nenhum aluno cadastrado para exportar.', 'err');
    return;
  }
  baixarArquivo(`alunos_${dataParaInput()}.json`, JSON.stringify(state.alunos, null, 2), 'application/json');
  toast('Backup JSON exportado.', 'ok');
}

// =====================================================================
// Modais de ESP / NFC / câmera
// =====================================================================

function abrirModalEsp() {
  if ($('campoEspUrl')) $('campoEspUrl').value = Esp32.obterUrlEsp();
  if ($('espTesteResultado')) $('espTesteResultado').textContent = '';
  abrirModal('modalEsp');
}

async function testarEspModal() {
  if ($('espTesteResultado')) $('espTesteResultado').textContent = 'Testando...';
  const urlTeste = $('campoEspUrl')?.value || Esp32.obterUrlEsp();
  const anterior = Esp32.obterUrlEsp();
  Esp32.configurarEsp(urlTeste);
  try {
    const dados = await Esp32.testarEsp();
    if ($('espTesteResultado')) {
      $('espTesteResultado').textContent = `Online · IP ${dados?.ip || '—'} · Wi-Fi ${dados?.ssid || '—'}`;
    }
  } catch (erro) {
    if ($('espTesteResultado')) $('espTesteResultado').textContent = mensagemErro(erro);
  } finally {
    Esp32.configurarEsp(anterior);
  }
}

function salvarEspModal() {
  const valor = $('campoEspUrl')?.value || '';
  const normalizado = definirUrlEsp(valor);
  Esp32.configurarEsp(normalizado);
  if ($('cfgEspUrl')) $('cfgEspUrl').value = normalizado;
  if (state.usuario && !Esp32.espEmHttpsBloqueado()) {
    Esp32.pararMonitoramento();
    Esp32.iniciarMonitoramento({ onStatus: aoStatusEsp, onCartao: (uid) => processarCartao(uid) });
  } else if (Esp32.espEmHttpsBloqueado()) {
    aoStatusEsp({ estado: 'bloqueado' });
  }
  fecharModal('modalEsp');
  toast('Leitor configurado: ' + normalizado, 'ok');
}

// =====================================================================
// Eventos
// =====================================================================

function ligarEventos() {
  $('formLogin')?.addEventListener('submit', aoEntrar);
  $('btnLogout')?.addEventListener('click', sairDaConta);
  $('btnMinhaConta')?.addEventListener('click', abrirMinhaConta);
  $('btnFecharMinhaConta')?.addEventListener('click', () => fecharModal('modalMinhaConta'));
  $('formMinhaConta')?.addEventListener('submit', salvarMinhaConta);

  document.querySelectorAll('.nav-btn').forEach((botao) => {
    botao.addEventListener('click', () => navegar(botao.dataset.tab));
  });

  $('badgeEsp')?.addEventListener('click', abrirModalEsp);
  $('btnIrConfigEsp')?.addEventListener('click', abrirModalEsp);
  $('btnAtualizarRecentes')?.addEventListener('click', carregarRecentesHoje);
  $('btnTotemFullscreen')?.addEventListener('click', alternarTelaCheia);
  $('btnSairTotem')?.addEventListener('click', pararTotem);
  $('btnAtivarSom')?.addEventListener('click', ativarSom);
  document.addEventListener('fullscreenchange', aoMudarTelaCheia);

  $('btnEscolherArquivo')?.addEventListener('click', () => $('inputArquivoFoto')?.click());
  $('inputArquivoFoto')?.addEventListener('change', processarArquivoFoto);
  $('btnTirarFoto')?.addEventListener('click', abrirCamera);
  $('btnRemoverFoto')?.addEventListener('click', removerFotoSelecionada);
  $('formAluno')?.addEventListener('submit', salvarAluno);
  $('btnCancelarEdicao')?.addEventListener('click', limparFormularioAluno);
  $('btnPuxarUid')?.addEventListener('click', abrirCapturaUid);
  $('campoUid')?.addEventListener('blur', () => {
    const normalizado = normalizarUid($('campoUid').value);
    if (normalizado) $('campoUid').value = normalizado;
  });
  $('campoTelefone')?.addEventListener('blur', () => {
    const formatado = formatarTelefone($('campoTelefone').value);
    if (formatado) $('campoTelefone').value = formatado;
  });
  $('btnFecharModalNfc')?.addEventListener('click', () => fecharModal('modalNfc'));
  $('btnCancelarNfc')?.addEventListener('click', () => fecharModal('modalNfc'));

  $('btnCapturarFoto')?.addEventListener('click', capturarFotoWebcam);
  $('btnFecharCamera')?.addEventListener('click', () => fecharModal('modalCamera'));

  $('buscaAlunos')?.addEventListener('input', debounce(aoFiltrarAlunos, 150));
  $('filtroStatusAluno')?.addEventListener('change', aoFiltrarAlunos);
  $('btnImportarCsv')?.addEventListener('click', () => $('inputImportCsv')?.click());
  $('inputImportCsv')?.addEventListener('change', aoSelecionarArquivoCsv);
  $('btnExportarCsv')?.addEventListener('click', exportarAlunosCsv);
  $('btnBaixarModelo')?.addEventListener('click', baixarModeloCsv);
  $('btnConfirmarImport')?.addEventListener('click', confirmarImportacao);
  $('btnCancelarImport')?.addEventListener('click', () => { state.importPreview = null; fecharModal('modalImport'); });
  $('btnSyncEspSec')?.addEventListener('click', (evento) => sincronizarTodosAlunos(evento.currentTarget));

  $('btnExportarHistorico')?.addEventListener('click', exportarHistorico);
  $('btnAtualizarHistorico')?.addEventListener('click', () => carregarHistorico(state.historico.page));
  $('btnFiltrarHistorico')?.addEventListener('click', () => carregarHistorico(0));
  $('btnLimparFiltrosHist')?.addEventListener('click', () => {
    if ($('histDataInicio')) $('histDataInicio').value = dataParaInput();
    if ($('histDataFim')) $('histDataFim').value = dataParaInput();
    if ($('histBusca')) $('histBusca').value = '';
    if ($('histStatus')) $('histStatus').value = '';
    carregarHistorico(0);
  });
  $('btnHistAnterior')?.addEventListener('click', () => carregarHistorico(Math.max(0, state.historico.page - 1)));
  $('btnHistProxima')?.addEventListener('click', () => carregarHistorico(state.historico.page + 1));
  $('btnFecharHistoricoAluno')?.addEventListener('click', () => fecharModal('modalHistoricoAluno'));

  $('btnNovoUsuario')?.addEventListener('click', abrirNovoUsuario);
  $('btnFecharModalUsuario')?.addEventListener('click', () => fecharModal('modalUsuario'));
  $('formUsuario')?.addEventListener('submit', salvarUsuario);
  $('btnFecharModalSenha')?.addEventListener('click', () => fecharModal('modalSenhaUsuario'));
  $('formSenhaUsuario')?.addEventListener('submit', confirmarRedefinicaoSenha);
  $('buscaUsuarios')?.addEventListener('input', debounce(renderizarTabelaUsuarios, 150));

  $('btnTestarTudo')?.addEventListener('click', testarTudo);
  $('btnAtualizarDiag')?.addEventListener('click', carregarDiagnosticoNuvem);
  $('btnSalvarEsp')?.addEventListener('click', salvarEspConfig);
  $('btnTestarEsp')?.addEventListener('click', testarEspConfig);
  $('btnSyncEspConfig')?.addEventListener('click', (evento) => sincronizarTodosAlunos(evento.currentTarget));
  $('btnCompararEsp')?.addEventListener('click', compararBaseEsp);
  $('btnExportarJson')?.addEventListener('click', exportarAlunosJson);
  $('btnExportarCsvConfig')?.addEventListener('click', exportarAlunosCsv);

  $('btnFecharModalEsp')?.addEventListener('click', () => fecharModal('modalEsp'));
  $('formEsp')?.addEventListener('submit', (evento) => { evento.preventDefault(); salvarEspModal(); });
  $('btnTestarEspModal')?.addEventListener('click', testarEspModal);

  $('btnFecharModalConfirm')?.addEventListener('click', () => resolverConfirmacao(false));
  $('btnConfirmarCancelar')?.addEventListener('click', () => resolverConfirmacao(false));
  $('btnConfirmarOk')?.addEventListener('click', () => resolverConfirmacao(true));

  document.querySelectorAll('[data-fechar]').forEach((botao) => {
    botao.addEventListener('click', () => fecharModal(botao.dataset.fechar));
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (evento) => {
      if (evento.target !== overlay) return;
      if (overlay.id === 'modalConfirm') resolverConfirmacao(false);
      else if (overlay.id === 'modalCamera') fecharModal('modalCamera');
      else fecharModal(overlay.id);
    });
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') return;
    if (fecharModalDoTopo()) evento.preventDefault();
  });

  window.addEventListener('hashchange', aoMudarHash);
}

// Inicializa assim que o módulo é avaliado (scripts type=module são adiados).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar, { once: true });
} else {
  iniciar();
}

// Exportações para depuração no console do navegador.
if (typeof window !== 'undefined') {
  window.__ACESSO_NFC__ = {
    state,
    navegar,
    aplicarPermissoes,
    processarCartao,
    carregarAlunos,
    carregarHistorico,
    carregarUsuarios,
    sincronizarTodosAlunos,
    recarregar: () => window.location.reload()
  };
}
