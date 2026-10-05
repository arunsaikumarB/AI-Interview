import { ImportError, parseCsv } from "@/lib/resume-import";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "./constants";

/** A problem with the uploaded file as a whole; the message is safe to show to HR. */
export class ImportFileError extends Error {}

export type CsvTable = { header: string[]; rows: string[][] };

const SAVE_AS_HINT = "In Resume Parser or Excel, export / Save As \"CSV UTF-8 (Comma delimited)\".";

export function readCsvTable(bytes: Uint8Array): CsvTable {
  if (bytes.length === 0) throw new ImportFileError("The file is empty.");
  if (bytes.length > IMPORT_MAX_BYTES) {
    throw new ImportFileError(`The file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`);
  }
  if (bytes.includes(0)) {
    throw new ImportFileError(`This is not a CSV text file. ${SAVE_AS_HINT}`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportFileError(`The file is not UTF-8 text. ${SAVE_AS_HINT}`);
  }

  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (err) {
    if (err instanceof ImportError) throw new ImportFileError(err.message);
    throw err;
  }
  if (table.length === 0) throw new ImportFileError("The file is empty.");

  const header = table[0].map((h) => h.trim());
  if (header.filter(Boolean).length < 2) {
    throw new ImportFileError(`The first row must contain the column headings, separated by commas. ${SAVE_AS_HINT}`);
  }
  const seen = new Set<string>();
  for (const h of header) {
    const key = h.toLowerCase();
    if (!key) continue;
    if (seen.has(key)) throw new ImportFileError(`The column heading "${h}" appears more than once.`);
    seen.add(key);
  }

  const rows = table.slice(1);
  if (rows.length === 0) throw new ImportFileError("The file has column headings but no rows.");
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new ImportFileError(`The file has ${rows.length} rows; the limit is ${IMPORT_MAX_ROWS}. Split it into smaller files.`);
  }
  return { header, rows };
}
