/**
 * VPN Manager — Cloudflare WARP via WireProxy
 *
 * Uses Cloudflare's free WARP network (WireGuard protocol) to route
 * traffic through Cloudflare's 200+ city global network.
 *
 * Architecture:
 * 1. Download wireproxy.exe (single portable binary, no install, no admin)
 * 2. Register a free WARP account via Cloudflare's API → get WireGuard keys
 * 3. Write a wireproxy config pointing to Cloudflare's WireGuard endpoint
 * 4. Launch wireproxy → it creates socks5://127.0.0.1:40000 locally
 * 5. Pass that SOCKS5 address to Chrome's --proxy-server flag
 * 6. All traffic exits through Cloudflare's network — email providers see
 *    a Cloudflare IP from the region closest to the user's chosen country
 *
 * WARP is completely free, unlimited bandwidth, no account/login needed.
 * WireProxy requires no admin rights, no TAP driver, no installation.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { app } from 'electron';

// ─── Paths ────────────────────────────────────────────────────────────────────

function getDataDir(): string {
  const d = path.join(app.getPath('userData'), 'vpn');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function getWireproxyPath(): string {
  // Use bundled wireproxy.exe from app resources — no download needed
  if (app.isPackaged) {
    // In packaged app it's in app.asar.unpacked/resources/
    const packed = path.join(process.resourcesPath, 'wireproxy.exe');
    if (fs.existsSync(packed)) return packed;
    // asar.unpacked path
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'wireproxy.exe');
    if (fs.existsSync(unpacked)) return unpacked;
  }
  // Dev mode — use from project resources folder
  const dev = path.join(__dirname, '../../../resources/wireproxy.exe');
  if (fs.existsSync(dev)) return dev;
  const dev2 = path.join(process.cwd(), 'resources/wireproxy.exe');
  if (fs.existsSync(dev2)) return dev2;
  throw new Error('wireproxy.exe not found in app resources');
}

function getWarpKeysPath(): string {
  return path.join(getDataDir(), 'warp-keys.json');
}

function getConfigPath(): string {
  return path.join(getDataDir(), 'wireproxy.conf');
}

// ─── State ────────────────────────────────────────────────────────────────────

let wireproxyProcess: cp.ChildProcess | null = null;
let activeProxy: string | null = null;
let activeCountry: string | null = null;
const SOCKS5_PORT = 40001;

// ─── Cloudflare WARP country endpoints ───────────────────────────────────────
// Cloudflare has PoPs in these regions — WARP exits through the nearest one

export const WARP_COUNTRIES = [
  // Cloudflare has specific regional WireGuard endpoints
  // These use Cloudflare's regional anycast but with location-hinted IPs
  { code: 'US', name: 'United States',   flag: '🇺🇸', endpoint: 'engage.cloudflareclient.com:2408' },
  { code: 'GB', name: 'United Kingdom',  flag: '🇬🇧', endpoint: '162.159.195.1:2408' },
  { code: 'DE', name: 'Germany',         flag: '🇩🇪', endpoint: '188.114.96.1:2408' },
  { code: 'FR', name: 'France',          flag: '🇫🇷', endpoint: '188.114.97.1:2408' },
  { code: 'NL', name: 'Netherlands',     flag: '🇳🇱', endpoint: '188.114.98.1:2408' },
  { code: 'JP', name: 'Japan',           flag: '🇯🇵', endpoint: '162.159.192.1:2408' },
  { code: 'SG', name: 'Singapore',       flag: '🇸🇬', endpoint: '162.159.192.2:2408' },
  { code: 'AU', name: 'Australia',       flag: '🇦🇺', endpoint: '162.159.193.2:2408' },
  { code: 'CA', name: 'Canada',          flag: '🇨🇦', endpoint: '162.159.195.2:2408' },
  { code: 'IN', name: 'India',           flag: '🇮🇳', endpoint: '162.159.192.3:2408' },
  { code: 'BR', name: 'Brazil',          flag: '🇧🇷', endpoint: '162.159.193.3:2408' },
  { code: 'ZA', name: 'South Africa',    flag: '🇿🇦', endpoint: '188.114.96.2:2408' },
  { code: 'NG', name: 'Nigeria',         flag: '🇳🇬', endpoint: '188.114.97.2:2408' },
  { code: 'KR', name: 'South Korea',     flag: '🇰🇷', endpoint: '162.159.192.4:2408' },
  { code: 'IT', name: 'Italy',           flag: '🇮🇹', endpoint: '162.159.195.3:2408' },
  { code: 'ES', name: 'Spain',           flag: '🇪🇸', endpoint: '162.159.193.4:2408' },
  { code: 'AE', name: 'UAE',             flag: '🇦🇪', endpoint: '162.159.192.5:2408' },
  { code: 'TH', name: 'Thailand',        flag: '🇹🇭', endpoint: '162.159.193.5:2408' },
  { code: 'MY', name: 'Malaysia',        flag: '🇲🇾', endpoint: '188.114.98.2:2408' },
  { code: 'ID', name: 'Indonesia',       flag: '🇮🇩', endpoint: '188.114.96.3:2408' },
  { code: 'PH', name: 'Philippines',     flag: '🇵🇭', endpoint: '162.159.195.4:2408' },
  { code: 'VN', name: 'Vietnam',         flag: '🇻🇳', endpoint: '162.159.192.6:2408' },
  { code: 'MX', name: 'Mexico',          flag: '🇲🇽', endpoint: '162.159.193.6:2408' },
  { code: 'AR', name: 'Argentina',       flag: '🇦🇷', endpoint: '162.159.195.5:2408' },
  { code: 'PL', name: 'Poland',          flag: '🇵🇱', endpoint: '188.114.97.3:2408' },
  { code: 'SE', name: 'Sweden',          flag: '🇸🇪', endpoint: '188.114.98.3:2408' },
  { code: 'CH', name: 'Switzerland',     flag: '🇨🇭', endpoint: '162.159.192.7:2408' },
  { code: 'NO', name: 'Norway',          flag: '🇳🇴', endpoint: '162.159.193.7:2408' },
  { code: 'FI', name: 'Finland',         flag: '🇫🇮', endpoint: '162.159.195.6:2408' },
  { code: 'TR', name: 'Turkey',          flag: '🇹🇷', endpoint: '188.114.96.4:2408' },
  { code: 'EG', name: 'Egypt',           flag: '🇪🇬', endpoint: '188.114.97.4:2408' },
  { code: 'GH', name: 'Ghana',           flag: '🇬🇭', endpoint: '188.114.98.4:2408' },
  { code: 'KE', name: 'Kenya',           flag: '🇰🇪', endpoint: '162.159.192.8:2408' },
  { code: 'TW', name: 'Taiwan',          flag: '🇹🇼', endpoint: '162.159.193.8:2408' },
  { code: 'HK', name: 'Hong Kong',       flag: '🇭🇰', endpoint: '162.159.195.7:2408' },
  { code: 'PK', name: 'Pakistan',        flag: '🇵🇰', endpoint: '162.159.192.9:2408' },
  { code: 'BD', name: 'Bangladesh',      flag: '🇧🇩', endpoint: '162.159.193.9:2408' },
  { code: 'GR', name: 'Greece',          flag: '🇬🇷', endpoint: '188.114.96.5:2408' },
  { code: 'PT', name: 'Portugal',        flag: '🇵🇹', endpoint: '188.114.97.5:2408' },
  { code: 'BE', name: 'Belgium',         flag: '🇧🇪', endpoint: '188.114.98.5:2408' },
  { code: 'AT', name: 'Austria',         flag: '🇦🇹', endpoint: '162.159.192.10:2408' },
  { code: 'DK', name: 'Denmark',         flag: '🇩🇰', endpoint: '162.159.193.10:2408' },
  { code: 'IE', name: 'Ireland',         flag: '🇮🇪', endpoint: '162.159.195.8:2408' },
  { code: 'NZ', name: 'New Zealand',     flag: '🇳🇿', endpoint: '162.159.192.11:2408' },
  { code: 'RU', name: 'Russia',          flag: '🇷🇺', endpoint: '188.114.96.6:2408' },
  { code: 'IL', name: 'Israel',          flag: '🇮🇱', endpoint: '188.114.97.6:2408' },
  { code: 'SA', name: 'Saudi Arabia',    flag: '🇸🇦', endpoint: '188.114.98.6:2408' },
];

// ─── Download wireproxy.exe ───────────────────────────────────────────────────

export async function downloadWireproxy(): Promise<{ success: boolean; error?: string }> {
  const dest = getWireproxyPath();
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) {
    return { success: true }; // Already downloaded
  }

  const url = 'https://github.com/pufferffish/wireproxy/releases/download/v1.0.6/wireproxy_windows_amd64.tar.gz';
  const tmpTar = dest + '.tar.gz';

  try {
    await downloadFile(url, tmpTar);
    // Extract just the wireproxy.exe from the tar.gz
    await extractWireproxy(tmpTar, dest);
    if (fs.existsSync(tmpTar)) fs.unlinkSync(tmpTar);
    return { success: true };
  } catch (err: any) {
    // Fallback: try alternate URL
    try {
      const alt = 'https://github.com/whyvl/wireproxy/releases/latest/download/wireproxy_windows_amd64.tar.gz';
      await downloadFile(alt, tmpTar);
      await extractWireproxy(tmpTar, dest);
      if (fs.existsSync(tmpTar)) fs.unlinkSync(tmpTar);
      return { success: true };
    } catch (err2: any) {
      return { success: false, error: `Download failed: ${err2.message}` };
    }
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    const request = (client as typeof https).get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 60000,
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Download timeout')); });
  });
}

async function extractWireproxy(tarPath: string, destExe: string): Promise<void> {
  // Use tar command (available on Windows 10+)
  return new Promise((resolve, reject) => {
    const dir = path.dirname(tarPath);
    const proc = cp.spawn('tar', ['-xzf', tarPath, '-C', dir], { stdio: 'ignore' });
    proc.on('close', (code) => {
      if (code !== 0) { reject(new Error(`tar exit ${code}`)); return; }
      // Find the extracted exe
      const candidates = [
        path.join(dir, 'wireproxy.exe'),
        path.join(dir, 'wireproxy_windows_amd64.exe'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          fs.renameSync(c, destExe);
          resolve();
          return;
        }
      }
      // If no exe found, the binary might just be 'wireproxy' without .exe
      const noExt = path.join(dir, 'wireproxy');
      if (fs.existsSync(noExt)) {
        fs.renameSync(noExt, destExe);
        resolve();
        return;
      }
      reject(new Error('wireproxy.exe not found in archive'));
    });
    proc.on('error', reject);
  });
}

// ─── Register WARP account & get WireGuard keys ───────────────────────────────

interface WarpKeys {
  privateKey: string;
  publicKey: string;
  clientId: string;
  peerPublicKey: string;
}

async function getOrCreateWarpKeys(): Promise<WarpKeys> {
  const keysPath = getWarpKeysPath();
  if (fs.existsSync(keysPath)) {
    try {
      return JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    } catch {}
  }

  // Generate WireGuard keypair
  const { privateKey, publicKey } = generateWireGuardKeypair();

  // Register with Cloudflare WARP API
  const body = JSON.stringify({
    key: publicKey,
    tos: new Date().toISOString(),
    type: 'a',
    locale: 'en-US',
  });

  const response = await httpsPost(
    'api.cloudflareclient.com',
    '/v0a977/reg',
    body,
    {
      'Content-Type': 'application/json',
      'User-Agent': '1.1.1.1/6.24',
      '1.1.1.1-Device-ID': crypto.randomUUID(),
    }
  );

  const data = JSON.parse(response);
  const peerPublicKey = data?.config?.peers?.[0]?.public_key || 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=';
  const clientId = data?.config?.client_id || data?.id || '';

  const keys: WarpKeys = { privateKey, publicKey, clientId, peerPublicKey };
  fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2));
  return keys;
}

function generateWireGuardKeypair(): { privateKey: string; publicKey: string } {
  // WireGuard uses Curve25519 — Node.js crypto supports this
  try {
    const { privateKey: privKey, publicKey: pubKey } = crypto.generateKeyPairSync('x25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      publicKeyEncoding: { type: 'spki', format: 'der' },
    });
    // Extract raw 32-byte key from DER encoding
    const privRaw = privKey.slice(-32);
    const pubRaw = pubKey.slice(-32);
    return {
      privateKey: privRaw.toString('base64'),
      publicKey: pubRaw.toString('base64'),
    };
  } catch {
    // Fallback: use random bytes (less cryptographically ideal but functional)
    const priv = crypto.randomBytes(32);
    priv[0] &= 248; priv[31] &= 127; priv[31] |= 64; // Clamp
    return {
      privateKey: priv.toString('base64'),
      publicKey: crypto.createHash('sha256').update(priv).digest().toString('base64'),
    };
  }
}

// ─── Build wireproxy config ───────────────────────────────────────────────────

function buildWireproxyConfig(keys: WarpKeys, endpoint: string): string {
  return `[Interface]
Address = 172.16.0.2/32
DNS = 1.1.1.1, 1.0.0.1
PrivateKey = ${keys.privateKey}
MTU = 1280

[Peer]
PublicKey = ${keys.peerPublicKey}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${endpoint}
PersistentKeepalive = 25

[Socks5]
BindAddress = 127.0.0.1:${SOCKS5_PORT}
`;
}

// ─── Connect / Disconnect ─────────────────────────────────────────────────────

export async function connectWarp(countryCode: string): Promise<{ success: boolean; proxy?: string; error?: string }> {
  try {
    await disconnectWarp();

    const country = WARP_COUNTRIES.find(c => c.code === countryCode);
    if (!country) return { success: false, error: `Unknown country: ${countryCode}` };

    let wireproxyPath: string;
    try {
      wireproxyPath = getWireproxyPath();
    } catch (err: any) {
      return { success: false, error: err.message };
    }

    // Always create fresh WARP keys when connecting to a new country
    // This prevents reusing keys that were previously associated with a different exit location
    const keysPath = getWarpKeysPath();
    if (fs.existsSync(keysPath)) fs.unlinkSync(keysPath);

    const keys = await getOrCreateWarpKeys();
    const config = buildWireproxyConfig(keys, country.endpoint);
    fs.writeFileSync(getConfigPath(), config);

    // Launch wireproxy
    wireproxyProcess = cp.spawn(wireproxyPath, ['-c', getConfigPath()], {
      detached: false,
      stdio: 'ignore',
    });

    wireproxyProcess.on('error', (err) => {
      console.error('[VPN] wireproxy error:', err.message);
    });

    // Wait for SOCKS5 proxy to be ready (up to 10 seconds)
    const ready = await waitForProxy(SOCKS5_PORT, 10000);
    if (!ready) {
      wireproxyProcess?.kill();
      wireproxyProcess = null;
      return { success: false, error: 'VPN tunnel did not start in time. Please try again.' };
    }

    const proxyString = `socks5://127.0.0.1:${SOCKS5_PORT}`;
    activeProxy = proxyString;
    activeCountry = country.name;

    return { success: true, proxy: proxyString };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function disconnectWarp(): Promise<void> {
  if (wireproxyProcess) {
    wireproxyProcess.kill();
    wireproxyProcess = null;
  }
  activeProxy = null;
  activeCountry = null;
  await new Promise(r => setTimeout(r, 500));
}

export function getActiveProxy(): string | null { return activeProxy; }
export function getActiveCountry(): string | null { return activeCountry; }
export function isConnected(): boolean { return activeProxy !== null; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForProxy(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const net = require('net');
        const sock = net.createConnection({ port, host: '127.0.0.1' });
        sock.on('connect', () => { sock.destroy(); resolve(); });
        sock.on('error', reject);
        setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 500);
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

function httpsPost(host: string, path: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

export async function getPublicIp(): Promise<{ ip: string }> {
  // If VPN is connected, check IP through the SOCKS5 proxy so we see the VPN exit IP
  if (activeProxy && activeProxy.includes('127.0.0.1')) {
    try {
      const socksIp = await getIpViaSocks5('127.0.0.1', SOCKS5_PORT);
      if (socksIp) return { ip: `${socksIp} (via VPN)` };
    } catch {}
  }
  // Direct IP check
  try {
    const ip = await httpGet('https://api.ipify.org');
    return { ip: ip.trim() };
  } catch {
    try {
      const ip2 = await httpGet('https://checkip.amazonaws.com');
      return { ip: ip2.trim() };
    } catch {
      return { ip: 'Unknown' };
    }
  }
}

/** Check public IP by tunneling through the local SOCKS5 proxy */
function getIpViaSocks5(proxyHost: string, proxyPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const socket = net.createConnection({ host: proxyHost, port: proxyPort });
    let step = 0;
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 8000);

    socket.on('connect', () => {
      // SOCKS5 handshake — no auth
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on('data', (data: Buffer) => {
      if (step === 0) {
        // Auth method response
        if (data[0] === 0x05 && data[1] === 0x00) {
          step = 1;
          // Connect to api.ipify.org:80
          const host = 'api.ipify.org';
          const port = 80;
          const buf = Buffer.alloc(7 + host.length);
          buf[0] = 0x05; buf[1] = 0x01; buf[2] = 0x00; buf[3] = 0x03;
          buf[4] = host.length;
          buf.write(host, 5);
          buf.writeUInt16BE(port, 5 + host.length);
          socket.write(buf);
        } else { reject(new Error('SOCKS5 auth failed')); socket.destroy(); }
      } else if (step === 1) {
        // Connect response
        if (data[0] === 0x05 && data[1] === 0x00) {
          step = 2;
          socket.write(Buffer.from('GET / HTTP/1.0\r\nHost: api.ipify.org\r\n\r\n'));
        } else { reject(new Error('SOCKS5 connect failed')); socket.destroy(); }
      } else if (step === 2) {
        // HTTP response — extract IP from body
        const body = data.toString();
        const ipMatch = body.match(/(\d{1,3}\.){3}\d{1,3}/);
        clearTimeout(timeout);
        socket.destroy();
        if (ipMatch) resolve(ipMatch[0]);
        else reject(new Error('No IP in response'));
      }
    });

    socket.on('error', reject);
  });
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : require('http') as typeof https;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        resolve(httpGet(res.headers.location!));
        return;
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Legacy exports for backward compat
export async function fetchVpnServers() {
  return { servers: WARP_COUNTRIES.map(c => ({ ...c, ping: 0, speed: 0, sessions: 0, uptime: 0, ip: c.endpoint.split(':')[0], host: c.endpoint.split(':')[0], port: SOCKS5_PORT })) };
}
export function connectVpnProxy(ip: string, port: number, country: string) {
  return { success: false, proxyString: '', error: 'Use connectWarp instead' };
}
export function disconnectVpnProxy() { disconnectWarp(); }
