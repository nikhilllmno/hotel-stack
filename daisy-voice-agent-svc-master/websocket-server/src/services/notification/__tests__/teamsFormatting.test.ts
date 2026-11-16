import {
  buildActionCard,
  htmlToTeamsMarkdown,
  markdownV2ToTeamsMarkdown,
  toTeamsMarkdown,
  truncateForTeams,
  withParagraphBreaks,
} from '@/services/notification/teamsFormatting';

describe('htmlToTeamsMarkdown', () => {
  it('converts bold, italic, strike, code and links', () => {
    expect(
      htmlToTeamsMarkdown(
        '<b>Bold</b> <i>it</i> <s>gone</s> <code>x=1</code> <a href="https://a.test/?q=1&amp;r=2">site</a>',
      ),
    ).toBe('**Bold** _it_ ~~gone~~ `x=1` [site](https://a.test/?q=1&r=2)');
  });

  it('decodes entities and escapes markdown characters in text', () => {
    expect(htmlToTeamsMarkdown('<b>A_B*C</b> 5 &lt; 6 &amp; 7')).toBe(
      '**A\\_B\\*C** 5 \\< 6 & 7',
    );
  });

  it('strips template indentation so lines are not rendered as code blocks', () => {
    const html = `
    <b>Summary</b>
    Chad called.

    <a href="https://a.test/r">Download call recording</a>
  `.trim();

    expect(withParagraphBreaks(htmlToTeamsMarkdown(html))).toBe(
      '**Summary**\n\nChad called.\n\n\u00A0\n\n[Download call recording](https://a.test/r)',
    );
  });

  it('keeps indentation inside pre blocks', () => {
    expect(htmlToTeamsMarkdown('<pre>  a\n    b</pre>')).toBe(
      '\n```\n  a\n    b\n```\n',
    );
  });

  it('keeps the content of pre blocks literal', () => {
    expect(htmlToTeamsMarkdown('<pre>a_b *c*</pre>')).toBe(
      '\n```\na_b *c*\n```\n',
    );
  });
});

describe('markdownV2ToTeamsMarkdown', () => {
  it('doubles emphasis markers and keeps escapes', () => {
    expect(markdownV2ToTeamsMarkdown('*Paid* ~old~ _it_ 1\\.5 \\- ok')).toBe(
      '**Paid** ~~old~~ _it_ 1\\.5 \\- ok',
    );
  });

  it('leaves code untouched and unescapes inside it', () => {
    expect(markdownV2ToTeamsMarkdown('`a*b\\`c` *x*')).toBe('`a*b`c` **x**');
  });
});

describe('toTeamsMarkdown', () => {
  it('escapes plain text so it renders literally', () => {
    expect(toTeamsMarkdown('Guest: a_b\n- not a list')).toBe(
      'Guest: a\\_b\n\\- not a list',
    );
  });

  it('routes by parse mode', () => {
    expect(toTeamsMarkdown('<b>x</b>', 'HTML')).toBe('**x**');
    expect(toTeamsMarkdown('*x*', 'MarkdownV2')).toBe('**x**');
  });
});

describe('withParagraphBreaks', () => {
  it('turns single newlines into paragraph breaks but not inside code fences', () => {
    expect(withParagraphBreaks('a\nb\n\n\nc\n```\nx\ny\n```\nd')).toBe(
      'a\n\nb\n\n\u00A0\n\nc\n\n```\nx\ny\n```\n\nd',
    );
  });

  it('keeps one visible spacer for a run of blank lines', () => {
    expect(withParagraphBreaks('a\n\n\n\nb')).toBe('a\n\n\u00A0\n\nb');
  });

  it('treats CRLF and whitespace-only lines as blank lines', () => {
    expect(withParagraphBreaks('a\r\n\r\nb')).toBe('a\n\n\u00A0\n\nb');
    expect(withParagraphBreaks('a\n  \t\nb')).toBe('a\n\n\u00A0\n\nb');
    expect(withParagraphBreaks('a\r\nb')).toBe('a\n\nb');
  });
});

describe('truncateForTeams', () => {
  it('shortens very long messages', () => {
    const result = truncateForTeams('a'.repeat(30000));
    expect(result.length).toBeLessThan(25000);
    expect(result.endsWith('(truncated)')).toBe(true);
  });
});

describe('buildActionCard', () => {
  it('renders one action set per button row with the action data in the payload', () => {
    const card = buildActionCard('Confirm', [
      [{ text: 'Send', data: 'mgr_send' }],
      [
        { text: 'A', data: 'a' },
        { text: 'B', data: 'b' },
      ],
    ]) as { body: Array<Record<string, unknown>> };

    expect(card.body).toHaveLength(3);
    expect(card.body[0]).toMatchObject({ type: 'TextBlock', text: 'Confirm' });
    expect(card.body[1]).toMatchObject({
      type: 'ActionSet',
      actions: [
        {
          type: 'Action.Submit',
          title: 'Send',
          data: { daisyAction: 'mgr_send' },
        },
      ],
    });
    expect((card.body[2] as { actions: unknown[] }).actions).toHaveLength(2);
  });
});
