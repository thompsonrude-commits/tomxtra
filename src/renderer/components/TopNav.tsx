import React from 'react';
import { LicenseStatus } from '../types';

interface TopNavProps {
  onNavigate: (page: string) => void;
  currentPage: string;
  licenseStatus: LicenseStatus | null;
}

const menuItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'extract', label: 'Extract' },
  { id: 'interactive', label: 'Browser' },
  { id: 'verify', label: 'Verify' },
  { id: 'mailer-section', label: 'Mailer' },
  { id: 'proxy-manager', label: 'Proxy' },
  { id: 'export', label: 'Export' },
  { id: 'settings', label: 'Settings' },
];

export const TopNav: React.FC<TopNavProps> = ({ onNavigate, currentPage, licenseStatus }) => {
  return (
    <header className="bg-cyber-panel border-b border-gray-800 h-12 flex items-center shrink-0 overflow-hidden">
      {/* App name */}
      <div className="flex items-center gap-2 px-3 no-drag shrink-0">
        <svg className="w-6 h-6 text-cyber-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span className="text-base font-black tracking-tight whitespace-nowrap flex items-center">
          <span className="rainbow-text">Obo</span>
          <span className="rainbow-text" style={{ display: 'inline-block', animation: 'rainbowShift 3s linear infinite' }}>X</span>
          <span className="rainbow-text">a</span>
          <span className="rainbow-text ml-1">Ultra</span>
        </span>
        <span className="text-[10px] text-gray-400 font-mono bg-gray-800/50 px-1.5 py-0.5 rounded border border-gray-700 whitespace-nowrap">
          v1.0.13
        </span>
      </div>

      {/* Menu items — scrollable if needed */}
      <nav className="flex items-center gap-0.5 no-drag mx-2 overflow-x-auto shrink-0" style={{ scrollbarWidth: 'none' }}>
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
              currentPage === item.id
                ? 'text-cyber-accent bg-cyber-accent/10'
                : 'text-gray-400 hover:text-cyber-text hover:bg-gray-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Drag region — fills remaining space */}
      <div className="flex-1 h-full drag-region min-w-[10px]"></div>

      {/* Right side — always visible, shrink-0 */}
      <div className="flex items-center gap-1.5 no-drag shrink-0 pr-1">
        {/* Trial badge */}
        {licenseStatus?.trial && !licenseStatus.trialExpired && (
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/30">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />
              <span className="text-[10px] text-yellow-400 font-mono whitespace-nowrap">
                {Math.round(licenseStatus.hoursRemaining || 0)}h
              </span>
            </div>
            <button
              onClick={() => onNavigate('activate')}
              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-cyber-accent/20 border border-cyber-accent/40 text-cyber-accent hover:bg-cyber-accent/30 transition-colors whitespace-nowrap"
            >
              Activate
            </button>
          </div>
        )}

        {/* Notification icon */}
        <button className="p-1 rounded hover:bg-gray-800 text-gray-300 hover:text-cyber-accent transition-colors relative shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-cyber-accent rounded-full" />
        </button>

        {/* Settings icon */}
        <button
          onClick={() => onNavigate('settings')}
          className="p-1 rounded hover:bg-gray-800 text-gray-300 hover:text-cyber-accent transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Window controls — always last, always visible */}
        <div className="flex items-center gap-0 ml-1 pl-1 border-l border-gray-800 shrink-0">
          <button
            onClick={() => window.electronAPI?.minimizeWindow()}
            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="Minimize"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={() => window.electronAPI?.maximizeWindow()}
            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="Maximize"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="5" y="5" width="14" height="14" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => window.electronAPI?.closeWindow()}
            className="p-1.5 rounded hover:bg-red-500 text-gray-400 hover:text-white transition-colors"
            title="Close"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};
