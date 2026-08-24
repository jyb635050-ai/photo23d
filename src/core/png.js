import { inflateSync } from "node:zlib";
import { expandInternalBackground } from "./mask-postprocess.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("PNG_DECODE_ERROR: 文件签名无效");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const channelsByType = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
  ]);
  const channels = channelsByType.get(colorType);
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(
      `PNG_DECODE_ERROR: 仅支持非交错 8-bit 灰度/RGB/RGBA，收到 ${width}x${height} depth=${bitDepth} type=${colorType}`,
    );
  }
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (packed.length !== (stride + 1) * height) {
    throw new Error("PNG_DECODE_ERROR: 解压后的扫描线长度不符");
  }
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (stride + 1);
    const targetOffset = y * stride;
    const filter = packed[sourceOffset];
    for (let x = 0; x < stride; x += 1) {
      const value = packed[sourceOffset + 1 + x];
      const left = x >= channels ? raw[targetOffset + x - channels] : 0;
      const up = y > 0 ? raw[targetOffset + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? raw[targetOffset + x - stride - channels] : 0;
      let reconstructed;
      if (filter === 0) reconstructed = value;
      else if (filter === 1) reconstructed = value + left;
      else if (filter === 2) reconstructed = value + up;
      else if (filter === 3) reconstructed = value + Math.floor((left + up) / 2);
      else if (filter === 4) reconstructed = value + paeth(left, up, upLeft);
      else throw new Error(`PNG_DECODE_ERROR: 未知过滤器 ${filter}`);
      raw[targetOffset + x] = reconstructed & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (colorType === 0 || colorType === 4) {
      rgba[target] = raw[source];
      rgba[target + 1] = raw[source];
      rgba[target + 2] = raw[source];
      rgba[target + 3] = colorType === 4 ? raw[source + 1] : 255;
    } else {
      rgba[target] = raw[source];
      rgba[target + 1] = raw[source + 1];
      rgba[target + 2] = raw[source + 2];
      rgba[target + 3] = colorType === 6 ? raw[source + 3] : 255;
    }
  }
  return { width, height, data: rgba };
}

export function thresholdSilhouette(image, channelThreshold = 185) {
  const mask = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    const minimumChannel = Math.min(
      image.data[offset],
      image.data[offset + 1],
      image.data[offset + 2],
    );
    mask[pixel] = image.data[offset + 3] > 8 && minimumChannel < channelThreshold ? 1 : 0;
  }
  return { width: image.width, height: image.height, data: mask };
}

