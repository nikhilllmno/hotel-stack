import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import * as fs from 'fs';
import * as path from 'path';
import config from '../../config';
import { BadRequestError } from '../../errors/BadRequestError';
import { ExternalAPIError } from '../../errors/ExternalApiError';
import logger from '../../utils/logger';

export interface SendEmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  cc?: string[];
  bcc?: string[];
}

export type TemplateVariableValue =
  | string
  | number
  | boolean
  | Record<string, string>;

export interface SendTemplatedEmailOptions {
  to: string;
  templateName: string;
  subject: string;
  variables?: Record<string, TemplateVariableValue>;
  cc?: string[];
  bcc?: string[];
}

const TEMPLATES_DIR = path.resolve(__dirname, '../../static/templates/email');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailService {
  private sesClient: SESClient;
  private fromEmail: string;
  private templateCache: Map<string, string> = new Map();

  constructor() {
    this.sesClient = new SESClient({
      region: config.SES_REGION || config.AWS_REGION,
    });
    this.fromEmail = config.SES_FROM_EMAIL;
    if (!this.fromEmail) {
      throw new Error(
        'SES_FROM_EMAIL is not configured. Please check your environment variables.',
      );
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<string> {
    const { to, subject, htmlBody, cc, bcc } = options;

    if (!this.validateEmailAddress(to)) {
      throw new BadRequestError(`Invalid recipient email address: ${to}`);
    }

    if (!subject || !htmlBody) {
      throw new BadRequestError('Subject and htmlBody are required');
    }

    try {
      const command = new SendEmailCommand({
        Source: this.fromEmail,
        Destination: {
          ToAddresses: [to],
          ...(cc?.length && { CcAddresses: cc }),
          ...(bcc?.length && { BccAddresses: bcc }),
        },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
        },
      });

      const result = await this.sesClient.send(command);
      const messageId = result.MessageId ?? 'unknown';

      logger.info(`Email sent successfully via SES`, {
        messageId,
        to_domain: to.split('@')[1],
        subject,
      });

      return messageId;
    } catch (error) {
      logger.error(`Failed to send email via SES`, {
        to_domain: to.split('@')[1],
        subject,
        error,
      });
      throw new ExternalAPIError(
        `Failed to send email via SES: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async sendTemplatedEmail(
    options: SendTemplatedEmailOptions,
  ): Promise<string> {
    const { to, templateName, subject, variables = {}, cc, bcc } = options;

    const templateContent = await this.loadTemplate(templateName);
    const htmlBody = this.renderTemplate(templateContent, variables);

    return this.sendEmail({ to, subject, htmlBody, cc, bcc });
  }

  async loadTemplate(templateName: string): Promise<string> {
    const cached = this.templateCache.get(templateName);
    if (cached) return cached;

    const sanitized = path.basename(templateName.replace(/\.html$/, ''));
    const filePath = path.join(TEMPLATES_DIR, `${sanitized}.html`);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      this.templateCache.set(templateName, content);
      return content;
    } catch (error) {
      logger.error(`Email template not found: ${templateName}`, { filePath });
      throw new BadRequestError(`Email template '${templateName}' not found`);
    }
  }

  escapeHtml(str: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, (m) => map[m] || m);
  }

  renderTemplate(
    templateContent: string,
    variables: Record<string, TemplateVariableValue>,
  ): string {
    return templateContent.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
      const value = variables[key];
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        return this.buildDetailRows(value as Record<string, string>);
      }
      return this.escapeHtml(String(value));
    });
  }

  async listTemplates(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(TEMPLATES_DIR);
      return files
        .filter((f) => f.endsWith('.html'))
        .map((f) => f.replace(/\.html$/, ''));
    } catch (error) {
      logger.error('Failed to list email templates', { error });
      return [];
    }
  }

  buildDetailRows(details: Record<string, string>): string {
    return Object.entries(details)
      .map(
        ([label, value], i) =>
          `<tr${i % 2 === 0 ? ' style="background-color:#f9f9f9;"' : ''}>` +
          `<td style="font-size:14px;color:#666666;font-weight:bold;width:40%;">${this.escapeHtml(label)}</td>` +
          `<td style="font-size:14px;color:#333333;">${this.escapeHtml(value)}</td>` +
          `</tr>`,
      )
      .join('\n');
  }

  validateEmailAddress(email: string): boolean {
    return EMAIL_REGEX.test(email);
  }
}

export const emailService = new EmailService();
