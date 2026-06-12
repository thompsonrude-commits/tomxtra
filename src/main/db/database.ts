import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { isLikelyRealEmail } from '../utils/emailValidator';


let db: SqlJsDatabase;
let dbPath: string;
let pendingChanges = 0;
const SAVE_THRESHOLD = 5; // Reduced from 50 to ensure settings are saved immediately
let saveTimeout: NodeJS.Timeout | null = null;

export async function initDatabase() {
  console.log('[DB] Initializing TomXtractor database...');
  
  // Resolve WASM path: packaged → asar.unpacked, dev → project root node_modules
  const wasmCandidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')]
    : [
        path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
        path.resolve(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm'),
        path.resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
      ];

  const wasmPath = wasmCandidates.find(p => fs.existsSync(p)) || wasmCandidates[0];
  console.log('[DB] Using WASM at:', wasmPath);

  try {
    const SQL = await initSqlJs({
      locateFile: (file: string) => (file === 'sql-wasm.wasm' ? wasmPath : file)
    });
    
    dbPath = path.join(app.getPath('userData'), 'tomxtractor.db');
    console.log('[DB] SQL.js initialized. DB Path:', dbPath);

    if (fs.existsSync(dbPath)) {
      try {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
        console.log('[DB] Existing database loaded.');
      } catch (loadErr: any) {
        console.warn('[DB] Database corrupted, recreating...', loadErr.message);
        // Backup the corrupted file then start fresh
        fs.renameSync(dbPath, dbPath + '.corrupted.' + Date.now());
        db = new SQL.Database();
        console.log('[DB] Fresh database created after corruption recovery.');
      }
    } else {
      db = new SQL.Database();
      console.log('[DB] New database created.');
    }
  } catch (err: any) {
    console.error('[DB] Initialization failed:', err.message);
    throw err;
  }

  createTables();
  migrateDatabase();
  performSave(); 
}

function migrateDatabase() {
  const tableInfo = query("PRAGMA table_info(emails)");
  const hasPhone = tableInfo.some(col => col.name === 'phone');
  if (!hasPhone) {
    run("ALTER TABLE emails ADD COLUMN phone TEXT");
    run("ALTER TABLE emails ADD COLUMN name TEXT");
    forceSave();
  }

  const hasReason = tableInfo.some(col => col.name === 'status_reason');
  if (!hasReason) {
    run("ALTER TABLE emails ADD COLUMN status_reason TEXT");
    forceSave();
  }

  // Add marketing validation columns for AI-powered email scoring
  const hasMarketingScore = tableInfo.some(col => col.name === 'marketing_score');
  if (!hasMarketingScore) {
    run("ALTER TABLE emails ADD COLUMN marketing_score INTEGER DEFAULT 0");
    run("ALTER TABLE emails ADD COLUMN is_marketing_ready INTEGER DEFAULT 0");
    run("ALTER TABLE emails ADD COLUMN marketing_risk TEXT DEFAULT 'unknown'");
    forceSave();
  }

  const mailingLogsInfo = query("PRAGMA table_info(mailing_logs)");
  if (!mailingLogsInfo.some(col => col.name === 'delivery_location')) {
    run("ALTER TABLE mailing_logs ADD COLUMN delivery_location TEXT DEFAULT 'Pending'");
    run("ALTER TABLE mailing_logs ADD COLUMN status_details TEXT");
    forceSave();
  }
}

function saveDb(force = false) {
  pendingChanges++;
  
  if (force || pendingChanges >= SAVE_THRESHOLD) {
    performSave();
    return;
  }

  if (!saveTimeout) {
    saveTimeout = setTimeout(() => {
      performSave();
    }, 5000); 
  }
}

function performSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  
  if (!db || !dbPath) return;

  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    pendingChanges = 0;
  } catch {}
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      domain TEXT NOT NULL,
      source_page TEXT DEFAULT '',
      phone TEXT,
      name TEXT,
      status TEXT DEFAULT 'pending',
      status_reason TEXT,
      found_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE NOT NULL,
    pages_crawled INTEGER DEFAULT 0,
    emails_found INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS crawl_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    level TEXT DEFAULT 'info',
    timestamp TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    keywords TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS smtps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    user TEXT NOT NULL,
    pass TEXT NOT NULL,
    secure INTEGER DEFAULT 1,
    from_name TEXT,
    from_email TEXT,
    reply_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL,
    working INTEGER DEFAULT 0,
    latency INTEGER,
    last_tested TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS mailing_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      smtp_id INTEGER,
      recipient TEXT NOT NULL,
      subject TEXT,
      status TEXT,
      delivery_location TEXT DEFAULT 'Pending',
      status_details TEXT,
      error TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(smtp_id) REFERENCES smtps(id)
    )
  `);
  db.run(`CREATE TABLE IF NOT EXISTS mailing_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

function query(sql: string, params: any[] = []): any[] {
  try {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch { return []; }
}

function run(sql: string, params: any[] = []) {
  try {
    db.run(sql, params);
    saveDb();
  } catch {}
}

export function forceSave() {
  performSave();
}

export function addEmail(email: string, domain: string, sourcePage: string, phone?: string, name?: string, marketingScore?: number, isMarketingReady?: boolean, marketingRisk?: string): boolean {
  const existing = query('SELECT id FROM emails WHERE email = ?', [email]);
  if (existing.length === 0) {
    run('INSERT INTO emails (email, domain, source_page, phone, name, marketing_score, is_marketing_ready, marketing_risk) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
      [email, domain, sourcePage, phone || null, name || null, marketingScore || 0, isMarketingReady ? 1 : 0, marketingRisk || 'unknown']);
    const domainRow = query('SELECT id FROM domains WHERE domain = ?', [domain]);
    if (domainRow.length > 0) {
      run('UPDATE domains SET emails_found = emails_found + 1 WHERE domain = ?', [domain]);
    } else {
      run('INSERT INTO domains (domain, emails_found) VALUES (?, 1)', [domain]);
    }
    return true;
  }
  return false;
}

export function addDomain(domain: string) {
  const existing = query('SELECT id FROM domains WHERE domain = ?', [domain]);
  if (existing.length === 0) {
    run('INSERT INTO domains (domain) VALUES (?)', [domain]);
  }
}

export function incrementDomainPages(domain: string) {
  run('UPDATE domains SET pages_crawled = pages_crawled + 1 WHERE domain = ?', [domain]);
}

export function addLog(message: string, level: string = 'info') {
  run('INSERT INTO crawl_logs (message, level) VALUES (?, ?)', [message, level]);
  
  // Force immediate save for critical start/stop/error logs to reflect in UI
  const criticalTerms = ['started', 'engine', 'error', 'initializing', 'using browser'];
  if (level === 'error' || level === 'success' || criticalTerms.some(term => message.toLowerCase().includes(term))) {
    forceSave();
  }
}

export function getEmails(options: { limit?: number, offset?: number, search?: string, status?: string } = {}): any[] {
  let sql = 'SELECT id, email, domain, source_page as sourcePage, phone, name, status, status_reason as statusReason, found_at as foundAt, marketing_score as marketingScore, is_marketing_ready as isMarketingReady, marketing_risk as marketingRisk FROM emails';
  const params: any[] = [];
  const conditions: string[] = [];

  if (options.status && options.status !== 'All') {
    if (options.status === 'Active') {
      conditions.push('status = ?');
      params.push('Active');
    } else if (options.status === 'Inactive') {
      conditions.push('status = ?');
      params.push('Inactive');
    } else if (options.status === 'Pending') {
      conditions.push('(status = ? OR status IS NULL OR status = ?)');
      params.push('pending', '');
    }
  }

  if (options.search) {
    const q = `%${options.search}%`;
    conditions.push('(email LIKE ? OR domain LIKE ?)');
    params.push(q, q);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY id DESC';

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
    if (options.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  return query(sql, params);
}

export function getEmailCount(options: { search?: string, status?: string } = {}): number {
  let sql = 'SELECT COUNT(*) as c FROM emails';
  const params: any[] = [];
  const conditions: string[] = [];

  if (options.status && options.status !== 'All') {
    if (options.status === 'Active') {
      conditions.push('status = ?');
      params.push('Active');
    } else if (options.status === 'Inactive') {
      conditions.push('status = ?');
      params.push('Inactive');
    } else if (options.status === 'Pending') {
      conditions.push('(status = ? OR status IS NULL OR status = ?)');
      params.push('pending', '');
    }
  }

  if (options.search) {
    const q = `%${options.search}%`;
    conditions.push('(email LIKE ? OR domain LIKE ?)');
    params.push(q, q);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const result = query(sql, params);
  return result[0]?.c || 0;
}

export function deleteEmailsByStatus(status: string) {
  if (status === 'Inactive') {
    run('DELETE FROM emails WHERE status = ?', ['Inactive']);
  } else {
    run('DELETE FROM emails WHERE status = ?', [status]);
  }
}

export function getDomains(): any[] {
  return query('SELECT * FROM domains ORDER BY emails_found DESC');
}

export function getLogs(): any[] {
  return query('SELECT * FROM crawl_logs ORDER BY id DESC LIMIT 500');
}

export function getStats() {
  const emailCount = query('SELECT COUNT(*) as c FROM emails');
  const domainCount = query('SELECT COUNT(*) as c FROM domains');
  const pageCount = query('SELECT COALESCE(SUM(pages_crawled),0) as c FROM domains');
  return {
    emailsFound: emailCount[0]?.c || 0,
    domainsDiscovered: domainCount[0]?.c || 0,
    pagesCrawled: pageCount[0]?.c || 0,
    activeJobs: 0,
    isMailerRunning: false
  };
}

export function clearEmails() { run('DELETE FROM emails'); run('UPDATE domains SET emails_found = 0'); }
export function clearLogs() { run('DELETE FROM crawl_logs'); }
export function resetDatabase() {
  run('DELETE FROM emails');
  run('DELETE FROM domains');
  run('DELETE FROM crawl_logs');
  run('DELETE FROM smtps');
  run('DELETE FROM mailing_logs');
  run('DELETE FROM proxies');
  run('VACUUM');
  forceSave();
}
export function deleteEmail(id: number) { run('DELETE FROM emails WHERE id = ?', [id]); }

/**
 * Purge all emails that fail the strict validation check.
 * Useful for cleaning up a database with many false positives.
 */
export function purgeJunkEmails(): { removed: number; remaining: number } {
  const allEmails = query('SELECT id, email FROM emails');
  let removedCount = 0;
  
  for (const row of allEmails) {
    if (!isLikelyRealEmail(row.email)) {
      db.run('DELETE FROM emails WHERE id = ?', [row.id]);
      removedCount++;
    }
  }
  
  if (removedCount > 0) {
    forceSave();
  }
  
  const remaining = getEmailCount();
  return { removed: removedCount, remaining };
}


export function updateEmailStatus(email: string, status: string, reason?: string) {
  run('UPDATE emails SET status = ?, status_reason = ? WHERE email = ?', [status, reason || null, email]);
}

export function getAllEmailsForExport(status?: string): any[] {
  if (status) {
    return query('SELECT email, domain, source_page as sourcePage, phone, name, status, status_reason as statusReason, found_at as foundAt FROM emails WHERE status = ? ORDER BY id', [status]);
  }
  return query('SELECT email, domain, source_page as sourcePage, phone, name, status, status_reason as statusReason, found_at as foundAt FROM emails ORDER BY id');
}

// SMTP Management
export function addSmtp(smtp: any) {
  run(`INSERT INTO smtps (host, port, user, pass, secure, from_name, from_email, reply_to) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
       [smtp.host, smtp.port, smtp.user, smtp.pass, smtp.secure ? 1 : 0, smtp.fromName, smtp.fromEmail, smtp.replyTo]);
  forceSave();
}

export function getSmtps(): any[] {
  return query('SELECT id, host, port, user, pass, secure, from_name as fromName, from_email as fromEmail, reply_to as replyTo FROM smtps ORDER BY id DESC');
}

export function deleteSmtp(id: number) {
  run('DELETE FROM smtps WHERE id = ?', [id]);
  forceSave();
}

export function addMailingLog(log: any) {
  run('INSERT INTO mailing_logs (smtp_id, recipient, subject, status, delivery_location, status_details, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        log.smtpId ?? null, 
        log.recipient ?? '', 
        log.subject ?? '', 
        log.status ?? '', 
        log.deliveryLocation ?? 'Pending',
        log.statusDetails ?? null,
        log.error ?? null
      ]);
}

export function getMailingLogs(): any[] {
  return query('SELECT id, smtp_id as smtpId, recipient, subject, status, delivery_location as deliveryLocation, status_details as statusDetails, error, sent_at as sentAt FROM mailing_logs ORDER BY id DESC');
}

export function clearSmtps() {
  run('DELETE FROM smtps');
  forceSave();
}

export function clearMailingLogs() {
  run('DELETE FROM mailing_logs');
  forceSave();
}

export function saveMailingSetting(key: string, value: string) {
  run('INSERT OR REPLACE INTO mailing_settings (key, value) VALUES (?, ?)', [key, value]);
  forceSave();
}

export function getMailingSettings(): Record<string, string> {
  const rows = query('SELECT * FROM mailing_settings');
  const settings: Record<string, string> = {};
  rows.forEach(row => { settings[row.key] = row.value; });
  return settings;
}

// ─── Email Templates ──────────────────────────────────────────────────────────

export function saveEmailTemplate(name: string, subject: string, body: string): number {
  const existing = query('SELECT id FROM email_templates WHERE name = ?', [name]);
  if (existing.length > 0) {
    run('UPDATE email_templates SET subject=?, body=?, updated_at=datetime("now") WHERE name=?', [subject, body, name]);
    forceSave();
    return existing[0].id;
  } else {
    run('INSERT INTO email_templates (name, subject, body) VALUES (?, ?, ?)', [name, subject, body]);
    forceSave();
    const rows = query('SELECT last_insert_rowid() as id');
    return rows[0]?.id || 0;
  }
}

export function getEmailTemplates(): any[] {
  return query('SELECT id, name, subject, body, created_at as createdAt, updated_at as updatedAt FROM email_templates ORDER BY updated_at DESC');
}

export function deleteEmailTemplate(id: number): void {
  run('DELETE FROM email_templates WHERE id = ?', [id]);
  forceSave();
}

// Proxy Management
export function addProxy(address: string) {
  try {
    run('INSERT OR IGNORE INTO proxies (address) VALUES (?)', [address]);
  } catch (err) {}
}

export function getProxies(): any[] {
  return query('SELECT * FROM proxies ORDER BY id DESC');
}

export function updateProxyStatus(address: string, working: boolean, latency?: number) {
  run('UPDATE proxies SET working = ?, latency = ?, last_tested = datetime(\'now\') WHERE address = ?', 
      [working ? 1 : 0, latency || null, address]);
}

export function deleteProxy(id: number) {
  run('DELETE FROM proxies WHERE id = ?', [id]);
}

export function getWorkingProxies(): string[] {
  return query('SELECT address FROM proxies WHERE working = 1').map(p => p.address);
}

export function deleteFailedProxies() {
  run('DELETE FROM proxies WHERE working = 0 AND last_tested IS NOT NULL');
  forceSave();
}
