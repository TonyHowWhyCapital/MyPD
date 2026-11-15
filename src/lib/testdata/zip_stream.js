/* eslint-disable no-bitwise */
// ZIP archive written as a stream. report/zip.js builds the whole archive in memory,
// which a sheet of a million rows does not allow. Here a large entry is deflated into a
// temporary file while it is produced; its size and checksum are then known, so the
// archive needs neither data descriptors nor ZIP64 unless an entry really passes 4 GB.
import fs from 'fs';
import zlib from 'zlib';
import {
  createSink, streamsClosed, tracked, writerError,
} from './files';

const READY = Promise.resolve();
const partError = () => writerError('testdata.writer.aborted');

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

// crc = crcUpdate(crc, bytes) starting with -1; the checksum is (crc ^ -1) >>> 0
export const crcUpdate = (crc, bytes) => {
  let c = crc;
  for (let i = 0; i < bytes.length; i += 1) {
    c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return c;
};

export const crc32 = bytes => (crcUpdate(-1, bytes) ^ -1) >>> 0;

// A part of the archive that is written piece by piece: deflated into `tempPath`.
// write(text) -> promise (backpressure), end() -> {path, crc, size, compressedSize}
export const createDeflatedPart = (tempPath, level = 1) => {
  const deflate = zlib.createDeflateRaw({ level });
  const out = tracked(fs.createWriteStream(tempPath));
  let crc = -1;
  let size = 0;
  let failure = null;
  let waiters = [];
  const settle = () => {
    const list = waiters;
    waiters = [];
    list.forEach(w => (failure ? w.reject(failure) : w.resolve()));
  };
  let ending = null;
  const fail = (e) => {
    failure = failure || e;
    settle();
    if (ending) {
      ending.reject(failure);
    }
  };
  deflate.on('error', fail);
  out.on('error', fail);
  deflate.on('drain', settle);
  deflate.pipe(out);
  return {
    write: (text) => {
      if (failure) {
        return Promise.reject(failure);
      }
      const bytes = Buffer.from(text, 'utf8');
      crc = crcUpdate(crc, bytes);
      size += bytes.length;
      if (deflate.write(bytes)) {
        return READY;
      }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    end: () => new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      ending = { reject };
      out.once('finish', () => resolve({
        path: tempPath,
        crc: (crc ^ -1) >>> 0,
        size,
        compressedSize: out.bytesWritten,
      }));
      deflate.end();
    }),
    // stops at once; resolves when the temporary file is closed
    destroy: () => {
      fail(partError());
      deflate.unpipe(out);
      deflate.destroy();
      out.destroy();
      return streamsClosed([out]);
    },
  };
};

const LIMIT = 0xFFFFFFFF;

const u64 = (value) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(value % 0x100000000, 0);
  b.writeUInt32LE(Math.floor(value / 0x100000000), 4);
  return b;
};

// createZipWriter(filePath, {date, forceZip64})
//   addData(name, data)  small entry given as string or Buffer
//   addPart(name, part)  entry deflated before with createDeflatedPart
//   close() -> size of the archive
// `date` is the time stamp of the entries; the default is fixed (1980-01-01) so the same
// content gives the same file. forceZip64 exists for the tests.
export const createZipWriter = (filePath, options = {}) => {
  const sink = createSink(filePath);
  const entries = [];
  let offset = 0;
  const { date } = options;
  const dosTime = date
    ? (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1) : 0;
  const dosDate = date
    ? (Math.max(date.getFullYear() - 1980, 0) << 9) | ((date.getMonth() + 1) << 5)
      | date.getDate()
    : 0x21;
  const big = value => !!options.forceZip64 || value >= LIMIT;

  const write = (bytes) => {
    offset += bytes.length;
    return sink.write(bytes);
  };

  const localHeader = (e) => {
    const zip64 = big(e.size) || big(e.compressedSize);
    const extra = zip64
      ? Buffer.concat([Buffer.from([1, 0, 16, 0]), u64(e.size), u64(e.compressedSize)])
      : Buffer.alloc(0);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(zip64 ? 45 : 20, 4);
    head.writeUInt16LE(0x0800, 6); // names are UTF-8
    head.writeUInt16LE(e.method, 8);
    head.writeUInt16LE(dosTime, 10);
    head.writeUInt16LE(dosDate, 12);
    head.writeUInt32LE(e.crc, 14);
    head.writeUInt32LE(zip64 ? LIMIT : e.compressedSize, 18);
    head.writeUInt32LE(zip64 ? LIMIT : e.size, 22);
    head.writeUInt16LE(e.name.length, 26);
    head.writeUInt16LE(extra.length, 28);
    return Buffer.concat([head, e.name, extra]);
  };

  const centralHeader = (e) => {
    const fields = [];
    if (big(e.size)) fields.push(u64(e.size));
    if (big(e.compressedSize)) fields.push(u64(e.compressedSize));
    if (big(e.offset)) fields.push(u64(e.offset));
    const body = Buffer.concat(fields);
    const extraHead = Buffer.alloc(4);
    extraHead.writeUInt16LE(1, 0);
    extraHead.writeUInt16LE(body.length, 2);
    const extra = body.length ? Buffer.concat([extraHead, body]) : body;
    const version = body.length ? 45 : 20;
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(version, 4);
    head.writeUInt16LE(version, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(e.method, 10);
    head.writeUInt16LE(dosTime, 12);
    head.writeUInt16LE(dosDate, 14);
    head.writeUInt32LE(e.crc, 16);
    head.writeUInt32LE(big(e.compressedSize) ? LIMIT : e.compressedSize, 20);
    head.writeUInt32LE(big(e.size) ? LIMIT : e.size, 24);
    head.writeUInt16LE(e.name.length, 28);
    head.writeUInt16LE(extra.length, 30);
    head.writeUInt32LE(big(e.offset) ? LIMIT : e.offset, 42);
    return Buffer.concat([head, e.name, extra]);
  };

  const begin = (name, info) => {
    const entry = { ...info, name: Buffer.from(name, 'utf8'), offset };
    entries.push(entry);
    return write(localHeader(entry));
  };

  // the bytes of a temporary file, in the pace the archive takes them
  const copy = file => new Promise((resolve, reject) => {
    const input = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    input.on('error', reject);
    input.on('end', resolve);
    input.on('data', (chunk) => {
      input.pause();
      write(chunk).then(() => input.resume(), (e) => {
        input.destroy();
        reject(e);
      });
    });
  });

  const end = () => {
    const start = offset;
    const central = Buffer.concat(entries.map(centralHeader));
    const count = entries.length;
    const zip64 = !!options.forceZip64 || count >= 0xFFFF || big(start) || big(central.length);
    const parts = [central];
    if (zip64) {
      const record = Buffer.alloc(24);
      record.writeUInt32LE(0x06064b50, 0);
      record.writeUInt32LE(44, 4); // size of the rest of the record, high half stays 0
      record.writeUInt16LE(45, 12);
      record.writeUInt16LE(45, 14);
      const locator = Buffer.alloc(8);
      locator.writeUInt32LE(0x07064b50, 0);
      const disks = Buffer.alloc(4);
      disks.writeUInt32LE(1, 0);
      parts.push(record, u64(count), u64(count), u64(central.length), u64(start),
        locator, u64(start + central.length), disks);
    }
    const tail = Buffer.alloc(22);
    tail.writeUInt32LE(0x06054b50, 0);
    tail.writeUInt16LE(Math.min(count, 0xFFFF), 8);
    tail.writeUInt16LE(Math.min(count, 0xFFFF), 10);
    tail.writeUInt32LE(Math.min(central.length, LIMIT), 12);
    tail.writeUInt32LE(zip64 && big(start) ? LIMIT : start, 16);
    parts.push(tail);
    return write(Buffer.concat(parts));
  };

  return {
    addData: (name, data) => {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const deflated = zlib.deflateRawSync(bytes);
      const stored = deflated.length >= bytes.length;
      return begin(name, {
        method: stored ? 0 : 8,
        crc: crc32(bytes),
        size: bytes.length,
        compressedSize: stored ? bytes.length : deflated.length,
      }).then(() => write(stored ? bytes : deflated));
    },
    addPart: (name, part) => begin(name, {
      method: 8,
      crc: part.crc,
      size: part.size,
      compressedSize: part.compressedSize,
    }).then(() => copy(part.path)),
    close: () => end().then(() => sink.end()),
    // stops at once; resolves when the archive file is closed
    destroy: () => sink.destroy(),
  };
};
