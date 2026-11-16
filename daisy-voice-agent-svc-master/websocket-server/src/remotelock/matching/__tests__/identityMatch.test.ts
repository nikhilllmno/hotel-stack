import { isIdentityMatch } from '@/remotelock/matching/identityMatch';
import { AccessGuest } from '@/remotelock/types';

function makeGuest(
  attributes: Partial<AccessGuest['attributes']> = {},
): AccessGuest {
  return {
    id: 'g1',
    type: 'access_guest',
    attributes: {
      name: 'Ann Smith',
      email: null,
      phone: null,
      status: 'current',
      starts_at: '2026-08-01T00:00:00',
      ends_at: '2026-08-05T00:00:00',
      pin: '1234',
      department: null,
      ...attributes,
    },
  };
}

describe('isIdentityMatch', () => {
  it('matches on name alone when email/phone are absent on both sides', () => {
    const guest = makeGuest({ name: 'Ann Smith' });
    expect(isIdentityMatch(guest, { name: 'Ann Smith' })).toBe(true);
  });

  it('is case- and whitespace-insensitive on name', () => {
    const guest = makeGuest({ name: '  ann   smith ' });
    expect(isIdentityMatch(guest, { name: 'ANN SMITH' })).toBe(true);
  });

  it('rejects when first names differ', () => {
    const guest = makeGuest({ name: 'Ann Smith' });
    expect(isIdentityMatch(guest, { name: 'Bob Jones' })).toBe(false);
  });

  it('matches on the first name alone when the rest of the name differs', () => {
    const guest = makeGuest({ name: 'Ann M. Smith-Jones' });
    expect(isIdentityMatch(guest, { name: 'Ann Smith' })).toBe(true);
  });

  it('matches a first-name-only RemoteLock guest against a full reservation name', () => {
    const guest = makeGuest({ name: 'Ann' });
    expect(isIdentityMatch(guest, { name: 'Ann Smith' })).toBe(true);
  });

  it('rejects when either side is missing a name', () => {
    const guest = makeGuest({ name: '' });
    expect(isIdentityMatch(guest, { name: 'Ann Smith' })).toBe(false);
  });

  it('does not reject when email is present on only one side', () => {
    const guest = makeGuest({ name: 'Ann Smith', email: null });
    expect(
      isIdentityMatch(guest, { name: 'Ann Smith', email: 'ann@example.com' }),
    ).toBe(true);
  });

  it('does not reject when emails are present on both sides but differ', () => {
    const guest = makeGuest({ name: 'Ann Smith', email: 'ann@example.com' });
    expect(
      isIdentityMatch(guest, {
        name: 'Ann Smith',
        email: 'someone-else@example.com',
      }),
    ).toBe(true);
  });

  it('ignores differing emails when compareEmail is off', () => {
    const guest = makeGuest({ name: 'Ann Smith', email: 'ann+12345@x.com' });
    expect(
      isIdentityMatch(
        guest,
        { name: 'Ann Smith', email: 'ann@x.com' },
        { compareEmail: false },
      ),
    ).toBe(true);
  });

  it('does not reject a differing phone when compareEmail is off', () => {
    const guest = makeGuest({
      name: 'Ann Smith',
      email: 'ann+12345@x.com',
      phone: '3035551234',
    });
    expect(
      isIdentityMatch(
        guest,
        { name: 'Ann Smith', email: 'ann@x.com', phone: '3035559999' },
        { compareEmail: false },
      ),
    ).toBe(true);
  });

  it('matches when phones are present on both sides and equal after normalization', () => {
    const guest = makeGuest({ name: 'Ann Smith', phone: '(303) 555-1234' });
    expect(
      isIdentityMatch(guest, { name: 'Ann Smith', phone: '3035551234' }),
    ).toBe(true);
  });

  it('does not reject when phones are present on both sides but differ', () => {
    const guest = makeGuest({ name: 'Ann Smith', phone: '3035551234' });
    expect(
      isIdentityMatch(guest, { name: 'Ann Smith', phone: '3035559999' }),
    ).toBe(true);
  });
});
