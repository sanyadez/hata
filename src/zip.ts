/**
 * A ZIP writer: a folder or several files downloaded from the file manager as one archive.
 *
 * Written as a stream: a file is read and compressed in chunks, and its sizes and checksum go after
 * its data (a data descriptor), so the archive is never held in memory. There is no ZIP64: an archive
 * is at most 4 GB and 65 535 entries — the caller checks that before starting. Names are UTF-8 (flag 11).
 */
import { createReadStream } from "node:fs";
import { createDeflateRaw } from "node:zlib";

/** One entry: `name` is the path inside the archive with "/"; without `file` it is a folder */
export interface ZipSource {
  name: string;
  file?: string;
  /** Unix permissions, the low 12 bits */
  mode?: number;
  mtime?: Date;
}

export const ZIP_MAX_BYTES = 0xffffffff;
export const ZIP_MAX_ENTRIES = 0xffff;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_DESCRIPTOR = 0x08074b50;
const FLAG_UTF8 = 0x0800;
const FLAG_DESCRIPTOR = 0x0008;

const crc32 = (data: Uint8Array, seed: number) => Bun.hash.crc32(data, seed) >>> 0;

/** DOS time: date and time as two 16-bit numbers (local time, years from 1980) */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Written {
  name: Uint8Array;
  dir: boolean;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  mode: number;
  time: number;
  date: number;
}

export async function* zipChunks(sources: Iterable<ZipSource>): AsyncGenerator<Uint8Array> {
  const done: Written[] = [];
  let offset = 0;
  const enc = new TextEncoder();

  for (const src of sources) {
    const dir = src.file === undefined;
    const name = enc.encode(dir && !src.name.endsWith("/") ? src.name + "/" : src.name);
    const { time, date } = dosTime(src.mtime ?? new Date());
    const entry: Written = { name, dir, crc: 0, csize: 0, usize: 0, offset, mode: src.mode ?? (dir ? 0o755 : 0o644), time, date };

    const head = Buffer.alloc(30);
    head.writeUInt32LE(SIG_LOCAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(dir ? FLAG_UTF8 : FLAG_UTF8 | FLAG_DESCRIPTOR, 6);
    head.writeUInt16LE(dir ? 0 : 8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt16LE(name.length, 26);
    yield head;
    yield name;
    offset += 30 + name.length;

    if (!dir) {
      const deflate = createDeflateRaw();
      const input = createReadStream(src.file!);
      input.on("data", (chunk) => {
        const bytes = chunk as Buffer;
        entry.crc = crc32(bytes, entry.crc);
        entry.usize += bytes.length;
      });
      input.on("error", (e) => deflate.destroy(e));
      input.pipe(deflate);
      try {
        for await (const out of deflate) {
          entry.csize += (out as Buffer).length;
          yield out as Buffer;
        }
      } finally {
        input.destroy();
      }
      const desc = Buffer.alloc(16);
      desc.writeUInt32LE(SIG_DESCRIPTOR, 0);
      desc.writeUInt32LE(entry.crc, 4);
      desc.writeUInt32LE(entry.csize, 8);
      desc.writeUInt32LE(entry.usize, 12);
      yield desc;
      offset += entry.csize + 16;
      if (entry.usize > ZIP_MAX_BYTES || offset > ZIP_MAX_BYTES) throw new Error("the archive is too large for ZIP without ZIP64");
    }
    done.push(entry);
  }
  if (done.length > ZIP_MAX_ENTRIES) throw new Error("too many entries for ZIP without ZIP64");

  const start = offset;
  for (const e of done) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(SIG_CENTRAL, 0);
    c.writeUInt16LE((3 << 8) | 20, 4); // made on unix: the external attributes hold the permissions
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.dir ? FLAG_UTF8 : FLAG_UTF8 | FLAG_DESCRIPTOR, 8);
    c.writeUInt16LE(e.dir ? 0 : 8, 10);
    c.writeUInt16LE(e.time, 12);
    c.writeUInt16LE(e.date, 14);
    c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(e.csize, 20);
    c.writeUInt32LE(e.usize, 24);
    c.writeUInt16LE(e.name.length, 28);
    c.writeUInt32LE(((((e.dir ? 0o040000 : 0o100000) | (e.mode & 0o7777)) << 16) | (e.dir ? 0x10 : 0)) >>> 0, 38);
    c.writeUInt32LE(e.offset, 42);
    yield c;
    yield e.name;
    offset += 46 + e.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(done.length, 8);
  end.writeUInt16LE(done.length, 10);
  end.writeUInt32LE(offset - start, 12);
  end.writeUInt32LE(start, 16);
  yield end;
}

/** The archive as a response body */
export function zipStream(sources: Iterable<ZipSource>): ReadableStream<Uint8Array> {
  const gen = zipChunks(sources);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
}
