import { CellValue, Workbook, Worksheet } from 'exceljs';

/**
 * Builds a synthetic lockbox log with the same layout as a hotel's real one
 * (README/lockbox/dropbox-excel-lockbox.md): "Today" with the date in B4 and
 * headers on row 6, "Archive" with headers on row 4, plus the helper tabs.
 * Only made-up names and codes belong in these.
 */

export interface LockboxRowFixture {
  lockbox: CellValue;
  guestName?: CellValue;
  room?: CellValue;
  room2?: CellValue;
  code?: CellValue;
  /** Number format for the CODE cell, e.g. "00000". */
  codeNumFmt?: string;
  notes?: CellValue;
}

export interface ArchiveRowFixture extends LockboxRowFixture {
  date: CellValue;
  originalNameText?: CellValue;
}

export interface LockboxWorkbookFixture {
  /** B4 on the Today tab. Defaults to 2026-10-28. */
  todayDate?: CellValue;
  /** Defaults to lockboxes 1–12, all OPEN. */
  todayRows?: LockboxRowFixture[];
  archiveRows?: ArchiveRowFixture[];
  /** Overrides the Today header row (row 6). */
  todayHeaders?: string[];
  /** Tabs to leave out, e.g. ['Archive']. */
  omitSheets?: string[];
  /** Rows written after the lockbox table on the Today tab. */
  todayTrailingRows?: CellValue[][];
}

export const TODAY_HEADERS = [
  'LOCKBOX',
  'GUEST NAME',
  'ROOM ',
  'ROOM 2',
  'CODE',
  'NOTES',
];

export const ARCHIVE_HEADERS = [
  'DATE',
  'LOCKBOX',
  'GUEST NAME',
  'ROOM',
  'ROOM 2',
  'CODE',
  'NOTES',
  'ORIGINAL NAME TEXT',
];

const DATE_FORMAT = 'm/d/yyyy';

/** A calendar date as exceljs writes it: Excel's wall clock, held as UTC. */
export function excelDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function openLockboxRows(count = 12): LockboxRowFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    lockbox: index + 1,
    guestName: 'OPEN',
  }));
}

function writeRow(sheet: Worksheet, rowNumber: number, values: CellValue[]) {
  values.forEach((value, index) => {
    if (value !== undefined) sheet.getCell(rowNumber, index + 1).value = value;
  });
}

function applyFormats(
  sheet: Worksheet,
  rowNumber: number,
  columns: { code: number; date?: number },
  row: LockboxRowFixture & { date?: CellValue },
) {
  if (row.codeNumFmt) {
    sheet.getCell(rowNumber, columns.code).numFmt = row.codeNumFmt;
  }
  // Only real dates get a date format, so serial numbers and text stay as typed.
  if (columns.date && row.date instanceof Date) {
    sheet.getCell(rowNumber, columns.date).numFmt = DATE_FORMAT;
  }
}

export async function buildLockboxWorkbook(
  fixture: LockboxWorkbookFixture = {},
): Promise<Buffer> {
  const omit = new Set(fixture.omitSheets ?? []);
  const workbook = new Workbook();

  if (!omit.has('How to Use')) {
    workbook.addWorksheet('How to Use').getCell('A1').value =
      'Type the guest name over OPEN, then pick the room.';
  }

  if (!omit.has('Today')) {
    const today = workbook.addWorksheet('Today');
    today.getCell('A4').value = 'DATE';
    today.getCell('B4').value =
      fixture.todayDate === undefined
        ? excelDate('2026-10-28')
        : fixture.todayDate;
    today.getCell('B4').numFmt = DATE_FORMAT;
    writeRow(today, 6, fixture.todayHeaders ?? TODAY_HEADERS);

    const rows = fixture.todayRows ?? openLockboxRows();
    rows.forEach((row, index) => {
      const rowNumber = 7 + index;
      writeRow(today, rowNumber, [
        row.lockbox,
        row.guestName,
        row.room,
        row.room2,
        row.code,
        row.notes,
      ]);
      applyFormats(today, rowNumber, { code: 5 }, row);
    });
    (fixture.todayTrailingRows ?? []).forEach((values, index) =>
      writeRow(today, 7 + rows.length + 1 + index, values),
    );
  }

  if (!omit.has('Daily Log')) {
    workbook.addWorksheet('Daily Log', { state: 'veryHidden' });
  }

  if (!omit.has('Archive')) {
    const archive = workbook.addWorksheet('Archive');
    archive.getCell('A1').value = 'ARCHIVE';
    writeRow(archive, 4, ARCHIVE_HEADERS);
    (fixture.archiveRows ?? []).forEach((row, index) => {
      const rowNumber = 5 + index;
      writeRow(archive, rowNumber, [
        row.date,
        row.lockbox,
        row.guestName,
        row.room,
        row.room2,
        row.code,
        row.notes,
        row.originalNameText,
      ]);
      applyFormats(archive, rowNumber, { code: 6, date: 1 }, row);
    });
  }

  if (!omit.has('Lists')) {
    workbook.addWorksheet('Lists', { state: 'hidden' });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
