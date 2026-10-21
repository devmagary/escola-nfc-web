#pragma once
#include <Arduino.h>

// Painel Web Avançado para ESP32-S3 (LittleFS + NTP + Backup + NeoPixel)
const char PAGINA_HTML[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090d16">
<meta name="color-scheme" content="dark">
<title>Controle de Acesso NFC - ESP32-S3</title>
<style>
:root{--bg:#090d16;--card:#131c2e;--borda:#24324c;--txt:#f1f5f9;--sub:#94a3b8;--pri:#3b82f6;--pri-h:#2563eb;--ok:#10b981;--err:#ef4444;--wa:#f59e0b;--safe-t:env(safe-area-inset-top,0px);--safe-b:env(safe-area-inset-bottom,0px);--safe-l:env(safe-area-inset-left,0px);--safe-r:env(safe-area-inset-right,0px)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--txt);line-height:1.4;-webkit-tap-highlight-color:transparent;overflow-x:hidden}
header{padding:calc(14px + var(--safe-t)) calc(24px + var(--safe-r)) 14px calc(24px + var(--safe-l));border-bottom:1px solid var(--borda);background:#0e1626;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
h1{font-size:1.25rem;margin:0;display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere}
h2{font-size:1rem;margin:0 0 12px;color:#cbd5e1;display:flex;align-items:center;gap:6px;min-width:0}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{background:#18243b;border:1px solid var(--borda);padding:4px 10px;border-radius:999px;font-size:.78rem;color:var(--sub)}
.chip strong{color:var(--txt)}
.chip.atual{animation:pisca 1.2s infinite}
@keyframes pisca{50%{border-color:var(--pri)}}
main{max-width:1120px;margin:0 auto;padding:20px calc(20px + var(--safe-r)) calc(20px + var(--safe-b)) calc(20px + var(--safe-l));display:grid;gap:18px;grid-template-columns:1fr 1fr}
.box{background:var(--card);border:1px solid var(--borda);border-radius:14px;padding:18px;box-shadow:0 4px 16px rgba(0,0,0,.3);min-width:0}
.full{grid-column:1/-1}
@supports (grid-template-columns:subgrid){@media(min-width:981px){main{grid-template-rows:auto auto 1fr;align-items:start}main>.box{grid-row:span 2;display:grid;grid-template-rows:subgrid;align-content:start}}}
label{display:block;font-size:.82rem;color:var(--sub);margin:10px 0 4px}
input[type=text],input[type=search]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--borda);background:#0a0f1d;color:var(--txt);font-size:.95rem}
input[type=text],input[type=search]{font-size:16px}
input:focus{outline:2px solid var(--pri);border-color:transparent}
.mono{font-family:ui-monospace,Consolas,monospace;letter-spacing:.5px}
button{padding:9px 15px;border:0;border-radius:8px;background:var(--pri);color:#fff;cursor:pointer;font-size:.9rem;font-weight:500;transition:.15s;touch-action:manipulation}
button:hover{background:var(--pri-h)}
button.sec{background:#334155}button.sec:hover{background:#475569}
button.del{background:#dc2626}button.del:hover{background:#b91c1c}
button.sm{padding:5px 10px;font-size:.8rem}
button:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}
.topo{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between;margin-bottom:12px;}
.topo h2{margin:0}
.acoes-topo{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.acoes-topo input[type=search]{width:240px}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:10px;border-bottom:1px solid var(--borda)}
th{color:var(--sub);font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px}
.tag{padding:3px 9px;border-radius:999px;font-size:.75rem;font-weight:600;white-space:nowrap}
.on{background:#064e3b;color:#6ee7b7}.off{background:#7f1d1d;color:#fca5a5}.wa{background:#78350f;color:#fcd34d}
.ultimo{font-size:clamp(1.4rem,1.1rem + 2vw,2rem);margin:6px 0;font-weight:bold;color:#60a5fa;overflow-wrap:anywhere}
.sub{color:var(--sub);font-size:.85rem}
.vazio{color:var(--sub);text-align:center;padding:20px}
.acoes{text-align:right;white-space:nowrap}
.acoes button+button{margin-left:6px}
/* Rolagem horizontal dos chips so quando realmente nao couber (evita "borrao" do primeiro item) */
.chips .chip{flex:none;white-space:nowrap}
.switch{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:.9rem;color:var(--txt);cursor:pointer;padding:6px 0}
.switch input{cursor:pointer;width:18px;height:18px;flex:none;margin:0}
a.link-painel{background:#1e293b;border:1px solid var(--borda);color:var(--txt);padding:7px 12px;border-radius:8px;font-size:.85rem;text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
a.link-painel:hover{background:#334155}
.faixa-wifi{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#78350f;border-bottom:1px solid #b45309;color:#fde68a;padding:10px calc(20px + var(--safe-r)) 10px calc(20px + var(--safe-l));font-size:.9rem}
.faixa-wifi[hidden]{display:none}
.faixa-wifi strong{color:#fff}
.faixa-wifi a{background:#f59e0b;color:#1c1917;font-weight:600;border-radius:8px;padding:8px 14px;text-decoration:none;white-space:nowrap}
.faixa-wifi a:hover{background:#fbbf24}
#toast{position:fixed;left:50%;bottom:calc(24px + var(--safe-b));transform:translateX(-50%);max-width:min(92vw,480px);width:max-content;box-sizing:border-box;padding:11px 20px;border-radius:8px;background:#1e293b;border:1px solid var(--borda);box-shadow:0 8px 24px rgba(0,0,0,.5);opacity:0;transform:translate(-50%,10px);transition:.3s;pointer-events:none;z-index:99;font-weight:500;text-align:center;overflow-wrap:anywhere}
#toast.show{opacity:1;transform:translate(-50%,0)}#toast.err{background:#991b1b;color:#fff}#toast.ok{background:#065f46;color:#fff}

/* ---------- Celular ---------- */
@media(max-width:980px){
  header{padding-top:calc(10px + var(--safe-t));padding-bottom:10px}
  main{grid-template-columns:1fr;padding:14px calc(14px + var(--safe-r)) calc(18px + var(--safe-b)) calc(14px + var(--safe-l));gap:14px}
  .row{margin-top:0}
  .topo h2{width:100%}
  .acoes-topo{width:100%;flex-wrap:nowrap}
  .acoes-topo input[type=search]{flex:1 1 100%;width:100%;max-width:none}
  .acoes-topo button{flex:1 1 0;min-width:0}
  .row button{flex:1 1 auto}
  .tab-scroll{-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
  /* Telas de toque: areas de toque confortaveis (>=36px) */
  button.sm{min-height:38px;padding:6px 10px;font-size:.8rem}
}
/* Cabeçalho e botões por coluna (apenas celular em pé) */
@media(max-width:640px){
  header{flex-direction:column;align-items:stretch;gap:8px}
  h1{font-size:1.1rem}
  .box{padding:14px;border-radius:12px}
  .chips{gap:6px;min-width:0}
  .chip{font-size:.74rem;padding:4px 9px;min-height:28px;display:inline-flex;align-items:center;max-width:100%;overflow-wrap:anywhere}
  #toast{left:calc(50% + (var(--safe-l) - var(--safe-r))/2);bottom:calc(16px + var(--safe-b));width:auto;max-width:min(92vw,480px)}
  .busca-campo{width:100%}
  .topo{padding-top:38px;position:relative}
  .topo .busca-campo{position:absolute;left:0;right:0;top:0}
  .row button{flex:1 1 100%}
  .switch{padding:10px 0;margin-top:8px}
  .switch input{width:20px;height:20px}
  button{min-height:40px;max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.25}
}

/* Tabela vira lista de cartões (evita rolagem horizontal no celular) */
@media(max-width:720px){
  .tab-cartoes .tab-scroll,.tab-cartoes table,.tab-cartoes tbody{display:block;width:100%}
  .tab-cartoes thead{display:none}
  .tab-cartoes tr{display:block;position:relative;padding:9px 11px 10px;margin-bottom:8px;border:1px solid var(--borda);border-radius:10px;background:#0e1626}
  .tab-cartoes tr:last-child{margin-bottom:0}
  .tab-cartoes td{display:block;border:0;padding:0;text-align:left}
  .tab-cartoes td:nth-child(1){font-weight:600;padding-right:92px;min-height:22px;line-height:1.35;overflow-wrap:anywhere}
  .tab-cartoes td:nth-child(2){color:var(--sub);font-size:.82rem;margin:4px 0 8px;overflow-wrap:anywhere}
  .tab-cartoes td:nth-child(3){float:right;margin-top:-30px;clear:none}
  .tab-cartoes td.acoes{float:none;white-space:normal;display:flex;gap:6px;margin-top:0;padding-top:8px;border-top:1px dashed var(--borda)}
  .tab-cartoes td.acoes button{flex:1 1 auto;min-width:0;margin:0!important;padding:6px 4px;font-size:.78rem}
  .tab-cartoes tr.vazio-lista{display:block}
  .tab-cartoes tr.vazio-lista td{float:none;padding:16px 6px;margin:0;text-align:center;min-height:0}
}

/* Histórico em cards */
@media(max-width:720px){
  .tab-log .tab-scroll,.tab-log table,.tab-log tbody{display:block;width:100%}
  .tab-log thead{display:none}
  .tab-log tr{display:block;padding:9px 12px;border-left:3px solid var(--borda);border-radius:8px;background:#0e1626;margin-bottom:8px}
  .tab-log tr:last-child{margin-bottom:0}
  .tab-log td{display:block;border:0;padding:0;text-align:left}
  .tab-log td:nth-child(1){font-size:.85rem;font-weight:600;margin-bottom:2px;display:inline-block}
  .tab-log td:nth-child(1):empty{display:none}
  .tab-log td:nth-child(1),.tab-log td:nth-child(2){white-space:nowrap}
  .tab-log td:nth-child(2){display:inline-block;float:right;font-size:.8rem;color:var(--sub);margin-left:8px}
  .tab-log td:nth-child(3){display:inline-block;margin-left:8px;font-size:.88rem}
  .tab-log td:nth-child(4){float:right;clear:both;margin-top:2px}
  .tab-log tr:has(.on){border-left-color:var(--ok)}
  .tab-log tr:has(.off){border-left-color:var(--err)}
  .tab-log tr:has(.wa){border-left-color:var(--wa)}
  .tab-log tr:has(.vazio){border:0;padding:0}
  .tab-log td.vazio{text-align:center;padding:16px 0}
}

/* Celular deitado / telas baixas: mais densidade, cabeçalho em uma linha */
@media(max-height:500px) and (orientation:landscape){
  header{padding-top:calc(7px + var(--safe-t));padding-bottom:7px;flex-direction:row;flex-wrap:nowrap;gap:10px}
  header h1{flex:0 0 auto;white-space:nowrap;font-size:.82rem}
  #status{flex:1 1 0;min-width:0;justify-content:flex-end;padding-left:6px}
  #status .chip{min-height:0!important;padding:1px 6px!important;font-size:.68rem!important;line-height:1.25;border-radius:6px}
  .chips{flex:0 1 auto;min-width:0;flex-wrap:nowrap;justify-content:flex-end;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
  .chips::-webkit-scrollbar{display:none}
  .chip{white-space:nowrap}
  main{padding:10px calc(10px + var(--safe-r)) calc(10px + var(--safe-b)) calc(10px + var(--safe-l));gap:10px}
  .box{padding:12px 14px}
  .row{margin-top:8px}
  .topo{margin-bottom:8px}
  .busca-campo{display:none}
  .topo{padding-top:0}
}

/* Celular deitado (paisagem): lista completa e densa, sem cards empilhados */
@media(max-height:520px) and (orientation:landscape){
  .tab-cartoes table{display:table;width:100%}
  .tab-cartoes thead{display:table-header-group}
  .tab-cartoes tbody{display:table-row-group}
  .tab-cartoes tr{display:table-row;padding:0;margin:0;border:0;background:none}
  .tab-cartoes td{display:table-cell;padding:6px 8px;border-bottom:1px solid var(--borda);vertical-align:middle}
  .tab-cartoes td:nth-child(1),.tab-cartoes td:nth-child(2){padding-right:8px;margin:0;min-height:0;color:var(--txt);font-size:.85rem}
  .tab-cartoes td:nth-child(3){float:none;margin:0;text-align:center}
  .tab-cartoes td.acoes{display:table-cell;border-top:0;padding-top:6px;text-align:right;white-space:nowrap}
  .tab-cartoes td.acoes button{flex:none;min-height:30px;padding:4px 8px;margin-left:4px!important}
  .tab-cartoes tr.vazio-lista td{display:table-cell}
  .tab-log tr{padding:7px 10px}
  .tab-log td:nth-child(3){margin-left:6px}
  .tab-cartoes tr,.tab-log tr{margin-bottom:6px}
  .tab-cartoes td.acoes{padding-top:6px;margin-top:0}
  main{grid-template-columns:1fr}
  .row button{flex:0 1 auto;width:auto}
}
@media(orientation:landscape) and (max-width:950px) and (min-width:641px){
  /* Tablet/celular deitado: 2 colunas desde que haja largura */
  main{grid-template-columns:1fr 1fr}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<header>
  <h1>⚡ ESP32-S3 NFC Manager</h1>
  <a class="link-painel" href="/wifi">⚙️ Configurar Wi-Fi</a>
  <div class="chips" id="status"><span class="chip">Conectando...</span></div>
</header>

<div id="faixaWifi" class="faixa-wifi" hidden>
  <span>📡 <strong>Sem conexão com o Wi-Fi da escola.</strong> A placa está na rede de configuração <strong>ControleAcesso-S3</strong>.</span>
  <a href="/wifi">Configurar agora</a>
</div>

<main>
  <!-- Card: Último Cartão Detectado -->
  <section class="box">
    <h2>📡 Última Leitura NFC</h2>
    <div id="ultUid" class="ultimo mono">—</div>
    <div id="ultInfo" class="sub">Aproxime uma tag ou cartão do leitor PN532</div>
    <div class="row">
      <button id="btnUsar" disabled onclick="usarUltimo()">Cadastrar este cartão</button>
      <button class="sec" id="btnAguardar" onclick="aguardar()">Aguardar aproximação</button>
    </div>
  </section>

  <!-- Card: Formulário CRUD -->
  <section class="box">
    <h2 id="formTitulo">➕ Cadastrar Novo Cartão</h2>
    <form id="form" onsubmit="salvar(event)">
      <label for="fUid">UID Hexadecimal (ex: 2C:9D:7E:8E)</label>
      <input type="text" id="fUid" class="mono" required autocomplete="off" placeholder="Aproxime no leitor ou digite aqui">
      <label for="fNome">Identificação / Nome do Titular</label>
      <input type="text" id="fNome" maxlength="40" required autocomplete="off" placeholder="Ex: Maria Clara - Escritório">
      <label class="switch"><input type="checkbox" id="fAtivo" checked> Permitir acesso (Ativo)</label>
      <div class="row">
        <button type="submit" id="btnSalvar">Salvar Cartão</button>
        <button type="button" class="sec" id="btnCancelar" onclick="limpar()" hidden>Cancelar</button>
      </div>
    </form>
  </section>

  <!-- Tabela de Cartões Cadastrados -->
  <section class="box full">
    <div class="topo">
      <h2>🪪 Cartões Cadastrados <span id="contagem" class="chip">0</span></h2>
      <div class="busca-campo">
        <input type="search" id="busca" placeholder="🔍 Buscar nome ou UID..." oninput="render()">
      </div>
      <div class="acoes-topo">
        <button class="sec sm" onclick="baixarBackup()" title="Download JSON dos cartões">📥 Backup</button>
        <button class="sec sm" onclick="$('inpUpload').click()" title="Restaurar backup JSON">📤 Restaurar</button>
        <input type="file" id="inpUpload" accept=".json" style="display:none" onchange="restaurarBackup(event)">
      </div>
    </div>
    <div class="tab-scroll">
      <table class="tab-cartoes">
        <thead><tr><th>Nome</th><th>UID</th><th>Permissão</th><th class="acoes">Ações</th></tr></thead>
        <tbody id="lista"></tbody>
      </table>
    </div>
  </section>

  <!-- Histórico Persistente com Data/Hora NTP -->
  <section class="box full">
    <div class="topo">
      <h2>🕒 Histórico de Acessos Recentes</h2>
      <button class="sec sm del" onclick="limparHistorico()">Limpar Histórico</button>
    </div>
    <div class="tab-scroll">
      <table class="tab-log">
        <thead><tr><th>Data / Hora</th><th>UID</th><th>Titular</th><th>Status</th></tr></thead>
        <tbody id="log"></tbody>
      </table>
    </div>
  </section>
</main>
<div id="toast"></div>

<script>
let cartoes = [], info = {}, ultimo = null, editando = null, esperandoSeq = null, tick = 0;
const $ = id => document.getElementById(id);

function toast(msg, tipo) {
  const e = $('toast');
  e.textContent = msg;
  e.className = 'show ' + (tipo || '');
  clearTimeout(e._t);
  e._t = setTimeout(() => e.className = '', 2800);
}

// Erros de rede/senha no celular: evita "Failed to fetch" (mensagem pouco útil)
function msgErro(e) {
  if (e && e.message && e.message !== 'Failed to fetch' && e.message !== 'Load failed') return e.message;
  return 'Sem conexão com o ESP32. Verifique o Wi-Fi e recarregue a página.';
}

async function api(metodo, url, params, corpo) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const opts = { method: metodo };
  if (corpo) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(corpo);
  }
  const r = await fetch(url + qs, opts);
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.erro || ('Erro HTTP ' + r.status));
  return j;
}

function el(tag, txt, cls) {
  const e = document.createElement(tag);
  if (txt != null) e.textContent = txt;
  if (cls) e.className = cls;
  return e;
}

function linhaVazia(tb, msg, cols) {
  const tr = el('tr', null, 'vazio-lista'), td = el('td', msg, 'vazio');
  td.colSpan = cols; tr.append(td); tb.append(tr);
}

function ha(s) {
  if (s < 60) return 'há ' + s + ' s';
  if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
  return 'há ' + Math.floor(s / 3600) + ' h';
}

function duracao(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? h + 'h ' + m + 'min' : m + 'min';
}

// ---------- READ CARTOES ----------
async function carregar() {
  try { cartoes = await api('GET', '/api/cartoes'); render(); }
  catch (e) { toast(msgErro(e), 'err'); }
}

function render() {
  const f = $('busca').value.trim().toLowerCase();
  const tb = $('lista');
  tb.innerHTML = '';
  $('contagem').textContent = cartoes.length;

  const vis = cartoes.filter(c => !f || c.nome.toLowerCase().includes(f) || c.uid.toLowerCase().includes(f));
  if (!vis.length) return linhaVazia(tb, cartoes.length ? 'Nenhum resultado para a busca' : 'Nenhum cartão cadastrado no sistema', 4);

  for (const c of vis) {
    const tr = el('tr');
    tr.append(el('td', c.nome), el('td', c.uid, 'mono'));
    const st = el('td');
    st.append(el('span', c.ativo ? 'Autorizado' : 'Bloqueado', 'tag ' + (c.ativo ? 'on' : 'off')));
    tr.append(st);

    const ac = el('td', null, 'acoes');
    const b1 = el('button', c.ativo ? 'Bloquear' : 'Liberar', 'sm sec'); b1.onclick = () => alternar(c);
    const b2 = el('button', 'Editar', 'sm');                             b2.onclick = () => editar(c);
    const b3 = el('button', 'Excluir', 'sm del');                        b3.onclick = () => excluir(c);
    ac.append(b1, b2, b3);
    tr.append(ac);
    tb.append(tr);
  }
}

// ---------- CREATE / UPDATE ----------
async function salvar(ev) {
  ev.preventDefault();
  const p = { uid: $('fUid').value.trim(), nome: $('fNome').value.trim(), ativo: $('fAtivo').checked ? 1 : 0 };
  try {
    if (editando) {
      p.novo_uid = p.uid; p.uid = editando;
      await api('PUT', '/api/cartoes', p);
      toast('Cartão atualizado com sucesso!', 'ok');
    } else {
      await api('POST', '/api/cartoes', p);
      toast('Cartão gravado na Flash!', 'ok');
    }
    limpar();
    await carregar();
    atualizarUltimo();
  } catch (e) { toast(msgErro(e), 'err'); }
}

function editar(c) {
  editando = c.uid;
  $('fUid').value = c.uid;
  $('fNome').value = c.nome;
  $('fAtivo').checked = c.ativo;
  $('formTitulo').textContent = '✏️ Editando: ' + c.nome;
  $('btnSalvar').textContent = 'Salvar Alterações';
  $('btnCancelar').hidden = false;
  $('fNome').focus();
}

function limpar() {
  editando = null;
  $('form').reset();
  $('fAtivo').checked = true;
  $('formTitulo').textContent = '➕ Cadastrar Novo Cartão';
  $('btnSalvar').textContent = 'Salvar Cartão';
  $('btnCancelar').hidden = true;
}

async function alternar(c) {
  try { await api('PUT', '/api/cartoes', { uid: c.uid, ativo: c.ativo ? 0 : 1 }); carregar(); }
  catch (e) { toast(msgErro(e), 'err'); }
}

// ---------- DELETE ----------
async function excluir(c) {
  if (!confirm('Tem certeza que deseja apagar o cartão de "' + c.nome + '" (' + c.uid + ')?')) return;
  try {
    await api('DELETE', '/api/cartoes', { uid: c.uid });
    toast('Cartão removido', 'ok');
    if (editando === c.uid) limpar();
    carregar();
  } catch (e) { toast(msgErro(e), 'err'); }
}

// ---------- BACKUP E RESTAURAÇÃO ----------
function baixarBackup() {
  window.location.href = '/api/backup';
}

async function restaurarBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('Importar este arquivo substituirá os cartões atuais. Deseja continuar?')) return;
  try {
    const text = await file.text();
    const dados = JSON.parse(text);
    await api('POST', '/api/restaurar', null, dados);
    toast('Backup restaurado com sucesso!', 'ok');
    carregar();
  } catch (e) {
    toast('Erro no backup: ' + msgErro(e), 'err');
  }
  event.target.value = '';
}

// ---------- LEITURA NFC EM TEMPO REAL ----------
function usarUltimo() {
  if (!ultimo || !ultimo.uid) return;
  const c = cartoes.find(x => x.uid === ultimo.uid);
  if (c) return editar(c);
  limpar();
  $('fUid').value = ultimo.uid;
  $('fNome').focus();
}

function aguardar() {
  esperandoSeq = ultimo ? ultimo.seq : 0;
  $('btnAguardar').textContent = 'Aproxime o cartão agora...';
  $('btnAguardar').disabled = true;
}

async function atualizarUltimo() {
  try {
    const u = await api('GET', '/api/ultimo');
    const novo = u.seq !== (ultimo ? ultimo.seq : 0);
    ultimo = u;
    if (!u.seq) {
      $('ultUid').textContent = '—';
      $('ultInfo').textContent = 'Aproxime uma tag ou cartão do leitor';
      $('btnUsar').disabled = true;
    } else {
      $('ultUid').textContent = u.uid;
      $('ultInfo').textContent = (u.cadastrado ? 'Cadastrado: ' + u.nome : 'Não cadastrado') + ' · ' + ha(u.ha);
      $('btnUsar').disabled = false;
      $('btnUsar').textContent = u.cadastrado ? 'Editar este cartão' : 'Cadastrar este cartão';
      if (novo) {
        $('ultUid').classList.add('atual');
        setTimeout(() => $('ultUid').classList.remove('atual'), 1200);
      }
    }
    if (esperandoSeq !== null && u.seq > esperandoSeq) {
      esperandoSeq = null;
      $('btnAguardar').textContent = 'Aguardar aproximação';
      $('btnAguardar').disabled = false;
      toast('Cartão detectado: ' + u.uid, 'ok');
      usarUltimo();
    }
  } catch (e) {}
}

async function atualizarLog() {
  try {
    const l = await api('GET', '/api/log');
    const tb = $('log');
    tb.innerHTML = '';
    if (!l.length) return linhaVazia(tb, 'Nenhum acesso gravado no log', 4);
    const nomes = ['Liberado', 'Não cadastrado', 'Bloqueado'], cls = ['on', 'off', 'wa'];
    for (const e of l) {
      const tr = el('tr');
      tr.append(el('td', e.dh || ha(e.ha), 'mono'), el('td', e.uid, 'mono'), el('td', e.nome || '—'));
      const td = el('td');
      td.append(el('span', nomes[e.res], 'tag ' + cls[e.res]));
      tr.append(td);
      tb.append(tr);
    }
  } catch (e) {}
}

async function limparHistorico() {
  if (!confirm('Deseja limpar todo o histórico de acessos da memória Flash?')) return;
  try {
    await api('DELETE', '/api/log');
    toast('Histórico limpo', 'ok');
    atualizarLog();
  } catch (e) { toast(msgErro(e), 'err'); }
}

async function atualizarStatus() {
  try {
    info = await api('GET', '/api/status');
    const s = $('status');
    s.innerHTML = '';
    s.append(
      el('span', info.modo === 'AP' ? '📶 Rede AP: ' + info.ssid : '📶 ' + info.ssid + ' (' + info.rssi + ' dBm)', 'chip'),
      el('span', '🌐 ' + info.ip, 'chip'),
      el('span', info.nfc ? '🟢 NFC PN532 OK' : '🔴 NFC Desconectado', 'chip'),
      el('span', '🧠 PSRAM: ' + info.psram + 'MB', 'chip'),
      el('span', '🕒 ' + (info.hora || ('Uptime ' + duracao(info.uptime))), 'chip')
    );
    $('faixaWifi').hidden = info.modo !== 'AP';
    render();
  } catch (e) {}
}

async function ciclo() {
  await atualizarUltimo();
  if (tick % 2 === 0) await atualizarLog();
  if (tick % 8 === 0) await atualizarStatus();
  tick++;
  setTimeout(ciclo, 1200);
}

// Ao voltar do segundo plano (troca de app no celular), atualiza na hora
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { atualizarUltimo(); atualizarStatus(); }
});

carregar();
ciclo();
</script>
</body>
</html>
)rawliteral";
