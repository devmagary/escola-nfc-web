// =====================================================================
// SISTEMA DE CONTROLE ESCOLAR NFC - CLIENTE WEB INTEGRADO
// Conecta o ESP32-S3 (Hardware Local) com o Supabase (Nuvem e Fotos)
// =====================================================================

const $ = id => document.getElementById(id);

let supabase = null;
let espUrl = "http://nfc.local";
let ultimoSeqDetectado = 0;
let alunoEditandoId = null;
let fotoBlobProntoParaUpload = null;
let listaAlunosCache = [];
let streamWebcam = null;

// Áudio sintético suave para aviso de aproximação do cartão
function emitirBipSonoro(tipo = 'ok') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (tipo === 'ok') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
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
  t.textContent = msg;
  t.className = 'show ' + tipo;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 3000);
}

// =====================================================================
// NAVEGAÇÃO ENTRE ABAS
// =====================================================================
function trocarAba(nomeAba) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

  $('aba-' + nomeAba).classList.add('active');
  
  const botoes = document.querySelectorAll('.nav-btn');
  if (nomeAba === 'portaria') botoes[0].classList.add('active');
  if (nomeAba === 'secretaria') {
    botoes[1].classList.add('active');
    carregarAlunosDoSupabase();
  }
  if (nomeAba === 'config') botoes[2].classList.add('active');
}

// =====================================================================
// INICIALIZAÇÃO & CONFIGURAÇÕES
// =====================================================================
function carregarConfiguracoes() {
  const url = localStorage.getItem('cfg_supabase_url') || '';
  const key = localStorage.getItem('cfg_supabase_key') || '';
  const esp = localStorage.getItem('cfg_esp_url') || 'http://nfc.local';

  $('cfgSupabaseUrl').value = url;
  $('cfgSupabaseKey').value = key;
  $('cfgEspUrl').value = esp;
  espUrl = esp.replace(/\/$/, '');

  if (url && key && window.supabase) {
    try {
      supabase = window.supabase.createClient(url, key);
      $('dotSupabase').className = 'dot online';
      $('txtStatusSupabase').textContent = 'Conectado';
    } catch (e) {
      $('dotSupabase').className = 'dot offline';
      $('txtStatusSupabase').textContent = 'Erro Chave';
    }
  } else {
    $('dotSupabase').className = 'dot offline';
    $('txtStatusSupabase').textContent = 'Pendente';
  }
}

function salvarConfiguracoes() {
  const url = $('cfgSupabaseUrl').value.trim();
  const key = $('cfgSupabaseKey').value.trim();
  const esp = $('cfgEspUrl').value.trim();

  localStorage.setItem('cfg_supabase_url', url);
  localStorage.setItem('cfg_supabase_key', key);
  localStorage.setItem('cfg_esp_url', esp);

  toast('Configurações salvas com sucesso!', 'ok');
  carregarConfiguracoes();
}

async function testarConexoes() {
  salvarConfiguracoes();
  toast('Testando conexões...', '');

  // 1. Testa Supabase
  if (supabase) {
    const { data, error } = await supabase.from('alunos').select('id').limit(1);
    if (!error) {
      toast('Supabase conectado com sucesso!', 'ok');
    } else {
      toast('Erro no Supabase: ' + error.message, 'err');
      return;
    }
  } else {
    toast('Preencha a URL e a Chave do Supabase!', 'err');
    return;
  }

  // 2. Testa ESP32
  try {
    const resp = await fetch(espUrl + '/api/status', { method: 'GET', mode: 'cors' });
    if (resp.ok) {
      toast('ESP32-S3 e Supabase 100% operacionais!', 'ok');
    } else {
      toast('ESP32 respondeu com status ' + resp.status, 'err');
    }
  } catch (e) {
    toast('ESP32 não alcançado. Verifique se o IP está certo ou se está na mesma rede.', 'err');
  }
}

// =====================================================================
// COMPRESSÃO INTELIGENTE DE FOTOS NO NAVEGADOR (CANVAS HTML5)
// =====================================================================
function redimensionarEComprimirImagem(imgOriginal) {
  return new Promise((resolve) => {
    const canvas = $('canvasCompressor');
    const ctx = canvas.getContext('2d');

    // Define tamanho padrão de carteirinha escolar (máximo 500x500 quadrado)
    const maxDim = 500;
    let width = imgOriginal.width;
    let height = imgOriginal.height;

    // Calcula corte proporcional centralizado
    let srcX = 0, srcY = 0, srcSize = Math.min(width, height);
    srcX = (width - srcSize) / 2;
    srcY = (height - srcSize) / 2;

    canvas.width = maxDim;
    canvas.height = maxDim;

    // Desenha cortado e redimensionado
    ctx.drawImage(imgOriginal, srcX, srcY, srcSize, srcSize, 0, 0, maxDim, maxDim);

    // Exporta como JPEG com compressão ótima (85% de qualidade = ~35 a 45 KB)
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
      $('previewFotoForm').src = urlPreview;
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
  $('modalCamera').style.display = 'none';
  if (streamWebcam) {
    streamWebcam.getTracks().forEach(t => t.stop());
    streamWebcam = null;
  }
}

async function capturarFotoWebcam() {
  const video = $('videoWebcam');
  const canvas = $('canvasCompressor');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 640;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const img = new Image();
  img.onload = async function() {
    fotoBlobProntoParaUpload = await redimensionarEComprimirImagem(img);
    $('previewFotoForm').src = URL.createObjectURL(fotoBlobProntoParaUpload);
    fecharModalCamera();
    toast('Foto capturada e otimizada!', 'ok');
  };
  img.src = canvas.toDataURL('image/jpeg');
}

// =====================================================================
// SECRETARIA: CRUD DE ALUNOS NO SUPABASE
// =====================================================================
async function carregarAlunosDoSupabase() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('alunos')
    .select('*')
    .order('nome_completo', { ascending: true });

  if (error) {
    toast('Erro ao buscar alunos: ' + error.message, 'err');
    return;
  }

  listaAlunosCache = data || [];
  renderizarTabelaAlunos(listaAlunosCache);
}

function renderizarTabelaAlunos(lista) {
  const tb = $('corpoTabelaAlunos');
  tb.innerHTML = '';
  $('contagemAlunos').textContent = lista.length;

  if (lista.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Nenhum aluno cadastrado.</td></tr>';
    return;
  }

  lista.forEach(a => {
    const tr = document.createElement('tr');
    
    // Foto + Nome + Matrícula
    const tdAluno = document.createElement('td');
    tdAluno.className = 'aluno-col-info';
    const img = document.createElement('img');
    img.src = a.foto_url || 'https://via.placeholder.com/80/1e293b/94a3b8?text=Sem+Foto';
    img.className = 'aluno-mini-thumb';
    const divInfo = document.createElement('div');
    divInfo.innerHTML = `<strong>${a.nome_completo}</strong><br><small style="color:var(--text-muted)">Matrícula: ${a.matricula || '—'}</small>`;
    tdAluno.append(img, divInfo);

    // Turma / Curso
    const tdTurma = document.createElement('td');
    tdTurma.innerHTML = `<strong>${a.turma}</strong><br><small style="color:var(--text-muted)">${a.curso || '—'}</small>`;

    // Responsável / WhatsApp
    const tdResp = document.createElement('td');
    const tel = a.telefone_responsavel ? a.telefone_responsavel.replace(/\D/g, '') : '';
    const linkWpp = tel ? `<a href="https://wa.me/55${tel}" target="_blank" style="color:var(--whatsapp); text-decoration:none; font-weight:600;">📱 ${a.telefone_responsavel}</a>` : '—';
    tdResp.innerHTML = `<div>${a.nome_responsavel || '—'}</div><small>${linkWpp}</small>`;

    // Cartão NFC
    const tdUid = document.createElement('td');
    tdUid.innerHTML = `<span style="font-family:monospace; background:#0c1220; padding:3px 8px; border-radius:6px; border:1px solid var(--border-color);">${a.uid_nfc}</span>`;

    // Ações
    const tdAcoes = document.createElement('td');
    tdAcoes.style.textAlign = 'right';
    tdAcoes.innerHTML = `
      <button class="btn-secundario" style="padding:4px 8px; font-size:0.75rem;" onclick="alternarAtivoAluno('${a.id}', ${!a.ativo})">
        ${a.ativo ? 'Bloquear' : 'Liberar'}
      </button>
      <button class="btn-secundario" style="padding:4px 8px; font-size:0.75rem;" onclick="iniciarEdicaoAluno('${a.id}')">
        Editar
      </button>
      <button class="btn-secundario" style="padding:4px 8px; font-size:0.75rem; color:var(--danger);" onclick="excluirAluno('${a.id}', '${a.nome_completo}')">
        Excluir
      </button>
    `;

    tr.append(tdAluno, tdTurma, tdResp, tdUid, tdAcoes);
    tb.append(tr);
  });
}

function filtrarTabelaAlunos() {
  const busca = $('buscaAlunos').value.trim().toLowerCase();
  const filtrados = listaAlunosCache.filter(a => 
    a.nome_completo.toLowerCase().includes(busca) ||
    (a.matricula && a.matricula.toLowerCase().includes(busca)) ||
    a.uid_nfc.toLowerCase().includes(busca) ||
    a.turma.toLowerCase().includes(busca)
  );
  renderizarTabelaAlunos(filtrados);
}

// Salvar Novo ou Atualizar Aluno
async function salvarAluno(ev) {
  ev.preventDefault();
  if (!supabase) return toast('Configure o Supabase primeiro na aba Configurações!', 'err');

  const btnSalvar = $('btnSalvarAluno');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Gravando no banco...';

  try {
    const uid = $('campoUid').value.trim().toUpperCase();
    let fotoUrlFinal = $('previewFotoForm').src;

    // 1. Se uma foto nova foi carregada/tirada, faz upload para o cofre do Supabase
    if (fotoBlobProntoParaUpload) {
      btnSalvar.textContent = 'Enviando foto (Supabase Storage)...';
      const nomeArquivo = uid.replace(/[^A-Z0-9]/g, '') + '_' + Date.now() + '.jpg';
      
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('fotos-alunos')
        .upload(nomeArquivo, fotoBlobProntoParaUpload, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadErr) throw new Error('Erro ao salvar foto: ' + uploadErr.message);

      const { data: urlData } = supabase.storage
        .from('fotos-alunos')
        .getPublicUrl(nomeArquivo);

      fotoUrlFinal = urlData.publicUrl;
    }

    // 2. Prepara os dados para salvar
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
      const { error } = await supabase.from('alunos').update(payload).eq('id', alunoEditandoId);
      if (error) throw error;
      toast('Aluno atualizado com sucesso!', 'ok');
    } else {
      const { error } = await supabase.from('alunos').insert([payload]);
      if (error) throw error;
      toast('Aluno cadastrado com sucesso!', 'ok');
    }

    limparFormularioAluno();
    carregarAlunosDoSupabase();

  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.textContent = 'Salvar Aluno';
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
  $('previewFotoForm').src = a.foto_url || 'https://via.placeholder.com/150/1e293b/94a3b8?text=Sem+Foto';
  fotoBlobProntoParaUpload = null;

  $('tituloFormAluno').textContent = '✏️ Editando: ' + a.nome_completo;
  $('btnSalvarAluno').textContent = 'Salvar Alterações';
  $('btnCancelarEdicao').style.display = 'inline-block';
  $('campoNome').focus();
}

function limparFormularioAluno() {
  alunoEditandoId = null;
  fotoBlobProntoParaUpload = null;
  $('formAluno').reset();
  $('campoAtivo').checked = true;
  $('previewFotoForm').src = 'https://via.placeholder.com/150/1e293b/94a3b8?text=Sem+Foto';
  $('tituloFormAluno').textContent = '➕ Cadastrar Aluno';
  $('btnSalvarAluno').textContent = 'Salvar Aluno';
  $('btnCancelarEdicao').style.display = 'none';
}

async function alternarAtivoAluno(id, novoStatus) {
  const { error } = await supabase.from('alunos').update({ ativo: novoStatus }).eq('id', id);
  if (!error) {
    toast('Permissão de acesso alterada!', 'ok');
    carregarAlunosDoSupabase();
  }
}

async function excluirAluno(id, nome) {
  if (!confirm(`Tem certeza que deseja excluir o aluno "${nome}"?`)) return;
  const { error } = await supabase.from('alunos').delete().eq('id', id);
  if (!error) {
    toast('Aluno excluído', 'ok');
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

  if (!supabase) return;

  // Busca o aluno no Supabase
  const { data: alunos, error } = await supabase
    .from('alunos')
    .select('*')
    .eq('uid_nfc', uid)
    .limit(1);

  const agora = new Date().toLocaleTimeString('pt-BR');

  if (alunos && alunos.length > 0) {
    const aluno = alunos[0];

    // Preenche a tela grande
    $('totemFoto').src = aluno.foto_url || 'https://via.placeholder.com/500/1e293b/94a3b8?text=Sem+Foto';
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

    // Configura o botão do WhatsApp
    if (aluno.telefone_responsavel) {
      const telLimpo = aluno.telefone_responsavel.replace(/\D/g, '');
      const msg = encodeURIComponent(`Olá ${aluno.nome_responsavel || ''}! Informamos que o aluno(a) ${aluno.nome_completo} acabou de passar na portaria da escola às ${agora}.`);
      btnWpp.href = `https://wa.me/55${telLimpo}?text=${msg}`;
      btnWpp.style.display = 'flex';
    } else {
      btnWpp.style.display = 'none';
    }

    // Registra entrada na tabela de histórico do Supabase
    supabase.from('historico_acessos').insert([{
      uid_nfc: uid,
      aluno_id: aluno.id,
      nome_identificado: aluno.nome_completo,
      turma: aluno.turma,
      tipo_evento: 'ENTRADA',
      status: aluno.ativo ? 'LIBERADO' : 'BLOQUEADO'
    }]).then();

    // Adiciona ao topo da lista de recentes da portaria
    adicionarNaListaRecentes({
      nome: aluno.nome_completo,
      turma: aluno.turma,
      foto: aluno.foto_url,
      hora: agora
    });

  } else {
    // Cartão Desconhecido
    emitirBipSonoro('erro');
    $('totemFoto').src = 'https://via.placeholder.com/500/334155/ef4444?text=Nao+Cadastrado';
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
      foto: null,
      hora: agora
    });
  }
}

function adicionarNaListaRecentes(item) {
  const lista = $('listaRecentes');
  if (lista.children.length === 1 && lista.children[0].textContent.includes('Nenhum acesso')) {
    lista.innerHTML = '';
  }

  const li = document.createElement('li');
  li.className = 'recente-item';
  li.innerHTML = `
    <img src="${item.foto || 'https://via.placeholder.com/80/1e293b/94a3b8?text=?'}" class="recente-thumb">
    <div class="recente-info">
      <div class="recente-nome">${item.nome}</div>
      <div class="recente-turma">${item.turma}</div>
    </div>
    <div class="recente-hora">${item.hora}</div>
  `;
  lista.prepend(li);
}

// =====================================================================
// CICLO DE MONITORAMENTO DO ESP32 (POLLING EM TEMPO REAL)
// =====================================================================
async function monitorarEsp32() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const resp = await fetch(espUrl + '/api/ultimo', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (resp.ok) {
      $('dotEsp').className = 'dot online';
      $('txtStatusEsp').textContent = 'Online';

      const dados = await resp.json();
      
      // Se detectou uma leitura nova
      if (dados.seq && dados.seq > ultimoSeqDetectado) {
        ultimoSeqDetectado = dados.seq;
        processarCartaoNaPortaria(dados.uid);
      }
    } else {
      $('dotEsp').className = 'dot offline';
      $('txtStatusEsp').textContent = 'Falha';
    }
  } catch (e) {
    $('dotEsp').className = 'dot offline';
    $('txtStatusEsp').textContent = 'Offline';
  }

  setTimeout(monitorarEsp32, 1200);
}

// Inicialização da Aplicação
carregarConfiguracoes();
monitorarEsp32();
