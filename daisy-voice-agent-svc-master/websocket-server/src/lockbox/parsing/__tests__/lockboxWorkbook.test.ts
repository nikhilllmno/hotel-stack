/* global describe, expect, it */
import { LockboxLogFormatError } from '@/lockbox/errors/LockboxLogFormatError';
import { parseLockboxWorkbook } from '@/lockbox/parsing/lockboxWorkbook';
import {
  buildLockboxWorkbook,
  excelDate,
  TODAY_HEADERS,
} from '@/test/fixtures/lockboxWorkbookFixture';

describe('parseLockboxWorkbook', () => {
  describe('Today tab', () => {
    it('reads the B4 date and one entry per lockbox row', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          todayDate: excelDate('2026-10-28'),
          todayRows: [
            {
              lockbox: 1,
              guestName: 'ADA LOVELACE ',
              room: 7,
              code: '*4821',
              notes: 'key in box',
            },
            { lockbox: 2, guestName: 'OPEN', room: '12', code: 905113 },
            { lockbox: 3, guestName: 'OPEN' },
            {
              lockbox: 4,
              guestName: 'Grace Hopper',
              room: 3,
              room2: 4,
              code: '61822',
            },
          ],
        }),
      );

      expect(log.today.date).toBe('2026-10-28');
      expect(log.today.entries).toEqual([
        {
          lockboxNumber: '1',
          guestName: 'ADA LOVELACE',
          originalNameText: '',
          rooms: ['7'],
          code: '*4821',
          notes: 'key in box',
        },
        {
          lockboxNumber: '2',
          guestName: 'OPEN',
          originalNameText: '',
          rooms: ['12'],
          code: '905113',
          notes: '',
        },
        {
          lockboxNumber: '3',
          guestName: 'OPEN',
          originalNameText: '',
          rooms: [],
          code: '',
          notes: '',
        },
        {
          lockboxNumber: '4',
          guestName: 'Grace Hopper',
          originalNameText: '',
          rooms: ['3', '4'],
          code: '61822',
          notes: '',
        },
      ]);
    });

    it('lists every tab, hidden ones included', async () => {
      const log = await parseLockboxWorkbook(await buildLockboxWorkbook());

      expect(log.sheetNames).toEqual([
        'How to Use',
        'Today',
        'Daily Log',
        'Archive',
        'Lists',
      ]);
    });

    // A code typed as a number has lost its leading zeros unless the cell's
    // format pads them back, which is what Excel shows staff.
    it('keeps numeric codes as text and applies a zero-padding format', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          todayRows: [
            { lockbox: 1, guestName: 'OPEN', room: 1, code: 7734 },
            {
              lockbox: 2,
              guestName: 'OPEN',
              room: 2,
              code: 7734,
              codeNumFmt: '00000',
            },
            { lockbox: 3, guestName: 'OPEN', room: 3, code: '00451' },
          ],
        }),
      );

      expect(log.today.entries.map((entry) => entry.code)).toEqual([
        '7734',
        '07734',
        '00451',
      ]);
    });

    it('reads the values Excel cached for formulas, and rich text', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          todayDate: { formula: 'TODAY()', result: excelDate('2026-10-28') },
          todayRows: [
            {
              lockbox: { formula: 'ROW()-6', result: 1 },
              guestName: { richText: [{ text: 'ALAN ' }, { text: 'TURING' }] },
              room: { formula: 'Lists!A9', result: 9 },
              code: { formula: 'Lists!B2', result: '*1906' },
            },
            {
              lockbox: 2,
              guestName: { formula: 'Lists!C1', result: { error: '#N/A' } },
              room: 5,
              code: '*2020',
            },
          ],
        }),
      );

      expect(log.today.date).toBe('2026-10-28');
      expect(log.today.entries[0]).toEqual({
        lockboxNumber: '1',
        guestName: 'ALAN TURING',
        originalNameText: '',
        rooms: ['9'],
        code: '*1906',
        notes: '',
      });
      expect(log.today.entries[1].guestName).toBe('');
    });

    it('skips rows below the table that are not lockboxes', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          todayRows: [
            { lockbox: 1, guestName: 'OPEN', room: 2, code: '*1111' },
          ],
          todayTrailingRows: [
            ['Remember to archive before changing the date', 'x', 3, '', '9'],
            ['TOTAL', '', '', '', ''],
          ],
        }),
      );

      expect(log.today.entries.map((entry) => entry.lockboxNumber)).toEqual([
        '1',
      ]);
    });

    it('finds columns by header text, ignoring case and stray spaces', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          todayHeaders: [
            'lockbox',
            ' Guest  Name',
            'ROOM   ',
            'room 2',
            'Code',
          ],
          todayRows: [
            { lockbox: 1, guestName: 'OPEN', room: 6, code: '*6060' },
          ],
        }),
      );

      expect(log.today.entries[0]).toMatchObject({
        rooms: ['6'],
        code: '*6060',
      });
    });

    it('reads a B4 that is not a date as no date', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({ todayDate: 'tomorrow' }),
      );

      expect(log.today.date).toBeNull();
    });
  });

  describe('Archive tab', () => {
    it('groups rows by date and reads ORIGINAL NAME TEXT', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          archiveRows: [
            {
              date: excelDate('2026-10-26'),
              lockbox: 2,
              guestName: 'Lovelace, Ada',
              room: 7,
              code: '*4821',
              originalNameText: 'ADA LOVELACE',
            },
            {
              date: excelDate('2026-10-26'),
              lockbox: 1,
              guestName: 'OPEN',
            },
            {
              date: excelDate('2026-10-27'),
              lockbox: 1,
              guestName: 'GRACE HOPPER',
              room: 3,
              code: 61822,
            },
          ],
        }),
      );

      expect([...log.archive.keys()]).toEqual(['2026-10-26', '2026-10-27']);
      // Sorted by lockbox number within a date.
      expect(log.archive.get('2026-10-26')).toEqual([
        {
          lockboxNumber: '1',
          guestName: 'OPEN',
          originalNameText: '',
          rooms: [],
          code: '',
          notes: '',
        },
        {
          lockboxNumber: '2',
          guestName: 'Lovelace, Ada',
          originalNameText: 'ADA LOVELACE',
          rooms: ['7'],
          code: '*4821',
          notes: '',
        },
      ]);
      expect(log.archive.get('2026-10-27')?.[0].code).toBe('61822');
    });

    it('keeps the later copy of a date that was archived twice', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          archiveRows: [
            {
              date: excelDate('2026-10-25'),
              lockbox: 1,
              guestName: 'OPEN',
              room: 4,
              code: '*1000',
            },
            {
              date: excelDate('2026-10-26'),
              lockbox: 1,
              guestName: 'OPEN',
              room: 4,
              code: '*2000',
            },
            {
              date: excelDate('2026-10-26'),
              lockbox: 1,
              guestName: 'ADA LOVELACE',
              room: 4,
              code: '*3000',
            },
          ],
        }),
      );

      expect(log.archive.get('2026-10-26')).toEqual([
        expect.objectContaining({ guestName: 'ADA LOVELACE', code: '*3000' }),
      ]);
      expect(log.archive.get('2026-10-25')?.[0].code).toBe('*1000');
    });

    it('keeps the newer copy when the Archive lists the newest dates first', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          archiveRows: [
            {
              date: excelDate('2026-10-26'),
              lockbox: 1,
              guestName: 'ADA LOVELACE',
              room: 4,
              code: '*3000',
            },
            {
              date: excelDate('2026-10-26'),
              lockbox: 1,
              guestName: 'OPEN',
              room: 4,
              code: '*2000',
            },
            {
              date: excelDate('2026-10-25'),
              lockbox: 1,
              guestName: 'OPEN',
              room: 4,
              code: '*1000',
            },
          ],
        }),
      );

      expect(log.archive.get('2026-10-26')?.[0].code).toBe('*3000');
    });

    it('reads dates stored as serial numbers or typed as text', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          archiveRows: [
            // 46321 is Excel's serial number for 2026-10-26.
            { date: 46321, lockbox: 1, guestName: 'OPEN', code: '*1' },
            { date: '10/27/2026', lockbox: 1, guestName: 'OPEN', code: '*2' },
            { date: '2026-10-28', lockbox: 1, guestName: 'OPEN', code: '*3' },
            { date: '13/45/2026', lockbox: 1, guestName: 'OPEN', code: '*4' },
          ],
        }),
      );

      expect([...log.archive.keys()]).toEqual([
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
      ]);
    });
  });

  describe('fails closed', () => {
    it('rejects bytes that are not a workbook', async () => {
      await expect(
        parseLockboxWorkbook(Buffer.from('<html>Sign in to Dropbox</html>')),
      ).rejects.toThrow(LockboxLogFormatError);
    });

    it.each(['Today', 'Archive'])(
      'rejects a workbook without a %s tab',
      async (sheet) => {
        await expect(
          parseLockboxWorkbook(
            await buildLockboxWorkbook({ omitSheets: [sheet] }),
          ),
        ).rejects.toThrow(`Lockbox log has no "${sheet}" sheet`);
      },
    );

    it('names the missing header without echoing what the row holds', async () => {
      const shiftedHeaders = TODAY_HEADERS.map((header) =>
        header === 'CODE' ? 'ADA LOVELACE' : header,
      );

      const error = await parseLockboxWorkbook(
        await buildLockboxWorkbook({ todayHeaders: shiftedHeaders }),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LockboxLogFormatError);
      expect((error as Error).message).toBe(
        'Lockbox log "Today" row 6 is missing header(s): CODE',
      );
    });
  });

  describe('NOTES', () => {
    it('reads it on both tabs, trimmed', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          todayRows: [
            {
              lockbox: 1,
              guestName: 'OPEN',
              room: 1,
              code: '*1111',
              notes: ' Balance $40 collected at checkout ',
            },
            { lockbox: 2, guestName: 'OPEN', room: 2, code: '*2222' },
          ],
          archiveRows: [
            {
              date: excelDate('2026-10-27'),
              lockbox: 1,
              guestName: 'OPEN',
              room: 1,
              code: '*1111',
              notes: 'late arrival',
            },
          ],
        }),
      );

      expect(log.today.entries.map((entry) => entry.notes)).toEqual([
        'Balance $40 collected at checkout',
        '',
      ]);
      expect(log.archive.get('2026-10-27')?.[0].notes).toBe('late arrival');
    });

    it('is blank on a Today tab without the column', async () => {
      const log = await parseLockboxWorkbook(
        await buildLockboxWorkbook({
          todayHeaders: TODAY_HEADERS.filter((header) => header !== 'NOTES'),
          todayRows: [
            {
              lockbox: 1,
              guestName: 'OPEN',
              room: 1,
              code: '*1111',
              notes: 'under no header',
            },
          ],
        }),
      );

      expect(log.today.entries[0].notes).toBe('');
    });
  });
});
