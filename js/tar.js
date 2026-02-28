/**
 * tar.js — Minimal POSIX ustar TAR builder for browser use.
 *
 * Used by the Unity .unitypackage exporter.
 * No dependencies; works entirely in-memory with Uint8Arrays.
 */

const BLOCK = 512;
const enc   = new TextEncoder();

/** Encode a string into a fixed-length zero-padded Uint8Array. */
function encStr(str, len) {
  const arr   = new Uint8Array(len);
  const bytes = enc.encode(str);
  arr.set(bytes.subarray(0, len));
  return arr;
}

/** Encode a number as zero-padded octal ASCII, NUL-terminated. */
function encOctal(n, len) {
  const s   = n.toString(8).padStart(len - 1, '0').slice(-(len - 1));
  const arr = new Uint8Array(len);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  // arr[len-1] stays 0 (NUL terminator)
  return arr;
}

/**
 * Build a 512-byte ustar header block.
 *
 * @param {string}   name  - File or directory name (relative path)
 * @param {number}   size  - Byte count of file data (0 for directories)
 * @param {'0'|'5'}  type  - '0' = regular file, '5' = directory
 * @returns {Uint8Array}   512-byte header block
 */
function buildHeader(name, size, type) {
  const h     = new Uint8Array(BLOCK);
  const mtime = Math.floor(Date.now() / 1000);

  // name      [0,   100)
  h.set(encStr(name, 100), 0);
  // mode      [100, 108)
  h.set(encStr(type === '5' ? '0000755\0' : '0000644\0', 8), 100);
  // uid       [108, 116)
  h.set(encStr('0000000\0', 8), 108);
  // gid       [116, 124)
  h.set(encStr('0000000\0', 8), 116);
  // size      [124, 136)  — octal, 11 digits + NUL
  h.set(encOctal(size, 12), 124);
  // mtime     [136, 148)  — octal, 11 digits + NUL
  h.set(encOctal(mtime, 12), 136);
  // checksum  [148, 156)  — placeholder: 8 spaces (used in sum computation)
  h.fill(0x20, 148, 156);
  // typeflag  [156]
  h[156] = type.charCodeAt(0);
  // magic     [257, 263)  — "ustar\0"
  h.set(enc.encode('ustar'), 257);
  h[262] = 0;
  // version   [263, 265)  — "00"
  h[263] = 0x30; h[264] = 0x30;

  // Compute checksum — sum of all bytes (148–155 already contain spaces)
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];

  // Write checksum: 6 octal digits + NUL + space
  const cs = sum.toString(8).padStart(6, '0');
  for (let i = 0; i < 6; i++) h[148 + i] = cs.charCodeAt(i);
  h[154] = 0;
  h[155] = 0x20;

  return h;
}

/** Pad a Uint8Array to the next multiple of 512 bytes. */
function padToBlock(data) {
  const rem = data.length % BLOCK;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + BLOCK - rem);
  out.set(data);
  return out;
}

/**
 * Build a ustar TAR archive from an array of entries.
 *
 * @param {Array<{
 *   name:   string,
 *   data?:  Uint8Array,
 *   type?:  '0' | '5'
 * }>} entries
 * @returns {Uint8Array}
 */
export function buildTar(entries) {
  const chunks = [];

  for (const { name, data = new Uint8Array(0), type = '0' } of entries) {
    const size = type === '5' ? 0 : data.length;
    chunks.push(buildHeader(name, size, type));
    if (type !== '5' && data.length > 0) chunks.push(padToBlock(data));
  }

  // End-of-archive: two zero-filled 512-byte blocks
  chunks.push(new Uint8Array(BLOCK));
  chunks.push(new Uint8Array(BLOCK));

  // Concatenate all chunks
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out   = new Uint8Array(total);
  let   off   = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Gzip-compress a Uint8Array using the browser's CompressionStream API.
 *
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
export async function gzip(data) {
  const cs     = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const bufs   = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bufs.push(value);
  }

  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out   = new Uint8Array(total);
  let   off   = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}
