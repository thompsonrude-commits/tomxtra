import React, { useState, useEffect, useCallback } from 'react';
import { GlowButton } from '../components/GlowButton';
import { LiveFeed } from '../components/LiveFeed';
import { DataTable } from '../components/DataTable';
import { ExtractionConfig, ExtractionEvent, EmailRecord, ExtractionSource } from '../types';
import { SOURCES_BY_COUNTRY } from '../data/locationSources';

const COUNTRIES = [
  { code: '', name: 'Global (No specific location)' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'IN', name: 'India' },
  { code: 'RU', name: 'Russia' },
  { code: 'CN', name: 'China' },
  { code: 'KR', name: 'South Korea' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'JP', name: 'Japan' },
  { code: 'TR', name: 'Turkey' }
];

const CollapsibleSection: React.FC<{ 
  title: string; 
  titleClass?: string; 
  defaultOpen?: boolean; 
  children: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, titleClass, defaultOpen = false, children, icon }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-800/50 pb-2 mb-2 last:border-0 last:pb-0 last:mb-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-1.5 group"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className={`text-[10px] uppercase tracking-widest font-bold transition-colors ${titleClass || 'text-gray-500'} group-hover:text-white`}>
            {title}
          </span>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-gray-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && <div className="mt-2 animate-fade-in">{children}</div>}
    </div>
  );
};

export const Extract: React.FC = () => {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [config, setConfig] = useState<ExtractionConfig>({
    keywords: [],
    location: '',
    threads: 3,
    depth: 5,
    timeout: 30,
    proxyMode: 'rotating',
    sources: ['google', 'bing', 'duckduckgo', 'yahoo'] as ExtractionSource[],
    niches: [],
    roles: [],
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [events, setEvents] = useState<ExtractionEvent[]>([]);
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [showMoreKeywords, setShowMoreKeywords] = useState(false);

  useEffect(() => {
    // Delay loading heavy data to prioritize input responsiveness
    const timer = setTimeout(() => {
        loadEmails();
        checkRunningStatus();
    }, 500);

    const checkRunningStatus = async () => {
      if (window.electronAPI) {
        const stats = await window.electronAPI.getStats();
        if (stats.activeJobs > 0) setIsRunning(true);
      }
    };

    let cleanup: (() => void) | undefined;
    if (window.electronAPI) {
      cleanup = window.electronAPI.onExtractionEvent((_event, data) => {
        setEvents((prev) => [...prev.slice(-200), data]); // Limit to 200 events for performance
        if (data.type === 'email-found' && data.data) {
          setEmails((prev) => [...prev, data.data]);
        }
        if (data.type === 'complete' || data.type === 'stopped') {
          setIsRunning(false);
          setIsPaused(false);
        }
      });
    }
    return () => {
        clearTimeout(timer);
        cleanup?.();
    };
  }, []);

  // Handle Dynamic Source Refresh on Location Change
  useEffect(() => {
    const currentLoc = config.location || 'Global (No specific location)';
    const countryData = SOURCES_BY_COUNTRY[currentLoc] || SOURCES_BY_COUNTRY['Global (No specific location)'];
    
    // 1. Identify all country-specific source IDs across ALL countries
    const allLocalizedIds = Object.values(SOURCES_BY_COUNTRY).flatMap(c => [
        ...c.b2b.map(s => s.id),
        ...c.localEngines.map(s => s.id)
    ]);
    
    // 2. Remove all localized IDs from current selection
    // 3. Add the defaults for the NEW country (if desired, or just let user pick)
    const filteredSources = config.sources.filter(s => !allLocalizedIds.includes(s));
    
    // Optionally auto-select the new country's B2B sources if none are selected
    const newDefaults = [
        ...countryData.b2b.map(s => s.id),
        ...countryData.localEngines.map(s => s.id)
    ].slice(0, 3); // Auto-select top 3 for convenience

    setConfig(prev => ({ 
        ...prev, 
        sources: [...new Set([...filteredSources, ...newDefaults])]
    }));

  }, [config.location]);

  const loadEmails = async () => {
    try {
      if (window.electronAPI) {
        const e = await window.electronAPI.getEmails();
        setEmails(e);
      }
    } catch (err) {}
  };

  const addKeyword = () => {
    const lines = newKeyword.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 0) {
      const uniqueNewKeys = lines.filter(k => !keywords.includes(k));
      setKeywords([...keywords, ...uniqueNewKeys]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const importKeywords = async () => {
    try {
      if (window.electronAPI) {
        const filePath = await window.electronAPI.openFileDialog();
        if (filePath) {
          // File reading handled by main process
        }
      }
    } catch (err) {}
  };

  const startExtraction = async () => {
    if (keywords.length === 0) return;
    try {
      setIsRunning(true);
      setEvents([]);
      const extractionConfig = { ...config, keywords, sources: config.sources };
      if (window.electronAPI) {
        await window.electronAPI.startExtraction(extractionConfig);
      }
    } catch (err) {
      setIsRunning(false);
    }
  };

  const pauseExtraction = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.pauseExtraction();
        setIsPaused(!isPaused);
      }
    } catch (err) {}
  };

  const stopExtraction = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.stopExtraction();
        setIsRunning(false);
        setIsPaused(false);
      }
    } catch (err) {}
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-cyber-text">Extraction Engine</h1>
        <p className="text-sm text-gray-500 mt-1">Configure and run email extraction jobs</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Controls */}
        <div className="space-y-4">
          {/* Keyword Input */}
          <div className="bg-cyber-card rounded-xl border border-gray-700/50 p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-cyber-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
              </svg>
              Keywords / Targets
            </h3>

            <div className="space-y-3 mb-3">
              <textarea
                rows={4}
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="Paste keywords / domains (one per line)..."
                className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-xs text-cyber-text placeholder-gray-600 focus:outline-none focus:border-cyber-accent/50 custom-scrollbar"
              />
              <GlowButton onClick={addKeyword} className="w-full justify-center py-2">
                Add {newKeyword.split('\n').filter(k => k.trim()).length || 1} Keyword(s)
              </GlowButton>
            </div>

            <div className="flex gap-2 mb-3">
              <button onClick={importKeywords} className="text-xs text-gray-500 hover:text-cyber-accent transition-colors">
                Import from file
              </button>
              <button onClick={() => setKeywords([])} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                Clear all
              </button>
            </div>

            <div className="space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
              {keywords.length === 0 ? (
                <div className="text-xs text-gray-600 py-4 text-center">
                  <p>Add keywords to extract emails.</p>
                  <p className="mt-1 text-gray-700">Examples:</p>
                  <button onClick={() => setKeywords(['restaurants in lagos'])} className="text-cyber-accent/60 hover:text-cyber-accent text-xs mt-1">restaurants in lagos</button>
                  <br />
                  <button onClick={() => setKeywords((p) => [...p, 'construction companies dubai'])} className="text-cyber-accent/60 hover:text-cyber-accent text-xs">construction companies dubai</button>
                  <br />
                  <button onClick={() => setKeywords((p) => [...p, 'digital agencies usa'])} className="text-cyber-accent/60 hover:text-cyber-accent text-xs">digital agencies usa</button>
                </div>
              ) : (
                <>
                  {keywords.slice(0, showMoreKeywords ? undefined : 20).map((kw, i) => (
                    <div key={i} className="flex items-center justify-between bg-cyber-bg rounded-lg px-3 py-1.5 group">
                      <span className="text-xs text-gray-300 font-mono truncate mr-2">{kw}</span>
                      <button
                        onClick={() => removeKeyword(kw)}
                        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <line x1="6" y1="6" x2="18" y2="18" />
                          <line x1="6" y1="18" x2="18" y2="6" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {keywords.length > 20 && (
                    <button 
                        onClick={() => setShowMoreKeywords(!showMoreKeywords)}
                        className="w-full text-[10px] text-cyber-accent hover:text-cyber-accent/80 py-2 transition-colors uppercase font-bold tracking-widest"
                    >
                        {showMoreKeywords ? '↑ Show Less' : `↓ Show All (${keywords.length})`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Extraction Config */}
          <div className="bg-cyber-card rounded-xl border border-gray-700/50 p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-cyber-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Target Country / Location</label>
                <select
                  value={config.location}
                  onChange={(e) => setConfig({ ...config, location: e.target.value })}
                  className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:outline-none focus:border-cyber-accent/50"
                >
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              {config.location && config.location !== 'Global (No specific location)' && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">City / State <span className="text-gray-600">(optional)</span></label>
                  <input
                    type="text"
                    value={config.city || ''}
                    onChange={(e) => setConfig({ ...config, city: e.target.value })}
                    placeholder={`e.g. Lagos, Mumbai, New York...`}
                    className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:outline-none focus:border-cyber-accent/50 placeholder-gray-700"
                  />
                </div>
              )}

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Threads</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={config.threads}
                  onChange={(e) => setConfig({ ...config, threads: parseInt(e.target.value) || 1 })}
                  className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:outline-none focus:border-cyber-accent/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Search Depth (pages per keyword)</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={config.depth}
                  onChange={(e) => setConfig({ ...config, depth: parseInt(e.target.value) || 1 })}
                  className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:outline-none focus:border-cyber-accent/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Timeout (seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={config.timeout}
                  onChange={(e) => setConfig({ ...config, timeout: parseInt(e.target.value) || 30 })}
                  className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:outline-none focus:border-cyber-accent/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Proxy Mode</label>
                <select
                  value={config.proxyMode}
                  onChange={(e) => setConfig({ ...config, proxyMode: e.target.value as 'none' | 'rotating' })}
                  className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:outline-none focus:border-cyber-accent/50"
                >
                  <option value="none">None</option>
                  <option value="rotating">Rotating</option>
                </select>
              </div>

              {/* Source Selection */}
              <div className="pt-2 border-t border-gray-700/50 mt-2">
                <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Search Sources</label>
                
                <div className="space-y-4">
                  <CollapsibleSection title="Primary Search Sources" titleClass="text-cyber-accent" defaultOpen={true}>
                    <div className="grid grid-cols-2 gap-2">
                        {(['google', 'bing', 'duckduckgo', 'yahoo', 'ask', 'brave', 'startpage'] as ExtractionSource[]).map((s) => (
                          <label key={s} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                            <input
                              type="checkbox"
                              checked={config.sources.includes(s)}
                              onChange={(e) => {
                                const sources = e.target.checked 
                                  ? [...config.sources, s]
                                  : config.sources.filter(x => x !== s);
                                setConfig({ ...config, sources });
                              }}
                              className="rounded bg-cyber-bg border-gray-700 text-cyber-accent focus:ring-0"
                            />
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </label>
                        ))}
                      </div>
                  </CollapsibleSection>
                  </div>

                  <CollapsibleSection title="Local Search Engines" titleClass="text-pink-500">
                    <div className="grid grid-cols-2 gap-2">
                       { (SOURCES_BY_COUNTRY[config.location || 'Global (No specific location)']?.localEngines || []).length === 0 ? (
                          <p className="text-[10px] text-gray-700 italic col-span-2">No local engines for this region.</p>
                       ) : (
                         (SOURCES_BY_COUNTRY[config.location || 'Global (No specific location)']?.localEngines || []).map((s) => (
                           <label key={s.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                             <input
                               type="checkbox"
                               checked={config.sources.includes(s.id)}
                               onChange={(e) => {
                                 const sources = e.target.checked 
                                   ? [...config.sources, s.id]
                                   : config.sources.filter(x => x !== s.id);
                                 setConfig({ ...config, sources });
                               }}
                               className="rounded bg-cyber-bg border-gray-700 text-pink-500 focus:ring-0"
                             />
                             {s.label}
                           </label>
                         ))
                       )}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="B2B & Directories" titleClass="text-yellow-500">
                    <div className="grid grid-cols-2 gap-2">
                       { (SOURCES_BY_COUNTRY[config.location || 'Global (No specific location)']?.b2b || []).map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                          <input
                            type="checkbox"
                            checked={config.sources.includes(s.id)}
                            onChange={(e) => {
                              const sources = e.target.checked 
                                ? [...config.sources, s.id]
                                : config.sources.filter(x => x !== s.id);
                              setConfig({ ...config, sources });
                            }}
                            className="rounded bg-cyber-bg border-gray-700 text-yellow-500 focus:ring-0"
                          />
                          {s.label}
                        </label>
                      ))}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="Classifieds" titleClass="text-green-500">
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={config.sources.includes('craigslist')}
                        onChange={(e) => {
                          const sources = e.target.checked 
                            ? [...config.sources, 'craigslist']
                            : config.sources.filter(x => x !== 'craigslist');
                          setConfig({ ...config, sources });
                        }}
                        className="rounded bg-cyber-bg border-gray-700 text-cyber-accent focus:ring-0"
                      />
                      Craigslist (Global)
                    </label>
                  </CollapsibleSection>

                  {/* New Mega Categories */}
                  <CollapsibleSection title="Social Media Directories" titleClass="text-orange-500">
                    <div className="grid grid-cols-2 gap-2">
                       {([
                         { id: 'linkedin', label: 'LinkedIn' },
                         { id: 'facebook', label: 'Facebook' },
                         { id: 'instagram', label: 'Instagram' },
                         { id: 'twitter', label: 'Twitter (X)' }
                       ] as { id: ExtractionSource, label: string }[]).map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                          <input
                            type="checkbox"
                            checked={config.sources.includes(s.id)}
                            onChange={(e) => {
                              const sources = e.target.checked 
                                ? [...config.sources, s.id]
                                : config.sources.filter(x => x !== s.id);
                              setConfig({ ...config, sources });
                            }}
                            className="rounded bg-cyber-bg border-gray-700 text-cyber-accent focus:ring-0"
                          />
                          {s.label}
                        </label>
                      ))}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="Sharing & Forums" titleClass="text-blue-500">
                    <div className="grid grid-cols-2 gap-2">
                       {([
                         { id: 'github', label: 'GitHub' },
                         { id: '4shared', label: '4Shared' },
                         { id: 'mega', label: 'Mega.nz' },
                         { id: 'forums', label: 'Popular Forums' }
                       ] as { id: ExtractionSource, label: string }[]).map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                          <input
                            type="checkbox"
                            checked={config.sources.includes(s.id)}
                            onChange={(e) => {
                              const sources = e.target.checked 
                                ? [...config.sources, s.id]
                                : config.sources.filter(x => x !== s.id);
                              setConfig({ ...config, sources });
                            }}
                            className="rounded bg-cyber-bg border-gray-700 text-cyber-accent focus:ring-0"
                          />
                          {s.label}
                        </label>
                      ))}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="Deep File Search" titleClass="text-purple-500">
                    <div className="grid grid-cols-2 gap-2">
                       {([
                         { id: 'pdf', label: 'PDF Documents' },
                         { id: 'excel', label: 'Excel/XLSX' },
                         { id: 'word', label: 'Word/DOCX' },
                         { id: 'txt', label: 'Text/Logs' }
                       ] as { id: ExtractionSource, label: string }[]).map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                          <input
                            type="checkbox"
                            checked={config.sources.includes(s.id)}
                            onChange={(e) => {
                              const sources = e.target.checked 
                                ? [...config.sources, s.id]
                                : config.sources.filter(x => x !== s.id);
                              setConfig({ ...config, sources });
                            }}
                            className="rounded bg-cyber-bg border-gray-700 text-cyber-accent focus:ring-0"
                          />
                          {s.label}
                        </label>
                      ))}
                    </div>
                  </CollapsibleSection>
                </div>

                {/* Advanced Automation Toggles */}
                <div className="mt-4 pt-4 border-t border-gray-800 space-y-3">
                   <label className="flex items-center justify-between group cursor-pointer">
                      <div>
                        <p className="text-xs font-bold text-cyber-accent group-hover:text-white transition-colors">B2B Action Revealer</p>
                        <p className="text-[10px] text-gray-500">Auto-clicks "View Contact" on YellowPages/Directories</p>
                      </div>
                      <input 
                        type="checkbox"
                        checked={config.autoRevealer}
                        onChange={(e) => setConfig({ ...config, autoRevealer: e.target.checked })}
                        className="rounded bg-cyber-bg border-gray-700 text-cyber-accent focus:ring-0"
                      />
                   </label>
                   
                   <label className="flex items-center justify-between group cursor-pointer">
                      <div>
                        <p className="text-xs font-bold text-blue-400 group-hover:text-white transition-colors">Deep Document Scraper</p>
                        <p className="text-[10px] text-gray-500">Search inside files (PDF, Word, Excel) during crawl</p>
                      </div>
                      <input 
                        type="checkbox"
                        checked={config.deepFileSearch}
                        onChange={(e) => setConfig({ ...config, deepFileSearch: e.target.checked })}
                        className="rounded bg-cyber-bg border-gray-700 text-blue-400 focus:ring-0"
                      />
                   </label>
                </div>

                {/* Professional Sector & Role Targeting */}
                <div className="mt-4 pt-4 border-t border-gray-800 space-y-6">
                  {/* Niches Section */}
                  <div>
                    <h4 className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_cyan]"></span>
                       Targeted Sectors (Niches)
                    </h4>
                    
                    <div className="max-h-[500px] overflow-y-auto no-scrollbar space-y-1 pr-1">
                      {/* Public & Health */}
                      <CollapsibleSection title="Public, Health & Education">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'schools', label: 'Schools/Uni' },
                             { id: 'hospitals', label: 'Hospitals' },
                             { id: 'government', label: 'Government' },
                             { id: 'nonprofit', label: 'Non-Profit/NGO' },
                             { id: 'agencies', label: 'Agencies' },
                             { id: 'library', label: 'Libraries' },
                             { id: 'police', label: 'Law Enforcement' }
                          ]).map((n) => (
                            <label key={n.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input
                                type="checkbox"
                                checked={config.niches?.includes(n.id)}
                                onChange={(e) => {
                                  const niches = e.target.checked 
                                    ? [...(config.niches || []), n.id]
                                    : (config.niches || []).filter(x => x !== n.id);
                                  setConfig({ ...config, niches });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-cyan-400 focus:ring-0"
                              />
                              {n.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Tech, Media & Marketing">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'software', label: 'Software/SaaS' },
                             { id: 'it_services', label: 'IT Services' },
                             { id: 'ai_robotics', label: 'AI & Robotics' },
                             { id: 'marketing', label: 'Marketing/Ad' },
                             { id: 'media', label: 'News & Media' }
                          ]).map((n) => (
                            <label key={n.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.niches?.includes(n.id)}
                                onChange={(e) => {
                                  const niches = e.target.checked 
                                    ? [...(config.niches || []), n.id]
                                    : (config.niches || []).filter(x => x !== n.id);
                                  setConfig({ ...config, niches });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-cyan-400 focus:ring-0"
                              />
                              {n.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Finance, Legal & Realty">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'banks', label: 'Banks/Finance' },
                             { id: 'insurance', label: 'Insurance' },
                             { id: 'investment', label: 'Investments' },
                             { id: 'real_estate', label: 'Real Estate' },
                             { id: 'law_firms', label: 'Law Firms' }
                          ]).map((n) => (
                            <label key={n.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.niches?.includes(n.id)}
                                onChange={(e) => {
                                  const niches = e.target.checked 
                                    ? [...(config.niches || []), n.id]
                                    : (config.niches || []).filter(x => x !== n.id);
                                  setConfig({ ...config, niches });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-cyan-400 focus:ring-0"
                              />
                              {n.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Industrial & Logistics">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'construction', label: 'Construction' },
                             { id: 'manufacturing', label: 'Manufacturing' },
                             { id: 'energy', label: 'Energy/Utility' },
                             { id: 'mining', label: 'Mining/Resources' },
                             { id: 'logistics', label: 'Logistics' }
                          ]).map((n) => (
                            <label key={n.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.niches?.includes(n.id)}
                                onChange={(e) => {
                                  const niches = e.target.checked 
                                    ? [...(config.niches || []), n.id]
                                    : (config.niches || []).filter(x => x !== n.id);
                                  setConfig({ ...config, niches });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-cyan-400 focus:ring-0"
                              />
                              {n.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Lifestyle & Hospitality">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'hotels', label: 'Hotels' },
                             { id: 'restaurants', label: 'Restaurants' },
                             { id: 'spas', label: 'Beauty & Spas' },
                             { id: 'travel', label: 'Travel/Tourism' }
                          ]).map((n) => (
                            <label key={n.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.niches?.includes(n.id)}
                                onChange={(e) => {
                                  const niches = e.target.checked 
                                    ? [...(config.niches || []), n.id]
                                    : (config.niches || []).filter(x => x !== n.id);
                                  setConfig({ ...config, niches });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-cyan-400 focus:ring-0"
                              />
                              {n.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>
                    </div>
                  </div>

                  {/* Roles Section */}
                  <div>
                    <h4 className="text-[11px] text-green-400 font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_green]"></span>
                       Targeted Roles (Lists)
                    </h4>
                    
                    <div className="max-h-[500px] overflow-y-auto no-scrollbar space-y-1 pr-1">
                      {/* Leadership */}
                      <CollapsibleSection title="Leadership & C-Suite">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'ceo', label: 'CEO/Founders' },
                             { id: 'directors', label: 'Directors' },
                             { id: 'managers', label: 'Managers' }
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input
                                type="checkbox"
                                checked={config.roles?.includes(r.id)}
                                onChange={(e) => {
                                  const roles = e.target.checked 
                                    ? [...(config.roles || []), r.id]
                                    : (config.roles || []).filter(x => x !== r.id);
                                  setConfig({ ...config, roles });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-green-400 focus:ring-0"
                              />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Corporate & Operations">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'hr_managers', label: 'HR Managers' },
                             { id: 'marketing_execs', label: 'Marketing Execs' },
                             { id: 'sales_reps', label: 'Sales Reps' },
                             { id: 'support_staff', label: 'Customer Support' },
                             { id: 'accountants', label: 'Accountants' },
                             { id: 'brokers', label: 'Brokers' }
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.roles?.includes(r.id)}
                                onChange={(e) => {
                                  const roles = e.target.checked 
                                    ? [...(config.roles || []), r.id]
                                    : (config.roles || []).filter(x => x !== r.id);
                                  setConfig({ ...config, roles });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-green-400 focus:ring-0"
                              />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Tech & Global Experts">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'engineers', label: 'Engineers' },
                             { id: 'developers', label: 'Developers' },
                             { id: 'designers', label: 'Designers' },
                             { id: 'lawyers', label: 'Lawyers' },
                             { id: 'researchers', label: 'Researchers' }
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.roles?.includes(r.id)}
                                onChange={(e) => {
                                  const roles = e.target.checked 
                                    ? [...(config.roles || []), r.id]
                                    : (config.roles || []).filter(x => x !== r.id);
                                  setConfig({ ...config, roles });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-green-400 focus:ring-0"
                              />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Medical & Services">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'doctors', label: 'Doctors' },
                             { id: 'nurses', label: 'Nurses' },
                             { id: 'teachers', label: 'Teachers' },
                             { id: 'technicians', label: 'Technicians' },
                             { id: 'workers', label: 'Staff/Workers' },
                             { id: 'security', label: 'Security' }
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.roles?.includes(r.id)}
                                onChange={(e) => {
                                  const roles = e.target.checked 
                                    ? [...(config.roles || []), r.id]
                                    : (config.roles || []).filter(x => x !== r.id);
                                  setConfig({ ...config, roles });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-green-400 focus:ring-0"
                              />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Public & Candidates">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                             { id: 'students', label: 'Students' },
                             { id: 'jobseekers', label: 'Job Seekers' },
                             { id: 'freelancers', label: 'Freelancers' },
                             { id: 'interns', label: 'Interns' },
                             { id: 'visitors', label: 'Visitors' },
                             { id: 'patients', label: 'Patients' }
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                               <input
                                type="checkbox"
                                checked={config.roles?.includes(r.id)}
                                onChange={(e) => {
                                  const roles = e.target.checked 
                                    ? [...(config.roles || []), r.id]
                                    : (config.roles || []).filter(x => x !== r.id);
                                  setConfig({ ...config, roles });
                                }}
                                className="rounded bg-cyber-bg border-gray-700 text-green-400 focus:ring-0"
                              />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      {/* ── NEW PRECISION CATEGORIES ── */}
                      <CollapsibleSection title="🎯 Job Seekers & Resume" titleClass="text-orange-400">
                        <p className="text-[9px] text-gray-600 mb-2">Targets job boards, resume databases, career sites</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'jobseekers_active', label: 'Active Job Seekers' },
                            { id: 'resume_posters', label: 'Resume Posters' },
                            { id: 'career_changers', label: 'Career Changers' },
                            { id: 'recent_graduates', label: 'Recent Graduates' },
                            { id: 'remote_workers', label: 'Remote Workers' },
                            { id: 'gig_workers', label: 'Gig/Contract Workers' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-orange-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="🏠 Real Estate" titleClass="text-yellow-400">
                        <p className="text-[9px] text-gray-600 mb-2">Targets property listings, agent directories, real estate platforms</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'real_estate_agents', label: 'RE Agents' },
                            { id: 'property_buyers', label: 'Property Buyers' },
                            { id: 'landlords', label: 'Landlords' },
                            { id: 'property_developers', label: 'Developers' },
                            { id: 'mortgage_brokers', label: 'Mortgage Brokers' },
                            { id: 'property_managers', label: 'Property Managers' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-yellow-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="👔 Business Directors & C-Suite" titleClass="text-purple-400">
                        <p className="text-[9px] text-gray-600 mb-2">Targets company registries, LinkedIn, business directories</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'ceo_founders', label: 'CEO / Founders' },
                            { id: 'cfo', label: 'CFO / Finance Directors' },
                            { id: 'cto_cio', label: 'CTO / CIO' },
                            { id: 'cmo', label: 'CMO / Marketing Directors' },
                            { id: 'board_directors', label: 'Board Directors' },
                            { id: 'vp_executives', label: 'VP / Executives' },
                            { id: 'business_owners', label: 'Business Owners' },
                            { id: 'managing_directors', label: 'Managing Directors' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-purple-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="🎓 Students & Academic Institutions" titleClass="text-blue-400">
                        <p className="text-[9px] text-gray-600 mb-2">Targets university directories, student portals, academic databases</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'university_students', label: 'University Students' },
                            { id: 'college_students', label: 'College Students' },
                            { id: 'phd_researchers', label: 'PhD Researchers' },
                            { id: 'professors', label: 'Professors / Lecturers' },
                            { id: 'school_teachers', label: 'School Teachers' },
                            { id: 'academic_admin', label: 'Academic Admin' },
                            { id: 'student_unions', label: 'Student Unions' },
                            { id: 'training_centres', label: 'Training Centres' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-blue-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="🏭 Industry Specific" titleClass="text-red-400">
                        <p className="text-[9px] text-gray-600 mb-2">Targets industry associations, trade bodies, sector databases</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'manufacturing', label: 'Manufacturing' },
                            { id: 'oil_gas', label: 'Oil & Gas' },
                            { id: 'agriculture', label: 'Agriculture' },
                            { id: 'construction_industry', label: 'Construction' },
                            { id: 'automotive', label: 'Automotive' },
                            { id: 'mining', label: 'Mining' },
                            { id: 'textile_fashion', label: 'Textile / Fashion' },
                            { id: 'food_beverage', label: 'Food & Beverage' },
                            { id: 'logistics', label: 'Logistics / Supply Chain' },
                            { id: 'energy_utilities', label: 'Energy / Utilities' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-red-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="💼 Professional Services" titleClass="text-teal-400">
                        <p className="text-[9px] text-gray-600 mb-2">Targets professional associations, certification bodies, service directories</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'accountants', label: 'Accountants / CPAs' },
                            { id: 'lawyers_attorneys', label: 'Lawyers / Attorneys' },
                            { id: 'architects', label: 'Architects' },
                            { id: 'consultants', label: 'Consultants' },
                            { id: 'financial_advisors', label: 'Financial Advisors' },
                            { id: 'insurance_agents', label: 'Insurance Agents' },
                            { id: 'it_professionals', label: 'IT Professionals' },
                            { id: 'hr_professionals', label: 'HR Professionals' },
                            { id: 'pr_media', label: 'PR & Media' },
                            { id: 'event_planners', label: 'Event Planners' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-teal-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="🏥 Healthcare Professionals" titleClass="text-pink-400">
                        <p className="text-[9px] text-gray-600 mb-2">Targets medical directories, hospital staff lists, health associations</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'physicians', label: 'Physicians / GPs' },
                            { id: 'surgeons', label: 'Surgeons' },
                            { id: 'dentists', label: 'Dentists' },
                            { id: 'pharmacists', label: 'Pharmacists' },
                            { id: 'nurses_professional', label: 'Nurses' },
                            { id: 'physiotherapists', label: 'Physiotherapists' },
                            { id: 'psychologists', label: 'Psychologists' },
                            { id: 'hospital_admins', label: 'Hospital Admins' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-pink-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="⛪ Religious & Community" titleClass="text-amber-400">
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'churches', label: 'Churches / Mosques' },
                            { id: 'community_leaders', label: 'Community Leaders' },
                            { id: 'ngo_charities', label: 'NGOs / Charities' },
                            { id: 'political_orgs', label: 'Political Orgs' },
                          ]).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 transition-colors">
                              <input type="checkbox" checked={config.roles?.includes(r.id)}
                                onChange={(e) => { const roles = e.target.checked ? [...(config.roles||[]),r.id] : (config.roles||[]).filter(x=>x!==r.id); setConfig({...config,roles}); }}
                                className="rounded bg-cyber-bg border-gray-700 text-amber-400 focus:ring-0" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </CollapsibleSection>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 mt-4">
              <div className="flex gap-2">
                <GlowButton
                  onClick={startExtraction}
                  disabled={isRunning || keywords.length === 0}
                  variant="primary"
                  className="flex-1 justify-center animate-pulse-glow h-12"
                >
                  {isRunning ? '⟳ Engine Running...' : '▶ Start Extraction'}
                </GlowButton>
                <GlowButton
                  onClick={pauseExtraction}
                  disabled={!isRunning}
                  variant="warning"
                  className="w-12 flex justify-center items-center h-12"
                >
                  {isPaused ? '▶' : '⏸'}
                </GlowButton>
              </div>
              
              <GlowButton
                onClick={stopExtraction}
                disabled={!isRunning}
                variant="danger"
                className="w-full justify-center h-12 font-bold flex items-center gap-2 border-2 border-red-500/50 hover:bg-red-500/20"
              >
                <div className="w-4 h-4 rounded bg-white/20 flex items-center justify-center">
                    <div className="w-2 h-2 bg-white" />
                </div>
                {isRunning ? '🛑 STOP EXTRACTION NOW' : 'Stop Engine'}
              </GlowButton>
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="lg:col-span-2 space-y-4">
          <LiveFeed events={events} maxHeight="250px" />
          <DataTable emails={emails} />
        </div>
      </div>
    </div>
  );
};
