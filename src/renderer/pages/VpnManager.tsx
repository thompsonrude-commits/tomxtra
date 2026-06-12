import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Globe, Wifi, WifiOff, RefreshCw, Shield, CheckCircle2, AlertCircle, Zap } from 'lucide-react';

interface WarpCountry {
  code: string;
  name: string;
  flag: string;
  endpoint: string;
}

export const VpnManager: React.FC = () => {
  const [countries, setCountries] = useState<WarpCountry[]>([]);
  const [connected, setConnected] = useState(false);
  const [activeCountry, setActiveCountry] = useState('');
  const [connecting, setConnecting] = useState('');
  const [currentIp, setCurrentIp] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [firstConnect, setFirstConnect] = useState(true);

  const filtered = countries.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  const fetchCurrentIp = useCallback(async () => {
    try {
      const r = await (window.electronAPI as any).getPublicIp?.();
      if (r?.ip) setCurrentIp(r.ip);
    } catch {}
  }, []);

  const loadData = useCallback(async () => {
    try {
      const r = await (window.electronAPI as any).fetchVpnServers?.();
      if (r?.servers) setCountries(r.servers);
    } catch {}
    try {
      const vpn = await (window.electronAPI as any).getActiveVpn?.();
      if (vpn?.connected) {
        setConnected(true);
        setActiveCountry(vpn.country || '');
        setFirstConnect(false);
      }
    } catch {}
    fetchCurrentIp();
  }, [fetchCurrentIp]);

  useEffect(() => { loadData(); }, []);

  const handleConnect = async (country: WarpCountry) => {
    setConnecting(country.code);
    setError('');
    try {
      const r = await (window.electronAPI as any).connectVpn?.({ countryCode: country.code });
      if (r?.success) {
        setConnected(true);
        setActiveCountry(country.name);
        setFirstConnect(false);
        // Refresh IP after a short delay to show the new IP
        setTimeout(() => fetchCurrentIp(), 3000);
      } else {
        setError(r?.error || 'Connection failed. Please try another country.');
      }
    } catch (e: any) {
      setError('Error: ' + e.message);
    }
    setConnecting('');
  };

  const handleDisconnect = async () => {
    await (window.electronAPI as any).disconnectVpn?.();
    setConnected(false);
    setActiveCountry('');
    setTimeout(() => fetchCurrentIp(), 1500);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-cyber-text flex items-center gap-2">
            <Shield className="text-cyber-accent" />
            VPN Manager
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Powered by <span className="text-cyber-accent font-semibold">Cloudflare WARP</span> — route email logins through any country's IP. Free, unlimited, no account needed.
          </p>
        </div>
        <button onClick={fetchCurrentIp} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-cyber-accent border border-gray-700 hover:border-cyber-accent/50 rounded-lg transition-all">
          <RefreshCw size={12} /> Refresh IP
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={14} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-gray-500 hover:text-white">✕</button>
        </div>
      )}

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Current IP */}
        <div className="bg-cyber-card rounded-xl border border-gray-700/50 p-4 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${connected ? 'bg-green-500/20' : 'bg-gray-700/50'}`}>
            <Globe size={20} className={connected ? 'text-green-400' : 'text-gray-500'} />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase font-bold">Your Current IP</p>
            <p className="text-sm font-mono text-cyber-text">{currentIp || 'Detecting...'}</p>
            {connected && <p className="text-[9px] text-green-400 mt-0.5">Routed via {activeCountry}</p>}
          </div>
        </div>

        {/* VPN Status */}
        <div className={`bg-cyber-card rounded-xl border p-4 flex items-center gap-3 transition-all ${connected ? 'border-green-500/40' : 'border-gray-700/50'}`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${connected ? 'bg-green-500/20' : 'bg-gray-700/50'}`}>
            {connected ? <Wifi size={20} className="text-green-400" /> : <WifiOff size={20} className="text-gray-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-500 uppercase font-bold">WARP Status</p>
            {connected ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-green-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                  {activeCountry}
                </p>
                <button onClick={handleDisconnect} className="shrink-0 text-[10px] text-red-400 border border-red-500/30 px-2 py-0.5 rounded hover:bg-red-500/10 transition-all">
                  Disconnect
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Not connected — pick a country</p>
            )}
          </div>
        </div>

        {/* Network info */}
        <div className="bg-cyber-card rounded-xl border border-gray-700/50 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-cyber-accent/20 flex items-center justify-center">
            <Zap size={20} className="text-cyber-accent" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase font-bold">Network</p>
            <p className="text-sm font-semibold text-cyber-text">Cloudflare WARP</p>
            <p className="text-[10px] text-gray-500">{countries.length} countries • Zero logs • Free</p>
          </div>
        </div>
      </div>

      {connected && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <CheckCircle2 size={16} className="text-green-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-green-400">Connected via Cloudflare WARP → {activeCountry}</p>
            <p className="text-[11px] text-green-400/70 mt-0.5">
              All Chrome browser logins opened from the Web Login tab now route through {activeCountry}'s Cloudflare network exit. Email providers see a {activeCountry} IP address — no location challenges.
            </p>
          </div>
        </div>
      )}

      {firstConnect && !connected && (
        <div className="bg-cyber-accent/5 border border-cyber-accent/20 rounded-xl px-4 py-3 text-[11px] text-gray-400">
          <span className="text-cyber-accent font-bold">First time connecting</span> may take 5–10 seconds while Cloudflare WARP registers your device. Subsequent connections are instant.
        </div>
      )}

      {/* Country search + grid */}
      <div className="bg-cyber-card rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex-1">
            Select Country ({filtered.length})
          </h3>
          <input
            type="text"
            placeholder="Search country..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-cyber-bg border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-cyber-text focus:border-cyber-accent/50 focus:outline-none w-48"
          />
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {filtered.map(country => {
              const isActive = connected && activeCountry === country.name;
              const isConnecting = connecting === country.code;
              return (
                <button
                  key={country.code}
                  onClick={() => !isActive && !connecting && handleConnect(country)}
                  disabled={isActive || !!connecting}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    isActive
                      ? 'bg-green-500/10 border-green-500/40 text-green-400'
                      : connecting
                      ? 'opacity-50 cursor-not-allowed bg-black/20 border-gray-700/50 text-cyber-text'
                      : 'bg-black/20 border-gray-700/50 hover:border-cyber-accent/50 hover:bg-cyber-accent/5 text-cyber-text cursor-pointer'
                  }`}
                >
                  <span className="text-xl shrink-0">{country.flag}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold truncate leading-tight">{country.name}</p>
                    {isActive && (
                      <p className="text-[9px] text-green-400 font-bold flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse inline-block" />CONNECTED
                      </p>
                    )}
                    {isConnecting && (
                      <p className="text-[9px] text-cyber-accent flex items-center gap-1">
                        <Loader2 size={8} className="animate-spin" />Connecting...
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-black/20 border border-gray-800 rounded-xl p-4">
        <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">How it works</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] text-gray-500">
          <div className="flex gap-2">
            <span className="text-cyber-accent font-bold text-sm shrink-0">1</span>
            <span>Pick any country above and click it. The VPN engine (bundled with the app) connects to Cloudflare's WireGuard network in that region instantly.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-cyber-accent font-bold text-sm shrink-0">2</span>
            <span>Open the Web Login tab and log into any email account. Chrome routes through that country's Cloudflare exit point — the provider sees a local IP.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-cyber-accent font-bold text-sm shrink-0">3</span>
            <span>No location verification, no "suspicious activity" alerts. Send campaigns as if the account is being used by someone physically in that country.</span>
          </div>
        </div>
        <p className="text-[10px] text-gray-700 mt-3 border-t border-gray-800 pt-2">Powered by Cloudflare WARP (WireGuard protocol) + WireProxy. Free, zero logs, no account or subscription required.</p>
      </div>
    </div>
  );
};
