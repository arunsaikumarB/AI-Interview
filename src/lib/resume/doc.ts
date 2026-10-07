/**
 * Local text reader for old Word 97–2003 (.doc) resumes. No external tools, no macros, no
 * embedded objects: only the document text is read.
 *
 * A .doc is an OLE compound file. Its "WordDocument" stream holds the FIB and the characters;
 * the piece table (Clx) in the "0Table"/"1Table" stream says which byte ranges make up the text.
 * Files are untrusted, so every offset is bounds-checked and every sector chain is capped.
 */

export class DocReadError extends Error {}

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const NO_STREAM = 0xffffffff;
const HEADER_DIFAT_ENTRIES = 109;
const MAX_TEXT_CHARS = 2_000_000;

export function isOleFile(buf: Buffer): boolean {
  return buf.length >= 512 && buf.subarray(0, 8).equals(OLE_SIGNATURE);
}

function u16(buf: Buffer, at: number): number {
  if (at < 0 || at + 2 > buf.length) throw new DocReadError("Word file is damaged");
  return buf.readUInt16LE(at);
}

function u32(buf: Buffer, at: number): number {
  if (at < 0 || at + 4 > buf.length) throw new DocReadError("Word file is damaged");
  return buf.readUInt32LE(at);
}

type DirEntry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };

/** Reads the root-level streams of an OLE compound file by name. */
function readCompoundFile(buf: Buffer, wanted: string[]): Map<string, Buffer> {
  if (!isOleFile(buf)) throw new DocReadError("Not a Word 97–2003 document");

  const sectorShift = u16(buf, 0x1e);
  const miniShift = u16(buf, 0x20);
  if ((sectorShift !== 9 && sectorShift !== 12) || miniShift !== 6) {
    throw new DocReadError("Word file is damaged");
  }
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const sectorCount = Math.floor((buf.length - sectorSize) / sectorSize);
  const perSector = sectorSize / 4;

  const sector = (id: number): Buffer => {
    if (id >= sectorCount) throw new DocReadError("Word file is damaged");
    const start = (id + 1) * sectorSize;
    return buf.subarray(start, start + sectorSize);
  };

  const fatSectorIds: number[] = [];
  for (let i = 0; i < HEADER_DIFAT_ENTRIES; i++) {
    const id = u32(buf, 0x4c + i * 4);
    if (id !== FREE_SECTOR) fatSectorIds.push(id);
  }
  let difat = u32(buf, 0x44);
  for (let hops = 0; difat !== END_OF_CHAIN && difat !== FREE_SECTOR; hops++) {
    if (hops > sectorCount) throw new DocReadError("Word file is damaged");
    const s = sector(difat);
    for (let i = 0; i < perSector - 1; i++) {
      const id = s.readUInt32LE(i * 4);
      if (id !== FREE_SECTOR) fatSectorIds.push(id);
    }
    difat = s.readUInt32LE(sectorSize - 4);
  }
  if (fatSectorIds.length > sectorCount) throw new DocReadError("Word file is damaged");
  const fat = new Uint32Array(fatSectorIds.length * perSector);
  fatSectorIds.forEach((id, n) => {
    const s = sector(id);
    for (let i = 0; i < perSector; i++) fat[n * perSector + i] = s.readUInt32LE(i * 4);
  });

  const chain = (start: number, table: Uint32Array): number[] => {
    const ids: number[] = [];
    for (let id = start; id !== END_OF_CHAIN; id = table[id]!) {
      if (id >= table.length || ids.length >= table.length) throw new DocReadError("Word file is damaged");
      ids.push(id);
    }
    return ids;
  };

  const readStream = (start: number, size: number): Buffer => {
    const parts = chain(start, fat).map(sector);
    const data = Buffer.concat(parts);
    if (data.length < size) throw new DocReadError("Word file is damaged");
    return data.subarray(0, size);
  };

  const dirData = Buffer.concat(chain(u32(buf, 0x30), fat).map(sector));
  const entries: DirEntry[] = [];
  for (let at = 0; at + 128 <= dirData.length; at += 128) {
    const nameBytes = Math.min(dirData.readUInt16LE(at + 0x40), 64);
    entries.push({
      name: dirData.subarray(at, at + Math.max(nameBytes - 2, 0)).toString("utf16le"),
      type: dirData[at + 0x42]!,
      left: dirData.readUInt32LE(at + 0x44),
      right: dirData.readUInt32LE(at + 0x48),
      child: dirData.readUInt32LE(at + 0x4c),
      start: dirData.readUInt32LE(at + 0x74),
      size: dirData.readUInt32LE(at + 0x78),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new DocReadError("Word file is damaged");

  const miniCutoff = u32(buf, 0x38);
  let miniStream: Buffer | null = null;
  let miniFat: Uint32Array | null = null;
  const readMini = (start: number, size: number): Buffer => {
    if (!miniStream || !miniFat) {
      miniStream = readStream(root.start, root.size);
      const miniFatData = Buffer.concat(chain(u32(buf, 0x3c), fat).map(sector));
      miniFat = new Uint32Array(miniFatData.length / 4);
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = miniFatData.readUInt32LE(i * 4);
    }
    const stream = miniStream;
    const parts = chain(start, miniFat).map((id) => {
      const from = id * miniSize;
      if (from + miniSize > stream.length) throw new DocReadError("Word file is damaged");
      return stream.subarray(from, from + miniSize);
    });
    const data = Buffer.concat(parts);
    if (data.length < size) throw new DocReadError("Word file is damaged");
    return data.subarray(0, size);
  };

  const found = new Map<string, Buffer>();
  const pending = [root.child];
  const seen = new Set<number>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === NO_STREAM || seen.has(id)) continue;
    const entry = entries[id];
    if (!entry) throw new DocReadError("Word file is damaged");
    seen.add(id);
    pending.push(entry.left, entry.right);
    if (entry.type !== 2 || !wanted.includes(entry.name) || found.has(entry.name)) continue;
    if (entry.size > buf.length) throw new DocReadError("Word file is damaged");
    found.set(entry.name, entry.size < miniCutoff ? readMini(entry.start, entry.size) : readStream(entry.start, entry.size));
  }
  return found;
}

/** Windows-1252 code points for bytes 0x80–0x9F; every other byte maps to the same code point. */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function decodeCp1252(bytes: Buffer): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b);
  }
  return out;
}

/** Word control characters → plain text. Field codes (e.g. HYPERLINK "...") are dropped, field results kept. */
function plainText(raw: string): string {
  let out = "";
  const fields: boolean[] = [];
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) {
      fields.push(true);
      continue;
    }
    if (c === 0x14) {
      if (fields.length) fields[fields.length - 1] = false;
      continue;
    }
    if (c === 0x15) {
      fields.pop();
      continue;
    }
    if (fields.includes(true)) continue;
    if (c === 0x0d || c === 0x0b || c === 0x0c) out += "\n";
    else if (c === 0x07) out += "\t";
    else if (c === 0x09) out += "\t";
    else if (c === 0x1e) out += "-";
    else if (c === 0xa0) out += " ";
    else if (c >= 0x20 && c !== 0x1f) out += ch;
  }
  return out;
}

/** Extracts the text (body, headers, footers, footnotes, text boxes) of a Word 97–2003 file. */
export function readDocText(buf: Buffer): string {
  const streams = readCompoundFile(buf, ["WordDocument", "0Table", "1Table"]);
  const wordDoc = streams.get("WordDocument");
  if (!wordDoc) throw new DocReadError("Not a Word 97–2003 document");

  if (u16(wordDoc, 0) !== 0xa5ec) throw new DocReadError("Not a Word 97–2003 document");
  if (u16(wordDoc, 2) < 0xc0) throw new DocReadError("Word 95 and older files are not supported");
  const flags = u16(wordDoc, 0x0a);
  if (flags & 0x0100) throw new DocReadError("Password-protected Word files cannot be read");

  const table = streams.get(flags & 0x0200 ? "1Table" : "0Table");
  if (!table) throw new DocReadError("Word file is damaged");

  const csw = u16(wordDoc, 0x20);
  const cslwAt = 0x22 + csw * 2;
  const cslw = u16(wordDoc, cslwAt);
  const fcLcbCountAt = cslwAt + 2 + cslw * 4;
  if (u16(wordDoc, fcLcbCountAt) <= 33) throw new DocReadError("Word file is damaged");
  const clxAt = fcLcbCountAt + 2 + 33 * 8;
  const fcClx = u32(wordDoc, clxAt);
  const lcbClx = u32(wordDoc, clxAt + 4);
  if (fcClx + lcbClx > table.length) throw new DocReadError("Word file is damaged");
  const clx = table.subarray(fcClx, fcClx + lcbClx);

  let at = 0;
  let plcPcd: Buffer | null = null;
  while (at < clx.length) {
    const kind = clx[at];
    if (kind === 0x01) {
      at += 3 + u16(clx, at + 1);
    } else if (kind === 0x02) {
      const lcb = u32(clx, at + 1);
      if (at + 5 + lcb > clx.length) throw new DocReadError("Word file is damaged");
      plcPcd = clx.subarray(at + 5, at + 5 + lcb);
      break;
    } else {
      throw new DocReadError("Word file is damaged");
    }
  }
  if (!plcPcd || plcPcd.length < 16 || (plcPcd.length - 4) % 12 !== 0) {
    throw new DocReadError("Word file is damaged");
  }

  const pieces = (plcPcd.length - 4) / 12;
  let raw = "";
  for (let i = 0; i < pieces; i++) {
    const cpStart = u32(plcPcd, i * 4);
    const cpEnd = u32(plcPcd, (i + 1) * 4);
    if (cpEnd < cpStart) throw new DocReadError("Word file is damaged");
    const chars = cpEnd - cpStart;
    if (raw.length + chars > MAX_TEXT_CHARS) throw new DocReadError("Word file has too much text");
    const fc = u32(plcPcd, (pieces + 1) * 4 + i * 8 + 2);
    const compressed = (fc & 0x40000000) !== 0;
    const offset = compressed ? (fc & 0x3fffffff) >>> 1 : fc & 0x3fffffff;
    const bytes = compressed ? chars : chars * 2;
    if (offset + bytes > wordDoc.length) throw new DocReadError("Word file is damaged");
    const data = wordDoc.subarray(offset, offset + bytes);
    raw += compressed ? decodeCp1252(data) : data.toString("utf16le");
  }
  return plainText(raw);
}
