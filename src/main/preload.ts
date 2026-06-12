import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Extraction
  startExtraction: (config: any) => ipcRenderer.invoke('start-extraction', config),
  pauseExtraction: () => ipcRenderer.invoke('pause-extraction'),
  stopExtraction: () => ipcRenderer.invoke('stop-extraction'),
  onExtractionEvent: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('extraction-event', callback);
    return () => ipcRenderer.removeListener('extraction-event', callback);
  },

  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),
  getEmails: (filters?: any) => ipcRenderer.invoke('get-emails', filters),
  getEmailCount: (filters?: any) => ipcRenderer.invoke('get-email-count', filters),
  getDomains: () => ipcRenderer.invoke('get-domains'),
  getLogs: () => ipcRenderer.invoke('get-logs'),

  // Export
  exportData: (format: string, options?: any) => ipcRenderer.invoke('export-data', format, options),

  // Email verification
  verifyEmails: (emails: string[]) => ipcRenderer.invoke('verify-emails', emails),

  // Proxy
  getProxies: () => ipcRenderer.invoke('get-proxies'),
  addProxy: (address: string) => ipcRenderer.invoke('add-proxy', address),
  deleteProxy: (id: number) => ipcRenderer.invoke('delete-proxy', id),
  updateProxyStatus: (data: any) => ipcRenderer.invoke('update-proxy-status', data),
  getWorkingProxies: () => ipcRenderer.invoke('get-working-proxies'),
  fetchFreeProxies: () => ipcRenderer.invoke('fetch-free-proxies'),
  testProxy: (proxy: string) => ipcRenderer.invoke('proxy-test', proxy),
  onProxyAutopilotDone: (callback: (working: number) => void) => {
    ipcRenderer.on('proxy-autopilot-done', (_event, working) => callback(working));
    return () => ipcRenderer.removeAllListeners('proxy-autopilot-done');
  },

  // License
  checkLicense: () => ipcRenderer.invoke('check-license'),
  activateLicense: (key: string) => ipcRenderer.invoke('activate-license', key),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),

  // Interactive Browser
  addManualEmails: (data: { emails: string[], sourcePage: string, domain: string }) => ipcRenderer.invoke('add-manual-emails', data),

  // Database
  purgeJunkEmails: () => ipcRenderer.invoke('purge-junk-emails'),
  clearEmails: () => ipcRenderer.invoke('clear-emails'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  resetDatabase: () => ipcRenderer.invoke('reset-database'),
  deleteEmail: (id: number) => ipcRenderer.invoke('delete-email', id),
  deleteEmailsByStatus: (status: string) => ipcRenderer.invoke('delete-emails-by-status', status),

  // File dialog
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveFileDialog: (defaultName: string) => ipcRenderer.invoke('save-file-dialog', defaultName),

  // Mailer
  getSmtps: () => ipcRenderer.invoke('get-smtps'),
  addSmtp: (smtp: any) => ipcRenderer.invoke('add-smtp', smtp),
  deleteSmtp: (id: number) => ipcRenderer.invoke('delete-smtp', id),
  testSmtp: (smtp: any) => ipcRenderer.invoke('test-smtp', smtp),
  getMailingLogs: () => ipcRenderer.invoke('get-mailing-logs'),
  getMailingSettings: () => ipcRenderer.invoke('get-mailing-settings'),
  saveMailingSetting: (data: any) => ipcRenderer.invoke('save-mailing-setting', data),
  clearSmtps: () => ipcRenderer.invoke('clear-smtps'),
  clearMailingLogs: () => ipcRenderer.invoke('clear-mailing-logs'),
  importEmailsFromFile: () => ipcRenderer.invoke('import-emails-from-file'),
  startMailing: (config: any) => ipcRenderer.invoke('start-mailing', config),
  stopMailing: () => ipcRenderer.invoke('stop-mailing'),
  exportCampaignReport: (reportPath: string) => ipcRenderer.invoke('export-campaign-report', reportPath),
  parseMailMergeFile: () => ipcRenderer.invoke('parse-mailmerge-file'),
  onMailingEvent: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('mailing-event', callback);
    return () => ipcRenderer.removeListener('mailing-event', callback);
  },

  // Web Email Accounts (Gmail / Outlook browser login)
  openGmailLogin: () => ipcRenderer.invoke('open-gmail-login'),
  openOutlookLogin: () => ipcRenderer.invoke('open-outlook-login'),
  openWebLogin: (data: { providerId: string; customUrl?: string }) => ipcRenderer.invoke('open-web-login', data),
  getAvailableProviders: () => ipcRenderer.invoke('get-available-providers'),
  getWebAccounts: () => ipcRenderer.invoke('get-web-accounts'),
  checkWebLoginStatus: () => ipcRenderer.invoke('check-web-login-status'),
  logoutWebAccount: (id: string) => ipcRenderer.invoke('logout-web-account', id),
  logoutGmail: () => ipcRenderer.invoke('logout-gmail'),
  logoutOutlook: () => ipcRenderer.invoke('logout-outlook'),
  startWebCampaign: (config: any) => ipcRenderer.invoke('start-web-campaign', config),
  onWebCampaignEvent: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('web-campaign-event', callback);
    return () => ipcRenderer.removeListener('web-campaign-event', callback);
  },
  // VPN Manager
  fetchVpnServers: () => ipcRenderer.invoke('fetch-vpn-servers'),
  connectVpn: (data: { countryCode: string }) => ipcRenderer.invoke('connect-vpn', data),
  disconnectVpn: () => ipcRenderer.invoke('disconnect-vpn'),
  downloadWireproxy: () => ipcRenderer.invoke('download-wireproxy'),
  getPublicIp: () => ipcRenderer.invoke('get-public-ip'),
  getActiveVpn: () => ipcRenderer.invoke('get-active-vpn'),
});
