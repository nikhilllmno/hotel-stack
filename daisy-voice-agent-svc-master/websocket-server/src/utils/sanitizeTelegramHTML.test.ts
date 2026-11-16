import { sanitizeTelegramHTML } from './sanitizeTelegramHTML';

describe('sanitizeTelegramHTML', () => {
  test('escapes &, <, >', () => {
    expect(sanitizeTelegramHTML('Tom & Jerry <script> a > b')).toBe(
      'Tom &amp; Jerry &lt;script&gt; a &gt; b',
    );
  });

  test('preserves newlines instead of emitting unsupported <br> tags', () => {
    expect(sanitizeTelegramHTML('line one\nline two')).toBe(
      'line one\nline two',
    );
  });

  test('preserves unicode arrows and normalizes dashes', () => {
    expect(sanitizeTelegramHTML('a → b – c — d')).toBe('a → b - c - d');
  });

  test('strips line separators and zero-width spaces', () => {
    expect(sanitizeTelegramHTML('a b c​d')).toBe('abcd');
  });
});
