import { EventEmitter } from 'events';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { addMailingLog, getSmtps, getWorkingProxies } from '../db/database';
import { verifyEmail } from './verifier';
import { calculateSpamScore } from '../utils/emailFilters';

interface MailerConfig {
  subject: string;
  body: string;
  recipients: string[];
  autoRephrase?: boolean;
  attachments?: { filename: string; path: string }[];
  /** Optional per-recipient merge data keyed by email address */
  mergeData?: Record<string, Record<string, string>>;
}

interface CampaignRecord {
  recipient: string;
  status: 'Sent' | 'Failed' | 'Skipped';
  location: string;
  reason: string;
  smtp: string;
  time: string;
}

export class EmailMailer extends EventEmitter {
  private running = false;
  private shouldStop = false;
  private campaignRecords: CampaignRecord[] = [];

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  async start(config: MailerConfig) {
    if (this.running) return;
    this.running = true;
    this.shouldStop = false;
    this.campaignRecords = [];

    const smtps = getSmtps();
    if (smtps.length === 0) {
      this.emit('event', { type: 'error', message: 'No SMTP accounts configured' });
      this.running = false;
      return;
    }

    const workingProxies = getWorkingProxies();
    const getProxy = (idx: number): string | null =>
      workingProxies.length > 0 ? workingProxies[idx % workingProxies.length] : null;

    // Each SMTP gets its own slice of recipients and sends one every 60 seconds independently.
    // SMTP1 → recipient1, wait 60s, recipient4, wait 60s, recipient7 ...
    // SMTP2 → recipient2, wait 60s, recipient5, wait 60s, recipient8 ... (runs in parallel)
    // SMTP3 → recipient3, wait 60s, recipient6, wait 60s, recipient9 ... (runs in parallel)
    const totalSmtps = smtps.length;
    const smtpQueues: string[][] = smtps.map((_, i) =>
      config.recipients.filter((_, ri) => ri % totalSmtps === i)
    );

    this.emit('event', {
      type: 'started',
      message: `Campaign started: ${config.recipients.length} recipients | ${totalSmtps} SMTP(s) | 60s delay per send per SMTP`
    });

    // Run all SMTP queues in parallel; each queue sends one email then waits 60s before the next
    await Promise.all(
      smtps.map((smtp, smtpIdx) => {
        const queue = smtpQueues[smtpIdx];
        return (async () => {
          for (let qi = 0; qi < queue.length; qi++) {
            if (this.shouldStop) break;
            const recipient = queue[qi];
            this.emit('event', {
              type: 'started',
              message: `[${smtp.user}] Sending to ${recipient} (${qi + 1}/${queue.length})...`
            });
            await this.sendOneEmail(smtp, recipient, config, getProxy(smtpIdx));
            // Wait using random interval from [30, 45, 60, 75]s to beat spam detectors
            if (qi < queue.length - 1 && !this.shouldStop) {
              const intervals = [30, 45, 60, 75];
              const baseSeconds = intervals[Math.floor(Math.random() * intervals.length)];
              const noise = Math.floor(Math.random() * 4000) - 2000; // ±2s noise
              const waitMs = (baseSeconds * 1000) + noise;
              this.emit('event', {
                type: 'waiting',
                message: `[${smtp.user}] ⏱ Next send in ${Math.round(waitMs / 1000)}s...`
              });
              await new Promise(r => setTimeout(r, waitMs));
            }
          }
        })();
      })
    );

    this.running = false;

    const reportPath = this.generateCampaignReport(config.subject);
    const sent    = this.campaignRecords.filter(r => r.status === 'Sent').length;
    const failed  = this.campaignRecords.filter(r => r.status === 'Failed').length;
    const skipped = this.campaignRecords.filter(r => r.status === 'Skipped').length;

    this.emit('event', {
      type: 'complete',
      message: `✅ Campaign complete — Sent: ${sent} | Failed: ${failed} | Skipped: ${skipped}`,
      report: { sent, failed, skipped, total: this.campaignRecords.length, reportPath }
    });
  }

  private async sendOneEmail(smtp: any, recipient: string, config: MailerConfig, proxy: string | null) {
    const time = new Date().toLocaleTimeString();
    try {
      // Pre-flight verification
      const vResult = await verifyEmail(recipient);
      if (!vResult.valid) {
        const reason = vResult.status || 'Invalid email';
        this.emit('event', { type: 'error', message: `[${smtp.user}] ⚠ Skipped ${recipient}: ${reason}`, recipient });
        addMailingLog({ smtpId: smtp.id, recipient, subject: config.subject, status: 'skipped', deliveryLocation: 'Invalid Recipient', statusDetails: reason });
        this.campaignRecords.push({ recipient, status: 'Skipped', location: 'Invalid Recipient', reason, smtp: smtp.user, time });
        this.sendFailureNotification(smtp, recipient, reason, time).catch(() => {});
        return;
      }

      let personalizedSubject = this.replacePlaceholders(config.subject, recipient);
      let personalizedBody    = this.replacePlaceholders(config.body, recipient);

      // Apply mail merge column data ({{name}}, {{company}}, {{position}}, etc.)
      if (config.mergeData?.[recipient]) {
        const rowData = config.mergeData[recipient];
        for (const [col, value] of Object.entries(rowData)) {
          const colRegex = new RegExp(`\\{\\{${col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'gi');
          personalizedSubject = personalizedSubject.replace(colRegex, value);
          personalizedBody    = personalizedBody.replace(colRegex, value);
        }
      }

      personalizedSubject = this.parseSpintax(personalizedSubject);
      personalizedBody    = this.parseSpintax(personalizedBody);
      if (config.autoRephrase) {
        personalizedSubject = this.autoRephrase(personalizedSubject);
        personalizedBody    = this.autoRephrase(personalizedBody);
      }

      const spamRisk   = calculateSpamScore(personalizedSubject, personalizedBody);
      const info       = await this.sendEmail(smtp, recipient, personalizedSubject, personalizedBody, config.attachments, proxy);
      const smtpResponse = info.response || '';

      let deliveryLocation = 'Inbox';
      let statusDetails    = 'Standard Handover Success';
      if (spamRisk.score > 50) {
        deliveryLocation = 'Likely Spam';
        statusDetails = `High Spam Score (${spamRisk.score}): ${spamRisk.triggers.join(', ')}`;
      }
      if (smtpResponse.toLowerCase().includes('spam') || smtpResponse.toLowerCase().includes('policy')) {
        deliveryLocation = 'Spam/Blocked';
        statusDetails = `Server Flagged: ${smtpResponse}`;
      }

      this.emit('event', { type: 'sent', message: `[${smtp.user}] ✓ ${recipient} → ${deliveryLocation}`, recipient, smtpUser: smtp.user, deliveryLocation });
      addMailingLog({ smtpId: smtp.id, recipient, subject: personalizedSubject, status: 'success', deliveryLocation, statusDetails });
      this.campaignRecords.push({ recipient, status: 'Sent', location: deliveryLocation, reason: statusDetails, smtp: smtp.user, time });

    } catch (err: any) {
      const errorMessage = err.message || 'Unknown error';
      this.emit('event', { type: 'error', message: `[${smtp.user}] ✗ ${recipient}: ${errorMessage}`, recipient });
      addMailingLog({ smtpId: smtp.id, recipient, subject: config.subject, status: 'error', deliveryLocation: 'Blocked', error: errorMessage });
      this.campaignRecords.push({ recipient, status: 'Failed', location: 'Blocked', reason: errorMessage, smtp: smtp.user, time });
      this.sendFailureNotification(smtp, recipient, errorMessage, time).catch(() => {});
    }
  }

  stop() {
    this.shouldStop = true;
    this.emit('event', { type: 'stopped', message: 'Campaign stopped by user' });
  }

  private generateCampaignReport(subject: string): string {
    try {
      const dir = 'C:\\ProgramData\\TomXtractor\\Reports';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath  = path.join(dir, `campaign_report_${timestamp}.csv`);

      const sentRecords    = this.campaignRecords.filter(r => r.status === 'Sent');
      const failedRecords  = this.campaignRecords.filter(r => r.status === 'Failed');
      const skippedRecords = this.campaignRecords.filter(r => r.status === 'Skipped');
      const total          = this.campaignRecords.length;

      const lines: string[] = [];
      lines.push(`CAMPAIGN REPORT`);
      lines.push(`Subject,${subject}`);
      lines.push(`Date,${new Date().toLocaleString()}`);
      lines.push(``);
      lines.push(`SUMMARY`);
      lines.push(`Total,Sent,Failed,Skipped`);
      lines.push(`${total},${sentRecords.length},${failedRecords.length},${skippedRecords.length}`);
      lines.push(``);

      const maxRows = Math.max(sentRecords.length, failedRecords.length, skippedRecords.length, 1);
      lines.push(`Date,Subject,Total,Sent,Blocked,Skipped`);
      lines.push(
        `"${new Date().toLocaleString()}",` +
        `"${subject}",` +
        `${total},` +
        `"${sentRecords[0]?.recipient || 'None'}",` +
        `"${failedRecords[0]?.recipient || 'None'}",` +
        `"${skippedRecords[0]?.recipient || 'None'}"`
      );
      for (let i = 1; i < maxRows; i++) {
        lines.push(`,,,"${sentRecords[i]?.recipient || ''}","${failedRecords[i]?.recipient || ''}","${skippedRecords[i]?.recipient || ''}"`);
      }

      fs.writeFileSync(filePath, lines.join('\r\n'), 'utf-8');
      return filePath;
    } catch {
      return '';
    }
  }

  private replacePlaceholders(text: string, recipient: string): string {
    const domain = recipient.split('@')[1] || '';
    const date   = new Date().toLocaleDateString();
    return text
      .replace(/{email}/g, recipient)
      .replace(/{domain}/g, domain)
      .replace(/{date}/g, date);
  }

  public parseSpintax(text: string): string {
    const spintaxRegex = /{([^{}]+)}/g;
    let match;
    let result = text;
    while ((match = spintaxRegex.exec(result)) !== null) {
      const options  = match[1].split('|');
      const selected = options[Math.floor(Math.random() * options.length)];
      result = result.replace(match[0], selected);
      spintaxRegex.lastIndex = 0;
    }
    return result;
  }

  public autoRephrase(text: string): string {
    const synonymGroups = [
      ['Hello', 'Hi', 'Greetings', 'Dear', 'Hey'],
      ['interested in', 'looking for', 'inquiring about', 'following up on'],
      ['best', 'warm', 'kind', 'sincere'],
      ['regards', 'wishes', 'thanks', 'respects'],
      ['found', 'noticed', 'saw', 'discovered', 'came across'],
      ['website', 'site', 'page', 'online profile'],
      ['Thanks', 'Thank you', 'Many thanks'],
      ['services', 'offerings', 'solutions', 'expertise'],
      ['business', 'company', 'firm', 'organization'],
    ];

    let rephrased = text;
    for (const group of synonymGroups) {
      const escapedWords = group.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const regex = new RegExp(`\\b(${escapedWords})\\b`, 'gi');
      rephrased = rephrased.replace(regex, (match) => {
        const others = group.filter(w => w.toLowerCase() !== match.toLowerCase());
        if (others.length === 0) return match;
        const selected = others[Math.floor(Math.random() * others.length)];
        return match[0] === match[0].toUpperCase()
          ? selected.charAt(0).toUpperCase() + selected.slice(1)
          : selected.toLowerCase();
      });
    }
    return rephrased;
  }

  private async sendFailureNotification(smtp: any, failedRecipient: string, reason: string, time: string) {
    const actualFromEmail = smtp.fromEmail || smtp.user;
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure === 1,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1' },
      connectionTimeout: 15000,
    });
    await transport.sendMail({
      from: `"Delivery Notification" <${actualFromEmail}>`,
      to: actualFromEmail,
      subject: `Delivery Failed: ${failedRecipient}`,
      text: `Your email to ${failedRecipient} could not be delivered.\n\nReason: ${reason}\n\nTime: ${time}`,
      html: `<div style="font-family:Arial,sans-serif;padding:20px;background:#f9f9f9;border-left:4px solid #e53e3e;">
        <h3 style="color:#e53e3e;margin:0 0 10px">Delivery Failure Notification</h3>
        <p><strong>Recipient:</strong> ${failedRecipient}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><strong>Time:</strong> ${time}</p>
        <p style="color:#666;font-size:12px;margin-top:20px">This is an automated notification from TomXtractor 49ja Mailer.</p>
      </div>`
    });
  }

  private async sendEmail(smtp: any, to: string, subject: string, body: string, attachments?: { filename: string; path: string }[], proxy?: string | null) {
    const isGmail = smtp.host.toLowerCase().includes('gmail.com') || smtp.user.toLowerCase().endsWith('@gmail.com');
    const isYahoo = smtp.host.toLowerCase().includes('yahoo.com') || smtp.user.toLowerCase().endsWith('@yahoo.com');

    const transportConfig: any = {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure === 1,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1' },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 45000,
    };

    if (isGmail) transportConfig.service = 'gmail';
    else if (isYahoo) transportConfig.service = 'yahoo';

    const transporter       = nodemailer.createTransport(transportConfig);
    const actualFromEmail   = smtp.fromEmail || smtp.user;
    const actualFromName    = smtp.fromName  || 'Mailer';
    const fromAddress       = `"${actualFromName}" <${actualFromEmail}>`;
    const replyAddress      = smtp.replyTo  || actualFromEmail;

    const bodyLow     = body.toLowerCase();
    const isFullHtml  = bodyLow.includes('<html') || bodyLow.includes('<body') || bodyLow.includes('<head');
    const htmlContent = isFullHtml ? body : (body.includes('<')
      ? `<div style="font-family:'Segoe UI',Arial,sans-serif;line-height:1.6;color:#333;">${body}</div>`
      : body.replace(/\n/g, '<br>'));

    const textContent = body
      .replace(/<style[^>]*>.*<\/style>/gms, '')
      .replace(/<[^>]*>?/gm, '')
      .replace(/&nbsp;/g, ' ')
      .trim();

    return await transporter.sendMail({
      from: fromAddress,
      to,
      replyTo: replyAddress,
      subject,
      text: textContent,
      html: htmlContent,
      headers: {
        'X-Mailer': 'Microsoft Outlook 16.0',
        'X-Priority': '3',
        'Importance': 'Normal',
        'MIME-Version': '1.0'
      },
      attachments: attachments?.map(att => ({ filename: att.filename, path: att.path }))
    });
  }

  async testSmtp(smtp: any) {
    const isGmail = smtp.host.toLowerCase().includes('gmail.com') || smtp.user.toLowerCase().endsWith('@gmail.com');
    const isYahoo = smtp.host.toLowerCase().includes('yahoo.com') || smtp.user.toLowerCase().endsWith('@yahoo.com');

    const transportConfig: any = {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure === 1,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1' },
      connectionTimeout: 30000,
    };

    if (isGmail) transportConfig.service = 'gmail';
    else if (isYahoo) transportConfig.service = 'yahoo';

    const transporter = nodemailer.createTransport(transportConfig);
    try {
      await transporter.verify();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  isRunning() { return this.running; }
}

export const emailMailer = new EmailMailer();
