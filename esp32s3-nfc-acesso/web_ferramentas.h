#pragma once
#include <Arduino.h>

// =====================================================================
// PÁGINA: CONSOLE SERIAL REMOTO VIA WI-FI (MONITOR EM TEMPO REAL)
// =====================================================================
const char PAGINA_CONSOLE_HTML[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#080d1a">
<meta name="color-scheme" content="dark">
<title>ESP32-S3 | Monitor Serial Wi-Fi</title>
<style>
:root{--bg:#080d1a;--terminal:#030712;--borda:#1e293b;--txt:#e2e8f0;--sub:#64748b;--pri:#3b82f6;--ok:#10b981;--err:#ef4444;--wa:#f59e0b;--nfc:#06b6d4;--safe-t:env(safe-area-inset-top,0px);--safe-b:env(safe-area-inset-bottom,0px);--safe-l:env(safe-area-inset-left,0px);--safe-r:env(safe-area-inset-right,0px)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,sans-serif;height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden;-webkit-tap-highlight-color:transparent}
header{background:#0f172a;border-bottom:1px solid var(--borda);padding:calc(10px + var(--safe-t)) calc(16px + var(--safe-r)) 10px calc(16px + var(--safe-l));display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.titulo{font-weight:700;font-size:1rem;display:flex;align-items:center;gap:6px;color:#38bdf8;min-width:0}
.chips{display:flex;gap:6px;font-size:0.75rem;align-items:center;flex-wrap:wrap}
.chip{background:#1e293b;padding:3px 8px;border-radius:999px;color:var(--sub);white-space:nowrap}
.chip strong{color:var(--txt)}
.toolbar{background:#0b1120;border-bottom:1px solid var(--borda);padding:8px calc(12px + var(--safe-r)) 8px calc(12px + var(--safe-l));display:flex;gap:6px;flex-wrap:wrap;align-items:center}
button{background:#1e293b;border:1px solid var(--borda);color:var(--txt);padding:6px 10px;border-radius:6px;font-size:0.8rem;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;transition:0.15s;font-weight:500;touch-action:manipulation}
button:hover{background:#334155}
button.pri{background:var(--pri);border-color:var(--pri);color:#fff}
button.err{background:rgba(239,68,68,0.2);border-color:var(--err);color:#f87171}
button:disabled{opacity:0.5;cursor:not-allowed}
.terminal-container{flex:1;min-height:0;background:var(--terminal);padding:12px calc(12px + var(--safe-r)) 12px calc(12px + var(--safe-l));overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:0.82rem;line-height:1.5;display:flex;flex-direction:column}
.linha-log{display:flex;gap:8px;word-break:break-word;overflow-wrap:anywhere;margin-bottom:2px}
.log-hora{color:var(--sub);font-size:0.75rem;min-width:65px;flex:none;user-select:none}
.log-msg{flex:1;min-width:0}
.log-info{color:#94a3b8}
.log-ok{color:var(--ok);font-weight:600}
.log-err{color:var(--err);font-weight:600}
.log-wa{color:var(--wa);font-weight:600}
.log-nfc{color:var(--nfc);font-weight:600}
.barra-status{background:#0f172a;border-top:1px solid var(--borda);padding:6px calc(12px + var(--safe-r)) calc(6px + var(--safe-b)) calc(12px + var(--safe-l));font-size:0.75rem;color:var(--sub);display:flex;justify-content:space-between;align-items:center;gap:8px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px;flex:none}
.dot.online{background:var(--ok);box-shadow:0 0 6px var(--ok)}
.dot.offline{background:var(--err)}
.nav-link{color:#38bdf8;text-decoration:none;font-weight:600;padding:6px 8px;border-radius:6px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);white-space:nowrap;touch-action:manipulation;display:inline-flex;align-items:center;justify-content:center}
.nav-link:hover{background:rgba(56,189,248,0.16)}

/* Celular: cabeçalho compacto, atalhos em linha unica rolavel e botoes confortaveis */
@media(max-width:700px){
  header{padding-top:calc(8px + var(--safe-t));padding-bottom:8px}
  .titulo{font-size:.92rem;width:100%}
  .chips{width:100%;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:2px}
  .chips::-webkit-scrollbar{display:none}
  .nav-link{font-size:.75rem;min-height:34px}
  .chips .chip{display:inline-flex;align-items:center;min-height:28px}
  .toolbar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
  .toolbar::-webkit-scrollbar{display:none}
  .toolbar button{flex:none;min-height:38px;font-size:.8rem;padding:8px 12px}
  .terminal-container{font-size:16px;padding-top:8px;padding-bottom:8px}
  .linha-log{flex-direction:column;gap:0;padding:2px 0;border-bottom:1px solid rgba(30,41,59,.45)}
  .log-hora{min-width:0;font-size:.68rem;letter-spacing:.4px}
  .log-msg{font-size:.95em}
  .barra-status{font-size:.7rem;padding-top:8px;padding-bottom:calc(8px + var(--safe-b))}
}
@media(max-width:480px){
  .barra-status{flex-wrap:wrap;row-gap:2px}
}

/* Celular deitado / telas baixas: prioridade total para o terminal */
@media(max-height:520px) and (orientation:landscape){
  header{padding-top:calc(6px + var(--safe-t));padding-bottom:6px;flex-wrap:nowrap;gap:12px}
  .titulo{width:auto;flex:0 1 auto;min-width:0;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chips{width:auto;flex:1 1 auto;flex-wrap:nowrap;justify-content:flex-end;overflow-x:auto;scrollbar-width:none}
  .chips::-webkit-scrollbar{display:none}
  .nav-link{min-height:34px;font-size:.72rem;display:inline-flex;align-items:center}
  .toolbar{padding-top:5px;padding-bottom:5px}
  .toolbar button{min-height:34px;padding:5px 10px}
  .linha-log{flex-direction:row;gap:8px;border-bottom:0}
  .log-hora{min-width:62px}
  .barra-status{padding-top:4px;padding-bottom:calc(4px + var(--safe-b))}
}
@media(hover:none){button:hover{background:#1e293b}button.pri:hover{background:var(--pri)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
/* Por ultimo: "celular deitado" vence a regra de celular em pe que vem antes */
@media(max-height:520px) and (orientation:landscape){
  .nav-link{min-height:30px;font-size:.72rem;padding:4px 8px}
  .chips .chip{padding:2px 7px}
}
</style>
</head>
<body>

<header>
  <div class="titulo">
    <span>📟</span> ESP32-S3 Web Serial Console
  </div>
  <div class="chips">
    <span class="chip" id="chipUptime">Uptime: 0s</span>
    <span class="chip" id="chipNfc">NFC: ...</span>
    <a href="/ota" class="nav-link">⬆️ OTA</a>
    <a href="/" class="nav-link">🏠 Painel</a>
  </div>
</header>

<div class="toolbar">
  <button type="button" class="pri" onclick="enviarComando('ping_nfc')">📡 Testar PN532</button>
  <button type="button" onclick="enviarComando('status')">📊 Diagnóstico</button>
  <button type="button" id="btnScroll" onclick="alternarScroll()">⏸️ Pausar Rolagem</button>
  <button type="button" onclick="limparTela()">🧹 Limpar Tela</button>
  <button type="button" class="err" onclick="enviarComando('reboot')">🔄 Reiniciar ESP32</button>
</div>

<div class="terminal-container" id="terminalBox">
  <div class="linha-log"><span class="log-hora">00:00:00</span><span class="log-msg log-info">Iniciando conexao ao console serial do ESP32-S3...</span></div>
</div>

<div class="barra-status">
  <div><span class="dot online" id="statusDot"></span><span id="txtConexao">Conectado via Wi-Fi</span></div>
  <div id="txtTotalLogs">0 linhas recebidas</div>
</div>

<script>
let ultimoIdLog = 0;
let autoScroll = true;
let totalRecebidos = 0;
const terminal = document.getElementById('terminalBox');

function atualizarBotaoScroll() {
  const btn = document.getElementById('btnScroll');
  btn.textContent = autoScroll ? '⏸️ Pausar Rolagem' : '▶️ Seguir Rolagem';
  btn.style.color = autoScroll ? '#fff' : '#f59e0b';
}

function alternarScroll() {
  autoScroll = !autoScroll;
  atualizarBotaoScroll();
  if (autoScroll) terminal.scrollTop = terminal.scrollHeight;
}

function limparTela() {
  terminal.innerHTML = '';
}

function escaparHtml(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// No celular, rolar a tela para cima pausa automaticamente; voltar ao fim retoma
terminal.addEventListener('scroll', () => {
  const noFim = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 40;
  if (noFim === autoScroll) return;
  autoScroll = noFim;
  atualizarBotaoScroll();
}, { passive: true });

async function buscarNovosLogs() {
  const pausado = document.hidden;
  try {
    const resp = await fetch('/api/logs?desde=' + ultimoIdLog);
    if (!resp.ok) throw new Error();
    const dados = await resp.json();

    document.getElementById('statusDot').className = 'dot online';
    document.getElementById('txtConexao').textContent = 'Conectado (' + (dados.ip || 'Wi-Fi') + ')';
    if (dados.uptime) document.getElementById('chipUptime').textContent = 'Uptime: ' + dados.uptime + 's';
    if (dados.nfc !== undefined) {
      document.getElementById('chipNfc').textContent = dados.nfc ? 'NFC: OK' : 'NFC: Desconectado';
      document.getElementById('chipNfc').style.color = dados.nfc ? '#10b981' : '#f87171';
    }

    if (dados.logs && dados.logs.length > 0) {
      dados.logs.forEach(l => {
        ultimoIdLog = Math.max(ultimoIdLog, l.id);
        totalRecebidos++;

        const linha = document.createElement('div');
        linha.className = 'linha-log';

        let classeCor = 'log-info';
        if (l.tipo === 'ok') classeCor = 'log-ok';
        if (l.tipo === 'err') classeCor = 'log-err';
        if (l.tipo === 'wa') classeCor = 'log-wa';
        if (l.tipo === 'nfc') classeCor = 'log-nfc';

        linha.innerHTML = '<span class="log-hora">' + l.hora + '</span>' +
                          '<span class="log-msg ' + classeCor + '">' + escaparHtml(l.msg) + '</span>';
        terminal.appendChild(linha);
      });

      document.getElementById('txtTotalLogs').textContent = totalRecebidos + ' linhas';

      if (autoScroll) {
        terminal.scrollTop = terminal.scrollHeight;
      }
    }
  } catch (e) {
    document.getElementById('statusDot').className = 'dot offline';
    document.getElementById('txtConexao').textContent = 'Reconectando...';
  }
  // Aba em segundo plano (tela bloqueada/trocou de app): economiza bateria e libera o ESP32
  setTimeout(buscarNovosLogs, pausado ? 4000 : 700);
}

async function enviarComando(cmd) {
  try {
    if (cmd === 'reboot' && !confirm('Tem certeza que deseja reiniciar o ESP32?')) return;
    const resp = await fetch('/api/comando?cmd=' + cmd, { method: 'POST' });
    const res = await resp.json();
    if (res.msg) {
      const l = document.createElement('div');
      l.className = 'linha-log';
      l.innerHTML = '<span class="log-hora">SISTEMA</span><span class="log-msg log-wa">>>> ' + escaparHtml(res.msg) + '</span>';
      terminal.appendChild(l);
      terminal.scrollTop = terminal.scrollHeight;
    }
  } catch (e) {
    alert('Erro ao enviar comando: ' + e.message);
  }
}

atualizarBotaoScroll();
buscarNovosLogs();
</script>
</body>
</html>
)rawliteral";

// =====================================================================
// PÁGINA: ATUALIZAÇÃO DE FIRMWARE OTA VIA NAVEGADOR (WEB OTA)
// =====================================================================
const char PAGINA_OTA_HTML[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090d16">
<meta name="color-scheme" content="dark">
<title>ESP32-S3 | Atualização OTA</title>
<style>
:root{--bg:#090d16;--card:#131c2e;--borda:#24324c;--txt:#f1f5f9;--sub:#94a3b8;--pri:#3b82f6;--pri-h:#2563eb;--ok:#10b981;--err:#ef4444;--safe-b:env(safe-area-inset-bottom,0px);--safe-l:env(safe-area-inset-left,0px);--safe-r:env(safe-area-inset-right,0px)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,sans-serif;padding:20px calc(20px + var(--safe-r)) calc(20px + var(--safe-b)) calc(20px + var(--safe-l));display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;-webkit-tap-highlight-color:transparent}
.card{background:var(--card);border:1px solid var(--borda);border-radius:18px;max-width:480px;width:100%;padding:28px;box-shadow:0 12px 32px rgba(0,0,0,0.5);margin:auto}
.topo{text-align:center;margin-bottom:20px}
.icone{font-size:2.8rem;margin-bottom:8px;line-height:1.1}
h1{font-size:clamp(1.1rem,1rem + 1vw,1.3rem);margin-bottom:6px;line-height:1.3;overflow-wrap:break-word}
p{color:var(--sub);font-size:0.85rem;line-height:1.4}
.zona-arquivo{border:2px dashed var(--borda);border-radius:12px;padding:24px;text-align:center;cursor:pointer;margin:20px 0;transition:0.2s;background:#0b1120;-webkit-user-select:none;user-select:none}
.zona-arquivo:hover,.zona-arquivo:focus-visible{border-color:var(--pri);background:#0f172a;outline:none}
.zona-arquivo.arrastando{border-color:var(--pri);background:#0f172a}
.nome-arq{color:var(--pri);font-weight:600;margin-top:8px;font-size:0.9rem;word-break:break-word;overflow-wrap:anywhere}
button{width:100%;padding:12px;border:0;border-radius:10px;background:var(--pri);color:#fff;font-size:0.95rem;font-weight:600;cursor:pointer;transition:0.2s;min-height:48px;touch-action:manipulation}
button:hover{background:var(--pri-h)}
button:disabled{opacity:0.5;cursor:not-allowed}
.progresso-box{margin-top:20px;display:none}
.barra-bg{background:#1e293b;border-radius:999px;height:12px;overflow:hidden;margin:8px 0}
.barra-fill{background:linear-gradient(90deg,#3b82f6,#10b981);height:100%;width:0%;transition:width 0.2s}
.progresso-txt{display:flex;justify-content:space-between;gap:8px;font-size:0.8rem;color:var(--sub)}
.alerta{margin-top:16px;padding:10px;border-radius:8px;font-size:0.8rem;text-align:center;display:none;overflow-wrap:anywhere}
.alerta.ok{background:rgba(16,185,129,0.15);color:var(--ok);border:1px solid rgba(16,185,129,0.3);display:block}
.alerta.err{background:rgba(239,68,68,0.15);color:var(--err);border:1px solid rgba(239,68,68,0.3);display:block}
.links{margin-top:20px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:0.8rem}
.links a{color:#38bdf8;text-decoration:none;padding:10px 8px;border-radius:8px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.22);flex:1 1 auto;text-align:center;min-width:0;touch-action:manipulation}
.links a:hover{background:rgba(56,189,248,0.16)}

/* Celular em pe: tela cheia sem cartao flutuante, e area de toque maior */
@media(max-width:560px){
  body{padding-top:calc(12px + env(safe-area-inset-top,0px));padding-bottom:calc(16px + var(--safe-b));align-items:flex-start}
  .card{padding:20px 16px;border-radius:14px}
  .icone{font-size:2.2rem;margin-bottom:4px}
  .topo{margin-bottom:14px}
  .zona-arquivo{padding:20px 14px;margin:14px 0}
  .links a{flex:1 1 100%}
}
/* Celular deitado: layout em duas colunas (arquivo a esquerda, status a direita) */
@media(max-height:520px) and (orientation:landscape){
  body{padding:10px calc(14px + var(--safe-r)) calc(10px + var(--safe-b)) calc(14px + var(--safe-l));align-items:center}
  .card{max-width:760px;padding:14px 18px;display:grid;grid-template-columns:1fr 1fr;column-gap:18px;align-items:start}
  .topo{grid-column:1/-1;display:flex;align-items:center;gap:12px;text-align:left;margin-bottom:4px}
  .icone{font-size:1.6rem;margin:0}
  .topo h1{margin:0}
  .topo p{display:none}
  #formOta{grid-column:1}
  .zona-arquivo{margin:10px 0;padding:14px}
  #formOta button{min-height:40px;padding:8px}
  .progresso-box,.alerta{grid-column:2;margin-top:8px}
  .progresso-box{align-self:start}
  .links{grid-column:1/-1;margin-top:10px}
  .links a{flex:1 1 0;padding:6px 8px}
}
@media(hover:none){button:not(:disabled):hover{background:var(--pri-h)}.zona-arquivo:hover{border-color:var(--borda);background:#0b1120}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>

<div class="card">
  <div class="topo">
    <div class="icone">⬆️</div>
    <h1>Atualização de Firmware OTA</h1>
    <p>Envie o arquivo binário compilado (<strong>.bin</strong>) para gravar o novo código no ESP32-S3 sem usar cabos.</p>
  </div>

  <form id="formOta">
    <div class="zona-arquivo" id="zonaArquivo" tabindex="0" role="button"
         onclick="document.getElementById('inputArquivo').click()"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('inputArquivo').click();}">
      <div style="font-size:1.8rem;line-height:1.1;">📁</div>
      <div style="margin-top:6px; font-weight:500;">Toque para selecionar o arquivo .bin</div>
      <div class="nome-arq" id="txtNomeArquivo">Nenhum arquivo selecionado</div>
      <input type="file" id="inputArquivo" accept=".bin" style="display:none;" onchange="arquivoSelecionado(this)">
      <div style="margin-top:6px;font-size:0.72rem;color:var(--sub);">Não achou o arquivo? Toque e segure para escolher arquivos do tipo “Todos os arquivos”.</div>
    </div>

    <button type="button" id="btnGravar" onclick="iniciarUploadOta()" disabled>
      Gravar Firmware via Wi-Fi
    </button>
  </form>

  <div class="progresso-box" id="boxProgresso">
    <div class="progresso-txt">
      <span>Enviando firmware...</span>
      <span id="txtPorcentagem">0%</span>
    </div>
    <div class="barra-bg">
      <div class="barra-fill" id="barraFill"></div>
    </div>
    <small style="color:var(--sub); display:block; text-align:center; font-size:0.75rem;">
      Não desligue o ESP32 durante a gravação.
    </small>
  </div>

  <div class="alerta" id="alertaBox"></div>

  <div class="links">
    <a href="/console">📟 Ir para Console Serial</a>
    <a href="/">🏠 Voltar ao Painel Web</a>
  </div>
</div>

<script>
let arquivoParaEnviar = null;

function arquivoSelecionado(input) {
  const arq = input.files && input.files[0];
  if (!arq) return;
  if (!/\.bin$/i.test(arq.name)) {
    document.getElementById('txtNomeArquivo').textContent = 'Selecione um arquivo .bin (firmware compilado)';
    documentoBotao(false);
    return;
  }
  arquivoParaEnviar = arq;
  document.getElementById('txtNomeArquivo').textContent =
    arq.name + ' (' + (arq.size > 1048576 ? (arq.size / 1048576).toFixed(2) + ' MB' : Math.round(arq.size / 1024) + ' KB') + ')';
  documentoBotao(true);
  // Permite escolher o mesmo arquivo de novo depois de um envio
  input.value = '';
}

function documentoBotao(habilitado) {
  document.getElementById('btnGravar').disabled = !habilitado;
}

// Android as vezes esconde o .bin ao filtrar por extensao; toque longo no cartao abre
// o seletor sem filtro para escolher qualquer arquivo.
(function ligarFallbackArquivo() {
  const zona = document.getElementById('zonaArquivo');
  let timer = null;
  const abrirSemFiltro = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '*/*';
    inp.onchange = () => arquivoSelecionado(inp);
    document.body.appendChild(inp);
    inp.click();
    setTimeout(() => inp.remove(), 60000);
  };
  zona.addEventListener('contextmenu', e => { e.preventDefault(); abrirSemFiltro(); });
  zona.addEventListener('touchstart', () => { timer = setTimeout(abrirSemFiltro, 600); }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev => zona.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
})();

function iniciarUploadOta() {
  if (!arquivoParaEnviar) return;
  if (!confirm('Iniciar gravação do firmware "' + arquivoParaEnviar.name + '" no ESP32-S3?')) return;

  const btn = document.getElementById('btnGravar');
  const boxProg = document.getElementById('boxProgresso');
  const barra = document.getElementById('barraFill');
  const pct = document.getElementById('txtPorcentagem');
  const alerta = document.getElementById('alertaBox');
  const zona = document.getElementById('zonaArquivo');

  btn.disabled = true;
  boxProg.style.display = 'block';
  alerta.className = 'alerta';
  alerta.style.display = 'none';
  if (zona) zona.style.pointerEvents = 'none';

  const formData = new FormData();
  formData.append('update', arquivoParaEnviar);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/ota', true);

  xhr.upload.onprogress = function(e) {
    if (e.lengthComputable) {
      const p = Math.round((e.loaded / e.total) * 100);
      barra.style.width = p + '%';
      pct.textContent = p + '%';
    }
  };

  xhr.onload = function() {
    if (xhr.status === 200) {
      barra.style.width = '100%';
      pct.textContent = '100%';
      alerta.className = 'alerta ok';
      alerta.textContent = 'Firmware gravado com sucesso! O ESP32 está reiniciando. Aguarde 8 segundos...';

      let contagem = 8;
      const t = setInterval(() => {
        contagem--;
        if (contagem > 0) {
          alerta.textContent = 'Firmware gravado! Reiniciando em ' + contagem + 's...';
        } else {
          clearInterval(t);
          window.location.href = '/console';
        }
      }, 1000);
    } else {
      alerta.className = 'alerta err';
      let detalhe = xhr.responseText || ('HTTP ' + xhr.status);
      try { const j = JSON.parse(xhr.responseText); detalhe = j.erro || detalhe; } catch (e) {}
      alerta.textContent = 'Falha na gravação: ' + detalhe;
      finalizar(false);
    }
  };

  xhr.onerror = function() {
    alerta.className = 'alerta err';
    alerta.textContent = 'Erro de comunicação ao enviar arquivo. Verifique se o celular continua na mesma rede do ESP32.';
    finalizar(false);
  };

  xhr.ontimeout = xhr.onerror;

  function finalizar(ok) {
    if (!ok) { btn.disabled = false; if (zona) zona.style.pointerEvents = ''; }
  }

  xhr.send(formData);
}
</script>
</body>
</html>
)rawliteral";
