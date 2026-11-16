/**
 * Reads a hotel's lockbox log workbook (`.xlsx` or macro-enabled `.xlsm`).
 *
 * Expected layout (README/lockbox/dropbox-excel-lockbox.md):
 * - "Today": the date in B4, headers on row 6, one row per lockbox below.
 * - "Archive": headers on row 4, archived rows below, one block per date.
 *
 * Columns are found by header text, so their order does not matter, but the
 * header rows themselves are fixed. Anything unexpected throws
 * `LockboxLogFormatError` rather than guessing, since a misread row would
 * hand out the wrong door code. Formula cells are read from the values Excel
 * cached when the file was last saved.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Cell, CellValue, Row, Workbook, Worksheet } from 'exceljs';
import { LockboxLogFormatError } from '../errors/LockboxLogFormatError';
import { LockboxLog, LockboxLogEntry } from '../types';

dayjs.extend(utc);

const TODAY_SHEET = 'Today';
const ARCHIVE_SHEET = 'Archive';
const TODAY_DATE_CELL = 'B4';
const TODAY_HEADER_ROW = 6;
const ARCHIVE_HEADER_ROW = 4;

const Header = {
  DATE: 'DATE',
  LOCKBOX: 'LOCKBOX',
  GUEST_NAME: 'GUEST NAME',
  ROOM: 'ROOM',
  ROOM_2: 'ROOM 2',
  CODE: 'CODE',
  NOTES: 'NOTES',
  ORIGINAL_NAME_TEXT: 'ORIGINAL NAME TEXT',
} as const;

const ENTRY_HEADERS = [
  Header.LOCKBOX,
  Header.GUEST_NAME,
  Header.ROOM,
  Header.ROOM_2,
  Header.CODE,
];

/**
 * Worksheet parts the log never needs. Skipping them means a hotel's
 * dropdowns, conditional formats, links or buttons can't break the read.
 */
const IGNORED_WORKSHEET_NODES = [
  'dataValidations',
  'conditionalFormatting',
  'extLst',
  'hyperlinks',
  'drawing',
  'picture',
  'tableParts',
];

/** Excel's serial number for 1970-01-01 in the 1900 date system. */
const EXCEL_UNIX_EPOCH_SERIAL = 25569;
/** Days between the 1900 and 1904 date systems' epochs. */
const EXCEL_1904_OFFSET_DAYS = 1462;
/** Serial number of 9999-12-31, the last date Excel can hold. */
const EXCEL_MAX_SERIAL = 2958465;

type CellPrimitive = string | number | boolean | Date | null;
type HeaderColumns = Record<string, number>;

export async function parseLockboxWorkbook(bytes: Buffer): Promise<LockboxLog> {
  const workbook = await loadWorkbook(bytes);
  const todaySheet = findSheet(workbook, TODAY_SHEET);
  const archiveSheet = findSheet(workbook, ARCHIVE_SHEET);
  const date1904 = Boolean(workbook.properties?.date1904);

  return {
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    today: {
      date: toIsoDate(cellValue(todaySheet.getCell(TODAY_DATE_CELL)), date1904),
      entries: readTodayEntries(todaySheet),
    },
    archive: readArchive(archiveSheet, date1904),
  };
}

async function loadWorkbook(bytes: Buffer): Promise<Workbook> {
  // Loaded on first use: exceljs adds ~30 MB to the process, and only hotels
  // with a lockbox log ever need it.
  const { Workbook: ExcelWorkbook } = await import('exceljs');
  const workbook = new ExcelWorkbook();
  try {
    await workbook.xlsx.load(bytes, { ignoreNodes: IGNORED_WORKSHEET_NODES });
  } catch (error) {
    throw new LockboxLogFormatError(
      `Lockbox log is not a readable Excel workbook: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return workbook;
}

function findSheet(workbook: Workbook, name: string): Worksheet {
  const sheet = workbook.worksheets.find(
    (candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (!sheet) {
    throw new LockboxLogFormatError(`Lockbox log has no "${name}" sheet`);
  }
  return sheet;
}

function readHeaderColumns(
  sheet: Worksheet,
  rowNumber: number,
  required: string[],
): HeaderColumns {
  const columns: HeaderColumns = {};
  sheet.getRow(rowNumber).eachCell((cell, columnNumber) => {
    const header = cellText(cell).replace(/\s+/g, ' ').toUpperCase();
    if (header && columns[header] === undefined) {
      columns[header] = columnNumber;
    }
  });

  const missing = required.filter((header) => columns[header] === undefined);
  if (missing.length > 0) {
    throw new LockboxLogFormatError(
      `Lockbox log "${sheet.name}" row ${rowNumber} is missing header(s): ${missing.join(', ')}`,
    );
  }
  return columns;
}

function readTodayEntries(sheet: Worksheet): LockboxLogEntry[] {
  const columns = readHeaderColumns(sheet, TODAY_HEADER_ROW, ENTRY_HEADERS);
  const entries: LockboxLogEntry[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= TODAY_HEADER_ROW) return;
    const entry = readEntry(row, columns);
    if (entry) entries.push(entry);
  });
  return entries;
}

function readArchive(
  sheet: Worksheet,
  date1904: boolean,
): Map<string, LockboxLogEntry[]> {
  const columns = readHeaderColumns(sheet, ARCHIVE_HEADER_ROW, [
    Header.DATE,
    ...ENTRY_HEADERS,
  ]);
  const rows: { date: string; entry: LockboxLogEntry }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= ARCHIVE_HEADER_ROW) return;
    const date = toIsoDate(
      cellValue(row.getCell(columns[Header.DATE])),
      date1904,
    );
    const entry = date ? readEntry(row, columns) : null;
    if (date && entry) rows.push({ date, entry });
  });

  // A date archived twice holds two copies of its lockboxes, and the later
  // archive is the one to trust. Which end of the sheet is newest is read
  // from the dates rather than assumed.
  const newestLast =
    rows.length === 0 || rows[0].date <= rows[rows.length - 1].date;
  const byDate = new Map<string, Map<string, LockboxLogEntry>>();
  for (const { date, entry } of newestLast ? rows : [...rows].reverse()) {
    const lockboxes = byDate.get(date) ?? new Map<string, LockboxLogEntry>();
    lockboxes.set(entry.lockboxNumber, entry);
    byDate.set(date, lockboxes);
  }

  const archive = new Map<string, LockboxLogEntry[]>();
  byDate.forEach((lockboxes, date) => {
    archive.set(
      date,
      [...lockboxes.values()].sort(
        (a, b) => Number(a.lockboxNumber) - Number(b.lockboxNumber),
      ),
    );
  });
  return archive;
}

/** Null for rows that aren't a lockbox: blank rows, notes, totals. */
function readEntry(row: Row, columns: HeaderColumns): LockboxLogEntry | null {
  const lockboxNumber = toLockboxNumber(
    cellValue(row.getCell(columns[Header.LOCKBOX])),
  );
  if (!lockboxNumber) return null;

  return {
    lockboxNumber,
    guestName: cellText(row.getCell(columns[Header.GUEST_NAME])),
    originalNameText: optionalCellText(row, columns[Header.ORIGINAL_NAME_TEXT]),
    rooms: [Header.ROOM, Header.ROOM_2]
      .map((header) => cellText(row.getCell(columns[header])))
      .filter(Boolean),
    code: codeText(row.getCell(columns[Header.CODE])),
    notes: optionalCellText(row, columns[Header.NOTES]),
  };
}

/** '' when the sheet has no such column. */
function optionalCellText(row: Row, column: number | undefined): string {
  return column === undefined ? '' : cellText(row.getCell(column));
}

function toLockboxNumber(value: CellPrimitive): string | null {
  const text =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  return /^\d+$/.test(text) && Number(text) > 0 ? String(Number(text)) : null;
}

/** Unwraps formulas (cached result), rich text and links; errors read as blank. */
function toPrimitive(value: CellValue): CellPrimitive {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== 'object') return value;
  if ('richText' in value) {
    return value.richText.map((run) => run.text).join('');
  }
  if ('formula' in value || 'sharedFormula' in value) {
    return toPrimitive(value.result ?? null);
  }
  if ('hyperlink' in value) return value.text;
  return null;
}

function cellValue(cell: Cell): CellPrimitive {
  return toPrimitive(cell.value);
}

function cellText(cell: Cell): string {
  const value = cellValue(cell);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Codes stay text. A code typed as a number has already lost any leading
 * zeros, unless the cell's format pads it back (e.g. "00000"), in which case
 * the padding is applied the way Excel displays it.
 */
function codeText(cell: Cell): string {
  const value = cellValue(cell);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    const format = cell.numFmt ?? '';
    return String(value).padStart(/^0+$/.test(format) ? format.length : 0, '0');
  }
  return cellText(cell);
}

function toIsoDate(value: CellPrimitive, date1904: boolean): string | null {
  if (value instanceof Date) {
    // exceljs builds dates from Excel's wall-clock time as if it were UTC.
    return Number.isNaN(value.getTime())
      ? null
      : dayjs.utc(value).format('YYYY-MM-DD');
  }
  if (typeof value === 'number') {
    if (value < 1 || value > EXCEL_MAX_SERIAL) return null;
    const daysSinceUnixEpoch =
      Math.floor(value) -
      EXCEL_UNIX_EPOCH_SERIAL +
      (date1904 ? EXCEL_1904_OFFSET_DAYS : 0);
    return dayjs.utc(0).add(daysSinceUnixEpoch, 'day').format('YYYY-MM-DD');
  }
  if (typeof value === 'string') return parseDateText(value.trim());
  return null;
}

/** Dates typed as text: YYYY-MM-DD or M/D/YYYY. */
function parseDateText(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const parts = iso
    ? [iso[1], iso[2], iso[3]]
    : us
      ? [us[3], us[1], us[2]]
      : null;
  if (!parts) return null;

  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return isRealDate ? dayjs.utc(date).format('YYYY-MM-DD') : null;
}
