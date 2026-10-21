#pragma once
#include <Arduino.h>

// Pagina de configuracao de Wi-Fi (modo AP): varredura, senha e conexao.
// Serve para o usuario escolher a rede do local sem precisar recompilar o firmware.
const char PAGINA_WIFI_HTML[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090d16">
<meta name="color-scheme" content="dark">
<meta http-equiv="Cache-Control" content="no-store">
<title>Configurar Wi-Fi - Controle de Acesso</title>
<style>
:root{--bg:#090d16;--card:#131c2e;--borda:#24324c;--txt:#f1f5f9;--sub:#94a3b8;--pri:#3b82f6;--pri-h:#2563eb;--ok:#10b981;--err:#ef4444;--wa:#f59e0b;--safe-t:env(safe-area-inset-top,0px);--safe-b:env(safe-area-inset-bottom,0px);--safe-l:env(safe-area-inset-left,0px);--safe-r:env(safe-area-inset-right,0px)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--txt);line-height:1.45;overflow-x:hidden;-webkit-tap-highlight-color:transparent}
header{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:calc(12px + var(--safe-t)) calc(16px + var(--safe-r)) 12px calc(16px + var(--safe-l));border-bottom:1px solid var(--borda);background:#0e1626}
h1{font-size:1.15rem;margin:0;display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere}
h2{font-size:1rem;margin:0 0 10px;color:#cbd5e1;display:flex;align-items:center;gap:6px;min-width:0}
a.btn{background:#1e293b;border:1px solid var(--borda);color:var(--txt);padding:8px 12px;border-radius:8px;font-size:.85rem;text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
a.btn:hover{background:#334155}
main{max-width:780px;margin:0 auto;padding:16px calc(14px + var(--safe-r)) calc(32px + var(--safe-b)) calc(14px + var(--safe-l));display:grid;gap:14px}
.box{background:var(--card);border:1px solid var(--borda);border-radius:14px;padding:16px;box-shadow:0 4px 16px rgba(0,0,0,.3);min-width:0}
.sub{color:var(--sub);font-size:.85rem;margin:0}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.chip{background:#18243b;border:1px solid var(--borda);padding:4px 10px;border-radius:999px;font-size:.78rem;color:var(--sub);overflow-wrap:anywhere}
.chip strong{color:var(--txt)}
.aviso{margin-top:12px;padding:12px 14px;border-radius:10px;font-size:.88rem;border:1px solid var(--borda);background:#0b1322;color:#cbd5e1}
.aviso[hidden]{display:none}
.aviso strong{color:#fff}
.aviso.ap{border-color:#b45309;background:#2a1a06;color:#fde68a}
.aviso.sta{border-color:#065f46;background:#04211a;color:#a7f3d0}
.topo{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.topo h2{margin:0}
.acoes{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.auto{display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--sub);cursor:pointer;user-select:none}
.auto input{width:16px;height:16px;margin:0;cursor:pointer}
.redes{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px;max-height:46vh;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.rede{display:flex;width:100%;text-align:left;gap:10px;align-items:center;background:#0e1626;border:1px solid var(--borda);color:var(--txt);border-radius:10px;padding:10px 12px;cursor:pointer;font-size:.9rem;font-weight:400}
.rede:hover{border-color:var(--pri)}
.rede.selecionada{border-color:var(--pri);background:#13223c;box-shadow:0 0 0 1px var(--pri) inset}
.rede .texto{flex:1;min-width:0;display:grid;gap:2px}
.rede .nome{font-weight:600;overflow-wrap:anywhere}
.rede .meta{color:var(--sub);font-size:.76rem;overflow-wrap:anywhere}
.sinal{display:inline-flex;gap:2px;align-items:flex-end;height:16px;flex:none}
.sinal i{width:3px;border-radius:1px;background:#334155}
.sinal i:nth-child(1){height:5px}.sinal i:nth-child(2){height:8px}.sinal i:nth-child(3){height:12px}.sinal i:nth-child(4){height:16px}
.sinal i.ativo{background:#34d399}
button{padding:10px 16px;border:0;border-radius:8px;background:var(--pri);color:#fff;cursor:pointer;font-size:.92rem;font-weight:600;transition:.15s;touch-action:manipulation}
button:hover{background:var(--pri-h)}
button.sec{background:#334155}button.sec:hover{background:#475569}
button.del{background:#dc2626}button.del:hover{background:#b91c1c}
button.sm{padding:6px 10px;font-size:.8rem}
button:disabled{opacity:.5;cursor:not-allowed}
label{display:block;font-size:.82rem;color:var(--sub);margin:12px 0 5px}
input[type=text],input[type=password]{width:100%;padding:11px 12px;border-radius:8px;border:1px solid var(--borda);background:#0a0f1d;color:var(--txt);font-size:16px}
input:focus{outline:2px solid var(--pri);border-color:transparent}
.senha-linha{display:flex;gap:8px;align-items:stretch}
.senha-linha input{flex:1;min-width:0}
.senha-linha button{flex:none}
.nota{font-size:.78rem;color:var(--sub);margin:14px 0 0;background:#0b1322;border:1px dashed var(--borda);border-radius:10px;padding:10px}
.nota strong{color:#cbd5e1}
.row{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
.row button{flex:1 1 auto}
.progresso{margin-top:12px}
.barra{height:6px;background:#0b1322;border-radius:999px;overflow:hidden;border:1px solid var(--borda)}
.barra i{display:block;height:100%;width:35%;background:linear-gradient(90deg,#3b82f6,#60a5fa);animation:corre 1.1s linear infinite}
@keyframes corre{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
#progressoTxt{display:block;margin-top:6px;font-size:.8rem;color:var(--sub)}
.resultado{margin-top:12px;padding:12px 14px;border-radius:10px;font-size:.88rem;overflow-wrap:anywhere}
.resultado.ok{background:#04211a;border:1px solid var(--ok);color:#d1fae5}
.resultado.err{background:#2a0808;border:1px solid var(--err);color:#fee2e2}
.resultado[hidden]{display:none}
#toast{position:fixed;left:50%;bottom:calc(20px + var(--safe-b));transform:translateX(-50%);max-width:min(92vw,480px);width:max-content;box-sizing:border-box;padding:11px 20px;border-radius:8px;background:#1e293b;border:1px solid var(--borda);box-shadow:0 8px 24px rgba(0,0,0,.5);opacity:0;transform:translate(-50%,10px);transition:.3s;pointer-events:none;z-index:99;font-weight:500;text-align:center;overflow-wrap:anywhere}
#toast.show{opacity:1;transform:translate(-50%,0)}#toast.err{background:#991b1b;color:#fff}#toast.ok{background:#065f46;color:#fff}
@media(max-width:640px){
  h1{font-size:1.05rem}
  main{padding-top:12px;gap:12px}
  .box{padding:14px;border-radius:12px}
  header{padding-top:calc(10px + var(--safe-t));padding-bottom:10px}
  .redes{max-height:none}
  .row button{flex:1 1 100%}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<header>
  <h1>📶 Configurar Wi-Fi</h1>
  <a class="btn" href="/">← Voltar ao painel</a>
</header>

<main>
  <section class="box">
    <h2>📡 Situação atual</h2>
    <div class="chips" id="chips"><span class="chip">Carregando...</span></div>
    <div id="avisoAp" class="aviso ap" hidden>
      <strong>Modo de configuração.</strong> Conecte o celular na rede <strong>ControleAcesso-S3</strong>, escolha abaixo a rede do local e informe a senha. A placa salva a rede e reinicia conectada.
    </div>
    <div id="avisoSta" class="aviso sta" hidden>
      <strong>Placa conectada.</strong> Para trocar de rede, use “Esquecer rede” no final desta página e configure novamente no modo AP.
    </div>
    <p class="sub" id="radioInfo" style="margin-top:12px">—</p>
  </section>

  <section class="box">
    <div class="topo">
      <h2>📶 Redes disponíveis</h2>
      <div class="acoes">
        <label class="auto"><input type="checkbox" id="auto" checked> Atualizar sozinho</label>
        <button class="sec sm" id="btnScan" type="button" onclick="escanear(true)">🔄 Atualizar</button>
      </div>
    </div>
    <p class="sub" id="scanMsg">Procurando redes 2,4 GHz...</p>
    <ul class="redes" id="redes"></ul>
    <p class="nota">Este chip tem rádio <strong>Wi-Fi 4 (802.11 b/g/n) somente em 2,4 GHz</strong>. Redes de <strong>5 GHz (Wi-Fi 5/6)</strong> não são suportadas pelo hardware — não é uma limitação do firmware. O Bluetooth 5 (LE) existe na placa, mas não é usado para acessar a internet.</p>
  </section>

  <section class="box">
    <h2>🔐 Conectar à rede</h2>
    <form id="form" onsubmit="conectar(event)">
      <label for="ssid">Nome da rede (SSID)</label>
      <input type="text" id="ssid" maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Toque em uma rede acima ou digite o nome" required>
      <label for="senha">Senha do Wi-Fi</label>
      <div class="senha-linha">
        <input type="password" id="senha" autocomplete="current-password" placeholder="Senha da rede (em branco se for aberta)">
        <button type="button" class="sec sm" id="btnOlho" onclick="alternarSenha()" title="Mostrar/ocultar senha">👁</button>
      </div>
      <p class="nota">
        Suporte a <strong>WPA2/WPA3-Pessoal</strong>. Redes WPA-Enterprise (com usuário e senha da escola) não podem ser configuradas por esta página.
        A senha fica salva apenas na memória interna da placa e nunca é exibida de volta.
      </p>
      <div class="row">
        <button type="submit" id="btnConectar">Conectar e salvar</button>
      </div>
      <div class="progresso" id="progresso" hidden>
        <div class="barra"><i></i></div>
        <span id="progressoTxt">Tentando conectar...</span>
      </div>
      <div class="resultado" id="resultado" hidden></div>
    </form>
  </section>

  <section class="box">
    <h2>💾 Rede salva</h2>
    <p class="sub" id="redeSalva">—</p>
    <div class="row">
      <button type="button" class="del sm" id="btnEsquecer" onclick="esquecer()" hidden>Esquecer rede e voltar ao modo AP</button>
    </div>
    <p class="nota">Use esta opção para mudar de rede ou quando a escola trocar a senha do Wi-Fi. A placa reinicia na rede <strong>ControleAcesso-S3</strong>.</p>
  </section>
</main>

<div id="toast"></div>
<noscript><p style="padding:16px">Ative o JavaScript do navegador para configurar o Wi-Fi.</p></noscript>

<script>
const $ = id => document.getElementById(id);
let estadoAtual = null;
let timerEstado = null, timerScan = null, timerProgresso = null;
let scanando = false;
let progressoInicio = 0, ssidTentando = '', sucessoMostrado = false;

function toast(msg, tipo) {
  const e = $('toast');
  e.textContent = msg;
  e.className = 'show ' + (tipo || '');
  clearTimeout(e._t);
  e._t = setTimeout(() => { e.className = ''; }, 3000);
}

function msgErro(e) {
  if (e && e.message && e.message !== 'Failed to fetch' && e.message !== 'Load failed') return e.message;
  return 'Sem conexão com a placa. Verifique se o celular continua na rede ControleAcesso-S3.';
}

async function api(metodo, url, corpo) {
  const opts = { method: metodo, cache: 'no-store' };
  if (corpo) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(corpo);
  }
  const r = await fetch(url, opts);
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.erro || ('Erro HTTP ' + r.status));
  return j;
}

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function agendarEstado(ms) {
  clearTimeout(timerEstado);
  timerEstado = setTimeout(atualizarEstado, ms);
}

function nivelSinal(rssi) {
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -78) return 2;
  if (rssi >= -89) return 1;
  return 0;
}

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR');
}

// ---------------- LISTA DE REDES ----------------

function renderRedes(lista) {
  const ul = $('redes');
  ul.innerHTML = '';
  if (!lista.length) {
    $('scanMsg').textContent = 'Nenhuma rede 2,4 GHz encontrada. Aproxime o celular do roteador ou digite o nome da rede mais abaixo.';
    return;
  }
  $('scanMsg').textContent = lista.length + ' rede(s) encontrada(s) • atualizado às ' + horaAgora();
  const alvo = $('ssid').value.trim();
  for (const r of lista) {
    const li = el('li');
    const b = el('button', 'rede' + (r.ssid === alvo ? ' selecionada' : ''));
    b.type = 'button';
    const texto = el('span', 'texto');
    texto.append(el('span', 'nome', r.ssid));
    const seg = r.aberta ? '🔓 Aberta' : '🔒 ' + (r.seguranca || 'Protegida');
    texto.append(el('span', 'meta', seg + ' • ' + r.rssi + ' dBm • canal ' + r.canal));
    const sinal = el('span', 'sinal');
    const nivel = nivelSinal(r.rssi);
    for (let i = 1; i <= 4; i++) sinal.append(el('i', i <= nivel ? 'ativo' : ''));
    b.append(texto, sinal);
    b.onclick = () => selecionarRede(b, r.ssid);
    li.append(b);
    ul.append(li);
  }
}

function selecionarRede(botao, ssid) {
  for (const b of $('redes').querySelectorAll('button.rede')) b.classList.remove('selecionada');
  botao.classList.add('selecionada');
  $('ssid').value = ssid;
  $('senha').focus();
}

async function escanear(forcar) {
  if (scanando) return;
  scanando = true;
  $('btnScan').disabled = true;
  $('scanMsg').textContent = 'Procurando redes 2,4 GHz...';
  try {
    const r = await api('GET', '/api/wifi/scan' + (forcar ? '?forcar=1' : ''));
    renderRedes(r.redes || []);
  } catch (e) {
    $('scanMsg').textContent = msgErro(e);
  }
  scanando = false;
  $('btnScan').disabled = false;
}

function cicloScan() {
  clearTimeout(timerScan);
  const conectado = estadoAtual && estadoAtual.modo === 'STA';
  const ocupado = scanando || sucessoMostrado || (estadoAtual && estadoAtual.tentativa && estadoAtual.tentativa.ativa);
  if ($('auto').checked && !document.hidden && !conectado && !ocupado) escanear(false);
  timerScan = setTimeout(cicloScan, 5000);
}

// ---------------- ESTADO / TENTATIVA ----------------

async function atualizarEstado() {
  try {
    const e = await api('GET', '/api/wifi/estado');
    estadoAtual = e;
    renderEstado();
    const t = e.tentativa || {};
    if (t.ativa) {
      sucessoMostrado = false;
      agendarEstado(1000);
    } else if (t.resultado === 'ok') {
      sucessoMostrado = true;
      agendarEstado(3000);
    } else {
      agendarEstado(3000);
    }
  } catch (err) {
    if (!sucessoMostrado) agendarEstado(2500);
  }
}

function renderEstado() {
  const e = estadoAtual;
  const chips = $('chips');
  chips.innerHTML = '';
  chips.append(el('span', 'chip', e.modo === 'AP' ? '📶 Modo configuração (AP)' : '✅ Conectado ao Wi-Fi'));
  chips.append(el('span', 'chip', '🌐 ' + e.ip));
  if (e.modo === 'AP') {
    chips.append(el('span', 'chip', '👥 ' + (e.clientes_ap || 0) + ' dispositivo(s) no AP'));
  } else if (e.rssi) {
    chips.append(el('span', 'chip', '📡 ' + e.rssi + ' dBm'));
  }
  $('avisoAp').hidden = e.modo !== 'AP';
  $('avisoSta').hidden = e.modo !== 'STA';
  $('redeSalva').textContent = e.tem_rede_salva
    ? e.ssid_salvo
    : 'Nenhuma rede salva na placa (usando a rede definida no código).';
  $('radioInfo').textContent = '🧩 ' + (e.chip || 'ESP32-S3') +
    ' • ' + (e.wifi_padrao || 'Wi-Fi 4') +
    ' • ' + (e.wifi_faixas || '2,4 GHz') +
    ' • ' + (e.bluetooth || 'Bluetooth 5 (LE)');

  const t = e.tentativa || {};
  if (t.ativa) {
    iniciarProgresso(t.ssid || $('ssid').value);
    return;
  }
  if (t.resultado === 'ok') {
    pararProgresso();
    mostrarSucesso(t.ip || e.ip);
    return;
  }
  if (t.resultado === 'falha') {
    pararProgresso();
    mostrarFalha(t.motivo || 'Não foi possível conectar.');
    return;
  }

  pararProgresso();
  $('resultado').hidden = true;
  const podeConectar = e.modo === 'AP';
  $('btnConectar').disabled = !podeConectar;
  $('ssid').disabled = !podeConectar;
  $('senha').disabled = !podeConectar;
  $('btnEsquecer').hidden = !e.tem_rede_salva && e.modo === 'AP';
}

function atualizarProgressoTxt() {
  if (!progressoInicio) return;
  const s = Math.round((Date.now() - progressoInicio) / 1000);
  $('progressoTxt').textContent = 'Tentando conectar a "' + ssidTentando + '"... ' + s + ' s (pode levar até 20 s)';
}

function iniciarProgresso(ssid) {
  if (!progressoInicio) {
    progressoInicio = Date.now();
    timerProgresso = setInterval(atualizarProgressoTxt, 500);
  }
  ssidTentando = ssid || ssidTentando;
  $('progresso').hidden = false;
  $('resultado').hidden = true;
  $('btnConectar').disabled = true;
  $('ssid').disabled = true;
  $('senha').disabled = true;
  atualizarProgressoTxt();
}

function pararProgresso() {
  progressoInicio = 0;
  clearInterval(timerProgresso);
  timerProgresso = null;
  $('progresso').hidden = true;
}

function mostrarSucesso(ip) {
  const r = $('resultado');
  r.hidden = false;
  r.className = 'resultado ok';
  r.textContent = '✅ Conectado! A placa vai reiniciar em instantes. Depois, conecte o celular na mesma rede Wi-Fi e acesse http://' + ip + ' (ou http://nfc.local).';
  $('btnConectar').disabled = true;
  $('ssid').disabled = true;
  $('senha').disabled = true;
}

function mostrarFalha(motivo) {
  const r = $('resultado');
  r.hidden = false;
  r.className = 'resultado err';
  r.textContent = '❌ ' + motivo;
  const pode = estadoAtual && estadoAtual.modo === 'AP';
  $('btnConectar').disabled = !pode;
  $('ssid').disabled = !pode;
  $('senha').disabled = !pode;
}

// ---------------- ACOES ----------------

async function conectar(ev) {
  ev.preventDefault();
  const ssid = $('ssid').value.trim();
  const senha = $('senha').value;
  if (!ssid) return toast('Escolha ou digite o nome da rede.', 'err');
  if (estadoAtual && estadoAtual.modo === 'STA') {
    return toast('Para trocar de rede, use “Esquecer rede” e reconfigurar no modo AP.', 'err');
  }
  if (senha && (senha.length < 8 || senha.length > 63)) {
    return toast('A senha deve ter entre 8 e 63 caracteres (ou ficar vazia para rede aberta).', 'err');
  }
  try {
    await api('POST', '/api/wifi/conectar', { ssid: ssid, senha: senha });
    iniciarProgresso(ssid);
    agendarEstado(800);
  } catch (e) {
    toast(msgErro(e), 'err');
  }
}

function alternarSenha() {
  const i = $('senha');
  i.type = (i.type === 'password') ? 'text' : 'password';
  $('btnOlho').textContent = (i.type === 'password') ? '👁' : '🙈';
}

async function esquecer() {
  if (!confirm('A placa vai esquecer a rede salva e reiniciar no modo de configuração (AP). Continuar?')) return;
  try {
    await api('POST', '/api/wifi/esquecer');
    toast('Rede esquecida. A placa vai reiniciar...', 'ok');
    pararProgresso();
    sucessoMostrado = true;
    setTimeout(() => location.reload(), 9000);
  } catch (e) {
    toast(msgErro(e), 'err');
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    atualizarEstado();
    escanear(false);
  }
});

$('auto').addEventListener('change', () => {
  if ($('auto').checked) escanear(true);
});

atualizarEstado();
escanear(false);
cicloScan();
</script>
</body>
</html>
)rawliteral";
