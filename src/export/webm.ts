import type { ExportConfig } from './config';
import type { OutputFile } from './output';

const ascii = new TextEncoder();
function bytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function uint(value: number, minLength = 1) {
  const result: number[] = [];
  do { result.unshift(value % 256); value = Math.floor(value / 256); } while (value || result.length < minLength);
  return Uint8Array.from(result);
}
function length(value: number) {
  let width = 1;
  while (value >= 2 ** (7 * width) - 1) width++;
  const result = uint(value, width);
  result[0] |= 1 << (8 - width);
  return result;
}
function el(id: number, ...parts: Uint8Array[]) {
  const data = bytes(...parts);
  return bytes(uint(id), length(data.length), data);
}
const num = (id: number, value: number) => el(id, uint(value));
const string = (id: number, value: string) => el(id, ascii.encode(value));

function chunkBytes(chunk: EncodedVideoChunk) {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return data;
}

export function createWebm(output: OutputFile, options: ExportConfig, duration: number) {
  const time = new Uint8Array(8);
  new DataView(time.buffer).setFloat64(0, duration * 1000);
  output.append(el(0x1a45dfa3, num(0x4286, 1), num(0x42f7, 1), num(0x42f2, 4), num(0x42f3, 8),
    string(0x4282, 'webm'), num(0x4287, 4), num(0x4285, 2)));
  // Unknown segment size permits writing files sequentially to non-seekable sinks.
  output.append(Uint8Array.of(0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff));
  output.append(el(0x1549a966, num(0x2ad7b1, 1_000_000), el(0x4489, time), string(0x4d80, 'VS3D'), string(0x5741, 'VS3D')));
  const video = [num(0xb0, options.width), num(0xba, options.height)];
  if (options.transparent) video.push(num(0x53c0, 1));
  const track = [num(0xd7, 1), num(0x73c5, 1), num(0x83, 1), num(0x9c, 0),
    num(0x23e383, Math.round(1e9 / options.fps)), string(0x86, 'V_VP9'), el(0xe0, ...video)];
  if (options.transparent) track.push(num(0x55ee, 1));
  output.append(el(0x1654ae6b, el(0xae, ...track)));

  let cluster: Uint8Array[] = [];
  let clusterTime = 0;
  let previousTime = 0;
  return {
    add(frame: EncodedVideoChunk, alpha?: EncodedVideoChunk) {
      const key = frame.type === 'key' && (!alpha || alpha.type === 'key');
      const ms = Math.round(frame.timestamp / 1000);
      if (!cluster.length || (key && ms - clusterTime >= 900) || ms - clusterTime >= 30_000) {
        if (cluster.length) output.append(el(0x1f43b675, ...cluster));
        clusterTime = ms;
        cluster = [num(0xe7, clusterTime)];
      }
      const offset = uint(ms - clusterTime, 2);
      const header = Uint8Array.of(0x81, offset[0], offset[1], !alpha && key ? 0x80 : 0);
      if (!alpha) cluster.push(el(0xa3, header, chunkBytes(frame)));
      else {
        const sideData = el(0x75a1, el(0xa6, num(0xee, 1), el(0xa5, chunkBytes(alpha))));
        const block = [el(0xa1, header, chunkBytes(frame)), sideData];
        if (!key) block.push(num(0xfb, 0x10000 + previousTime - ms));
        cluster.push(el(0xa0, ...block));
      }
      previousTime = ms;
    },
    close() {
      if (cluster.length) output.append(el(0x1f43b675, ...cluster));
      cluster = [];
    },
  };
}
