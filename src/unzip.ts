/**
 * Reading ZIP archives: the central directory parsed (ZIP64 included) and one entry at a time streamed
 * out through the built-in raw inflate, its CRC checked. Only the stored and deflated methods — what
 * every common tool writes; encrypted entries are refused. Names are taken apart here so that no entry
 * can land outside the folder it is unpacked into.
 */
import { closeSync, createWriteStream, openSync, readSync, statSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw, crc32 } from "node:zlib";

export interface ZipEntry {
  /** The path inside the archive, `/`-separated, as cleaned by `safeName` */
  name: string;
  dir: boolean;
  /** A symbolic link (Unix attributes) — never unpacked */
  link: boolean;
  method: number;
  encrypted: boolean;
  crc: number;
  compressed: number;
  size: number;
  /** Where the entry's local header is */
  offset: number;
  /** Permission bits from the Unix attributes, 0 — none recorded */
  mode: number;
}

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * An archive's path made safe to join under a folder: backslashes read as separators (Windows tools),
 * no leading slash or drive, no `.` or `..` parts. Null — nothing is left, or a part was `..`.
 */
export function safeName(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "").split("/").filter((part) => part !== "" && part !== ".");
  if (!parts.length || parts.some((part) => part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

/** A name as the archive wrote it: UTF-8 when it says so or when it reads as such, else the DOS code page Windows used */
export function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder().decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("ibm866").decode(bytes);
  }
}

/** The entries listed by the central directory at the end of `buf` (the archive's tail) */
export function parseDirectory(tail: Uint8Array, tailStart: number, readAt: (offset: number, length: number) => Uint8Array): ZipEntry[] {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a ZIP archive");
  let count = view.getUint16(end + 10, true);
  let size = view.getUint32(end + 12, true);
  let start = view.getUint32(end + 16, true);
  // the 32-bit fields full of ones: the real values are in the ZIP64 record
  if (end >= 20 && view.getUint32(end - 20, true) === EOCD64_LOCATOR) {
    const at = Number(view.getBigUint64(end - 12, true));
    const record = readAt(at, 56);
    const r = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (r.getUint32(0, true) !== EOCD64) throw new Error("damaged ZIP64 record");
    count = Number(r.getBigUint64(32, true));
    size = Number(r.getBigUint64(40, true));
    start = Number(r.getBigUint64(48, true));
  }
  const dir = start >= tailStart ? tail.subarray(start - tailStart, start - tailStart + size) : readAt(start, size);
  const d = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > dir.length || d.getUint32(p, true) !== CENTRAL) throw new Error("damaged central directory");
    const made = d.getUint8(p + 5);
    const flags = d.getUint16(p + 8, true);
    const method = d.getUint16(p + 10, true);
    const crc = d.getUint32(p + 16, true);
    let compressed = d.getUint32(p + 20, true);
    let length = d.getUint32(p + 24, true);
    const nameLength = d.getUint16(p + 28, true);
    const extraLength = d.getUint16(p + 30, true);
    const commentLength = d.getUint16(p + 32, true);
    const external = d.getUint32(p + 38, true);
    let offset = d.getUint32(p + 42, true);
    const raw = decodeName(dir.subarray(p + 46, p + 46 + nameLength), (flags & 0x800) !== 0);
    // ZIP64 extra field: the sizes and the offset that did not fit, in this order
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = d.getUint16(e, true);
      const len = d.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (length === 0xffffffff) (length = Number(d.getBigUint64(q, true))), (q += 8);
        if (compressed === 0xffffffff) (compressed = Number(d.getBigUint64(q, true))), (q += 8);
        if (offset === 0xffffffff) offset = Number(d.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    const unix = made === 3 ? external >>> 16 : 0;
    const name = safeName(raw);
    if (name !== null) {
      entries.push({
        name,
        dir: raw.endsWith("/") || raw.endsWith("\\") || (unix & 0o170000) === 0o040000 || (made === 0 && (external & 0x10) !== 0),
        link: (unix & 0o170000) === 0o120000,
        method,
        encrypted: (flags & 1) !== 0,
        crc,
        compressed,
        size: length,
        offset,
        mode: unix & 0o777,
      });
    }
    p = extraEnd + commentLength;
  }
  return entries;
}

/** An open archive: its entries, and each one written out to a file */
export function openZip(path: string): { entries: ZipEntry[]; extract: (entry: ZipEntry, to: string) => Promise<void>; close: () => void } {
  const fd = openSync(path, "r");
  const total = statSync(path).size;
  const readAt = (offset: number, length: number): Uint8Array => {
    const buf = new Uint8Array(length);
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, offset + got);
      if (n === 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  };
  try {
    // the end record and its comment are within the last 64 KiB; the directory is read from there or apart
    const tailStart = Math.max(0, total - (65_557 + 1024 * 1024));
    const entries = parseDirectory(readAt(tailStart, total - tailStart), tailStart, readAt);
    const extract = async (entry: ZipEntry, to: string): Promise<void> => {
      const local = readAt(entry.offset, 30);
      const l = new DataView(local.buffer, local.byteOffset, local.byteLength);
      if (local.length < 30 || l.getUint32(0, true) !== LOCAL) throw new Error(`damaged entry ${entry.name}`);
      const start = entry.offset + 30 + l.getUint16(26, true) + l.getUint16(28, true);
      const source = Readable.from(chunks(readAt, start, entry.compressed));
      let crc = 0;
      let written = 0;
      const check = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          crc = crc32(chunk, crc);
          written += chunk.length;
          done(null, chunk);
        },
      });
      if (entry.method === 8) await pipeline(source, createInflateRaw(), check, createWriteStream(to));
      else await pipeline(source, check, createWriteStream(to));
      if (written !== entry.size || crc >>> 0 !== entry.crc >>> 0) throw new Error(`${entry.name} is damaged in the archive`);
    };
    return { entries, extract, close: () => closeSync(fd) };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}

function* chunks(readAt: (offset: number, length: number) => Uint8Array, start: number, length: number): Generator<Uint8Array> {
  const step = 1024 * 1024;
  for (let at = 0; at < length; at += step) {
    const part = readAt(start + at, Math.min(step, length - at));
    if (!part.length) throw new Error("the archive ends early");
    yield part;
  }
}
