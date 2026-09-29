/**
 * كاتب ZIP حتمي — مخزن (stored) ومضغوط (deflated) بصفر تبعيات — ADR-15/21.
 *
 * لماذا داخلي؟ حزمة الخادم يجب أن تصل بايت-بايت مطابقة، وصيغة ZIP
 * بلا ضغط ثابتة، وتنفيذها يعطي: صفر مكتبات أرشفة، حتمية كاملة
 * (زمن DOS ثابت)، وسطح أمني أصغر. الضغط deflateRaw حتمي بلا قاموس.
 * الصيغة: ترويسة محلية + دليل مركزي + EOCD — little-endian PKWARE.
 */

import { deflateRawSync } from "node:zlib";

export const ZipErrors = {
  duplicatePath: (path: string) => new AppErrorZip(`مسار مكرر داخل الأرشيف: ${path}`),
  badPath: (path: string) => new AppErrorZip(`مسار غير صالح للأرشفة: ${path} — بلا بادئة مطلقة ولا ..`),
} as const;
class AppErrorZip extends Error { constructor(message: string) { super(message); this.name = "ZipError"; } }
export interface ZipEntry { readonly path: string; readonly contents: string; }
const LOCAL_SIG = 0x04034b50; const CENTRAL_SIG = 0x02014b50; const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800; const FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; const FIXED_DOS_TIME = 0;
/* ---------- CRC-32 IEEE 802.3 ---------- */
let tableCache: Int32Array | null = null;
function table(): Int32Array {
  if (tableCache !== null) return tableCache;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  tableCache = t; return t;
}
export function crc32(bytes: Uint8Array): number {
  let crc = -1; for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ (table()[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0);
  return (crc ^ -1) >>> 0;
}
function writeU16(buf: Buffer, offset: number, value: number): void { buf.writeUInt16LE(value & 0xffff, offset); }
function writeU32(buf: Buffer, offset: number, value: number): void { buf.writeUInt32LE(value >>> 0, offset); }

/** يبني أرشيف ZIP مضغوطاً (deflateRaw حتمي) — نفس بنية المخزن لكن method 8 */
export function buildDeflatedZip(entries: readonly ZipEntry[]): Buffer {
  const seen = new Set<string>();
  const prepared = entries.map((entry) => {
    const path = entry.path.replace(/\\/gu, "/");
    if (path.length === 0 || path.startsWith("/") || path.includes("../")) throw ZipErrors.badPath(entry.path);
    if (seen.has(path)) throw ZipErrors.duplicatePath(path); seen.add(path);
    const bytes = Buffer.from(entry.contents, "utf8"); const compressed = deflateRawSync(bytes);
    return { path, bytes, compressed, crc: crc32(bytes) };
  });
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const item of prepared) {
    const nameBytes = Buffer.from(item.path, "utf8");
    const localSize = 30 + nameBytes.length + item.compressed.length; const local = Buffer.alloc(localSize);
    writeU32(local, 0, LOCAL_SIG); writeU16(local, 4, 20); writeU16(local, 6, UTF8_FLAG); writeU16(local, 8, 8);
    writeU16(local, 10, FIXED_DOS_TIME); writeU16(local, 12, FIXED_DOS_DATE); writeU32(local, 14, item.crc);
    writeU32(local, 18, item.compressed.length); writeU32(local, 22, item.bytes.length);
    writeU16(local, 26, nameBytes.length); writeU16(local, 28, 0);
    nameBytes.copy(local, 30); Buffer.from(item.compressed).copy(local, 30 + nameBytes.length); locals.push(local);
    const central = Buffer.alloc(46 + nameBytes.length);
    writeU32(central, 0, CENTRAL_SIG); writeU16(central, 4, 20); writeU16(central, 6, 20); writeU16(central, 8, UTF8_FLAG); writeU16(central, 10, 8);
    writeU16(central, 12, FIXED_DOS_TIME); writeU16(central, 14, FIXED_DOS_DATE); writeU32(central, 16, item.crc);
    writeU32(central, 20, item.compressed.length); writeU32(central, 24, item.bytes.length); writeU16(central, 28, nameBytes.length);
    writeU32(central, 42, offset); nameBytes.copy(central, 46); centrals.push(central); offset += localSize;
  }
  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0); const eocd = Buffer.alloc(22);
  writeU32(eocd, 0, EOCD_SIG); writeU16(eocd, 8, prepared.length); writeU16(eocd, 10, prepared.length);
  writeU32(eocd, 12, centralSize); writeU32(eocd, 16, offset);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/** يبني أرشيف ZIP مخزّناً من مدخلات نصية — حتمي بايت-بايت */
export function buildStoredZip(entries: readonly ZipEntry[]): Buffer {
  const seen = new Set<string>();
  const prepared = entries.map((entry) => {
    const path = entry.path.replace(/\\/gu, "/");
    if (path.length === 0 || path.startsWith("/") || path.includes("../")) throw ZipErrors.badPath(entry.path);
    if (seen.has(path)) throw ZipErrors.duplicatePath(path); seen.add(path);
    const bytes = Buffer.from(entry.contents, "utf8"); return { path, bytes, crc: crc32(bytes) };
  });
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const item of prepared) {
    const nameBytes = Buffer.from(item.path, "utf8");
    const localSize = 30 + nameBytes.length + item.bytes.length; const local = Buffer.alloc(localSize);
    writeU32(local, 0, LOCAL_SIG); writeU16(local, 4, 20); writeU16(local, 6, UTF8_FLAG); writeU16(local, 8, 0);
    writeU16(local, 10, FIXED_DOS_TIME); writeU16(local, 12, FIXED_DOS_DATE); writeU32(local, 14, item.crc);
    writeU32(local, 18, item.bytes.length); writeU32(local, 22, item.bytes.length);
    writeU16(local, 26, nameBytes.length); writeU16(local, 28, 0);
    nameBytes.copy(local, 30); item.bytes.copy(local, 30 + nameBytes.length); locals.push(local);
    const central = Buffer.alloc(46 + nameBytes.length);
    writeU32(central, 0, CENTRAL_SIG); writeU16(central, 4, 20); writeU16(central, 6, 20); writeU16(central, 8, UTF8_FLAG); writeU16(central, 10, 0);
    writeU16(central, 12, FIXED_DOS_TIME); writeU16(central, 14, FIXED_DOS_DATE); writeU32(central, 16, item.crc);
    writeU32(central, 20, item.bytes.length); writeU32(central, 24, item.bytes.length); writeU16(central, 28, nameBytes.length);
    writeU32(central, 42, offset); nameBytes.copy(central, 46); centrals.push(central); offset += localSize;
  }
  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0); const eocd = Buffer.alloc(22);
  writeU32(eocd, 0, EOCD_SIG); writeU16(eocd, 8, prepared.length); writeU16(eocd, 10, prepared.length);
  writeU32(eocd, 12, centralSize); writeU32(eocd, 16, offset);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
