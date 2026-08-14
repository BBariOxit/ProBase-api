import { Readable } from 'stream';
import ExcelJS, { type CellValue } from 'exceljs';

export interface ParsedImportRow {
  /** 1-based spreadsheet row number, for error reporting back to the admin */
  rowNumber: number;
  /** header (lowercased, trimmed) -> trimmed cell text */
  values: Record<string, string>;
}

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.csv']);

export async function parseImportFile(
  buffer: Buffer,
  originalName: string,
): Promise<ParsedImportRow[]> {
  const extension = originalName
    .slice(originalName.lastIndexOf('.'))
    .toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported file type "${extension}" — only .xlsx and .csv are accepted`,
    );
  }

  const workbook = new ExcelJS.Workbook();
  if (extension === '.xlsx') {
    // exceljs's .d.ts resolves `Buffer` through a nested, pre-generic
    // @types/node (pulled in transitively via fast-csv), which is a
    // structurally different type from the modern generic Buffer our own
    // code uses — this cast is a same-value type-identity bridge, not an
    // unsafe cast.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await workbook.xlsx.load(buffer as any);
  } else {
    await workbook.csv.read(Readable.from(buffer));
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = cellToString(cell.value).trim().toLowerCase();
  });

  const rows: ParsedImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const values: Record<string, string> = {};
    let hasValue = false;

    sheet
      .getRow(rowNumber)
      .eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (!header) return;

        const text = cellToString(cell.value).trim();
        if (text) hasValue = true;
        values[header] = text;
      });

    if (hasValue) rows.push({ rowNumber, values });
  }

  return rows;
}

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    if ('richText' in value) {
      return value.richText.map((fragment) => fragment.text).join('');
    }
    if ('text' in value) return String(value.text ?? '');
    if ('result' in value) {
      const { result } = value;
      return typeof result === 'string' || typeof result === 'number'
        ? String(result)
        : '';
    }
    return '';
  }

  return String(value);
}
