import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export interface ZipFileInput {
  name: string;
  filePath: string;
  modifiedAt?: Date;
}

interface PreparedZipFile extends ZipFileInput {
  crc32: number;
  dosDate: number;
  dosTime: number;
  localHeaderOffset: number;
  nameBytes: Buffer;
  size: number;
}

const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_FLAGS = ZIP_FLAG_DATA_DESCRIPTOR | ZIP_FLAG_UTF8;
const ZIP_METHOD_STORE = 0;
const ZIP_VERSION_NEEDED = 20;
const MAX_ZIP_UINT32 = 0xffffffff;
const MAX_ZIP_ENTRIES = 0xffff;
const CRC_TABLE = createCrcTable();

export async function prepareZipFiles(files: ZipFileInput[]): Promise<PreparedZipFile[]> {
  if (files.length > MAX_ZIP_ENTRIES) {
    throw new Error("Too many files for ZIP export.");
  }

  return Promise.all(
    files.map(async (file) => {
      const fileStat = await stat(file.filePath);
      if (!fileStat.isFile()) {
        throw new Error("ZIP export entry is not a file.");
      }
      if (fileStat.size > MAX_ZIP_UINT32) {
        throw new Error("ZIP export entry is too large.");
      }

      const nameBytes = Buffer.from(file.name, "utf8");
      if (nameBytes.byteLength > 0xffff) {
        throw new Error("ZIP export entry name is too long.");
      }

      const modifiedAt = file.modifiedAt ?? fileStat.mtime;
      const { dosDate, dosTime } = dateToDos(modifiedAt);

      return {
        ...file,
        crc32: 0,
        dosDate,
        dosTime,
        localHeaderOffset: 0,
        nameBytes,
        size: fileStat.size
      };
    })
  );
}

export function createZipStream(files: PreparedZipFile[]): ReadableStream<Uint8Array> {
  const iterator = zipChunks(files)[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next();
      if (result.done) {
        controller.close();
        return;
      }

      controller.enqueue(result.value);
    },
    async cancel() {
      if (iterator.return) {
        await iterator.return(undefined);
      }
    }
  });
}

async function* zipChunks(files: PreparedZipFile[]): AsyncGenerator<Uint8Array> {
  let offset = 0;

  for (const file of files) {
    file.localHeaderOffset = offset;

    const localHeader = createLocalHeader(file);
    yield localHeader;
    offset += localHeader.byteLength;

    let crc32 = 0;
    let size = 0;
    for await (const chunk of createReadStream(file.filePath)) {
      const bytes = chunkToUint8Array(chunk);
      crc32 = updateCrc32(crc32, bytes);
      size += bytes.byteLength;
      yield bytes;
      offset += bytes.byteLength;
    }

    if (size > MAX_ZIP_UINT32) {
      throw new Error("ZIP export entry is too large.");
    }

    file.crc32 = crc32;
    file.size = size;

    const descriptor = createDataDescriptor(file);
    yield descriptor;
    offset += descriptor.byteLength;
  }

  const centralDirectoryOffset = offset;
  for (const file of files) {
    const centralHeader = createCentralDirectoryHeader(file);
    yield centralHeader;
    offset += centralHeader.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endRecord = createEndOfCentralDirectory(files.length, centralDirectorySize, centralDirectoryOffset);
  yield endRecord;
}

function createLocalHeader(file: PreparedZipFile): Buffer {
  const buffer = Buffer.alloc(30 + file.nameBytes.byteLength);
  buffer.writeUInt32LE(0x04034b50, 0);
  buffer.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
  buffer.writeUInt16LE(ZIP_FLAGS, 6);
  buffer.writeUInt16LE(ZIP_METHOD_STORE, 8);
  buffer.writeUInt16LE(file.dosTime, 10);
  buffer.writeUInt16LE(file.dosDate, 12);
  buffer.writeUInt32LE(0, 14);
  buffer.writeUInt32LE(0, 18);
  buffer.writeUInt32LE(0, 22);
  buffer.writeUInt16LE(file.nameBytes.byteLength, 26);
  buffer.writeUInt16LE(0, 28);
  file.nameBytes.copy(buffer, 30);
  return buffer;
}

function createDataDescriptor(file: PreparedZipFile): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32LE(0x08074b50, 0);
  buffer.writeUInt32LE(file.crc32, 4);
  buffer.writeUInt32LE(file.size, 8);
  buffer.writeUInt32LE(file.size, 12);
  return buffer;
}

function createCentralDirectoryHeader(file: PreparedZipFile): Buffer {
  const buffer = Buffer.alloc(46 + file.nameBytes.byteLength);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt16LE(0x0314, 4);
  buffer.writeUInt16LE(ZIP_VERSION_NEEDED, 6);
  buffer.writeUInt16LE(ZIP_FLAGS, 8);
  buffer.writeUInt16LE(ZIP_METHOD_STORE, 10);
  buffer.writeUInt16LE(file.dosTime, 12);
  buffer.writeUInt16LE(file.dosDate, 14);
  buffer.writeUInt32LE(file.crc32, 16);
  buffer.writeUInt32LE(file.size, 20);
  buffer.writeUInt32LE(file.size, 24);
  buffer.writeUInt16LE(file.nameBytes.byteLength, 28);
  buffer.writeUInt16LE(0, 30);
  buffer.writeUInt16LE(0, 32);
  buffer.writeUInt16LE(0, 34);
  buffer.writeUInt16LE(0, 36);
  buffer.writeUInt32LE(0, 38);
  buffer.writeUInt32LE(file.localHeaderOffset, 42);
  file.nameBytes.copy(buffer, 46);
  return buffer;
}

function createEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Buffer {
  if (centralDirectorySize > MAX_ZIP_UINT32 || centralDirectoryOffset > MAX_ZIP_UINT32) {
    throw new Error("ZIP export is too large.");
  }

  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(0, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt16LE(entryCount, 8);
  buffer.writeUInt16LE(entryCount, 10);
  buffer.writeUInt32LE(centralDirectorySize, 12);
  buffer.writeUInt32LE(centralDirectoryOffset, 16);
  buffer.writeUInt16LE(0, 20);
  return buffer;
}

function chunkToUint8Array(chunk: string | Buffer): Uint8Array {
  return typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function updateCrc32(current: number, bytes: Uint8Array): number {
  let crc = current ^ 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function dateToDos(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds
  };
}
