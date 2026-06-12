/**
 * Web Email Sender — Real Installed Chrome, Independent Process
 *
 * Strategy:
 *  1. Find the user's real installed Chrome (not our bundled Chromium).
 *  2. Launch Chrome as a completely INDEPENDENT process using spawn() —
 *     NOT as a child of Puppeteer/our app. This means Windows shows
 *     Chrome.exe as launched by the user, not by TomXtractor.
 *  3. Connect Puppeteer to the running Chrome via CDP remote debugging port.
 *  4. User logs in normally — Google/Microsoft see real Chrome on Windows.
 *  5. Session is saved in a per-account user-data-dir so it persists.
 *  6. To send: open new tab in that Chrome, automate compose + send via CDP.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { app } from 'electron';
import puppeteer, { Browser, Page } from 'puppeteer-core';

// ─── Utility ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Random delay between min and max ms — simulates human typing rhythm */
function randDelay(min = 30, max = 120): Promise<void> {
  return delay(min + Math.floor(Math.random() * (max - min)));
}

/** Human-like typing speed — varies per character */
function humanTypeDelay(): number {
  const base = 40 + Math.floor(Math.random() * 80);
  // Occasionally add a longer pause (mimicking a thought or looking at notes)
  if (Math.random() > 0.95) return base + 1500;
  return base;
}

/** Simulates random human mouse movement or jitter before interaction */
async function humanJitter(page: Page) {
  try {
    // Move to a random area of the viewport
    const x = Math.floor(Math.random() * 400) + 200;
    const y = Math.floor(Math.random() * 400) + 200;
    await page.mouse.move(x, y);
    
    // 30% chance to perform a tiny scroll
    if (Math.random() > 0.7) {
      await page.mouse.wheel({ deltaY: Math.random() > 0.5 ? 100 : -100 });
    }
    await delay(500 + Math.random() * 1000);
  } catch {}
}

/** 
 * Types text with human characteristics: 
 * variable speeds, micro-pauses, and occasional corrected typos.
 */
async function smartType(page: Page, text: string) {
  try {
    for (const char of text) {
      // 2% chance to type a wrong character and fix it
      if (Math.random() < 0.02) {
        const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
        await page.keyboard.type(wrongChar, { delay: humanTypeDelay() });
        await delay(200 + Math.random() * 300);
        await page.keyboard.press('Backspace', { delay: humanTypeDelay() });
        await delay(100 + Math.random() * 200);
      }
      
      await page.keyboard.type(char, { delay: humanTypeDelay() });
      
      // Pause at punctuation
      if (['.', '!', '?', ','].includes(char)) {
        await delay(400 + Math.random() * 600);
      }
    }
  } catch {}
}

// ─── Find real installed Chrome ───────────────────────────────────────────────

function findInstalledChrome(): string {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
    // Microsoft Edge as fallback (also Chromium-based, also trusted)
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Last resort — bundled chromium (may get blocked by Google but works for others)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let p = require('chromium').path as string;
    if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    if (fs.existsSync(p)) return p;
  } catch {}
  throw new Error(
    'Google Chrome is not installed on this computer.\n\n' +
    'Please install Chrome from https://www.google.com/chrome/ and try again.'
  );
}

// ─── Session directories ──────────────────────────────────────────────────────

function getSessionDir(accountId: string): string {
  const base = path.join(app.getPath('userData'), 'web-sessions', accountId);
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return base;
}

// ─── Find a free port ─────────────────────────────────────────────────────────

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// ─── Account registry ─────────────────────────────────────────────────────────

export interface WebAccount {
  id: string;
  provider: string;
  providerName: string;
  email: string;
  sessionDir: string;
  debugPort: number;
  proxy?: string;  // proxy assigned to this account e.g. "http://1.2.3.4:8080"
  addedAt: string;
}

const webAccounts: WebAccount[] = [];
let accountCounter = 0;

// Map of accountId → running Chrome child process
const chromeProcesses: Map<string, cp.ChildProcess> = new Map();
// Map of accountId → connected Puppeteer browser
const connectedBrowsers: Map<string, Browser> = new Map();
// Map of accountId → single reusable compose tab (1 tab per account, reused for all sends)
const composePages: Map<string, Page> = new Map();

export function getWebAccounts(): WebAccount[] {
  return [...webAccounts];
}

export function removeWebAccount(id: string): void {
  const idx = webAccounts.findIndex(a => a.id === id);
  if (idx !== -1) webAccounts.splice(idx, 1);
}

// ─── Provider config ──────────────────────────────────────────────────────────

interface ProviderConfig {
  id: string;
  name: string;
  loginUrl: string;
  inboxPattern: RegExp;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  gmail:      { id: 'gmail',      name: 'Gmail',      loginUrl: 'https://mail.google.com',         inboxPattern: /mail\.google\.com\/mail/ },
  outlook:    { id: 'outlook',    name: 'Outlook',    loginUrl: 'https://outlook.live.com/mail',   inboxPattern: /outlook\.(live|office)\.com\/mail/ },
  yahoo:      { id: 'yahoo',      name: 'Yahoo Mail', loginUrl: 'https://mail.yahoo.com',          inboxPattern: /mail\.yahoo\.com(?!.*login)/ },
  zoho:       { id: 'zoho',       name: 'Zoho Mail',  loginUrl: 'https://mail.zoho.com',           inboxPattern: /mail\.zoho\.com\/(zm\/|fr\/mail|eu\/mail|in\/mail|com\.au\/mail)/ },
  protonmail: { id: 'protonmail', name: 'ProtonMail', loginUrl: 'https://account.proton.me/login', inboxPattern: /mail\.proton\.me\/u\// },
  webmail:    { id: 'webmail',    name: 'Webmail',    loginUrl: '',                                inboxPattern: /.*/ },
};

export interface ProviderInfo { id: string; name: string; loginUrl: string; }
export function getAvailableProviders(): ProviderInfo[] {
  return Object.values(PROVIDERS).map(p => ({ id: p.id, name: p.name, loginUrl: p.loginUrl }));
}

// ─── Launch Chrome as independent process & connect ───────────────────────────

async function launchIndependentChrome(
  sessionDir: string,
  debugPort: number,
  startUrl: string,
  proxy?: string
): Promise<cp.ChildProcess> {
  const chromePath = findInstalledChrome();

  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--remote-debugging-address=127.0.0.1`,
    `--user-data-dir=${sessionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    '--lang=en-US',
    '--accept-lang=en-US,en;q=0.9',
    // Block all permission popups (notifications, location, microphone, camera)
    '--disable-notifications',
    '--deny-permission-prompts',
    '--use-fake-ui-for-media-stream',
    '--disable-popup-blocking',
    startUrl,
  ];

  // Assign a unique proxy to this Chrome instance so each account sends from a different IP
  if (proxy) {
    // Chrome --proxy-server accepts: socks5://host:port, http://host:port, or bare host:port
    const proxyStr = proxy.startsWith('socks5://') || proxy.startsWith('http://')
      ? proxy
      : proxy.replace(/^https?:\/\//, '').split('@').pop() || proxy;
    args.push(`--proxy-server=${proxyStr}`);
  }

  const proc = cp.spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();

  return proc;
}

async function connectToChromeWithRetry(debugPort: number, retries = 10): Promise<Browser> {
  for (let i = 0; i < retries; i++) {
    try {
      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${debugPort}`,
        defaultViewport: null,
      });
      return browser;
    } catch {
      await delay(1000);
    }
  }
  throw new Error(`Could not connect to Chrome on port ${debugPort} after ${retries} attempts`);
}

// ─── Open login browser ────────────────────────────────────────────────────────

export async function openWebLogin(
  providerId: string,
  customUrl?: string,
  proxy?: string
): Promise<WebAccount | null> {
  const provider = PROVIDERS[providerId] || PROVIDERS.webmail;
  const loginUrl = customUrl || provider.loginUrl;
  if (!loginUrl) return null;

  const idx = accountCounter++;
  const accountId = `${providerId}-${idx}`;
  const sessionDir = getSessionDir(accountId);
  const debugPort = await getFreePort();

  // Launch Chrome with optional proxy
  const chromeProc = await launchIndependentChrome(sessionDir, debugPort, loginUrl, proxy);
  chromeProcesses.set(accountId, chromeProc);

  // Connect Puppeteer to the running Chrome
  let browser: Browser;
  try {
    browser = await connectToChromeWithRetry(debugPort);
  } catch (err: any) {
    throw new Error(`Launched Chrome but could not connect: ${err.message}`);
  }

  connectedBrowsers.set(accountId, browser);

  // Disable webdriver flag on all pages
  const existingPages = await browser.pages();
  for (const pg of existingPages) {
    await pg.evaluateOnNewDocument(() => {
      // Deeper stealth overrides
      (window as any).chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    }).catch(() => {});
  }

  return new Promise((resolve) => {
    let resolved = false;
    let checkCount = 0;

    const interval = setInterval(async () => {
      checkCount++;
      if (checkCount < 3) return;
      try {
        const pages = await browser.pages();
        for (const pg of pages) {
          const url = pg.url();
          const isInbox = providerId === 'webmail'
            ? isLikelyInbox(url, loginUrl)
            : provider.inboxPattern.test(url);

          if (isInbox && !resolved) {
            await delay(2000);
            const email = await extractEmail(pg, providerId);
            resolved = true;
            clearInterval(interval);

            const account: WebAccount = {
              id: accountId,
              provider: providerId,
              providerName: provider.name,
              email: email || `${provider.name} Account ${idx + 1}`,
              sessionDir,
              debugPort,
              proxy,
              addedAt: new Date().toISOString(),
            };
            webAccounts.push(account);
            resolve(account);
            return;
          }
        }
      } catch {}
    }, 2000);

    browser.on('disconnected', () => {
      clearInterval(interval);
      connectedBrowsers.delete(accountId);
      chromeProcesses.delete(accountId);
      if (!resolved) {
        resolved = true;
        accountCounter--;
        resolve(null);
      }
    });
  });
}

function isLikelyInbox(currentUrl: string, loginUrl: string): boolean {
  try {
    const loginHost = new URL(loginUrl).hostname;
    const currentHost = new URL(currentUrl).hostname;
    const currentPath = new URL(currentUrl).pathname;
    return (
      currentHost === loginHost &&
      currentPath.length > 2 &&
      !/login|signin|auth|password|challenge|sso|oauth|register/i.test(currentUrl)
    );
  } catch { return false; }
}

async function extractEmail(page: Page, providerId: string): Promise<string> {
  try {
    return await page.evaluate((pId) => {
      if (pId === 'gmail') {
        const meta = document.querySelector('meta[name="x-account-management-email"]');
        if (meta) return meta.getAttribute('content') || '';
        for (const img of document.querySelectorAll('img[aria-label]')) {
          const m = (img.getAttribute('aria-label') || '').match(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/i);
          if (m) return m[0];
        }
      }
      if (pId === 'outlook') {
        const el = document.querySelector('[aria-label*="@"]');
        if (el) {
          const m = (el.getAttribute('aria-label') || '').match(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/i);
          if (m) return m[0];
        }
      }
      for (const el of document.querySelectorAll('span, a, div, p, button')) {
        const t = (el.textContent || '').trim();
        if (/^[\w.+\-]+@[\w.\-]+\.[a-z]{2,}$/.test(t) && t.length < 80) return t;
      }
      return '';
    }, providerId);
  } catch { return ''; }
}

// ─── Get or reconnect browser ─────────────────────────────────────────────────

async function getBrowser(account: WebAccount): Promise<Browser> {
  // First try the already-connected browser
  const existing = connectedBrowsers.get(account.id);
  if (existing && existing.connected) return existing;

  // The login Chrome window is still open (we never close it).
  // Try to reconnect to it on the same debug port.
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${account.debugPort}`,
      defaultViewport: null,
    });
    connectedBrowsers.set(account.id, browser);
    return browser;
  } catch {
    // Chrome was closed by the user — relaunch with the saved session and same proxy
    const chromePath = findInstalledChrome();
    const args = [
      `--remote-debugging-port=${account.debugPort}`,
      `--remote-debugging-address=127.0.0.1`,
      `--user-data-dir=${account.sessionDir}`,
      '--no-first-run',
      '--start-maximized',
    ];
    if (account.proxy) {
      const proxyHost = account.proxy.replace(/^https?:\/\//, '').split('@').pop() || account.proxy;
      args.push(`--proxy-server=${proxyHost}`);
    }
    const proc = cp.spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    proc.unref();
    chromeProcesses.set(account.id, proc);

    const browser = await connectToChromeWithRetry(account.debugPort);
    connectedBrowsers.set(account.id, browser);
    return browser;
  }
}

// ─── Send via web account ──────────────────────────────────────────────────────

export async function sendViaWebAccount(
  accountId: string,
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  const account = webAccounts.find(a => a.id === accountId);
  if (!account) return { success: false, error: `Account ${accountId} not found. Please re-login.` };

  let browser: Browser;
  try {
    browser = await getBrowser(account);
  } catch (err: any) {
    return { success: false, error: `Could not connect to Chrome: ${err.message}` };
  }

  // Verify the session is still active by checking for an inbox page
  try {
    const pages = await browser.pages();
    const provider = PROVIDERS[account.provider];
    const hasInbox = pages.some(pg => provider && provider.inboxPattern.test(pg.url()));
    if (!hasInbox) {
      return {
        success: false,
        error: `${account.providerName} session not active. Please keep the ${account.providerName} browser window open while sending.`,
      };
    }
  } catch {}

  // ── ONE REUSABLE COMPOSE TAB PER ACCOUNT ───────────────────────────────────
  // We keep a single dedicated compose tab per account (stored by accountId).
  // Each send: navigate to compose URL → fill fields → send → navigate back.
  // This means 1 tab per account regardless of how many emails are sent.
  let composePage = composePages.get(accountId);
  const isPageAlive = async (pg: Page) => {
    try { await pg.evaluate(() => true); return true; } catch { return false; }
  };

  if (!composePage || !(await isPageAlive(composePage))) {
    try {
      composePage = await browser.newPage();
      await composePage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      composePages.set(accountId, composePage);
    } catch (err: any) {
      return { success: false, error: `Could not open compose tab: ${err.message}` };
    }
  }

  try {
    switch (account.provider) {
      case 'gmail':      await gmailSend(composePage, to, subject, body); break;
      case 'outlook':    await outlookSend(composePage, to, subject, body); break;
      case 'yahoo':      await yahooSend(composePage, to, subject, body); break;
      case 'zoho':       await zohoSend(composePage, to, subject, body); break;
      case 'protonmail': await protonSend(composePage, to, subject, body); break;
      default:           await genericSend(composePage, to, subject, body); break;
    }
    return { success: true };
  } catch (err: any) {
    // Always remove stale compose page on any error so next send gets a fresh one
    composePages.delete(accountId);
    
    // If context destroyed or not clickable — retry once with a fresh tab
    if (err.message?.includes('context was destroyed') || 
        err.message?.includes('not clickable') ||
        err.message?.includes('detached') ||
        err.message?.includes('Target closed')) {
      try {
        const freshPage = await browser.newPage();
        await freshPage.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        composePages.set(accountId, freshPage);
        switch (account.provider) {
          case 'gmail':      await gmailSend(freshPage, to, subject, body); break;
          case 'outlook':    await outlookSend(freshPage, to, subject, body); break;
          case 'yahoo':      await yahooSend(freshPage, to, subject, body); break;
          case 'zoho':       await zohoSend(freshPage, to, subject, body); break;
          case 'protonmail': await protonSend(freshPage, to, subject, body); break;
          default:           await genericSend(freshPage, to, subject, body); break;
        }
        return { success: true };
      } catch (retryErr: any) {
        composePages.delete(accountId);
        return { success: false, error: retryErr.message };
      }
    }
    return { success: false, error: err.message };
  }
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

async function gmailSend(page: Page, to: string, subject: string, body: string) {
  const isHtml = body.includes('<') && body.includes('</');

  // Navigate to Gmail compose URL — pre-fills To and Subject
  const composeUrl = `https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}`;
  try {
    await page.goto(composeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    await delay(2000);
    await page.goto(composeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await randDelay(2000, 3000);

  // Dismiss any Gmail notification/permission popups that block interaction
  await page.evaluate(() => {
    // Dismiss notification permission dialogs
    document.querySelectorAll('[data-action="cancel"], [data-action="dismiss"], button[jsaction*="dismiss"]')
      .forEach((el: any) => { try { el.click(); } catch {} });
    // Remove blocking overlays
    document.querySelectorAll('.zo, .aod, [role="alertdialog"]')
      .forEach((el: any) => { try { (el as HTMLElement).style.display = 'none'; } catch {} });
  }).catch(() => {});

  await delay(800);

  // Find and fill body — try selectors one by one
  const selectors = [
    '[aria-label="Message Body"]',
    'div[role="textbox"][contenteditable="true"]',
    '.Am.Al.editable',
    'div[g_editable="true"]',
  ];

  let filled = false;
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await page.focus(sel);
        await delay(300);
        if (isHtml) {
          await page.evaluate((s: string, h: string) => {
            const el = document.querySelector(s) as HTMLElement;
            if (el) { el.focus(); el.innerHTML = h; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
          }, sel, body);
        } else {
          await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
          await delay(100);
          await page.keyboard.press('Backspace');
          await delay(100);
          await smartType(page, body);
        }
        filled = true;
        break;
      }
    } catch {}
  }

  await randDelay(600, 1200);

  // Send — Ctrl+Enter is the most reliable across all Gmail states
  try {
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
  } catch {}

  await randDelay(3000, 5000);

  // Navigate back to clean inbox state for next send
  try {
    await page.goto('https://mail.google.com/mail/u/0/#inbox', {
      waitUntil: 'domcontentloaded', timeout: 15000
    });
    await delay(1500);
  } catch {}
}

// ─── Outlook ──────────────────────────────────────────────────────────────────

async function outlookSend(page: Page, to: string, subject: string, body: string) {
  const isHtml = body.includes('<') && body.includes('</');
  await page.goto(
    `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}`,
    { waitUntil: 'domcontentloaded', timeout: 45000 }
  );

  const bodySel = 'div[aria-label*="Message body" i][contenteditable], div[role="textbox"][contenteditable]';
  await page.waitForSelector(bodySel, { timeout: 20000 });
  await delay(800);

  await page.click(bodySel);
  if (isHtml) {
    await page.evaluate((sel, html) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) { el.focus(); el.innerHTML = html; }
    }, bodySel, body);
  } else {
    await smartType(page, body);
  }
  await delay(1000 + Math.random() * 1000);
  await humanJitter(page);

  await page.waitForSelector('button[aria-label*="Send" i]', { timeout: 10000 });
  await page.click('button[aria-label*="Send" i]');
  await delay(2000);
  // Navigate back so the same tab is ready for the next send
  await page.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}

// ─── Yahoo ────────────────────────────────────────────────────────────────────

async function yahooSend(page: Page, to: string, subject: string, body: string) {
  const isHtml = body.includes('<') && body.includes('</');
  await page.goto('https://mail.yahoo.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await humanJitter(page);
  await page.waitForSelector('[data-test-id="compose-button"]', { timeout: 20000 });
  await randDelay(1000, 2000);

  await humanJitter(page);
  await page.click('[data-test-id="compose-button"]');
  await randDelay(1500, 2500);

  await page.waitForSelector('input[data-test-id="ymail-compose-to-input"]', { timeout: 8000 });
  await page.click('input[data-test-id="ymail-compose-to-input"]');
  await page.keyboard.type(to, { delay: humanTypeDelay() });
  await page.keyboard.press('Tab');
  await randDelay(400, 800);

  await page.waitForSelector('input[data-test-id="ymail-compose-subject"]', { timeout: 5000 });
  await page.click('input[data-test-id="ymail-compose-subject"]');
  await page.keyboard.type(subject, { delay: humanTypeDelay() });
  await randDelay(600, 1200);

  const bodySel = '[data-test-id="ymail-compose-body"] [contenteditable], div[contenteditable="true"][role="textbox"]';
  await page.waitForSelector(bodySel, { timeout: 5000 });
  await humanJitter(page);
  await page.click(bodySel);
  if (isHtml) {
    await page.evaluate((sel, html) => { const el = document.querySelector(sel) as HTMLElement; if (el) el.innerHTML = html; }, bodySel, body);
  } else {
    await smartType(page, body);
  }
  await randDelay(1500, 3000);

  await page.waitForSelector('button[data-test-id="ymail-compose-send-button"]', { timeout: 8000 });
  await humanJitter(page);
  await page.click('button[data-test-id="ymail-compose-send-button"]');
  await randDelay(2000, 4000);
  // Tab stays on Yahoo inbox — next send will click Compose again
}

// ─── Zoho ─────────────────────────────────────────────────────────────────────

async function zohoSend(page: Page, to: string, subject: string, body: string) {
  const isHtml = body.includes('<') && body.includes('</');
  await page.goto('https://mail.zoho.com/zm/#mail/folder/inbox', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await humanJitter(page);
  await page.waitForSelector('[title="Compose"], [class*="compose" i]', { timeout: 20000 });
  await randDelay(1000, 2000);

  await humanJitter(page);
  await page.click('[title="Compose"], [class*="compose" i]');
  await randDelay(1500, 3000);

  const toEl = await page.$('input[id*="to" i], input[placeholder*="To" i]');
  if (!toEl) throw new Error('Zoho To field not found');
  await toEl.click();
  await page.keyboard.type(to, { delay: humanTypeDelay() });
  await page.keyboard.press('Enter');
  await randDelay(500, 1000);

  const subjEl = await page.$('input[id*="subject" i], input[placeholder*="Subject" i]');
  if (subjEl) { 
    await subjEl.click(); 
    await page.keyboard.type(subject, { delay: humanTypeDelay() }); 
  }
  await randDelay(800, 1500);

  const bodyEl = await page.$('[contenteditable="true"]');
  if (!bodyEl) throw new Error('Zoho body not found');
  await humanJitter(page);
  await bodyEl.click();
  if (isHtml) {
    await page.evaluate((html) => { const el = document.querySelector('[contenteditable="true"]') as HTMLElement; if (el) el.innerHTML = html; }, body);
  } else {
    await smartType(page, body);
  }
  await randDelay(2000, 4000);

  const sendBtn = await page.$('button[title*="Send" i], [id*="send" i]') ||
    await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('button')).find(b => /^send$/i.test(b.textContent?.trim() || ''))
    ) as any;
  if (sendBtn && sendBtn.asElement()) { 
    await humanJitter(page);
    await (sendBtn as any).click(); 
  }
  else { await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); }
  await randDelay(2000, 3000);
  // Zoho closes compose automatically after send — tab is back on inbox
}

// ─── ProtonMail ───────────────────────────────────────────────────────────────

async function protonSend(page: Page, to: string, subject: string, body: string) {
  const isHtml = body.includes('<') && body.includes('</');
  await page.goto('https://mail.proton.me', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await humanJitter(page);
  await page.waitForSelector('[data-testid="sidebar:compose"]', { timeout: 20000 });
  await randDelay(1000, 2000);

  await humanJitter(page);
  await page.click('[data-testid="sidebar:compose"]');
  await randDelay(1500, 2500);

  await page.waitForSelector('[data-testid="composer:to"] input', { timeout: 8000 });
  await page.click('[data-testid="composer:to"] input');
  await page.keyboard.type(to, { delay: humanTypeDelay() });
  await page.keyboard.press('Enter');
  await randDelay(500, 1000);

  const subjEl = await page.$('[data-testid="composer:subject"] input');
  if (subjEl) { 
    await subjEl.click(); 
    await page.keyboard.type(subject, { delay: humanTypeDelay() }); 
  }
  await randDelay(800, 1500);

  const bodySel = '[data-testid="rooster-editor"] [contenteditable], .composer-content [contenteditable]';
  await page.waitForSelector(bodySel, { timeout: 8000 });
  await humanJitter(page);
  await page.click(bodySel);
  if (isHtml) {
    await page.evaluate((sel, html) => { const el = document.querySelector(sel) as HTMLElement; if (el) el.innerHTML = html; }, bodySel, body);
  } else {
    await smartType(page, body);
  }
  await randDelay(2000, 4000);

  await page.waitForSelector('[data-testid="composer:send-button"]', { timeout: 8000 });
  await humanJitter(page);
  await page.click('[data-testid="composer:send-button"]');
  await randDelay(2000, 3000);
  // ProtonMail closes compose after send — tab stays on inbox
}

// ─── Generic ──────────────────────────────────────────────────────────────────

async function genericSend(page: Page, to: string, subject: string, body: string) {
  const isHtml = body.includes('<') && body.includes('</');
  await delay(3000);
  await humanJitter(page);

  const composeBtn = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button,a')).find(e =>
      /compose|new.*(mail|message)/i.test((e.textContent || '') + (e.getAttribute('aria-label') || ''))
    )
  ) as any;
  if (composeBtn?.asElement()) { await composeBtn.click(); await delay(1500); }

  const toEl = await page.$('input[name="to"], input[placeholder*="To" i]');
  if (!toEl) throw new Error('To field not found');
  await toEl.click();
  await page.keyboard.type(to, { delay: humanTypeDelay() });
  await page.keyboard.press('Tab');
  await randDelay(400, 800);

  const subjEl = await page.$('input[name="subject"], input[placeholder*="Subject" i]');
  if (subjEl) { await subjEl.click(); await page.keyboard.type(subject, { delay: humanTypeDelay() }); }
  await randDelay(800, 1500);

  const bodyEl = await page.$('textarea[name="body"], div[contenteditable="true"]');
  if (!bodyEl) throw new Error('Body field not found');
  await humanJitter(page);
  await bodyEl.click();
  
  if (isHtml) {
    await page.evaluate((html) => {
      const el = document.querySelector('div[contenteditable="true"]') as HTMLElement;
      if (el) el.innerHTML = html;
    }, body);
  } else {
    await smartType(page, body);
  }
  await randDelay(2000, 4000);

  const sendBtn = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button, input[type="submit"]')).find(b =>
      /^send$/i.test(((b as HTMLButtonElement).textContent || (b as HTMLInputElement).value || '').trim())
    )
  ) as any;
  if (sendBtn?.asElement()) {
    await humanJitter(page);
    await sendBtn.click();
  }
  await randDelay(3000, 5000);
}

// ─── Logout ────────────────────────────────────────────────────────────────────

export async function logoutWebAccount(id: string): Promise<void> {
  // Close the reusable compose tab first
  const composePage = composePages.get(id);
  if (composePage) { await composePage.close().catch(() => {}); composePages.delete(id); }

  const browser = connectedBrowsers.get(id);
  if (browser) { await browser.disconnect().catch(() => {}); connectedBrowsers.delete(id); }
  const proc = chromeProcesses.get(id);
  if (proc) { proc.kill(); chromeProcesses.delete(id); }
  const account = webAccounts.find(a => a.id === id);
  if (account?.sessionDir && fs.existsSync(account.sessionDir)) {
    fs.rmSync(account.sessionDir, { recursive: true, force: true });
  }
  removeWebAccount(id);
}

export async function logoutGmail(): Promise<void> {
  for (const acc of webAccounts.filter(a => a.provider === 'gmail')) await logoutWebAccount(acc.id);
}
export async function logoutOutlook(): Promise<void> {
  for (const acc of webAccounts.filter(a => a.provider === 'outlook')) await logoutWebAccount(acc.id);
}
export async function checkGmailLoginStatus(): Promise<boolean> {
  return webAccounts.some(a => a.provider === 'gmail');
}
export async function checkOutlookLoginStatus(): Promise<boolean> {
  return webAccounts.some(a => a.provider === 'outlook');
}
export async function openGmailLogin(proxy?: string): Promise<WebAccount | null> { return openWebLogin('gmail', undefined, proxy); }
export async function openOutlookLogin(proxy?: string): Promise<WebAccount | null> { return openWebLogin('outlook', undefined, proxy); }
