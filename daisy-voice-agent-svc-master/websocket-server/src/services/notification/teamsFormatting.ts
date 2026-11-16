import { ChatAction, NotificationChatContent } from './types';

const MARKDOWN_SPECIALS = /([\\*_~`[\]<>])/g;

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIALS, '\\$1').replace(/^([#>+-])/gm, '\\$1');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Converts the Telegram HTML subset (b, i, u, s, a, code, pre) to Teams markdown.
 * Text is escaped so characters such as `*` or `_` in guest names stay literal.
 */
export function htmlToTeamsMarkdown(html: string): string {
  const tokens = html.match(/<\/?[a-zA-Z][^>]*>|[^<]+|</g) ?? [];
  const hrefStack: string[] = [];
  let inPre = false;
  let inCode = false;
  let out = '';

  for (const token of tokens) {
    const tag = token.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>$/);
    if (!tag) {
      const text = decodeHtmlEntities(token);
      out += inPre || inCode ? text : escapeMarkdown(text);
      continue;
    }

    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    switch (name) {
      case 'b':
      case 'strong':
        out += '**';
        break;
      case 'i':
      case 'em':
        out += '_';
        break;
      case 's':
      case 'strike':
      case 'del':
        out += '~~';
        break;
      case 'code':
        if (!inPre) {
          out += '`';
        }
        inCode = !closing;
        break;
      case 'pre':
        out += '\n```\n';
        inPre = !closing;
        break;
      case 'a':
        if (closing) {
          out += `](${hrefStack.pop() ?? ''})`;
        } else {
          const href = tag[3].match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
          hrefStack.push(decodeHtmlEntities(href));
          out += '[';
        }
        break;
      default:
        break;
    }
  }
  return stripLineIndentation(out);
}

/**
 * Telegram ignores leading whitespace in HTML, so templates are often indented.
 * In markdown, 4+ leading spaces turn a paragraph into a code block.
 */
function stripLineIndentation(markdown: string): string {
  return markdown
    .split('```')
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/^[ \t]+/gm, ''),
    )
    .join('```');
}

/**
 * Converts Telegram MarkdownV2 to Teams markdown. Escapes carry over unchanged
 * (MarkdownV2 only escapes punctuation, which CommonMark also accepts); only the
 * emphasis markers differ.
 */
export function markdownV2ToTeamsMarkdown(text: string): string {
  let out = '';
  let inFence = false;
  let inCode = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length) {
      out += inFence || inCode ? text[i + 1] : `\\${text[i + 1]}`;
      i++;
      continue;
    }
    if (text.startsWith('```', i)) {
      inFence = !inFence;
      out += '```';
      i += 2;
      continue;
    }
    if (inFence) {
      out += ch;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      out += ch;
      continue;
    }
    if (inCode) {
      out += ch;
      continue;
    }
    if (ch === '*') {
      out += '**';
    } else if (ch === '~') {
      out += '~~';
    } else if (text.startsWith('__', i) || text.startsWith('||', i)) {
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Teams markdown for a chat message, whichever format the caller wrote it in. */
export function toTeamsMarkdown(
  message: string,
  parseMode?: NotificationChatContent['parseMode'],
): string {
  if (parseMode === 'HTML') {
    return htmlToTeamsMarkdown(message);
  }
  if (parseMode === 'MarkdownV2') {
    return markdownV2ToTeamsMarkdown(message);
  }
  return escapeMarkdown(message);
}

const SECTION_BREAK_MARKER = '\u0000';
const SECTION_SPACER = '\n\n\u00A0\n\n';

/**
 * Teams message text ignores single newlines, so every line break becomes a
 * paragraph break. A blank line in the source (a section break in Telegram) is
 * kept visible with a non-breaking-space paragraph, since Teams collapses empty
 * ones. Fenced code blocks are left alone.
 */
export function withParagraphBreaks(markdown: string): string {
  return markdown
    .split('```')
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/(?:\r?\n[ \t]*){2,}/g, SECTION_BREAK_MARKER)
            .replace(/\r?\n/g, '\n\n')
            .replace(new RegExp(SECTION_BREAK_MARKER, 'g'), SECTION_SPACER),
    )
    .join('```');
}

/** Teams caps a message payload at 28 KB, cards included. */
export const TEAMS_MAX_TEXT_LENGTH = 24000;

export function truncateForTeams(markdown: string): string {
  if (markdown.length <= TEAMS_MAX_TEXT_LENGTH) {
    return markdown;
  }
  return `${markdown.slice(0, TEAMS_MAX_TEXT_LENGTH)}\n\n…(truncated)`;
}

export const TEAMS_ACTION_KEY = 'daisyAction';

/**
 * Adaptive Card carrying the message text and one ActionSet per button row.
 * A click comes back as a message activity whose `value.daisyAction` is the
 * action's `data`.
 */
export function buildActionCard(
  markdown: string,
  actions: ChatAction[][],
): object {
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    msteams: { width: 'Full' },
    body: [
      { type: 'TextBlock', text: markdown, wrap: true },
      ...actions.map((row) => ({
        type: 'ActionSet',
        actions: row.map((action) => ({
          type: 'Action.Submit',
          title: action.text,
          data: { [TEAMS_ACTION_KEY]: action.data },
        })),
      })),
    ],
  };
}
