import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import { ExtractionEngine } from '../crawler/engine';
import * as db from '../db/database';
import { exportToCSV, exportToTXT, exportToXLSX } from '../export/exporter';
import { checkTrialStatus, getTrialInfo } from '../license/trial';
import { generateMachineId } from '../license/fingerprint';
import { activateLicense } from '../license/activation';
import { verifyEmail } from '../email/verifier';
import { emailMailer } from '../email/mailer';
import { fetchFreeProxies, ensureWorkingProxies } from '../crawler/proxyFetcher';
import { checkDomainDeliverability } from '../utils/emailValidator';
import { scoreEmailForMarketing } from '../utils/marketingValidator';
import {
  openGmailLogin, openOutlookLogin, openWebLogin,
  sendViaWebAccount, getWebAccounts, logoutWebAccount,
  checkGmailLoginStatus, checkOutlookLoginStatus,
  logoutGmail, logoutOutlook, getAvailableProviders
} from '../email/webEmailSender';
import {
  fetchVpnServers, connectVpnProxy, disconnectVpnProxy,
  getPublicIp, getActiveProxy, getActiveCountry,
  connectWarp, disconnectWarp, isConnected, WARP_COUNTRIES, downloadWireproxy
} from '../vpn/vpnManager';

const engine = new ExtractionEngine();

// Quick proxy health test — returns only alive proxies
async function quickTestProxies(proxies: string[]): Promise<string[]> {
  const http = require('http');
  const alive: string[] = [];
  
  const testOne = (proxy: string): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        const clean = proxy.replace(/^https?:\/\//, '');
        let host: string, port: number;
        if (clean.includes('@')) {
          const afterAt = clean.substring(clean.lastIndexOf('@') + 1);
          [host] = afterAt.split(':');
          port = parseInt(afterAt.split(':')[1]) || 8080;
        } else {
          const parts = clean.split(':');
          host = parts[0];
          port = parseInt(parts[1]) || 8080;
        }
        const headers: Record<string, string> = { Host: 'www.google.com' };
        if (clean.includes('@')) {
          const authPart = clean.split('@')[0];
          headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(authPart).toString('base64');
        }
        const req = http.request({ host, port, method: 'GET', path: 'http://www.google.com/', headers, timeout: 6000 }, (res: any) => {
          req.destroy();
          resolve((res.statusCode || 0) > 0);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      } catch {
        resolve(false);
      }
    });
  };
  
  // Test in batches of 10
  for (let i = 0; i < proxies.length; i += 10) {
    const batch = proxies.slice(i, i + 10);
    const results = await Promise.all(batch.map(p => testOne(p)));
    
    batch.forEach((proxy, idx) => {
      if (results[idx]) {
        alive.push(proxy);
        db.updateProxyStatus(proxy, true, 0);
      } else {
        db.updateProxyStatus(proxy, false, 0);
      }
    });
  }
  
  return alive;
}

export function registerIpcHandlers() {
  // Extraction
  ipcMain.handle('start-extraction', async (_event, config) => {
    const finalConfig = { ...config };
    if (config.proxyMode === 'rotating') {
      db.addLog('Ensuring working proxies available before extraction...', 'info');
      
      // Always verify and replenish proxies before starting
      const workingProxies = await ensureWorkingProxies(10);
      
      if (workingProxies.length > 0) {
        finalConfig.proxies = workingProxies;
        db.addLog(`${workingProxies.length} verified working proxies ready for extraction`, 'success');
      } else {
        db.addLog('Could not find working proxies — starting with direct connection', 'warning');
        finalConfig.proxyMode = 'none';
      }
    } else {
      db.addLog('Starting extraction in direct mode (No proxies)', 'info');
    }
    
    const win = BrowserWindow.getAllWindows()[0];
    engine.removeAllListeners('event');
    engine.on('event', (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('extraction-event', data);
      }
    });

    db.addLog(`Initializing extraction engine with ${config.threads} threads...`, 'info');
    engine.start(finalConfig);
  });

  ipcMain.handle('pause-extraction', async () => { engine.pause(); });
  ipcMain.handle('stop-extraction', async () => { 
    engine.stop(); 
    db.forceSave();
  });

  // Stats
  ipcMain.handle('get-stats', async () => {
    const stats = db.getStats();
    stats.activeJobs = engine.isRunning() ? 1 : 0;
    stats.isMailerRunning = emailMailer.isRunning();
    return stats;
  });

  ipcMain.handle('get-emails', async (_event, filters) => db.getEmails(filters));
  ipcMain.handle('get-email-count', async (_event, filters) => db.getEmailCount(filters));
  ipcMain.handle('get-domains', async () => db.getDomains());
  ipcMain.handle('get-logs', async () => db.getLogs());

  // Export
  ipcMain.handle('export-data', async (_event, format, options) => {
    const win = BrowserWindow.getAllWindows()[0];
    const saveResult = await dialog.showSaveDialog(win, {
      defaultPath: `extracted_emails.${format}`,
      filters: [
        { name: format.toUpperCase(), extensions: [format] },
      ],
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    const emails = db.getAllEmailsForExport(options?.filterStatus);
    switch (format) {
      case 'csv': await exportToCSV(emails, saveResult.filePath, options); break;
      case 'txt': await exportToTXT(emails, saveResult.filePath, options); break;
      case 'xlsx': await exportToXLSX(emails, saveResult.filePath, options); break;
    }
    return saveResult.filePath;
  });

  // Email verification
  ipcMain.handle('verify-emails', async (_event, emails: string[]) => {
    return Promise.all(emails.map(async (email) => {
      const res = await verifyEmail(email);
      db.updateEmailStatus(email, res.status);
      return res;
    }));
  });

  // Proxy
  ipcMain.handle('get-proxies', async () => db.getProxies());
  ipcMain.handle('add-proxy', async (_event, address) => db.addProxy(address));
  ipcMain.handle('delete-proxy', async (_event, id) => db.deleteProxy(id));
  ipcMain.handle('update-proxy-status', async (_event, { address, working, latency }) => 
    db.updateProxyStatus(address, working, latency));
  ipcMain.handle('get-working-proxies', async () => db.getWorkingProxies());
  ipcMain.handle('fetch-free-proxies', async () => fetchFreeProxies());
  
  ipcMain.handle('proxy-test', async (_event, proxy) => {
    const start = Date.now();
    const http = require('http');
    const clean = proxy.replace(/^https?:\/\//, '');
    let host: string, port: number;
    if (clean.includes('@')) {
      const afterAt = clean.substring(clean.lastIndexOf('@') + 1);
      [host] = afterAt.split(':');
      port = parseInt(afterAt.split(':')[1]) || 8080;
    } else {
      const parts = clean.split(':');
      host = parts[0];
      port = parseInt(parts[1]) || 8080;
    }
    const headers: Record<string, string> = { Host: 'www.google.com' };
    if (clean.includes('@')) {
      headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(clean.split('@')[0]).toString('base64');
    }
    const working: boolean = await new Promise((resolve) => {
      try {
        const req = http.request({ host, port, method: 'GET', path: 'http://www.google.com/', headers, timeout: 6000 }, (res: any) => {
          req.destroy();
          resolve((res.statusCode || 0) > 0);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      } catch { resolve(false); }
    });
    const latency = Date.now() - start;
    db.updateProxyStatus(proxy, working, latency);
    if (!working) db.deleteFailedProxies();
    return { proxy, working, latency };
  });

  // License
  ipcMain.handle('check-license', async () => {
    const trial = getTrialInfo();
    const machineId = await generateMachineId();
    return { ...trial, machineId };
  });

  ipcMain.handle('activate-license', async (_event, key) => activateLicense(key));
  ipcMain.handle('get-machine-id', async () => generateMachineId());

  // Interactive Browser
  ipcMain.handle('add-manual-emails', async (_event, { emails, sourcePage, domain }) => {
    let foundCount = 0;
    for (const email of emails) {
      const emailDomain = email.split('@')[1];
      if (!emailDomain) continue;
      
      const isDeliverable = await checkDomainDeliverability(emailDomain);
      if (!isDeliverable) continue;

      // AI-powered marketing quality validation
      const marketingValidation = scoreEmailForMarketing(email, emailDomain);
      if (db.addEmail(email, domain, sourcePage, undefined, undefined, marketingValidation.score, marketingValidation.isMarketingReady, marketingValidation.riskLevel)) {
        foundCount++;
      }
    }
    return foundCount;
  });

  // Data management
  ipcMain.handle('purge-junk-emails', async () => db.purgeJunkEmails());
  ipcMain.handle('clear-emails', async () => db.clearEmails());
  ipcMain.handle('clear-logs', async () => db.clearLogs());
  ipcMain.handle('reset-database', async () => db.resetDatabase());
  ipcMain.handle('delete-email', async (_event, id) => db.deleteEmail(id));
  ipcMain.handle('delete-emails-by-status', async (_event, status) => db.deleteEmailsByStatus(status));

  // File dialog
  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Text Files', extensions: ['txt', 'csv'] }] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('save-file-dialog', async (_event, defaultName) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('import-emails-from-file', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Email Lists', extensions: ['txt', 'csv'] }]
    });
    if (canceled || filePaths.length === 0) return 0;
    
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    let emails: string[] = [];

    if (filePath.endsWith('.csv')) {
      const { parse } = await import('fast-csv');
      const rows: any[] = [];
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(parse({ headers: true, ignoreEmpty: true }))
          .on('data', (row) => rows.push(row))
          .on('error', reject)
          .on('end', resolve);
      });
      
      // Look for common email column names
      const emailKeys = ['email', 'address', 'mail', 'e-mail'];
      emails = rows.map(row => {
        const key = Object.keys(row).find(k => emailKeys.includes(k.toLowerCase()));
        return key ? row[key] : Object.values(row)[0];
      }).filter(e => typeof e === 'string' && e.includes('@'));
    } else {
      // TXT parsing
      emails = content.split(/\r?\n/).map(line => line.trim()).filter(line => line.includes('@'));
    }

    let addedCount = 0;
    for (const email of emails) {
      const domain = email.split('@')[1] || 'imported';
      // AI-powered marketing quality validation
      const marketingValidation = scoreEmailForMarketing(email, domain);
      if (db.addEmail(email, domain, 'imported-file', undefined, undefined, marketingValidation.score, marketingValidation.isMarketingReady, marketingValidation.riskLevel)) {
        addedCount++;
      }
    }
    return addedCount;
  });

  // Mailer
  ipcMain.handle('get-smtps', async () => db.getSmtps());
  ipcMain.handle('add-smtp', async (_event, smtp) => db.addSmtp(smtp));
  ipcMain.handle('delete-smtp', async (_event, id) => db.deleteSmtp(id));
  ipcMain.handle('clear-smtps', async () => db.clearSmtps());
  ipcMain.handle('clear-mailing-logs', async () => db.clearMailingLogs());
  ipcMain.handle('test-smtp', async (_event, smtp) => emailMailer.testSmtp(smtp));
  ipcMain.handle('get-mailing-logs', async () => db.getMailingLogs());
  ipcMain.handle('get-mailing-settings', async () => db.getMailingSettings());
  ipcMain.handle('save-mailing-setting', async (_event, { key, value }) => db.saveMailingSetting(key, value));
  
  ipcMain.handle('start-mailing', async (_event, config: any) => {
    const win = BrowserWindow.getAllWindows()[0];
    emailMailer.removeAllListeners('event');
    emailMailer.on('event', (data: any) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('mailing-event', data);
      }
    });
    return emailMailer.start(config);
  });
  
  ipcMain.handle('stop-mailing', async () => emailMailer.stop());

  // Export campaign report CSV
  ipcMain.handle('export-campaign-report', async (_event, reportPath: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    const saveResult = await dialog.showSaveDialog(win, {
      defaultPath: `campaign_report_${Date.now()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    fs.copyFileSync(reportPath, saveResult.filePath);
    return saveResult.filePath;
  });

  // Mail Merge — parse CSV/Excel file and return rows + detected columns
  ipcMain.handle('parse-mailmerge-file', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Data Files', extensions: ['csv', 'xlsx', 'xls'] }]
    });
    if (canceled || filePaths.length === 0) return null;

    const filePath = filePaths[0];
    let rows: Record<string, string>[] = [];

    try {
      if (filePath.endsWith('.csv')) {
        const { parse } = await import('fast-csv');
        await new Promise<void>((resolve, reject) => {
          fs.createReadStream(filePath)
            .pipe(parse({ headers: true, ignoreEmpty: true, trim: true }))
            .on('data', (row: Record<string, string>) => rows.push(row))
            .on('error', reject)
            .on('end', resolve);
        });
      } else {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.worksheets[0];
        const headers: string[] = [];
        sheet.getRow(1).eachCell((cell) => { headers.push(String(cell.value || '').trim()); });
        sheet.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const obj: Record<string, string> = {};
          row.eachCell((cell, colNum) => {
            const key = headers[colNum - 1];
            if (key) obj[key] = String(cell.value || '').trim();
          });
          if (Object.values(obj).some(v => v)) rows.push(obj);
        });
      }
    } catch (err: any) {
      return { error: err.message };
    }

    if (rows.length === 0) return { error: 'No data found in file' };
    const columns = Object.keys(rows[0]);
    return { rows, columns };
  });

  // ─── Web Email Accounts (Gmail / Outlook browser login) ───────────────────

  ipcMain.handle('open-gmail-login', async () => {
    const workingProxies = db.getWorkingProxies();
    const accounts = getWebAccounts();
    const usedProxies = new Set(accounts.map((a: any) => a.proxy).filter(Boolean));
    // Only use external proxies — never pass local VPN proxy to login browser
    const activeVpn = getActiveProxy();
    const isLocalVpn = activeVpn && activeVpn.includes('127.0.0.1');
    const proxy = isLocalVpn ? undefined : (activeVpn || workingProxies.find(p => !usedProxies.has(p)) || undefined);
    return await openGmailLogin(proxy);
  });

  ipcMain.handle('open-outlook-login', async () => {
    const workingProxies = db.getWorkingProxies();
    const accounts = getWebAccounts();
    const usedProxies = new Set(accounts.map((a: any) => a.proxy).filter(Boolean));
    const activeVpn = getActiveProxy();
    const isLocalVpn = activeVpn && activeVpn.includes('127.0.0.1');
    const proxy = isLocalVpn ? undefined : (activeVpn || workingProxies.find(p => !usedProxies.has(p)) || undefined);
    return await openOutlookLogin(proxy);
  });

  ipcMain.handle('open-web-login', async (_event, { providerId, customUrl }: { providerId: string; customUrl?: string }) => {
    // Use VPN proxy only if wireproxy is actually running (local SOCKS5 works)
    // Use pool proxy only if it's an external proxy (not 127.0.0.1)
    const activeVpn = getActiveProxy();
    const isLocalVpn = activeVpn && activeVpn.includes('127.0.0.1');
    const workingProxies = db.getWorkingProxies();
    const accounts = getWebAccounts();
    const usedProxies = new Set(accounts.map((a: any) => a.proxy).filter(Boolean));
    const poolProxy = workingProxies.find(p => !usedProxies.has(p) && !p.includes('127.0.0.1')) || undefined;
    // Only pass proxy if VPN is confirmed running OR we have a real external proxy
    const proxy = (isLocalVpn && isConnected()) ? activeVpn : poolProxy;
    return await openWebLogin(providerId, customUrl, proxy || undefined);
  });

  ipcMain.handle('get-available-providers', async () => {
    return getAvailableProviders();
  });

  ipcMain.handle('get-web-accounts', async () => {
    return getWebAccounts();
  });

  ipcMain.handle('check-web-login-status', async () => {
    const accounts = getWebAccounts();
    return {
      gmail: accounts.some(a => a.provider === 'gmail'),
      outlook: accounts.some(a => a.provider === 'outlook'),
      accounts,
    };
  });

  ipcMain.handle('logout-web-account', async (_event, id: string) => {
    await logoutWebAccount(id);
    return { success: true };
  });

  ipcMain.handle('logout-gmail', async () => { await logoutGmail(); return { success: true }; });
  ipcMain.handle('logout-outlook', async () => { await logoutOutlook(); return { success: true }; });

  // ─── VPN Manager ──────────────────────────────────────────────────────────

  ipcMain.handle('fetch-vpn-servers', async () => {
    return { servers: WARP_COUNTRIES };
  });

  ipcMain.handle('connect-vpn', async (_event, { countryCode }: { countryCode: string }) => {
    return await connectWarp(countryCode);
  });

  ipcMain.handle('disconnect-vpn', async () => {
    await disconnectWarp();
    return { success: true };
  });

  ipcMain.handle('download-wireproxy', async () => {
    return await downloadWireproxy();
  });

  ipcMain.handle('get-public-ip', async () => {
    return await getPublicIp();
  });

  ipcMain.handle('get-active-vpn', async () => {
    return { proxy: getActiveProxy(), country: getActiveCountry(), connected: isConnected() };
  });

  // Legacy handlers (keep for backward compat)
  ipcMain.handle('fetch-vpn-servers-legacy', async () => fetchVpnServers());
  ipcMain.handle('connect-vpn-proxy', async (_event, { ip, port, country }) => connectVpnProxy(ip, port, country));
  ipcMain.handle('disconnect-vpn-proxy', async () => { disconnectVpnProxy(); return { success: true }; });

  /**
   * Web campaign: each account gets its own independent queue,
   * sends one email every 60s, all accounts run in parallel.
   * Results are written to mailing_logs DB and a CSV report is generated.
   */
  ipcMain.handle('start-web-campaign', async (_event, config: {
    subject: string;
    body: string;
    recipients: string[];
    mergeData?: Record<string, Record<string, string>>;
    autoRephrase?: boolean;
  }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const accounts = getWebAccounts();
    if (accounts.length === 0) return { success: false, error: 'No web accounts connected' };

    const emit = (data: any) => {
      if (win && !win.isDestroyed()) win.webContents.send('web-campaign-event', data);
    };

    const totalAccounts = accounts.length;
    const queues: string[][] = accounts.map((_, i) =>
      config.recipients.filter((_, ri) => ri % totalAccounts === i)
    );

    emit({
      type: 'started',
      message: `Web campaign: ${config.recipients.length} recipients | ${totalAccounts} account(s) | 60s per send per account`,
    });

    const applyMerge = (text: string, recipient: string, rowData?: Record<string, string>) => {
      let t = text
        .replace(/{email}/g, recipient)
        .replace(/{domain}/g, recipient.split('@')[1] || '')
        .replace(/{date}/g, new Date().toLocaleDateString());
      if (rowData) {
        for (const [col, val] of Object.entries(rowData)) {
          const re = new RegExp(`\\{\\{${col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'gi');
          t = t.replace(re, val);
        }
      }
      return t;
    };

    // Tracking for report
    const sentList: string[] = [];
    const failedList: string[] = [];

    await Promise.all(
      accounts.map((account, accIdx) => {
        const queue = queues[accIdx];
        return (async () => {
          for (let qi = 0; qi < queue.length; qi++) {
            const recipient = queue[qi];
            const rowData = config.mergeData?.[recipient];
            let pSubject = applyMerge(config.subject, recipient, rowData);
            let pBody    = applyMerge(config.body, recipient, rowData);

            // Apply variations to bypass spam filters (Spintax and Auto-Rephrase)
            pSubject = emailMailer.parseSpintax(pSubject);
            pBody = emailMailer.parseSpintax(pBody);

            if (config.autoRephrase) {
              pSubject = emailMailer.autoRephrase(pSubject);
              pBody = emailMailer.autoRephrase(pBody);
            }

            emit({ type: 'sending', message: `[${account.email}${account.proxy ? ' via proxy' : ''}] Sending to ${recipient}${rowData?.name ? ` (${rowData.name})` : ''} (${qi + 1}/${queue.length})...`, recipient, account: account.email });

            const result = await sendViaWebAccount(account.id, recipient, pSubject, pBody);

            if (result.success) {
              sentList.push(recipient);
              db.addMailingLog({
                smtpId: null,
                recipient,
                subject: pSubject,
                status: 'success',
                deliveryLocation: 'Inbox',
                statusDetails: `Sent via ${account.providerName} (${account.email})${rowData?.name ? ` to ${rowData.name}` : ''}${account.proxy ? ' | IP rotated' : ''}`,
              });
              emit({ type: 'sent', message: `[${account.email}] ✓ ${rowData?.name || recipient}`, recipient, account: account.email });
            } else {
              failedList.push(recipient);
              db.addMailingLog({
                smtpId: null,
                recipient,
                subject: pSubject,
                status: 'error',
                deliveryLocation: 'Blocked',
                error: result.error,
              });
              emit({ type: 'error', message: `[${account.email}] ✗ ${rowData?.name || recipient}: ${result.error}`, recipient });
            }

            if (qi < queue.length - 1) {
              // Random pick from [30, 45, 60, 75]s — unpredictable pattern beats spam detectors
              const intervals = [30, 45, 60, 75];
              const baseSeconds = intervals[Math.floor(Math.random() * intervals.length)];
              const noise = Math.floor(Math.random() * 4000) - 2000; // ±2s noise
              const waitMs = (baseSeconds * 1000) + noise;
              emit({ type: 'waiting', message: `[${account.email}] ⏱ Next send in ${Math.round(waitMs / 1000)}s...` });
              await new Promise(r => setTimeout(r, waitMs));
            }
          }
        })();
      })
    );

    // Generate CSV report
    let reportPath = '';
    try {
      const dir = 'C:\\ProgramData\\TomXtractor\\Reports';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      reportPath = require('path').join(dir, `web_campaign_report_${timestamp}.csv`);
      const lines: string[] = [
        'WEB CAMPAIGN REPORT',
        `Subject,${config.subject}`,
        `Date,${new Date().toLocaleString()}`,
        `Accounts,${accounts.map(a => a.email).join(' | ')}`,
        '',
        'SUMMARY',
        `Total,Sent,Failed`,
        `${config.recipients.length},${sentList.length},${failedList.length}`,
        '',
        'SENT RECIPIENTS',
        ...sentList.map(r => r),
        '',
        'FAILED RECIPIENTS',
        ...failedList.map(r => r),
      ];
      fs.writeFileSync(reportPath, lines.join('\r\n'), 'utf-8');
    } catch {}

    const report = {
      sent: sentList.length,
      failed: failedList.length,
      skipped: 0,
      total: config.recipients.length,
      reportPath,
    };

    emit({ type: 'complete', message: `✅ Web campaign complete — Sent: ${sentList.length} | Failed: ${failedList.length}`, report });
    return { success: true, report };
  });
}
