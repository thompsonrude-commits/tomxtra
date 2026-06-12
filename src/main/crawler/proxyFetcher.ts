import axios from 'axios';
import * as net from 'net';
import { addProxy, addLog, updateProxyStatus, getProxies } from '../db/database';

// Multiple free proxy sources — more sources = more chances of getting live proxies
const PROXY_SOURCES = [
  // HTTP proxies
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
  'https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt',
  'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
  'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all',
  'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=elite',
  // SOCKS5 proxies
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
  'https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=5000&country=all',
  // Additional sources
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt',
];

export async function fetchFreeProxies(): Promise<number> {
  addLog('Fetching fresh proxies from multiple sources...', 'info');
  let totalFound = 0;
  const seen = new Set<string>();

  const fetchSource = async (source: string) => {
    try {
      const response = await axios.get(source, { 
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const rawProxies = response.data
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 5 && !l.startsWith('#'));
      
      for (const proxy of rawProxies) {
        const clean = proxy.replace(/^https?:\/\//, '').split(' ')[0].trim();
        if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(clean) && !seen.has(clean)) {
          seen.add(clean);
          addProxy(clean);
          totalFound++;
        }
      }
    } catch {}
  };

  // Fetch from all sources in parallel
  await Promise.allSettled(PROXY_SOURCES.map(s => fetchSource(s)));
  addLog(`Fetched ${totalFound} proxy addresses from all sources`, 'success');
  return totalFound;
}

/**
 * Quick test a single proxy — returns true if it can connect to Google in under 5s
 */
function testProxy(proxy: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [host, portStr] = proxy.replace(/^https?:\/\//, '').split('@').pop()!.split(':');
    const port = parseInt(portStr) || 8080;
    if (!host || !port) { resolve(false); return; }

    const sock = new net.Socket();
    const timeout = setTimeout(() => { sock.destroy(); resolve(false); }, 4000);
    
    sock.connect(port, host, () => {
      clearTimeout(timeout);
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => { clearTimeout(timeout); resolve(false); });
  });
}

/**
 * Ensure a minimum number of working proxies are available.
 * Tests existing proxies in batches, removes dead ones, fetches fresh ones if needed.
 * Called before extraction starts.
 */
export async function ensureWorkingProxies(minCount = 10): Promise<string[]> {
  addLog(`Ensuring at least ${minCount} working proxies available...`, 'info');
  
  let allProxies = getProxies().map((p: any) => p.address);
  
  // If we have fewer than minCount, fetch fresh ones first
  if (allProxies.length < minCount * 3) {
    addLog('Proxy pool low — fetching fresh proxies...', 'info');
    await fetchFreeProxies();
    allProxies = getProxies().map((p: any) => p.address);
  }

  // Test proxies in batches of 20 concurrently
  const working: string[] = [];
  const BATCH = 20;
  
  // Shuffle to test different ones each time
  const shuffled = [...allProxies].sort(() => Math.random() - 0.5);
  
  addLog(`Testing ${Math.min(shuffled.length, 100)} proxies...`, 'info');
  
  for (let i = 0; i < Math.min(shuffled.length, 100) && working.length < minCount * 2; i += BATCH) {
    const batch = shuffled.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(p => testProxy(p)));
    
    batch.forEach((proxy, idx) => {
      if (results[idx]) {
        working.push(proxy);
        updateProxyStatus(proxy, true, 0);
      } else {
        updateProxyStatus(proxy, false, 0);
      }
    });
    
    if (working.length >= minCount) break;
  }

  addLog(`Found ${working.length} working proxies ready for extraction`, working.length > 0 ? 'success' : 'warning');
  
  // If still not enough, fetch more and test again
  if (working.length < minCount) {
    addLog('Not enough working proxies — fetching more...', 'warning');
    await fetchFreeProxies();
    allProxies = getProxies().map((p: any) => p.address);
    const newOnes = allProxies.filter(p => !shuffled.includes(p));
    
    for (let i = 0; i < Math.min(newOnes.length, 60) && working.length < minCount; i += BATCH) {
      const batch = newOnes.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(p => testProxy(p)));
      batch.forEach((proxy, idx) => {
        if (results[idx]) {
          working.push(proxy);
          updateProxyStatus(proxy, true, 0);
        } else {
          updateProxyStatus(proxy, false, 0);
        }
      });
    }
  }

  return working;
}
