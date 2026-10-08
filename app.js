// =====================================================================
// SISTEMA DE CONTROLE ESCOLAR NFC - CLIENTE WEB INTEGRADO
// Autenticação, Controle de Acesso Baseado em Papéis (RBAC) e ESP32
// =====================================================================

const $ = id => document.getElementById(id);

// Variáveis de estado global
let supabaseClient = null;
let espUrl = "http://nfc.local";
let ultimoSeqDetectado = 0;
let alunoEditandoId = null;
let fotoBlobProntoParaUpload = null;
let listaAlunosCache = [];
let listaUsuariosCache = [];
let streamWebcam = null;
let usuarioAtual = null; // { id, email, nome_completo, cargo, ativo }

// Funções utilitárias seguras para localStorage
function obterStorage(chave, padrao = '') {
  try {
    return localStorage.getItem(chave) || padrao;
  } catch (e) {
    return padrao;
  }
}

function salvarStorage(chave, valor) {
  try {
    localStorage.setItem(chave, valor);
  } catch (e) {}
}

// Sanitização contra ataques XSS
function escapeHtml(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Gerador de Avatar SVG dinâmico (substitui URLs externas instáveis como via.placeholder.com)
function obterAvatarPadrao(nome = '?') {
  const inicial = (nome || '?').trim().charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <rect width="160" height="160" fill="#1e293b"/>
    <text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="700" fill="#94a3b8" dominant-baseline="middle" text-anchor="middle">${inicial}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Áudio sintético suave para aviso de aproximação do cartão
function emitirBipSonoro(tipo = 'ok') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (tipo === 'ok') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {}
}

function toast(msg, tipo = '') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show ' + tipo;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 3500);
}

// =====================================================================
// NORMALIZAÇÃO DE ENDEREÇOS E CONFIGURAÇÃO
// =====================================================================
function normalizarUrlSupabase(url) {
  if (!url) return '';
  let u = url.trim();
  u = u.replace(/\/rest\/v1\/?$/i, '');
  u = u.replace(/\/auth\/v1\/?$/i, '');
  u = u.replace(/\/storage\/v1\/?$/i, '');
  u = u.replace(/\/+$/, '');
  return u;
}

function normalizarUrlEsp(url) {
  if (!url) return 'http://nfc.local';
  let u = url.trim().replace(/\/+$/, '');
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'http://' + u;
  }
  return u;
}

function carregarConfiguracoes() {
  let url = normalizarUrlSupabase(obterStorage('cfg_supabase_url'));
  const key = obterStorage('cfg_supabase_key');
  let esp = normalizarUrlEsp(obterStorage('cfg_esp_url', 'http://192.168.0.73'));

  if ($('cfgSupabaseUrl')) $('cfgSupabaseUrl').value = url;
  if ($('cfgSupabaseKey')) $('cfgSupabaseKey').value = key;
  if ($('cfgEspUrl')) $('cfgEspUrl').value = esp;
  espUrl = esp;

  if (url && key && window.supabase && window.supabase.createClient) {
    try {
      supabaseClient = window.supabase.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      });
      if ($('dotSupabase')) $('dotSupabase').className = 'dot online';
      if ($('txtStatusSupabase')) $('txtStatusSupabase').textContent = 'Conectado';
      
      iniciarObservadorAutenticacao();
    } catch (e) {
      if ($('dotSupabase')) $('dotSupabase').className = 'dot offline';
      if ($('txtStatusSupabase')) $('txtStatusSupabase').textContent = 'Erro Chave';
    }
  } else {
    if ($('dotSupabase')) $('dotSupabase').className = 'dot offline';
    if ($('txtStatusSupabase')) $('txtStatusSupabase').textContent = 'Configurar';
    mostrarTelaLogin();
  }
}

function salvarConfiguracoes() {
  let rawUrl = $('cfgSupabaseUrl') ? $('cfgSupabaseUrl').value : '';
  const key = $('cfgSupabaseKey') ? $('cfgSupabaseKey').value.trim() : '';
  let rawEsp = $('cfgEspUrl') ? $('cfgEspUrl').value : '';

  const url = normalizarUrlSupabase(rawUrl);
  const esp = normalizarUrlEsp(rawEsp);

  if ($('cfgSupabaseUrl')) $('cfgSupabaseUrl').value = url;
  if ($('cfgEspUrl')) $('cfgEspUrl').value = esp;

  salvarStorage('cfg_supabase_url', url);
  salvarStorage('cfg_supabase_key', key);
  salvarStorage('cfg_esp_url', esp);

  toast('Configurações salvas e validadas!', 'ok');
  carregarConfiguracoes();
}

function salvarConfigRapido(ev) {
  if (ev) ev.preventDefault();
  const url = normalizarUrlSupabase($('cfgRapidoUrl').value);
  const key = $('cfgRapidoKey').value.trim();

  if (!url || !key) return toast('Preencha a URL e a Chave anon!', 'err');

  salvarStorage('cfg_supabase_url', url);
  salvarStorage('cfg_supabase_key', key);
  $('modalConfigRapido').style.display = 'none';

  toast('Supabase configurado! Conectando...', 'ok');
  carregarConfiguracoes();
}

function abrirModalConfigSupabaseRapido() {
  $('cfgRapidoUrl').value = obterStorage('cfg_supabase_url');
  $('cfgRapidoKey').value = obterStorage('cfg_supabase_key');
  $('modalConfigRapido').style.display = 'flex';
}

async function testarConexoes() {
  salvarConfiguracoes();
  toast('Testando conexões...', '');

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('alunos').select('id').limit(1);
      if (!error) {
        toast('Supabase conectado com sucesso!', 'ok');
      } else {
        toast('Supabase respondeu: ' + error.message, 'err');
      }
    } catch (e) {
      toast('Falha com o Supabase: ' + e.message, 'err');
    }
  } else {
    toast('Preencha a URL e a Chave do Supabase!', 'err');
    return;
  }

  try {
    if (window.location.protocol === 'https:' && espUrl.startsWith('http://')) {
      toast('Atenção: Navegador em HTTPS bloqueia IP HTTP local (Mixed Content). Abra via http://localhost', 'err');
      return;
    }
    const resp = await fetch(espUrl + '/api/status', { method: 'GET', mode: 'cors' });
    if (resp.ok) {
      toast('ESP32-S3 e Supabase 100% operacionais!', 'ok');
    } else {
      toast('ESP32 respondeu com status ' + resp.status, 'err');
    }
  } catch (e) {
    console.error('Erro de conexão ao ESP32:', e);
    toast('ESP32 não alcançado. Verifique se o IP tem http:// e se o firmware com CORS foi gravado.', 'err');
  }
}

// =====================================================================
// AUTENTICAÇÃO E CONTROLE DE ACESSO (RBAC)
// =====================================================================
function mostrarTelaLogin() {
  $('telaLogin').style.display = 'flex';
  $('conteudoPrincipal').style.display = 'none';
  $('menuUsuario').style.display = 'none';
  verificarSePrecisaSetupInicial();
}

function mostrarPainelPrincipal() {
  $('telaLogin').style.display = 'none';
  $('conteudoPrincipal').style.display = 'block';
  $('menuUsuario').style.display = 'flex';
}

async function verificarSePrecisaSetupInicial() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.rpc('sistema_precisa_setup');
    if (!error && data === true) {
      if ($('linkPrimeiroAdmin')) $('linkPrimeiroAdmin').style.display = 'block';
    } else {
      if ($('linkPrimeiroAdmin')) $('linkPrimeiroAdmin').style.display = 'none';
    }
  } catch (e) {
    // Ignora se tabela ainda não existe
  }
}

function iniciarObservadorAutenticacao() {
  if (!supabaseClient) return;

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      await carregarPerfilUsuarioLogado(session.user);
    } else {
      usuarioAtual = null;
      mostrarTelaLogin();
    }
  });

  // Checa sessão existente de imediato
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) {
      carregarPerfilUsuarioLogado(session.user);
    } else {
      mostrarTelaLogin();
    }
  });
}

async function carregarPerfilUsuarioLogado(authUserData) {
  try {
    const { data: perfil, error } = await supabaseClient.rpc('obter_meu_perfil');

    if (error || !perfil) {
      // Se não encontrou na tabela pública de perfis, monta fallback dos metadados
      const meta = authUserData.user_metadata || {};
      usuarioAtual = {
        id: authUserData.id,
        email: authUserData.email,
        nome_completo: meta.nome || authUserData.email.split('@')[0],
        cargo: meta.cargo || 'portaria',
        ativo: true
      };
    } else {
      usuarioAtual = perfil;
    }

    if (!usuarioAtual.ativo) {
      toast('Sua conta está desativada. Fale com a direção ou suporte técnico.', 'err');
      await supabaseClient.auth.signOut();
      usuarioAtual = null;
      mostrarTelaLogin();
      return;
    }

    aplicarPermissoesDeCargo(usuarioAtual);
    mostrarPainelPrincipal();

  } catch (err) {
    console.error('Erro ao buscar perfil:', err);
    toast('Erro ao autenticar usuário: ' + err.message, 'err');
  }
}

function aplicarPermissoesDeCargo(usuario) {
  // Atualiza identificação no topo
  $('nomeUsuarioTopo').textContent = usuario.nome_completo;
  $('avatarUsuario').textContent = (usuario.nome_completo || 'U').charAt(0).toUpperCase();

  const badgeCargo = $('cargoUsuarioTopo');
  const mapaCargos = {
    'admin': { rotulo: '🛠️ Admin/Técnico', classe: 'cargo-admin' },
    'direcao': { rotulo: '🏛️ Direção', classe: 'cargo-direcao' },
    'coordenacao': { rotulo: '📚 Coordenação', classe: 'cargo-coordenacao' },
    'secretaria': { rotulo: '📝 Secretaria', classe: 'cargo-secretaria' },
    'portaria': { rotulo: '🏢 Portaria', classe: 'cargo-portaria' }
  };

  const infoCargo = mapaCargos[usuario.cargo] || { rotulo: usuario.cargo, classe: 'cargo-portaria' };
  badgeCargo.textContent = infoCargo.rotulo;
  badgeCargo.className = 'badge-cargo ' + infoCargo.classe;

  // Controle de visibilidade das abas conforme a função
  const btnPortaria = $('btnNavPortaria');
  const btnSecr = $('btnNavSecretaria');
  const btnUser = $('btnNavUsuarios');
  const btnCfg = $('btnNavConfig');

  btnPortaria.style.display = 'flex'; // Todos podem ver a Portaria

  // Secretaria, Coordenação, Direção e Admin podem acessar Secretaria
  const podeAcessarSecretaria = ['secretaria', 'coordenacao', 'direcao', 'admin'].includes(usuario.cargo);
  btnSecr.style.display = podeAcessarSecretaria ? 'flex' : 'none';

  // Apenas Admin (Técnico / Diretor TI) acessa Gestão de Usuários e Configurações de Hardware
  const ehAdmin = (usuario.cargo === 'admin');
  btnUser.style.display = ehAdmin ? 'flex' : 'none';
  btnCfg.style.display = ehAdmin ? 'flex' : 'none';

  // Redireciona para aba adequada se a aba atual não for permitida
  if (usuario.cargo === 'portaria') {
    trocarAba('portaria');
  } else if (!podeAcessarSecretaria && $('aba-secretaria').classList.contains('active')) {
    trocarAba('portaria');
  }
}

async function fazerLogin(ev) {
  if (ev) ev.preventDefault();
  if (!supabaseClient) return toast('Configure o Supabase primeiro no link abaixo!', 'err');

  const email = $('loginEmail').value.trim();
  const senha = $('loginSenha').value;
  const btn = $('btnEntrarLogin');

  btn.disabled = true;
  btn.textContent = 'Autenticando...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: senha
    });

    if (error) throw error;
    toast('Login realizado com sucesso!', 'ok');
  } catch (err) {
    toast('Falha no login: ' + (err.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : err.message), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar no Sistema';
  }
}

async function fazerLogout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  usuarioAtual = null;
  toast('Sessão encerrada.', '');
  mostrarTelaLogin();
}

// Criação do 1º Administrador quando o banco está virgem
async function cadastrarPrimeiroAdmin(ev) {
  if (ev) ev.preventDefault();
  if (!supabaseClient) return toast('Supabase não conectado!', 'err');

  const nome = $('primeiroAdminNome').value.trim();
  const email = $('primeiroAdminEmail').value.trim();
  const senha = $('primeiroAdminSenha').value;

  if (senha.length < 6) return toast('A senha deve ter pelo menos 6 caracteres!', 'err');

  toast('Criando administrador mestre...', '');

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: senha,
      options: {
        data: {
          nome: nome,
          cargo: 'admin'
        }
      }
    });

    if (error) throw error;

    toast('Administrador criado com sucesso!', 'ok');
    $('modalPrimeiroAdmin').style.display = 'none';

    if (!data.session) {
      $('loginEmail').value = email;
      $('loginSenha').value = senha;
      await fazerLogin();
    }

  } catch (err) {
    toast('Erro ao cadastrar administrador: ' + err.message, 'err');
  }
}

function abrirModalPrimeiroAdmin() {
  $('modalPrimeiroAdmin').style.display = 'flex';
}

// =====================================================================
// NAVEGAÇÃO ENTRE ABAS
// =====================================================================
function trocarAba(nomeAba) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

  const painel = $('aba-' + nomeAba);
  if (painel) painel.classList.add('active');

  if (nomeAba === 'portaria' && $('btnNavPortaria')) $('btnNavPortaria').classList.add('active');
  if (nomeAba === 'secretaria' && $('btnNavSecretaria')) {
    $('btnNavSecretaria').classList.add('active');
    carregarAlunosDoSupabase();
  }
  if (nomeAba === 'usuarios' && $('btnNavUsuarios')) {
    $('btnNavUsuarios').classList.add('active');
    carregarUsuarios();
  }
  if (nomeAba === 'config' && $('btnNavConfig')) $('btnNavConfig').classList.add('active');
}

// =====================================================================
// GESTÃO DE USUÁRIOS E PERMISSÕES (RBAC - EXCLUSIVA ADMIN)
// =====================================================================
async function carregarUsuarios() {
  if (!supabaseClient) return;
  const tb = $('corpoTabelaUsuarios');
  if (!tb) return;

  tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Carregando usuários...</td></tr>';

  try {
    const { data, error } = await supabaseClient
      .from('perfis_usuarios')
      .select('*')
      .order('nome_completo', { ascending: true });

    if (error) throw error;

    listaUsuariosCache = data || [];
    renderizarTabelaUsuarios(listaUsuariosCache);
  } catch (err) {
    toast('Erro ao carregar usuários: ' + err.message, 'err');
  }
}

function renderizarTabelaUsuarios(lista) {
  const tb = $('corpoTabelaUsuarios');
  if (!tb) return;
  tb.innerHTML = '';
  if ($('contagemUsuarios')) $('contagemUsuarios').textContent = lista.length;

  if (lista.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Nenhum usuário cadastrado.</td></tr>';
    return;
  }

  const mapaCargos = {
    'admin': { rotulo: '🛠️ Técnico/Admin', classe: 'cargo-admin' },
    'direcao': { rotulo: '🏛️ Direção', classe: 'cargo-direcao' },
    'coordenacao': { rotulo: '📚 Coordenação', classe: 'cargo-coordenacao' },
    'secretaria': { rotulo: '📝 Secretaria', classe: 'cargo-secretaria' },
    'portaria': { rotulo: '🏢 Portaria', classe: 'cargo-portaria' }
  };

  lista.forEach(u => {
    const tr = document.createElement('tr');

    // Nome
    const tdNome = document.createElement('td');
    tdNome.innerHTML = `<strong>${escapeHtml(u.nome_completo)}</strong>`;

    // Email
    const tdEmail = document.createElement('td');
    tdEmail.textContent = u.email;
    tdEmail.style.color = 'var(--text-muted)';

    // Cargo
    const tdCargo = document.createElement('td');
    const infoC = mapaCargos[u.cargo] || { rotulo: u.cargo, classe: 'cargo-portaria' };
    const badge = document.createElement('span');
    badge.className = 'badge-cargo ' + infoC.classe;
    badge.textContent = infoC.rotulo;
    tdCargo.appendChild(badge);

    // Status
    const tdStatus = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'status-pill ' + (u.ativo ? 'ativo' : 'bloqueado');
    pill.textContent = u.ativo ? 'Ativo' : 'Bloqueado';
    tdStatus.appendChild(pill);

    // Ações
    const tdAcoes = document.createElement('td');
    tdAcoes.style.textAlign = 'right';

    const ehProprioUsuario = (usuarioAtual && usuarioAtual.id === u.id);

    // Botão Editar
    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn-secundario';
    btnEditar.style.padding = '4px 8px';
    btnEditar.style.fontSize = '0.75rem';
    btnEditar.style.marginRight = '4px';
    btnEditar.textContent = 'Editar';
    btnEditar.onclick = () => iniciarEdicaoUsuario(u.id);
    tdAcoes.appendChild(btnEditar);

    // Botão Senha
    const btnSenha = document.createElement('button');
    btnSenha.className = 'btn-secundario';
    btnSenha.style.padding = '4px 8px';
    btnSenha.style.fontSize = '0.75rem';
    btnSenha.style.marginRight = '4px';
    btnSenha.textContent = '🔑 Senha';
    btnSenha.onclick = () => abrirModalRedefinirSenha(u.id, u.nome_completo);
    tdAcoes.appendChild(btnSenha);

    // Botão Bloquear/Ativar (não permite auto-bloqueio)
    if (!ehProprioUsuario) {
      const btnStatus = document.createElement('button');
      btnStatus.className = 'btn-secundario';
      btnStatus.style.padding = '4px 8px';
      btnStatus.style.fontSize = '0.75rem';
      btnStatus.style.marginRight = '4px';
      btnStatus.textContent = u.ativo ? 'Bloquear' : 'Ativar';
      btnStatus.onclick = () => alternarStatusUsuario(u.id, !u.ativo);
      tdAcoes.appendChild(btnStatus);

      // Botão Excluir
      const btnExcluir = document.createElement('button');
      btnExcluir.className = 'btn-secundario';
      btnExcluir.style.padding = '4px 8px';
      btnExcluir.style.fontSize = '0.75rem';
      btnExcluir.style.color = 'var(--danger)';
      btnExcluir.textContent = 'Excluir';
      btnExcluir.onclick = () => excluirUsuario(u.id, u.nome_completo);
      tdAcoes.appendChild(btnExcluir);
    }

    tr.append(tdNome, tdEmail, tdCargo, tdStatus, tdAcoes);
    tb.appendChild(tr);
  });
}

function abrirModalNovoUsuario() {
  $('tituloModalUsuario').textContent = '➕ Novo Usuário';
  $('usuarioEditandoId').value = '';
  $('campoUsuarioNome').value = '';
  $('campoUsuarioEmail').value = '';
  $('campoUsuarioEmail').disabled = false;
  $('campoUsuarioSenha').value = '';
  $('campoUsuarioSenha').required = true;
  $('boxSenhaUsuario').style.display = 'block';
  $('campoUsuarioCargo').value = 'secretaria';
  $('campoUsuarioAtivo').checked = true;
  $('modalUsuario').style.display = 'flex';
}

function iniciarEdicaoUsuario(id) {
  const u = listaUsuariosCache.find(x => x.id === id);
  if (!u) return;

  $('tituloModalUsuario').textContent = '✏️ Editar Usuário';
  $('usuarioEditandoId').value = u.id;
  $('campoUsuarioNome').value = u.nome_completo;
  $('campoUsuarioEmail').value = u.email;
  $('campoUsuarioEmail').disabled = true; // Email não é alterado aqui
  $('boxSenhaUsuario').style.display = 'none'; // Senha tem modal dedicado
  $('campoUsuarioSenha').required = false;
  $('campoUsuarioCargo').value = u.cargo;
  $('campoUsuarioAtivo').checked = u.ativo;
  $('modalUsuario').style.display = 'flex';
}

function fecharModalUsuario() {
  $('modalUsuario').style.display = 'none';
}

async function salvarDadosUsuario(ev) {
  if (ev) ev.preventDefault();
  if (!supabaseClient) return;

  const id = $('usuarioEditandoId').value;
  const nome = $('campoUsuarioNome').value.trim();
  const email = $('campoUsuarioEmail').value.trim();
  const cargo = $('campoUsuarioCargo').value;
  const ativo = $('campoUsuarioAtivo').checked;
  const btn = $('btnSalvarUsuario');

  btn.disabled = true;

  try {
    if (id) {
      // Atualizar existente via RPC
      const { data, error } = await supabaseClient.rpc('admin_alterar_usuario', {
        p_user_id: id,
        p_nome: nome,
        p_cargo: cargo,
        p_ativo: ativo
      });
      if (error) throw error;
      toast('Usuário atualizado com sucesso!', 'ok');
    } else {
      // Criar novo usuário via Auth client secundário (para não deslogar o admin)
      const senha = $('campoUsuarioSenha').value;
      if (senha.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.');

      const url = normalizarUrlSupabase(obterStorage('cfg_supabase_url'));
      const key = obterStorage('cfg_supabase_key');
      const clientSecundario = window.supabase.createClient(url, key, {
        auth: { persistSession: false }
      });

      const { data, error } = await clientSecundario.auth.signUp({
        email: email,
        password: senha,
        options: {
          data: {
            nome: nome,
            cargo: cargo
          }
        }
      });

      if (error) throw error;
      toast('Novo usuário cadastrado com sucesso!', 'ok');
    }

    fecharModalUsuario();
    carregarUsuarios();

  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

function abrirModalRedefinirSenha(id, nome) {
  $('usuarioSenhaId').value = id;
  $('descRedefinirSenha').textContent = `Defina a nova senha para o usuário "${nome}".`;
  $('campoNovaSenha').value = '';
  $('modalSenhaUsuario').style.display = 'flex';
}

async function confirmarRedefinicaoSenha(ev) {
  if (ev) ev.preventDefault();
  if (!supabaseClient) return;

  const id = $('usuarioSenhaId').value;
  const novaSenha = $('campoNovaSenha').value;

  try {
    const { data, error } = await supabaseClient.rpc('admin_redefinir_senha', {
      p_user_id: id,
      p_nova_senha: novaSenha
    });
    if (error) throw error;

    toast('Senha alterada com sucesso!', 'ok');
    $('modalSenhaUsuario').style.display = 'none';
  } catch (err) {
    toast('Erro ao alterar senha: ' + err.message, 'err');
  }
}

async function alternarStatusUsuario(id, novoStatus) {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.rpc('admin_alterar_usuario', {
      p_user_id: id,
      p_nome: null,
      p_cargo: null,
      p_ativo: novoStatus
    });
    if (error) throw error;

    toast(novoStatus ? 'Usuário ativado!' : 'Usuário bloqueado!', 'ok');
    carregarUsuarios();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function excluirUsuario(id, nome) {
  if (!supabaseClient) return;
  if (!confirm(`Tem certeza que deseja EXCLUIR permanentemente a conta de "${nome}"?`)) return;

  try {
    const { data, error } = await supabaseClient.rpc('admin_excluir_usuario', {
      p_user_id: id
    });
    if (error) throw error;

    toast('Usuário excluído com sucesso!', 'ok');
    carregarUsuarios();
  } catch (err) {
    toast('Erro ao excluir: ' + err.message, 'err');
  }
}

// =====================================================================
// COMPRESSÃO INTELIGENTE DE FOTOS NO NAVEGADOR (CANVAS HTML5)
// =====================================================================
function redimensionarEComprimirImagem(imgOriginal) {
  return new Promise((resolve) => {
    const canvas = $('canvasCompressor') || document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const maxDim = 500;
    let width = imgOriginal.width;
    let height = imgOriginal.height;

    let srcX = 0, srcY = 0, srcSize = Math.min(width, height);
    srcX = (width - srcSize) / 2;
    srcY = (height - srcSize) / 2;

    canvas.width = maxDim;
    canvas.height = maxDim;

    ctx.drawImage(imgOriginal, srcX, srcY, srcSize, srcSize, 0, 0, maxDim, maxDim);

    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/jpeg', 0.85);
  });
}

function processarArquivoFoto(event) {
  const arquivo = event.target.files[0];
  if (!arquivo) return;

  const leitor = new FileReader();
  leitor.onload = function(e) {
    const img = new Image();
    img.onload = async function() {
      fotoBlobProntoParaUpload = await redimensionarEComprimirImagem(img);
      const urlPreview = URL.createObjectURL(fotoBlobProntoParaUpload);
      if ($('previewFotoForm')) $('previewFotoForm').src = urlPreview;
      toast('Foto otimizada para ' + Math.round(fotoBlobProntoParaUpload.size / 1024) + ' KB!', 'ok');
    };
    img.src = e.target.result;
  };
  leitor.readAsDataURL(arquivo);
}

// Modal e Captura com Webcam
async function abrirModalCamera() {
  const modal = $('modalCamera');
  const video = $('videoWebcam');
  if (!modal || !video) return;
  modal.style.display = 'flex';

  try {
    streamWebcam = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' }
    });
    video.srcObject = streamWebcam;
  } catch (err) {
    toast('Não foi possível acessar a câmera: ' + err.message, 'err');
    fecharModalCamera();
  }
}

function fecharModalCamera() {
  const modal = $('modalCamera');
  if (modal) modal.style.display = 'none';
  if (streamWebcam) {
    streamWebcam.getTracks().forEach(track => track.stop());
    streamWebcam = null;
  }
}

async function capturarFotoWebcam() {
  const video = $('videoWebcam');
  if (!video) return;

  const canvas = $('canvasCompressor') || document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const img = new Image();
  img.onload = async function() {
    fotoBlobProntoParaUpload = await redimensionarEComprimirImagem(img);
    const urlPreview = URL.createObjectURL(fotoBlobProntoParaUpload);
    if ($('previewFotoForm')) $('previewFotoForm').src = urlPreview;
    fecharModalCamera();
    toast('Foto capturada e otimizada!', 'ok');
  };
  img.src = canvas.toDataURL('image/jpeg');
}

// =====================================================================
// SECRETARIA: GESTÃO DE ALUNOS
// =====================================================================
async function carregarAlunosDoSupabase() {
  if (!supabaseClient) return;

  const tb = $('corpoTabelaAlunos');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Carregando alunos do Supabase...</td></tr>';

  try {
    const { data, error } = await supabaseClient
      .from('alunos')
      .select('*')
      .order('nome_completo', { ascending: true });

    if (error) throw error;

    listaAlunosCache = data || [];
    renderizarTabelaAlunos(listaAlunosCache);
  } catch (err) {
    toast('Falha ao consultar alunos: ' + err.message, 'err');
  }
}

function renderizarTabelaAlunos(lista) {
  const tb = $('corpoTabelaAlunos');
  if (!tb) return;
  tb.innerHTML = '';
  if ($('contagemAlunos')) $('contagemAlunos').textContent = lista.length;

  if (lista.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Nenhum aluno cadastrado no sistema.</td></tr>';
    return;
  }

  lista.forEach(a => {
    const tr = document.createElement('tr');
    
    // Foto + Nome + Matrícula
    const tdAluno = document.createElement('td');
    tdAluno.className = 'aluno-col-info';
    const img = document.createElement('img');
    img.src = a.foto_url || obterAvatarPadrao(a.nome_completo);
    img.className = 'aluno-mini-thumb';
    const divInfo = document.createElement('div');
    divInfo.innerHTML = `<strong>${escapeHtml(a.nome_completo)}</strong><br><small style="color:var(--text-muted)">Matrícula: ${escapeHtml(a.matricula || '—')}</small>`;
    tdAluno.append(img, divInfo);

    // Turma / Curso
    const tdTurma = document.createElement('td');
    tdTurma.innerHTML = `<strong>${escapeHtml(a.turma)}</strong><br><small style="color:var(--text-muted)">${escapeHtml(a.curso || '—')}</small>`;

    // Responsável / WhatsApp
    const tdResp = document.createElement('td');
    const tel = a.telefone_responsavel ? a.telefone_responsavel.replace(/\D/g, '') : '';
    const linkWpp = tel ? `<a href="https://wa.me/55${tel}" target="_blank" style="color:var(--whatsapp); text-decoration:none; font-weight:600;">📱 ${escapeHtml(a.telefone_responsavel)}</a>` : '—';
    tdResp.innerHTML = `<div>${escapeHtml(a.nome_responsavel || '—')}</div><small>${linkWpp}</small>`;

    // Cartão NFC
    const tdUid = document.createElement('td');
    tdUid.innerHTML = `<span style="font-family:monospace; background:#0c1220; padding:3px 8px; border-radius:6px; border:1px solid var(--border-color);">${escapeHtml(a.uid_nfc)}</span>`;

    // Ações
    const tdAcoes = document.createElement('td');
    tdAcoes.style.textAlign = 'right';

    const btnStatus = document.createElement('button');
    btnStatus.className = 'btn-secundario';
    btnStatus.style.padding = '4px 8px';
    btnStatus.style.fontSize = '0.75rem';
    btnStatus.style.marginRight = '4px';
    btnStatus.textContent = a.ativo ? 'Bloquear' : 'Liberar';
    btnStatus.onclick = () => alternarAtivoAluno(a.id, !a.ativo);

    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn-secundario';
    btnEditar.style.padding = '4px 8px';
    btnEditar.style.fontSize = '0.75rem';
    btnEditar.style.marginRight = '4px';
    btnEditar.textContent = 'Editar';
    btnEditar.onclick = () => iniciarEdicaoAluno(a.id);

    const btnExcluir = document.createElement('button');
    btnExcluir.className = 'btn-secundario';
    btnExcluir.style.padding = '4px 8px';
    btnExcluir.style.fontSize = '0.75rem';
    btnExcluir.style.color = 'var(--danger)';
    btnExcluir.textContent = 'Excluir';
    btnExcluir.onclick = () => excluirAluno(a.id, a.nome_completo);

    tdAcoes.append(btnStatus, btnEditar, btnExcluir);
    tr.append(tdAluno, tdTurma, tdResp, tdUid, tdAcoes);
    tb.append(tr);
  });
}

function filtrarTabelaAlunos() {
  const busca = $('buscaAlunos') ? $('buscaAlunos').value.trim().toLowerCase() : '';
  const filtrados = listaAlunosCache.filter(a => 
    a.nome_completo.toLowerCase().includes(busca) ||
    (a.matricula && a.matricula.toLowerCase().includes(busca)) ||
    a.uid_nfc.toLowerCase().includes(busca) ||
    a.turma.toLowerCase().includes(busca)
  );
  renderizarTabelaAlunos(filtrados);
}

// =====================================================================
// SINCRONIZAÇÃO EM TEMPO REAL E EM LOTE COM A FLASH DO ESP32
// =====================================================================
async function sincronizarAlunoComEsp(uid, nome, ativo) {
  if (!espUrl || espUrl.startsWith('https://')) return;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(espUrl + '/api/sincronizar_aluno', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, nome, ativo }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (resp.ok) {
      console.log(`[SYNC ESP32] Aluno ${nome} (${uid}) gravado na Flash como: ${ativo ? 'LIBERADO' : 'BLOQUEADO'}`);
    }
  } catch (e) {
    console.warn('[SYNC ESP32] Aviso: Não foi possível atualizar o ESP32 localmente no momento:', e.message);
  }
}

async function removerAlunoDoEsp(uid) {
  if (!espUrl || espUrl.startsWith('https://')) return;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    await fetch(espUrl + '/api/remover_aluno', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
  } catch (e) {}
}

async function sincronizarTodosAlunosComEsp() {
  if (!supabaseClient) return toast('Supabase não conectado!', 'err');

  const botoes = document.querySelectorAll('.btn-sync-esp');
  botoes.forEach(b => {
    b.disabled = true;
    b.dataset.oldHtml = b.innerHTML;
    b.innerHTML = '⏳ Sincronizando...';
  });

  toast('Buscando todos os alunos no Supabase...', '');

  try {
    const { data: alunos, error } = await supabaseClient
      .from('alunos')
      .select('uid_nfc, nome_completo, ativo');

    if (error) throw error;
    if (!alunos || alunos.length === 0) {
      throw new Error('Nenhum aluno cadastrado no Supabase para sincronizar.');
    }

    const payloadEsp = alunos.map(a => ({
      uid: a.uid_nfc,
      nome: a.nome_completo,
      ativo: a.ativo
    }));

    toast(`Gravando ${payloadEsp.length} alunos na memória Flash do ESP32...`, '');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(espUrl + '/api/sincronizar_todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadEsp),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      throw new Error('ESP32 respondeu com código ' + resp.status);
    }

    toast(`✅ Sucesso! ${payloadEsp.length} alunos salvos na memória Flash do ESP32!`, 'ok');

  } catch (err) {
    console.error('Erro na sincronização completa:', err);
    toast('Falha ao sincronizar com o ESP32: ' + err.message, 'err');
  } finally {
    botoes.forEach(b => {
      b.disabled = false;
      if (b.dataset.oldHtml) b.innerHTML = b.dataset.oldHtml;
    });
  }
}

// Salvar Novo ou Atualizar Aluno
async function salvarAluno(ev) {
  if (ev) ev.preventDefault();
  if (!supabaseClient) return toast('Conecte o Supabase primeiro!', 'err');

  const btnSalvar = $('btnSalvarAluno');
  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Gravando no banco...';
  }

  try {
    const uid = $('campoUid').value.trim().toUpperCase();
    let fotoUrlFinal = $('previewFotoForm').src;

    // 1. Upload seguro para o Supabase Storage se houver nova foto
    if (fotoBlobProntoParaUpload) {
      if (btnSalvar) btnSalvar.textContent = 'Enviando foto (Storage)...';
      const nomeArquivo = uid.replace(/[^A-Z0-9]/g, '') + '_' + Date.now() + '.jpg';
      
      const { data: uploadData, error: uploadErr } = await supabaseClient.storage
        .from('fotos-alunos')
        .upload(nomeArquivo, fotoBlobProntoParaUpload, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadErr) throw new Error('Erro ao salvar foto: ' + uploadErr.message);

      const { data: urlData } = supabaseClient.storage
        .from('fotos-alunos')
        .getPublicUrl(nomeArquivo);

      fotoUrlFinal = urlData.publicUrl;
    }

    // 2. Prepara os dados validados
    const payload = {
      uid_nfc: uid,
      nome_completo: $('campoNome').value.trim(),
      matricula: $('campoMatricula').value.trim() || null,
      turma: $('campoTurma').value.trim(),
      curso: $('campoCurso').value.trim() || null,
      nome_responsavel: $('campoResponsavel').value.trim() || null,
      telefone_responsavel: $('campoTelefone').value.trim() || null,
      foto_url: fotoUrlFinal.startsWith('blob:') ? null : fotoUrlFinal,
      ativo: $('campoAtivo').checked
    };

    if (alunoEditandoId) {
      const { error } = await supabaseClient.from('alunos').update(payload).eq('id', alunoEditandoId);
      if (error) throw error;
      toast('Aluno atualizado com sucesso!', 'ok');
    } else {
      const { error } = await supabaseClient.from('alunos').insert([payload]);
      if (error) throw error;
      toast('Aluno cadastrado com sucesso!', 'ok');
    }

    // Sincroniza imediatamente com a Flash do ESP32
    sincronizarAlunoComEsp(uid, payload.nome_completo, payload.ativo);

    limparFormularioAluno();
    carregarAlunosDoSupabase();

  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (btnSalvar) {
      btnSalvar.disabled = false;
      btnSalvar.textContent = 'Salvar Aluno';
    }
  }
}

function iniciarEdicaoAluno(id) {
  const a = listaAlunosCache.find(x => x.id === id);
  if (!a) return;

  alunoEditandoId = a.id;
  $('campoNome').value = a.nome_completo;
  $('campoMatricula').value = a.matricula || '';
  $('campoTurma').value = a.turma;
  $('campoCurso').value = a.curso || '';
  $('campoResponsavel').value = a.nome_responsavel || '';
  $('campoTelefone').value = a.telefone_responsavel || '';
  $('campoUid').value = a.uid_nfc;
  $('campoAtivo').checked = a.ativo;

  $('previewFotoForm').src = a.foto_url || obterAvatarPadrao(a.nome_completo);
  fotoBlobProntoParaUpload = null;

  $('tituloFormAluno').textContent = '✏️ Editando: ' + a.nome_completo;
  $('btnSalvarAluno').textContent = 'Atualizar Aluno';
  $('btnCancelarEdicao').style.display = 'inline-block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limparFormularioAluno() {
  alunoEditandoId = null;
  fotoBlobProntoParaUpload = null;
  $('formAluno').reset();
  $('campoAtivo').checked = true;
  $('previewFotoForm').src = obterAvatarPadrao('Novo');
  $('tituloFormAluno').textContent = '➕ Cadastrar Aluno';
  $('btnSalvarAluno').textContent = 'Salvar Aluno';
  $('btnCancelarEdicao').style.display = 'none';
}

async function alternarAtivoAluno(id, novoEstado) {
  if (!supabaseClient) return;
  const a = listaAlunosCache.find(x => x.id === id);
  const { error } = await supabaseClient.from('alunos').update({ ativo: novoEstado }).eq('id', id);
  if (!error) {
    if (a) {
      a.ativo = novoEstado;
      sincronizarAlunoComEsp(a.uid_nfc, a.nome_completo, novoEstado);
    }
    toast(`Permissão alterada: ${novoEstado ? 'Liberado' : 'Bloqueado'}! Atualizando ESP32...`, 'ok');
    carregarAlunosDoSupabase();
  }
}

async function excluirAluno(id, nome) {
  if (!supabaseClient) return;
  if (!confirm(`Tem certeza que deseja excluir o aluno "${nome}"?`)) return;
  const a = listaAlunosCache.find(x => x.id === id);
  const { error } = await supabaseClient.from('alunos').delete().eq('id', id);
  if (!error) {
    if (a) {
      removerAlunoDoEsp(a.uid_nfc);
    }
    toast('Aluno excluído da nuvem e do leitor!', 'ok');
    carregarAlunosDoSupabase();
  }
}

async function capturarUidDoEsp() {
  toast('Consultando leitor no ESP32...', '');
  try {
    const resp = await fetch(espUrl + '/api/ultimo');
    const u = await resp.json();
    if (u.uid) {
      $('campoUid').value = u.uid;
      toast('Cartão capturado: ' + u.uid, 'ok');
    } else {
      toast('Nenhum cartão lido recentemente no ESP32.', 'err');
    }
  } catch (e) {
    toast('Não foi possível ler do ESP32. Digite o UID manualmente.', 'err');
  }
}

// =====================================================================
// PORTARIA EM TEMPO REAL: EXIBIÇÃO INSTANTÂNEA DA FICHA DO ALUNO
// =====================================================================
async function processarCartaoNaPortaria(uid) {
  const cardTotem = $('cardTotem');
  const badge = $('totemStatusBadge');
  const btnWpp = $('btnWhatsapp');

  if (!supabaseClient) return;

  const { data: alunos, error } = await supabaseClient
    .from('alunos')
    .select('*')
    .eq('uid_nfc', uid)
    .limit(1);

  const agora = new Date().toLocaleTimeString('pt-BR');

  if (alunos && alunos.length > 0) {
    const aluno = alunos[0];

    $('totemFoto').src = aluno.foto_url || obterAvatarPadrao(aluno.nome_completo);
    $('totemNome').textContent = aluno.nome_completo;
    $('totemMatricula').textContent = aluno.matricula || '—';
    $('totemTurma').textContent = aluno.turma;
    $('totemCurso').textContent = aluno.curso || '—';
    $('totemResponsavel').textContent = aluno.nome_responsavel || '—';

    if (aluno.ativo) {
      emitirBipSonoro('ok');
      cardTotem.className = 'card-totem liberado';
      badge.className = 'tag-status-acesso status-liberado';
      badge.textContent = 'ACESSO LIBERADO';
    } else {
      emitirBipSonoro('erro');
      cardTotem.className = 'card-totem bloqueado';
      badge.className = 'tag-status-acesso status-negado';
      badge.textContent = 'ACESSO BLOQUEADO';
    }

    if (aluno.telefone_responsavel) {
      const telLimpo = aluno.telefone_responsavel.replace(/\D/g, '');
      const msg = encodeURIComponent(`Olá ${aluno.nome_responsavel || ''}! Informamos que o aluno(a) ${aluno.nome_completo} acabou de passar na portaria da escola às ${agora}.`);
      btnWpp.href = `https://wa.me/55${telLimpo}?text=${msg}`;
      btnWpp.style.display = 'flex';
    } else {
      btnWpp.style.display = 'none';
    }

    supabaseClient.from('historico_acessos').insert([{
      uid_nfc: uid,
      aluno_id: aluno.id,
      nome_identificado: aluno.nome_completo,
      turma: aluno.turma,
      tipo_evento: 'ENTRADA',
      status: aluno.ativo ? 'LIBERADO' : 'BLOQUEADO'
    }]).then();

    adicionarNaListaRecentes({
      nome: aluno.nome_completo,
      turma: aluno.turma,
      foto: aluno.foto_url || obterAvatarPadrao(aluno.nome_completo),
      hora: agora
    });

  } else {
    emitirBipSonoro('erro');
    $('totemFoto').src = obterAvatarPadrao('?');
    $('totemNome').textContent = 'Cartão Desconhecido';
    badge.className = 'tag-status-acesso status-negado';
    badge.textContent = 'NÃO CADASTRADO (' + uid + ')';
    $('totemMatricula').textContent = '—';
    $('totemTurma').textContent = '—';
    $('totemCurso').textContent = '—';
    $('totemResponsavel').textContent = '—';
    btnWpp.style.display = 'none';
    cardTotem.className = 'card-totem bloqueado';

    adicionarNaListaRecentes({
      nome: 'Não Cadastrado',
      turma: uid,
      foto: obterAvatarPadrao('?'),
      hora: agora
    });
  }
}

function adicionarNaListaRecentes(item) {
  const lista = $('listaRecentes');
  if (!lista) return;
  if (lista.children.length === 1 && lista.children[0].textContent.includes('Nenhum acesso')) {
    lista.innerHTML = '';
  }

  const li = document.createElement('li');
  li.className = 'recente-item';

  const img = document.createElement('img');
  img.src = item.foto;
  img.className = 'recente-thumb';

  const divInfo = document.createElement('div');
  divInfo.className = 'recente-info';

  const divNome = document.createElement('div');
  divNome.className = 'recente-nome';
  divNome.textContent = item.nome;

  const divTurma = document.createElement('div');
  divTurma.className = 'recente-turma';
  divTurma.textContent = item.turma;

  divInfo.append(divNome, divTurma);

  const divHora = document.createElement('div');
  divHora.className = 'recente-hora';
  divHora.textContent = item.hora;

  li.append(img, divInfo, divHora);
  lista.prepend(li);
}

// =====================================================================
// CICLO DE MONITORAMENTO DO ESP32 (POLLING EM TEMPO REAL)
// =====================================================================
let primeiraLeituraFeita = false;

function alterarIpEspRapido() {
  const atual = espUrl || 'http://192.168.0.73';
  const novo = prompt('Endereço IP ou Host do ESP32-S3:', atual);
  if (novo) {
    espUrl = normalizarUrlEsp(novo);
    salvarStorage('cfg_esp_url', espUrl);
    if ($('cfgEspUrl')) $('cfgEspUrl').value = espUrl;
    if ($('txtStatusEsp')) $('txtStatusEsp').textContent = 'Buscando...';
    if ($('dotEsp')) $('dotEsp').className = 'dot';
    toast('IP do ESP32 atualizado para: ' + espUrl, 'ok');
    primeiraLeituraFeita = false;
    monitorarEsp32();
  }
}

async function monitorarEsp32() {
  if (window.location.protocol === 'https:' && espUrl.startsWith('http://')) {
    if ($('dotEsp')) $('dotEsp').className = 'dot offline';
    if ($('txtStatusEsp')) $('txtStatusEsp').textContent = 'Bloq. HTTPS';
    if ($('badgeEsp')) $('badgeEsp').title = 'Navegador em HTTPS (Vercel) bloqueia IP local HTTP. Abra o site via http://localhost:5500';
    setTimeout(monitorarEsp32, 4000);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const resp = await fetch(espUrl + '/api/ultimo', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const dados = await resp.json();

      if (dados.nfc_ok === false) {
        if ($('dotEsp')) $('dotEsp').className = 'dot offline';
        if ($('txtStatusEsp')) $('txtStatusEsp').textContent = 'Leitor OFF';
      } else {
        if ($('dotEsp')) $('dotEsp').className = 'dot online';
        if ($('txtStatusEsp')) $('txtStatusEsp').textContent = 'Online';
      }
      if ($('badgeEsp')) $('badgeEsp').title = `Conectado ao ESP32 em ${espUrl}. Toque para alterar.`;

      if (dados.seq !== undefined && dados.seq !== ultimoSeqDetectado) {
        ultimoSeqDetectado = dados.seq;

        if (!primeiraLeituraFeita) {
          primeiraLeituraFeita = true;
          // Se o cartão foi lido nos últimos 10 segundos ao abrir a página, processa
          if (dados.uid && (dados.ha === undefined || dados.ha <= 10)) {
            processarCartaoNaPortaria(dados.uid);
          }
        } else if (dados.uid) {
          processarCartaoNaPortaria(dados.uid);
        }
      }
    } else {
      if ($('dotEsp')) $('dotEsp').className = 'dot offline';
      if ($('txtStatusEsp')) $('txtStatusEsp').textContent = 'Falha (' + resp.status + ')';
    }
  } catch (e) {
    if ($('dotEsp')) $('dotEsp').className = 'dot offline';
    if ($('txtStatusEsp')) $('txtStatusEsp').textContent = 'Offline';
    if ($('badgeEsp')) $('badgeEsp').title = `Falha ao conectar em ${espUrl}. Toque para alterar IP.`;
  }

  setTimeout(monitorarEsp32, 1000);
}

// =====================================================================
// REGISTRO GLOBAL DE FUNÇÕES (WINDOW)
// =====================================================================
window.alterarIpEspRapido = alterarIpEspRapido;
window.trocarAba = trocarAba;
window.salvarConfiguracoes = salvarConfiguracoes;
window.salvarConfigRapido = salvarConfigRapido;
window.abrirModalConfigSupabaseRapido = abrirModalConfigSupabaseRapido;
window.testarConexoes = testarConexoes;
window.fazerLogin = fazerLogin;
window.fazerLogout = fazerLogout;
window.cadastrarPrimeiroAdmin = cadastrarPrimeiroAdmin;
window.abrirModalPrimeiroAdmin = abrirModalPrimeiroAdmin;
window.salvarAluno = salvarAluno;
window.iniciarEdicaoAluno = iniciarEdicaoAluno;
window.limparFormularioAluno = limparFormularioAluno;
window.alternarAtivoAluno = alternarAtivoAluno;
window.excluirAluno = excluirAluno;
window.capturarUidDoEsp = capturarUidDoEsp;
window.abrirModalCamera = abrirModalCamera;
window.fecharModalCamera = fecharModalCamera;
window.capturarFotoWebcam = capturarFotoWebcam;
window.processarArquivoFoto = processarArquivoFoto;
window.filtrarTabelaAlunos = filtrarTabelaAlunos;
window.sincronizarTodosAlunosComEsp = sincronizarTodosAlunosComEsp;
window.sincronizarAlunoComEsp = sincronizarAlunoComEsp;
window.abrirModalNovoUsuario = abrirModalNovoUsuario;
window.fecharModalUsuario = fecharModalUsuario;
window.salvarDadosUsuario = salvarDadosUsuario;
window.confirmarRedefinicaoSenha = confirmarRedefinicaoSenha;

// Inicialização segura
document.addEventListener('DOMContentLoaded', () => {
  carregarConfiguracoes();
  monitorarEsp32();
  limparFormularioAluno();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  carregarConfiguracoes();
  monitorarEsp32();
  limparFormularioAluno();
}
