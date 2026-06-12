import React, { useState, useEffect } from 'react';
import { GlowButton } from '../components/GlowButton';
import { MailMerge } from '../components/MailMerge';
import { Mail, Loader2, Play, Square, Plus, Trash2, CheckCircle2, AlertCircle, Clock, AlertTriangle, Paperclip, GitMerge, X, LogIn } from 'lucide-react';
import { RichTextEditor } from '../components/RichTextEditor';

interface SmtpAccount {
  id?: number;
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

interface MailingLog {
  id: number;
  recipient: string;
  subject: string;
  status: string;
  deliveryLocation: string;
  statusDetails?: string;
  error?: string;
  sentAt: string;
}

export const Mailer: React.FC = () => {
  const [smtps, setSmtps] = useState<SmtpAccount[]>([]);
  const [logs, setLogs] = useState<MailingLog[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // SMTP Form state
  const [newSmtp, setNewSmtp] = useState<SmtpAccount>({
    host: '', port: 465, user: '', pass: '', secure: true,
    fromName: '', fromEmail: '', replyTo: ''
  });
  
  // Campaign state
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState('');
  const [autoRephrase, setAutoRephrase] = useState(false);
  const [attachments, setAttachments] = useState<{filename: string, path: string}[]>([]);
  const [spamRisk, setSpamRisk] = useState<{ score: number; triggers: string[] }>({ score: 0, triggers: [] });
  const [campaignReport, setCampaignReport] = useState<{ sent: number; failed: number; skipped: number; total: number; reportPath: string } | null>(null);

  const [autoSyncVerified, setAutoSyncVerified] = useState(false);
  const [showMailMerge, setShowMailMerge] = useState(false);
  const [mailMergeRecipients, setMailMergeRecipients] = useState<{ email: string; data: Record<string, string> }[] | null>(null);

  // Web email accounts (Gmail / Outlook browser login) — multi-account
  const [webAccounts, setWebAccounts] = useState<{ id: string; provider: string; providerName?: string; email: string }[]>([]);
  const [webLoginLoading, setWebLoginLoading] = useState<string | null>(null);
  const [webCampaignRunning, setWebCampaignRunning] = useState(false);
  const [webCampaignStatus, setWebCampaignStatus] = useState('Idle');
  const [selectedProvider, setSelectedProvider] = useState('gmail');
  const [customWebmailUrl, setCustomWebmailUrl] = useState('');

  // Sender panel tab
  const [senderTab, setSenderTab] = useState<'web' | 'smtp'>('web');

  const SPAM_TRIGGER_WORDS = [
    'free', 'win', 'winner', 'cash', 'money', 'urgent', 'act now', 'guarantee',
    '100%', 'no cost', 'no obligation', 'offer', 'congratulations', 'claims',
    'refinance', 'insurance', 'debt', 'investment', 'rich', 'wealth',
    'bitcoin', 'crypto', 'lottery', 'inheritance', 'bank account', 'beneficiary',
    'exclusive', 'limited time', 'lowest price', 'apply now', 'instant'
  ];

  const calculateSpamRisk = (sub: string, msg: string) => {
    const fullText = (sub + ' ' + msg).toLowerCase();
    const triggers: string[] = [];
    let score = 0;

    for (const word of SPAM_TRIGGER_WORDS) {
      if (fullText.includes(word)) {
        score += 10;
        triggers.push(word);
      }
    }
    if ((fullText.match(/[A-Z]/g) || []).length > fullText.length * 0.3 && fullText.length > 20) {
        score += 25;
        triggers.push('Excessive Caps');
    }
    if (/!!!/.test(fullText)) {
        score += 15;
        triggers.push('Multiple !!!');
    }
    setSpamRisk({ score: Math.min(score, 100), triggers: [...new Set(triggers)] });
  };

  useEffect(() => {
    calculateSpamRisk(subject, body);
  }, [subject, body]);

  // Initial Data Fetching
  useEffect(() => {
    let cleanupFunc: (() => void) | undefined;
    
    const init = async () => {
      try {
        // Load settings and data in parallel without blocking UI
        loadData(); // Fire and forget initial load
        
        if (window.electronAPI) {
          window.electronAPI.getMailingSettings().then(settings => {
            if (settings) {
              if (settings.subject) setSubject(settings.subject);
              if (settings.body) setBody(settings.body);
              if (settings.recipients) setRecipients(settings.recipients);
              if (settings.autoRephrase) setAutoRephrase(settings.autoRephrase === 'true');
            }
          }).catch(err => console.error('Mailing settings error:', err));

          cleanupFunc = window.electronAPI.onMailingEvent((_event, data: any) => {
            if (!data) return;
            if (data.type === 'started') { setIsRunning(true); setStatus('Sending...'); }
            else if (data.type === 'complete') { 
              setIsRunning(false); 
              setStatus('Complete'); 
              loadData(); 
              if (data.report) setCampaignReport(data.report);
            }
            else if (data.type === 'stopped') { setIsRunning(false); setStatus('Stopped'); }
            else if (data.type === 'sent') { setStatus(`Sent to ${data.recipient}`); loadData(); }
            else if (data.type === 'waiting') { setStatus('Waiting (1 min)...'); }
            else if (data.type === 'error') { setStatus(`Error: ${data.message || 'Unknown error'}`); loadData(); }
          });

          // Load saved web accounts and subscribe to web campaign events
          try {
            const status = await (window.electronAPI as any).checkWebLoginStatus?.();
            if (status?.accounts) setWebAccounts(status.accounts);
          } catch {}
          try {
            (window.electronAPI as any).onWebCampaignEvent?.((_ev: any, data: any) => {
              if (!data) return;
              if (data.type === 'started') { setWebCampaignRunning(true); setWebCampaignStatus('Sending...'); }
              else if (data.type === 'complete') { setWebCampaignRunning(false); setWebCampaignStatus('Complete'); loadData(); if (data.report) setCampaignReport(data.report); }
              else if (data.type === 'sent') { setWebCampaignStatus(`✓ ${data.recipient}`); loadData(); }
              else if (data.type === 'waiting') setWebCampaignStatus('Waiting 60s...');
              else if (data.type === 'error') { setWebCampaignStatus(`✗ ${data.message}`); loadData(); }
              else if (data.type === 'sending') setWebCampaignStatus(data.message);
            });
          } catch {}
        }
      } catch (err: any) {
        console.error('Mailer initialization error:', err);
      } finally {
        setLoading(false); // Enable UI regardless of data fetch success
      }
    };

    init();
    return () => {
      if (cleanupFunc) cleanupFunc();
    };
  }, []);

  const loadData = async () => {
    if (window.electronAPI) {
      try {
        const s = await window.electronAPI.getSmtps();
        setSmtps(Array.isArray(s) ? s : []);
        
        const l = await window.electronAPI.getMailingLogs();
        setLogs(Array.isArray(l) ? l : []);

        // Check if already running
        const stats = await window.electronAPI.getStats();
        if (stats && stats.isMailerRunning) {
          setIsRunning(true);
          setStatus('Sending...');
        }
      } catch (err) {
        console.error('Failed to load Mailer data:', err);
      }
    }
  };

  const handleConnectGmail = async () => {
    setWebLoginLoading('gmail');
    try {
      const result = await (window.electronAPI as any).openGmailLogin?.();
      if (result) setWebAccounts(prev => [...prev, result]);
    } catch (err: any) { alert('Gmail login failed: ' + err.message); }
    setWebLoginLoading(null);
  };

  const handleConnectOutlook = async () => {
    setWebLoginLoading('outlook');
    try {
      const result = await (window.electronAPI as any).openOutlookLogin?.();
      if (result) setWebAccounts(prev => [...prev, result]);
    } catch (err: any) { alert('Outlook login failed: ' + err.message); }
    setWebLoginLoading(null);
  };

  const handleConnectWebAccount = async () => {
    setWebLoginLoading(selectedProvider);
    try {
      const customUrl = selectedProvider === 'webmail' ? customWebmailUrl : undefined;
      if (selectedProvider === 'webmail' && !customUrl) {
        alert('Please enter the webmail URL first.');
        setWebLoginLoading(null);
        return;
      }
      const result = await (window.electronAPI as any).openWebLogin?.({ providerId: selectedProvider, customUrl });
      if (result) setWebAccounts(prev => [...prev, result]);
    } catch (err: any) { alert('Login failed: ' + err.message); }
    setWebLoginLoading(null);
  };

  const handleLogoutWebAccount = async (id: string) => {
    await (window.electronAPI as any).logoutWebAccount?.(id);
    setWebAccounts(prev => prev.filter(a => a.id !== id));
  };

  const handleLogoutGmail = async () => {
    await (window.electronAPI as any).logoutGmail?.();
    setWebAccounts(prev => prev.filter(a => a.provider !== 'gmail'));
  };

  const handleLogoutOutlook = async () => {
    await (window.electronAPI as any).logoutOutlook?.();
    setWebAccounts(prev => prev.filter(a => a.provider !== 'outlook'));
  };

  const handleAddSmtp = async () => {
    if (!newSmtp.host || !newSmtp.user || !newSmtp.pass) {
      alert('Please fill in host, username, and password');
      return;
    }
    
    // Auto-correct secure toggle based on port to prevent SSL errors
    let finalSmtp = { ...newSmtp };
    if (newSmtp.port === 465) finalSmtp.secure = true;
    if (newSmtp.port === 587 || newSmtp.port === 25) finalSmtp.secure = false;

    if (window.electronAPI) {
      await window.electronAPI.addSmtp(finalSmtp);
      loadData();
      setNewSmtp({
        host: '', port: 465, user: '', pass: '', secure: true,
        fromName: '', fromEmail: '', replyTo: ''
      });
    }
  };

  const handleDeleteSmtp = async (id: number) => {
    if (window.electronAPI) {
      await window.electronAPI.deleteSmtp(id);
      loadData();
    }
  };

  const handleTestSmtp = async (smtp: SmtpAccount) => {
    if (window.electronAPI) {
      const result = await window.electronAPI.testSmtp(smtp);
      if (result.success) {
        alert('SMTP Connection Successful!');
      } else {
        alert('SMTP Connection Failed: ' + result.error);
      }
    }
  };

  const handleStartCampaign = async () => {
    if (senderTab === 'smtp' && smtps.length === 0) {
      alert('Please add at least one SMTP account in the SMTP tab');
      return;
    }
    if (senderTab === 'web' && webAccounts.length === 0) {
      alert('Please connect at least one web account in the Web Login tab');
      return;
    }
    if (!subject || !body) {
      alert('Please fill in subject and body');
      return;
    }
    
    let recipientList: string[] = [];

    // Mail Merge mode — use personalized recipients
    if (mailMergeRecipients && mailMergeRecipients.length > 0) {
      recipientList = mailMergeRecipients.map(r => r.email).filter(e => e?.includes('@'));
      if (recipientList.length === 0) {
        alert('No valid email addresses found in the mail merge data.');
        return;
      }
    } else if (autoSyncVerified && window.electronAPI) {
      try {
        const verifiedRecords = await window.electronAPI.getEmails({ status: 'Active' });
        recipientList = verifiedRecords.map((r: any) => r.email).filter((e: string) => e?.includes('@'));
        if (recipientList.length === 0) {
          alert('No Active/Verified emails found in the database. Please verify some emails first.');
          return;
        }
      } catch (err: any) {
        alert('Failed to fetch verified emails: ' + err.message);
        return;
      }
    } else {
      recipientList = recipients.split(/[\n,]/).map(r => r.trim()).filter(r => r.includes('@'));
      if (recipientList.length === 0) {
        alert('No valid recipients found in the text box.');
        return;
      }
    }

    if (window.electronAPI) {
      // Build per-recipient merge data map if in mail merge mode
      const mergeData: Record<string, Record<string, string>> | undefined =
        mailMergeRecipients && mailMergeRecipients.length > 0
          ? Object.fromEntries(
              mailMergeRecipients
                .filter(r => r.email?.includes('@'))
                .map(r => [r.email, r.data])
            )
          : undefined;

      // ── Send based on the active sender tab ──────────────────────────────────
      // Web Login tab → use web accounts only
      // SMTP tab → use SMTP only
      // This prevents Chrome from opening when user is working in SMTP mode

      if (senderTab === 'web') {
        if (webAccounts.length === 0) {
          alert('No web accounts connected. Please connect an account in the Web Login tab first.');
          return;
        }
        setWebCampaignRunning(true);
        setWebCampaignStatus('Starting...');
        (window.electronAPI as any).startWebCampaign?.({ subject, body, recipients: recipientList, mergeData, autoRephrase });
      } else {
        // SMTP tab
        if (smtps.length === 0) {
          alert('No SMTP accounts configured. Please add an SMTP account first.');
          return;
        }
        await window.electronAPI.startMailing({
          subject,
          body,
          recipients: recipientList,
          autoRephrase,
          attachments,
          mergeData,
        });
      }
    }
  };

  const handleStopCampaign = async () => {
    if (window.electronAPI) {
      await window.electronAPI.stopMailing();
    }
  };
  
  const handleClearMemory = async () => {
    if (confirm('Are you sure you want to clear all sender memory?')) {
      if (window.electronAPI) {
        await window.electronAPI.clearSmtps();
        loadData();
      }
    }
  };

  const handleClearLogs = async () => {
    if (confirm('Are you sure you want to clear all delivery logs?')) {
      if (window.electronAPI) {
        await window.electronAPI.clearMailingLogs();
        loadData();
      }
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center animate-pulse">
        <Loader2 className="w-10 h-10 text-cyber-accent mx-auto mb-4 animate-spin" />
        <p className="text-gray-500">Connecting to Mailer System...</p>
      </div>
    );
  }

  // Double check recipients split logic
  const handleRecipientsChange = (val: string) => {
    setRecipients(val);
    if (window.electronAPI) {
      window.electronAPI.saveMailingSetting({ key: 'recipients', value: val }).catch(() => {});
    }
  };

  const handleAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).map(f => ({
        filename: f.name,
        path: (f as any).path
      }));
      setAttachments(prev => [...prev, ...files]);
    }
    // Reset value so same file can be selected again if deleted
    e.target.value = '';
  };

  return (
    <div key="mailer-root" className="space-y-6 animate-fade-in relative pb-12">
      {showMailMerge && (
        <MailMerge
          onApply={(mergeSubject, mergeBody, recipients) => {
            setSubject(mergeSubject);
            setBody(mergeBody);
            setMailMergeRecipients(recipients);
            setAutoSyncVerified(false);
          }}
          onClose={() => setShowMailMerge(false)}
        />
      )}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-cyber-text flex items-center gap-2">
            <Mail className="text-cyber-accent" />
            Email Sender
          </h1>
          <p className="text-sm text-gray-400 mt-1">Send campaigns with humanized auto-rotation delays</p>
        </div>
        <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMailMerge(true)}
              className="px-3 py-1.5 bg-cyber-accent/10 border border-cyber-accent/30 text-cyber-accent rounded-lg text-xs font-semibold hover:bg-cyber-accent/20 transition-all flex items-center gap-1.5"
            >
              <GitMerge size={12} /> Mail Merge
            </button>
            {mailMergeRecipients && (
              <div className="flex items-center gap-2 px-2 py-1 bg-green-500/10 border border-green-500/30 rounded-lg">
                <CheckCircle2 size={12} className="text-green-400" />
                <span className="text-xs text-green-400 font-medium">{mailMergeRecipients.length} merged recipients</span>
                <button onClick={() => setMailMergeRecipients(null)} className="text-gray-500 hover:text-red-400 ml-1">
                  <X size={10} />
                </button>
              </div>
            )}
            <div className={`px-3 py-1 rounded-full text-xs font-medium border ${
            isRunning || webCampaignRunning ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-500'
          }`}>
            {webCampaignRunning ? `Web: ${webCampaignStatus}` : `Status: ${status}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Senders Panel (tabbed: Web Login | SMTP) ── */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-cyber-card rounded-xl border border-gray-700/50 overflow-hidden">

            {/* Tab bar */}
            <div className="flex border-b border-gray-700/60">
              <button
                onClick={() => setSenderTab('web')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                  senderTab === 'web'
                    ? 'bg-cyber-accent/10 text-cyber-accent border-b-2 border-cyber-accent'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <LogIn size={12} />
                Web Login
                {webAccounts.length > 0 && (
                  <span className="ml-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full text-[9px] px-1.5 py-0.5 font-bold">
                    {webAccounts.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setSenderTab('smtp')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                  senderTab === 'smtp'
                    ? 'bg-cyber-accent/10 text-cyber-accent border-b-2 border-cyber-accent'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Plus size={12} />
                SMTP
                {smtps.length > 0 && (
                  <span className="ml-1 bg-cyber-accent/20 text-cyber-accent border border-cyber-accent/30 rounded-full text-[9px] px-1.5 py-0.5 font-bold">
                    {smtps.length}
                  </span>
                )}
              </button>
            </div>

            {/* ── Web Login tab ── */}
            {senderTab === 'web' && (
              <div className="p-4 space-y-3">
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Login with a real Chrome browser. Works with <span className="text-green-400 font-semibold">Zoho, Tutanota, Mailfence</span> — providers confirmed to work without bot-detection blocks. Gmail/Outlook/Yahoo block browser automation and are not supported here — use the SMTP tab for those instead.
                </p>

                {/* Provider selector + connect button */}
                <div className="space-y-2">
                  <select
                    value={selectedProvider}
                    onChange={e => setSelectedProvider(e.target.value)}
                    className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:border-cyber-accent/50 focus:outline-none"
                  >
                    <option value="zoho">Zoho Mail (Worldwide — Recommended)</option>
                    <option value="tutanota">Tutanota (Worldwide)</option>
                    <option value="mailfence">Mailfence (Worldwide)</option>
                    <option value="webmail">Other Webmail (custom URL)</option>
                  </select>

                  {selectedProvider === 'webmail' && (
                    <input
                      type="text"
                      placeholder="https://webmail.yourdomain.com"
                      value={customWebmailUrl}
                      onChange={e => setCustomWebmailUrl(e.target.value)}
                      className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text focus:border-cyber-accent/50 focus:outline-none"
                    />
                  )}

                  <button
                    onClick={handleConnectWebAccount}
                    disabled={!!webLoginLoading}
                    className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-cyber-accent/80 hover:bg-cyber-accent px-3 py-2.5 rounded-lg transition-all disabled:opacity-50"
                  >
                    {webLoginLoading
                      ? <><Loader2 size={14} className="animate-spin" /> Opening browser...</>
                      : <><LogIn size={14} /> Open Login Browser</>
                    }
                  </button>
                </div>

                {/* Connected accounts list — grouped by provider */}
                {webAccounts.length > 0 && (
                  <div className="space-y-1.5 max-h-[260px] overflow-y-auto custom-scrollbar pt-1">
                    <p className="text-[10px] text-gray-500 uppercase font-bold px-0.5">
                      Connected accounts ({webAccounts.length})
                    </p>
                    {/* Group by provider */}
                    {(['gmail','outlook','yahoo','zoho','protonmail','webmail'] as const)
                      .filter(prov => webAccounts.some(a => a.provider === prov))
                      .map(prov => {
                        const provAccounts = webAccounts.filter(a => a.provider === prov);
                        const provName = provAccounts[0]?.providerName || prov;
                        const dotColor =
                          prov === 'gmail'      ? 'bg-[#EA4335]' :
                          prov === 'outlook'    ? 'bg-[#0072C6]' :
                          prov === 'yahoo'      ? 'bg-[#6001D2]' :
                          prov === 'zoho'       ? 'bg-[#E42527]' :
                          prov === 'protonmail' ? 'bg-[#6D4AFF]' :
                          'bg-gray-400';
                        return (
                          <div key={prov} className="space-y-1">
                            {/* Provider header */}
                            <div className="flex items-center gap-1.5 px-1 pt-0.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                              <p className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">
                                {provName} ({provAccounts.length})
                              </p>
                            </div>
                            {/* Accounts under this provider — only provAccounts, not all webAccounts */}
                            {provAccounts.map(acc => (
                              <div key={acc.id} className="bg-black/30 border border-gray-700/50 rounded-lg px-3 py-2 group ml-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                                    <p className="text-[11px] font-medium text-cyber-text truncate">{acc.email}</p>
                                  </div>
                                  <button
                                    onClick={() => handleLogoutWebAccount(acc.id)}
                                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all ml-2 shrink-0"
                                    title="Remove account"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                                {(acc as any).proxy && (
                                  <p className="text-[9px] text-green-400/70 mt-0.5 truncate">
                                    🔀 {(acc as any).proxy.replace(/^https?:\/\//, '').split('@').pop()}
                                  </p>
                                )}
                                {!(acc as any).proxy && (
                                  <p className="text-[9px] text-yellow-500/60 mt-0.5">⚠ No proxy — add proxies for IP rotation</p>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })
                    }
                  </div>
                )}

                {/* Web campaign status indicator */}
                {webAccounts.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${webCampaignRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                    <p className="text-[10px] text-gray-400 truncate">{webCampaignRunning ? webCampaignStatus : 'Ready'}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── SMTP tab ── */}
            {senderTab === 'smtp' && (
              <div className="p-4 space-y-4">
                {/* Add SMTP form */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Add Account</p>
                  </div>

                  {/* Provider preset picker */}
                  <div className="space-y-2">
                    <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Click a provider to auto-fill server settings</p>

                    {/* Worldwide — Direct Password */}
                    <div>
                      <p className="text-[9px] text-green-400 uppercase font-bold mb-1 px-0.5">🌍 Worldwide — Direct Password (no app password)</p>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { label: 'Zoho Mail',  host: 'smtp.zoho.com',       port: 465, secure: true  },
                          { label: 'Tutanota',   host: 'smtp.tutanota.com',   port: 587, secure: false },
                          { label: 'Mailfence',  host: 'smtp.mailfence.com',  port: 465, secure: true  },
                        ].map(p => (
                          <button key={p.label} onClick={() => setNewSmtp({ ...newSmtp, host: p.host, port: p.port, secure: p.secure })}
                            className="text-left bg-green-500/5 border border-green-500/20 hover:border-green-500/50 rounded-lg px-2 py-1.5 transition-all">
                            <p className="text-[10px] font-semibold text-cyber-text">{p.label}</p>
                            <p className="text-[8px] text-green-400">Direct pwd ✓</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Worldwide — App Password */}
                    <div>
                      <p className="text-[9px] text-yellow-400 uppercase font-bold mb-1 px-0.5">🌍 Worldwide — App Password Required</p>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { label: 'Gmail',    host: 'smtp.gmail.com',       port: 587, secure: false },
                          { label: 'Yahoo',    host: 'smtp.mail.yahoo.com',  port: 465, secure: true  },
                          { label: 'AOL',      host: 'smtp.aol.com',         port: 587, secure: false },
                          { label: 'iCloud',   host: 'smtp.mail.me.com',     port: 587, secure: false },
                          { label: 'Fastmail', host: 'smtp.fastmail.com',    port: 587, secure: false },
                        ].map(p => (
                          <button key={p.label} onClick={() => setNewSmtp({ ...newSmtp, host: p.host, port: p.port, secure: p.secure })}
                            className="text-left bg-yellow-500/5 border border-yellow-500/20 hover:border-yellow-500/40 rounded-lg px-2 py-1.5 transition-all">
                            <p className="text-[10px] font-semibold text-cyber-text">{p.label}</p>
                            <p className="text-[8px] text-yellow-400">App pwd needed</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Europe / US — Direct Password */}
                    <div>
                      <p className="text-[9px] text-blue-400 uppercase font-bold mb-1 px-0.5">🇪🇺 Europe/US — Direct Password</p>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { label: 'GMX',       host: 'mail.gmx.com',      port: 587, secure: false },
                          { label: 'Mail.com',  host: 'smtp.mail.com',     port: 587, secure: false },
                          { label: 'Web.de',    host: 'smtp.web.de',       port: 587, secure: false },
                          { label: 'Freenet',   host: 'mx.freenet.de',     port: 587, secure: false },
                          { label: 'T-Online',  host: 'securesmtp.t-online.de', port: 465, secure: true },
                          { label: 'Orange.fr', host: 'smtp.orange.fr',    port: 465, secure: true  },
                          { label: 'Laposte',   host: 'smtp.laposte.net',  port: 465, secure: true  },
                          { label: 'Libero.it', host: 'smtp.libero.it',    port: 465, secure: true  },
                          { label: 'Alice.it',  host: 'smtp.alice.it',     port: 465, secure: true  },
                        ].map(p => (
                          <button key={p.label} onClick={() => setNewSmtp({ ...newSmtp, host: p.host, port: p.port, secure: p.secure })}
                            className="text-left bg-blue-500/5 border border-blue-500/20 hover:border-blue-500/40 rounded-lg px-2 py-1.5 transition-all">
                            <p className="text-[10px] font-semibold text-cyber-text">{p.label}</p>
                            <p className="text-[8px] text-blue-400">Direct pwd ✓</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Asia — China */}
                    <div>
                      <p className="text-[9px] text-red-400 uppercase font-bold mb-1 px-0.5">🇨🇳 China — Direct Password</p>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { label: '163.com',  host: 'smtp.163.com',  port: 465, secure: true  },
                          { label: '126.com',  host: 'smtp.126.com',  port: 465, secure: true  },
                          { label: 'Sina',     host: 'smtp.sina.com', port: 465, secure: true  },
                          { label: 'QQ Mail',  host: 'smtp.qq.com',   port: 465, secure: true  },
                        ].map(p => (
                          <button key={p.label} onClick={() => setNewSmtp({ ...newSmtp, host: p.host, port: p.port, secure: p.secure })}
                            className="text-left bg-red-500/5 border border-red-500/20 hover:border-red-500/40 rounded-lg px-2 py-1.5 transition-all">
                            <p className="text-[10px] font-semibold text-cyber-text">{p.label}</p>
                            <p className="text-[8px] text-red-400">Direct pwd ✓</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Asia — Korea / Singapore */}
                    <div>
                      <p className="text-[9px] text-purple-400 uppercase font-bold mb-1 px-0.5">🌏 Korea / Singapore</p>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { label: 'Daum/Kakao', host: 'smtp.daum.net',         port: 465, secure: true,  note: 'Direct pwd ✓',   color: 'text-purple-400' },
                          { label: 'Naver',      host: 'smtp.naver.com',        port: 465, secure: true,  note: 'App pwd needed', color: 'text-yellow-400' },
                          { label: 'SingNet',    host: 'smtp.singnet.com.sg',   port: 465, secure: true,  note: 'SingTel users',  color: 'text-purple-400' },
                        ].map(p => (
                          <button key={p.label} onClick={() => setNewSmtp({ ...newSmtp, host: p.host, port: p.port, secure: p.secure })}
                            className="text-left bg-purple-500/5 border border-purple-500/20 hover:border-purple-500/40 rounded-lg px-2 py-1.5 transition-all">
                            <p className="text-[10px] font-semibold text-cyber-text">{p.label}</p>
                            <p className={`text-[8px] ${p.note.includes('App') ? 'text-yellow-400' : 'text-purple-400'}`}>{p.note}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* App password help */}
                    <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-2.5 py-2 space-y-1">
                      <p className="text-[9px] text-yellow-400/80 font-bold uppercase">Where to generate app passwords:</p>
                      <p className="text-[9px] text-gray-500">Gmail → myaccount.google.com → Security → App passwords</p>
                      <p className="text-[9px] text-gray-500">Yahoo → account.security.yahoo.com → App passwords</p>
                      <p className="text-[9px] text-gray-500">AOL → account.security.aol.com → App passwords</p>
                      <p className="text-[9px] text-gray-500">iCloud → appleid.apple.com → App-specific passwords</p>
                      <p className="text-[9px] text-gray-500">Fastmail → fastmail.com → Settings → App passwords</p>
                      <p className="text-[9px] text-gray-500">Naver → mail.naver.com → Settings → IMAP/SMTP → App password</p>
                      <p className="text-[9px] text-gray-500">QQ Mail → mail.qq.com → Settings → Account → Auth code</p>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="SMTP Host"
                    value={newSmtp.host}
                    onChange={e => setNewSmtp({...newSmtp, host: e.target.value})}
                    className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Port"
                      value={newSmtp.port}
                      onChange={e => setNewSmtp({...newSmtp, port: parseInt(e.target.value)})}
                      className="w-24 bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text"
                    />
                    <label className="flex items-center gap-2 text-xs text-gray-400 px-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newSmtp.secure}
                        onChange={e => setNewSmtp({...newSmtp, secure: e.target.checked})}
                        className="rounded bg-cyber-bg border-gray-700 pointer-events-auto"
                      />
                      SSL/TLS
                    </label>
                  </div>
                  <input
                    type="text"
                    placeholder="Username / Email"
                    value={newSmtp.user}
                    onChange={e => setNewSmtp({...newSmtp, user: e.target.value})}
                    className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text"
                  />
                  <input
                    type="password"
                    placeholder="Password or App Password"
                    value={newSmtp.pass}
                    onChange={e => setNewSmtp({...newSmtp, pass: e.target.value})}
                    className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="From Name"
                      value={newSmtp.fromName}
                      onChange={e => setNewSmtp({...newSmtp, fromName: e.target.value})}
                      className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text"
                    />
                    <input
                      type="text"
                      placeholder="From Email"
                      value={newSmtp.fromEmail}
                      onChange={e => setNewSmtp({...newSmtp, fromEmail: e.target.value})}
                      className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Reply-To (Optional)"
                    value={newSmtp.replyTo}
                    onChange={e => setNewSmtp({...newSmtp, replyTo: e.target.value})}
                    className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-cyber-text"
                  />
                  <div className="flex gap-2">
                    <GlowButton onClick={handleAddSmtp} className="flex-1">Save SMTP</GlowButton>
                    <button
                      onClick={() => setNewSmtp({ host: '', port: 465, user: '', pass: '', secure: true, fromName: '', fromEmail: '', replyTo: '' })}
                      className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs hover:bg-gray-700 transition-all"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* SMTP accounts list */}
                {smtps.length > 0 && (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pt-1">
                    <div className="flex items-center justify-between px-0.5">
                      <p className="text-[10px] text-gray-500 uppercase font-bold">Active ({smtps.length})</p>
                      <button
                        onClick={handleClearMemory}
                        className="text-[9px] text-red-400/60 hover:text-red-400 transition-all"
                      >
                        Clear all
                      </button>
                    </div>
                    {smtps.map(smtp => (
                      <div key={smtp.id} className="bg-black/30 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-all group">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-cyber-text truncate">{smtp.user}</p>
                            <p className="text-[9px] text-gray-500 uppercase tracking-wider">{smtp.host}:{smtp.port}</p>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                            <button onClick={() => handleTestSmtp(smtp)} className="p-1 hover:text-green-400 text-gray-500" title="Test">
                              <Play size={11} fill="currentColor" />
                            </button>
                            <button onClick={() => smtp.id && handleDeleteSmtp(smtp.id)} className="p-1 hover:text-red-400 text-gray-500" title="Delete">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                        {smtp.replyTo && (
                          <p className="text-[9px] text-cyber-accent/70 italic mt-1">Reply-to: {smtp.replyTo}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Campaign Management */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-cyber-card rounded-xl border border-gray-700/50 p-6 space-y-5">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 relative">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Recipients</label>
                    <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setAutoSyncVerified(!autoSyncVerified)}>
                      <span className={`text-[10px] uppercase font-bold tracking-tight ${autoSyncVerified ? 'text-cyber-accent' : 'text-gray-500'}`}>
                        Auto-Sync Verified
                      </span>
                      <div className={`w-6 h-3 rounded-full relative transition-colors ${autoSyncVerified ? 'bg-cyber-accent' : 'bg-gray-700'}`}>
                        <div className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all ${autoSyncVerified ? 'right-0.5' : 'left-0.5'}`}></div>
                      </div>
                    </div>
                  </div>
                  <div className="relative">
                    {autoSyncVerified && (
                       <div className="absolute inset-0 bg-cyber-bg/80 backdrop-blur-[1px] flex flex-col items-center justify-center rounded-lg border border-cyber-accent/30 z-10">
                          <CheckCircle2 size={24} className="text-cyber-accent mb-1" />
                          <span className="text-xs font-bold text-cyber-accent uppercase tracking-wider text-center px-2">
                             Auto-Sync Active<br/>
                             <span className="text-[9px] text-gray-400">Pulls directly from Verified list on start</span>
                          </span>
                       </div>
                    )}
                    <textarea
                      rows={4}
                      value={recipients}
                      onChange={e => handleRecipientsChange(e.target.value)}
                      placeholder="example@mail.com&#10;test@demo.org"
                      disabled={autoSyncVerified}
                      className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-4 py-3 text-sm text-cyber-text focus:border-cyber-accent/50 focus:outline-none custom-scrollbar"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase px-1">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={e => {
                      const val = e.target.value;
                      setSubject(val);
                      window.electronAPI?.saveMailingSetting({ key: 'subject', value: val });
                    }}
                    placeholder="Enter email subject..."
                    className="w-full bg-cyber-bg border border-gray-700 rounded-lg px-4 py-3 text-sm text-cyber-text focus:border-cyber-accent/50 focus:outline-none"
                  />
                  
                  <div className="flex items-center gap-2 px-1 pt-2">
                     <input 
                        type="checkbox" 
                        id="autoRephrase"
                        checked={autoRephrase}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setAutoRephrase(val);
                          window.electronAPI?.saveMailingSetting({ key: 'autoRephrase', value: val.toString() });
                        }}
                        className="rounded bg-cyber-bg border-gray-700 text-cyber-accent focus:ring-0"
                     />
                     <label htmlFor="autoRephrase" className="text-xs font-bold text-cyber-accent cursor-pointer uppercase tracking-tight">
                        Enable "Subtle" Auto-Rephrase (Smart Evasion)
                     </label>
                  </div>

                  <div className="p-3 bg-cyber-accent/5 border border-cyber-accent/20 rounded-lg text-[11px] text-gray-400 leading-relaxed mt-2">
                    <Clock size={12} className="inline mr-1 text-cyber-accent" />
                    **Safety Rule**: System uses a humanized delay cycle (45s–75s) between sends to maximize deliverability and bypass bot detection.
                    <hr className="my-2 border-gray-800" />
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold uppercase text-gray-500">Real-time Spam Risk</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                spamRisk.score > 50 ? 'bg-red-500/20 text-red-400' : 
                                spamRisk.score > 20 ? 'bg-yellow-500/20 text-yellow-400' : 
                                'bg-green-500/20 text-green-400'
                            }`}>
                                {spamRisk.score > 50 ? 'CRITICAL' : spamRisk.score > 20 ? 'MODERATE' : 'CLEAN'}
                            </span>
                        </div>
                        <div className="w-full bg-gray-800 h-1 rounded-full overflow-hidden">
                            <div 
                                className={`h-full transition-all duration-500 ${
                                    spamRisk.score > 50 ? 'bg-red-500' : 
                                    spamRisk.score > 20 ? 'bg-yellow-500' : 
                                    'bg-green-500'
                                }`}
                                style={{ width: `${spamRisk.score}%` }}
                            />
                        </div>
                        {spamRisk.triggers.length > 0 && (
                            <p className="text-[9px] text-gray-500 italic">
                                Triggers: {spamRisk.triggers.join(', ')}
                            </p>
                        )}
                    </div>
                  </div>
                </div>
             </div>

             <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <label className="text-xs font-bold text-gray-500 uppercase">Message Body (HTML supported)</label>
                  <div className="flex gap-2">
                    {['{email}', '{domain}', '{date}'].map(tag => (
                      <span key={tag} className="text-[10px] bg-cyber-accent/10 border border-cyber-accent/30 text-cyber-accent px-1.5 py-0.5 rounded font-mono cursor-help" title={`Replaced by recipient's ${tag.slice(1, -1)}`}>
                        {tag}
                      </span>
                    ))}
                    <span className="text-[10px] bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 px-1.5 py-0.5 rounded font-mono cursor-help" title="Randomly picks one: {Hi|Hello}">
                      {`{Spintax|Logic}`}
                    </span>
                  </div>
                </div>
                <RichTextEditor
                  value={body}
                  onChange={val => {
                    setBody(val);
                    window.electronAPI?.saveMailingSetting({ key: 'body', value: val });
                  }}
                  placeholder="Hello, I found your contact at {domain}. My system shows the date is {date}."
                  className="min-h-[300px]"
                />
                <div className="flex items-center justify-between bg-black/20 p-2 rounded-lg border border-gray-800 mt-2">
                   <div className="flex flex-wrap gap-2 items-center">
                     <label className="cursor-pointer text-xs flex items-center gap-1.5 bg-cyber-bg border border-gray-700 hover:border-cyber-accent/50 text-gray-400 px-3 py-1.5 rounded transition-all">
                       <Paperclip size={14} /> Add Attachment
                       <input type="file" multiple className="hidden" onChange={handleAttachment} />
                     </label>
                     {attachments.map((att, i) => (
                       <div key={i} className="flex items-center gap-1 bg-cyber-accent/10 border border-cyber-accent/30 text-cyber-accent px-2 py-1 rounded text-[10px]">
                         <span className="truncate max-w-[150px]" title={att.filename}>{att.filename}</span>
                         <button onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))} className="hover:text-red-400 ml-1">
                           <Trash2 size={10} />
                         </button>
                       </div>
                     ))}
                   </div>
                </div>
             </div>

             <div className="flex gap-3">
               {!isRunning ? (
                 <GlowButton onClick={handleStartCampaign} className="flex-1 flex justify-center gap-2 items-center py-3">
                   <Play size={18} fill="currentColor" /> Start Mailing Campaign
                 </GlowButton>
               ) : (
                 <GlowButton onClick={handleStopCampaign} variant="secondary" className="flex-1 flex justify-center gap-2 items-center py-3 border-red-500/50 hover:bg-red-500/10 text-red-400">
                   <Square size={18} fill="currentColor" /> Stop Campaign
                 </GlowButton>
               )}
             </div>

             {/* Campaign Report */}
             {campaignReport && !isRunning && (
               <div className="bg-cyber-accent/5 border border-cyber-accent/20 rounded-xl p-4 space-y-3">
                 <div className="flex justify-between items-center">
                   <h4 className="text-xs font-bold text-cyber-accent uppercase tracking-wider">Campaign Report</h4>
                   <button
                     onClick={() => setCampaignReport(null)}
                     className="text-gray-500 hover:text-gray-300 text-xs"
                   >✕</button>
                 </div>
                 <div className="grid grid-cols-4 gap-3 text-center">
                   <div className="bg-cyber-bg rounded-lg p-2">
                     <div className="text-lg font-bold text-white">{campaignReport.total}</div>
                     <div className="text-[10px] text-gray-500 uppercase">Total</div>
                   </div>
                   <div className="bg-cyber-bg rounded-lg p-2">
                     <div className="text-lg font-bold text-green-400">{campaignReport.sent}</div>
                     <div className="text-[10px] text-gray-500 uppercase">Sent</div>
                   </div>
                   <div className="bg-cyber-bg rounded-lg p-2">
                     <div className="text-lg font-bold text-red-400">{campaignReport.failed}</div>
                     <div className="text-[10px] text-gray-500 uppercase">Failed</div>
                   </div>
                   <div className="bg-cyber-bg rounded-lg p-2">
                     <div className="text-lg font-bold text-yellow-400">{campaignReport.skipped}</div>
                     <div className="text-[10px] text-gray-500 uppercase">Skipped</div>
                   </div>
                 </div>
                 {campaignReport.reportPath && (
                   <button
                     onClick={async () => {
                       if (window.electronAPI) {
                         const saved = await (window.electronAPI as any).exportCampaignReport(campaignReport.reportPath);
                         if (saved) alert(`Report saved to: ${saved}`);
                       }
                     }}
                     className="w-full flex items-center justify-center gap-2 py-2 bg-cyber-accent/20 border border-cyber-accent/40 text-cyber-accent rounded-lg text-sm font-semibold hover:bg-cyber-accent/30 transition-colors"
                   >
                     ⬇ Export Campaign Report (CSV)
                   </button>
                 )}
               </div>
             )}
          </div>

          {/* Mailing Status / Logs */}
          <div className="bg-cyber-bg/50 border border-gray-800 rounded-xl overflow-hidden min-h-[300px]">
            <div className="px-4 py-3 border-b border-gray-800 bg-black/20 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Live Delivery Manifest</h3>
                <span className="text-[10px] text-gray-500 uppercase tracking-tighter hidden sm:inline">Last 500 Events</span>
              </div>
              <button 
                onClick={handleClearLogs}
                className="px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-[10px] hover:bg-red-500/20 transition-all flex items-center gap-1"
                title="Clear all delivery logs"
              >
                <Trash2 size={10} /> Clear Logs
              </button>
            </div>
            <div className="overflow-x-auto">
               <table className="w-full text-left text-sm">
                 <thead className="bg-cyber-panel/50 text-gray-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 font-medium">To</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Location</th>
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium text-right">Details</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-800">
                    {logs.map(log => (
                      <tr key={log.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2 text-cyber-text text-xs">{log.recipient}</td>
                        <td className="px-4 py-2">
                          {log.status === 'success' ? (
                            <span className="text-green-400 flex items-center gap-1 text-[10px]"><CheckCircle2 size={12} /> Delivered</span>
                          ) : log.status === 'skipped' ? (
                            <span className="text-yellow-400 flex items-center gap-1 text-[10px]"><AlertTriangle size={12} /> Skipped</span>
                          ) : (
                            <span className="text-red-400 flex items-center gap-1 text-[10px]"><AlertCircle size={12} /> Failed</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                           <div className="flex items-center gap-2">
                              {log.deliveryLocation === 'Inbox' ? (
                                <span className="text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border border-green-400/20">
                                   <Mail size={10} /> INBOX
                                </span>
                              ) : log.deliveryLocation === 'Likely Spam' ? (
                                <span className="text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border border-yellow-500/20">
                                   <AlertTriangle size={10} /> SPAM RISK
                                </span>
                              ) : log.deliveryLocation === 'Spam/Blocked' || log.deliveryLocation === 'Blocked' ? (
                                <span className="text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border border-red-500/20">
                                   <Trash2 size={10} /> BLOCKED
                                </span>
                              ) : (
                                <span className="text-gray-500 text-[9px]">{log.deliveryLocation || '---'}</span>
                              )}
                           </div>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-[10px]">{new Date(log.sentAt).toLocaleTimeString()}</td>
                        <td className="px-4 py-2 text-right">
                          {log.error || log.statusDetails ? (
                            <span className="text-[10px] text-red-400/70 truncate inline-block max-w-[150px]" title={log.error || log.statusDetails}>
                                {log.error || log.statusDetails}
                            </span>
                          ) : (
                            <span className="text-gray-600">---</span>
                          )}
                        </td>
                      </tr>
                    ))}
                   {logs.length === 0 && (
                     <tr>
                       <td colSpan={4} className="px-4 py-12 text-center text-gray-600 italic">No campaign activity recorded yet</td>
                     </tr>
                   )}
                 </tbody>
               </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
