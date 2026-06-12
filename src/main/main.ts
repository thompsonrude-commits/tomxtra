import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { autoUpdater } from 'electron-updater';
import { registerIpcHandlers } from './ipc/handlers';
import { initDatabase, forceSave, getProxies, getWorkingProxies, updateProxyStatus, deleteFailedProxies, addLog } from './db/database';
import { checkTrialStatus } from './license/trial';
import { fetchFreeProxies } from './crawler/proxyFetcher';

// Make the app look like Chrome to web services — but don't change the app name
// as that breaks chromium package path resolution
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('no-first-run');
app.commandLine.appendSwitch('no-default-browser-check');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    icon: path.join(__dirname, '../../resources/icon.ico'),
  });

  // Maximize to fill the screen on startup
  mainWindow.maximize();

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Silently fetch and verify proxies on startup — runs in background, doesn't block UI
async function autoVerifyProxies() {
  try {

    const testOne = (proxy: string): Promise<{ working: boolean; latency: number }> => {
      return new Promise((resolve) => {
        const start = Date.now();
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
          // Use a real HTTP request through the proxy to verify it actually works
          const http = require('http') as typeof import('http');
          const reqHeaders: Record<string, string> = { Host: 'www.google.com' };
          if (clean.includes('@')) {
            const authPart = clean.split('@')[0];
            reqHeaders['Proxy-Authorization'] = 'Basic ' + Buffer.from(authPart).toString('base64');
          }
          const options = {
            host, port,
            method: 'GET',
            path: 'http://www.google.com/',
            headers: reqHeaders,
            timeout: 6000,
          };
          const req = http.request(options, (res) => {
            req.destroy();
            resolve({ working: (res.statusCode || 0) > 0, latency: Date.now() - start });
          });
          req.on('error', () => resolve({ working: false, latency: Date.now() - start }));
          req.on('timeout', () => { req.destroy(); resolve({ working: false, latency: Date.now() - start }); });
          req.end();
        } catch {
          resolve({ working: false, latency: Date.now() - start });
        }
      });
    };

    // If no proxies exist, fetch free ones first
    let allProxies = getProxies().map((p: any) => p.address);
    if (allProxies.length === 0) {
      addLog('[Startup] No proxies found. Auto-fetching free proxies...', 'info');
      await fetchFreeProxies();
      allProxies = getProxies().map((p: any) => p.address);
    }

    addLog(`[Startup] Auto-verifying ${allProxies.length} proxies in background...`, 'info');

    // Test in batches of 20 concurrently
    const BATCH = 20;
    for (let i = 0; i < allProxies.length; i += BATCH) {
      const batch = allProxies.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(p => testOne(p)));
      batch.forEach((proxy, idx) => {
        updateProxyStatus(proxy, results[idx].working, results[idx].latency);
      });
    }

    const working = getWorkingProxies().length;
    // Purge all failed proxies — they will never be seen by engine or mailer
    deleteFailedProxies();
    addLog(`[Startup] Proxy auto-verify complete. ${working} working proxies ready. Failed proxies removed.`, 'success');

    // Notify the renderer UI that autopilot is done
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send('proxy-autopilot-done', working);
    }
  } catch (err: any) {
    addLog(`[Startup] Proxy auto-verify failed: ${err.message}`, 'error');
  }
}

app.whenReady().then(async () => {
  await initDatabase();
  registerIpcHandlers();
  createWindow();

  // Check for updates automatically in production
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  // Auto-fetch and verify proxies silently in the background on startup
  autoVerifyProxies();

  // Window controls
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow?.close());
});

app.on('window-all-closed', () => {
  forceSave();
  app.quit();
});

app.on('before-quit', () => {
  forceSave();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

export { mainWindow };
