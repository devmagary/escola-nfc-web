/**
 * network.mjs — escolha do endereço IP do laboratório.
 * ---------------------------------------------------------------------------
 * O notebook do laboratório costuma ter várias interfaces além do Wi-Fi:
 * Tailscale, ZeroTier, WSL, Docker, Hyper-V, Bluetooth... Escolher "o primeiro
 * IPv4" podia gravar 100.x/172.x no .env.local e o tablet nunca alcançava o
 * painel.
 *
 * Este módulo centraliza a regra usada por:
 *   - scripts/lab-setup.mjs (grava SUPABASE_URL)
 *   - scripts/check-lab.mjs (diagnóstico e endereços)
 *   - scripts/serve-local.mjs (linhas "Rede:" no terminal)
 *
 * Regras:
 *   1. só IPv4 de interface física (Wi-Fi/Ethernet) ou do hotspot do Windows;
 *   2. fora loopback, link-local (169.254) e CGNAT/Tailscale (100.64/10);
 *   3. o hotspot do laboratório (192.168.137.1) tem prioridade quando ativo;
 *   4. prefere endereço privado (10/8, 172.16/12, 192.168/16);
 *   5. se houver mais de um, mantém a ordem do sistema e informe os demais.
 * ---------------------------------------------------------------------------
 */
import net from 'node:net';
import os from 'node:os';

/** IP padrão do hotspot/ICS do Windows (a rede criada pelo lab-hotspot.ps1). */
export const IP_HOTSPOT_WINDOWS = '192.168.137.1';

/** Interfaces que nunca são a rede que o tablet enxerga. */
export const ALIAS_INTERFACE_VIRTUAL =
  /tailscale|zerotier|wsl|hyper|virtual|loopback|docker|vethernet|vmware|virtualbox|vbox|tap|tun|bluetooth|vpn|wireguard|hamachi|radmin|nordlynx|mullvad|proton|openvpn|clash|singbox|sing-box/i;

/** Interfaces físicas comuns (usadas só para desempate na hora de escolher). */
export const ALIAS_INTERFACE_FISICA = /wi-?fi|wlan|wireless|ethernet|lan/i;

/**
 * Diz se um IPv4 pode ser usado por outro aparelho da rede local.
 * @param {string} endereco
 * @returns {boolean}
 */
export function ipv4Utilizavel(endereco) {
  if (!net.isIPv4(String(endereco || ''))) return false;
  const [primeiro, segundo] = String(endereco).split('.').map(Number);
  if (primeiro === 0 || primeiro === 127) return false;
  if (primeiro === 169 && segundo === 254) return false;
  // 100.64.0.0/10 — CGNAT, faixa usada pelo Tailscale.
  if (primeiro === 100 && segundo >= 64 && segundo <= 127) return false;
  return true;
}

/**
 * Classifica uma interface pelo nome e pelo endereço.
 * @param {string} apelido
 * @param {string} endereco
 * @returns {'fisica' | 'virtual' | 'ignorada'}
 */
export function classificarInterface(apelido, endereco) {
  if (ALIAS_INTERFACE_VIRTUAL.test(String(apelido || ''))) return 'virtual';
  if (!ipv4Utilizavel(endereco)) return 'ignorada';
  return 'fisica';
}

/**
 * Diz se o endereço é o IP padrão do hotspot do Windows.
 * @param {string} endereco
 * @returns {boolean}
 */
export function ehHotspotWindows(endereco) {
  return String(endereco || '').trim() === IP_HOTSPOT_WINDOWS;
}

/**
 * @typedef {{ apelido: string, endereco: string, privado: boolean, preferida: boolean, hotspot: boolean }} InterfaceRede
 */

/**
 * Lista as interfaces físicas utilizáveis, na ordem do sistema.
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [interfaces]
 * @returns {InterfaceRede[]}
 */
export function listarInterfacesRede(interfaces = os.networkInterfaces()) {
  /** @type {InterfaceRede[]} */
  const lista = [];
  const vistos = new Set();

  for (const [apelido, itens] of Object.entries(interfaces || {})) {
    for (const item of itens || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const endereco = item.address;
      if (classificarInterface(apelido, endereco) !== 'fisica') continue;
      if (vistos.has(endereco)) continue;
      vistos.add(endereco);
      lista.push({
        apelido,
        endereco,
        privado: ehEnderecoPrivado(endereco),
        preferida: ALIAS_INTERFACE_FISICA.test(apelido),
        hotspot: ehHotspotWindows(endereco),
      });
    }
  }

  return lista;
}

/**
 * Lista somente os IPs físicos utilizáveis (compatível com o código antigo).
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [interfaces]
 * @returns {string[]}
 */
export function listarIpsRede(interfaces = os.networkInterfaces()) {
  return listarInterfacesRede(interfaces).map((item) => item.endereco);
}

/**
 * Escolhe o IP que o tablet deve usar.
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [interfaces]
 * @returns {string}
 */
export function escolherIpPrincipal(interfaces = os.networkInterfaces()) {
  const lista = listarInterfacesRede(interfaces);
  if (lista.length === 0) return '';

  const ordenada = [...lista].sort((a, b) => {
    // Se o hotspot do laboratório está ligado, ele é a rede que o tablet usa.
    if (a.hotspot !== b.hotspot) return a.hotspot ? -1 : 1;
    if (a.privado !== b.privado) return a.privado ? -1 : 1;
    if (a.preferida !== b.preferida) return a.preferida ? -1 : 1;
    return 0;
  });

  return ordenada[0].endereco;
}

/**
 * @param {string} endereco
 * @returns {boolean}
 */
export function ehEnderecoPrivado(endereco) {
  const partes = String(endereco || '').split('.').map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = partes;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Texto curto para o terminal: "Wi-Fi 10.0.16.154".
 * @param {InterfaceRede} item
 * @returns {string}
 */
export function descreverInterface(item) {
  return `${item.apelido} ${item.endereco}${item.hotspot ? ' (hotspot)' : ''}`;
}
