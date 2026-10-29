const HEADER_SIZE = 18;
const MAX_PIXELS = 64 * 1024 * 1024;
const FOOTER_SIGNATURE = "TRUEVISION-XFILE.\0";

// TGA 2.0 can explicitly mark the stored color channels as premultiplied.
function metadata(view) {
  const footer = view.byteLength - 26;
  if (footer < HEADER_SIZE)
    return { end: view.byteLength, premultiplied: false };
  for (let i = 0; i < FOOTER_SIGNATURE.length; i++) {
    if (view.getUint8(footer + 8 + i) !== FOOTER_SIGNATURE.charCodeAt(i)) {
      return { end: view.byteLength, premultiplied: false };
    }
  }
  const offset = view.getUint32(footer, true);
  const developer = view.getUint32(footer + 4, true);
  if (developer && (developer < HEADER_SIZE || developer >= footer)) {
    throw new Error("Invalid TGA developer area");
  }
  let end = developer || footer;
  if (!offset) return { end, premultiplied: false };
  if (offset < HEADER_SIZE || offset + 495 > footer)
    throw new Error("Invalid TGA extension area");
  const size = view.getUint16(offset, true);
  if (size < 495 || offset + size > footer)
    throw new Error("Invalid TGA extension area");
  const alphaType = view.getUint8(offset + 494);
  if (alphaType > 4) throw new Error("Unsupported TGA extension alpha type");
  end = Math.min(end, offset);
  return { end, premultiplied: alphaType === 4 };
}

/**
 * Decode an ArrayBuffer into { width, height, data: Uint8ClampedArray }.
 * Pixels are top-down, left-to-right, straight-alpha RGBA. Supports TGA
 * types 2/10 (24/32-bit BGR[A]) and 3/11 (8-bit gray or 16-bit gray/alpha).
 * A stored alpha byte is retained even when the descriptor reports zero
 * attribute bits, as used by some legacy files. Trailing metadata is allowed.
 */
export function decodeTGA(buffer) {
  if (!(buffer instanceof ArrayBuffer))
    throw new TypeError("TGA input must be an ArrayBuffer");
  if (buffer.byteLength < HEADER_SIZE) throw new Error("Truncated TGA header");
  const view = new DataView(buffer);
  const idLength = view.getUint8(0);
  const colorMapType = view.getUint8(1);
  const imageType = view.getUint8(2);
  const width = view.getUint16(12, true),
    height = view.getUint16(14, true);
  const depth = view.getUint8(16),
    descriptor = view.getUint8(17);
  if (colorMapType !== 0) throw new Error("Unsupported TGA color map");
  if (![2, 3, 10, 11].includes(imageType))
    throw new Error(`Unsupported TGA image type ${imageType}`);
  const gray = imageType === 3 || imageType === 11;
  const rle = imageType === 10 || imageType === 11;
  if (!(gray ? [8, 16] : [24, 32]).includes(depth)) {
    throw new Error(
      `Unsupported TGA ${gray ? "grayscale" : "truecolor"} depth ${depth}`,
    );
  }
  if (descriptor & 0xc0) throw new Error("Unsupported TGA interleaving");
  const attributes = descriptor & 15;
  // Some OMSI 24-bit textures report eight attribute bits despite having none.
  if (attributes !== 0 && attributes !== 8)
    throw new Error("Unsupported TGA attribute bit count");
  if (!width || !height || width * height > MAX_PIXELS)
    throw new Error("Invalid or excessive TGA dimensions");
  const pixels = width * height,
    bytesPerPixel = depth / 8;
  const start = HEADER_SIZE + idLength;
  const { end, premultiplied } = metadata(view);
  if (start > end) throw new Error("Truncated TGA image ID");

  // Validate the entire encoded image before allocating the output buffer.
  let offset = start;
  if (!rle) {
    if (pixels * bytesPerPixel > end - offset)
      throw new Error("Truncated TGA pixel data");
  } else {
    let count = 0;
    while (count < pixels) {
      if (offset >= end) throw new Error("Truncated TGA RLE packet header");
      const packet = view.getUint8(offset++);
      const length = (packet & 127) + 1;
      if (length > pixels - count)
        throw new Error("Invalid TGA RLE packet exceeds image dimensions");
      const bytes = (packet & 128 ? 1 : length) * bytesPerPixel;
      if (bytes > end - offset)
        throw new Error("Truncated TGA RLE packet data");
      offset += bytes;
      count += length;
    }
  }

  const data = new Uint8ClampedArray(pixels * 4);
  offset = start;
  let index = 0;
  const write = (source) => {
    const x = index % width,
      y = Math.floor(index / width);
    const dstX = descriptor & 0x10 ? width - 1 - x : x;
    const dstY = descriptor & 0x20 ? y : height - 1 - y;
    const dst = (dstY * width + dstX) * 4;
    const alpha =
      depth === (gray ? 16 : 32)
        ? view.getUint8(source + bytesPerPixel - 1)
        : 255;
    const b = view.getUint8(source);
    const g = gray ? b : view.getUint8(source + 1);
    const r = gray ? b : view.getUint8(source + 2);
    const scale = premultiplied ? (alpha ? 255 / alpha : 0) : 1;
    data[dst] = Math.min(255, Math.round(r * scale));
    data[dst + 1] = Math.min(255, Math.round(g * scale));
    data[dst + 2] = Math.min(255, Math.round(b * scale));
    data[dst + 3] = alpha;
    index++;
  };
  if (!rle) {
    while (index < pixels) {
      write(offset);
      offset += bytesPerPixel;
    }
  } else {
    while (index < pixels) {
      const packet = view.getUint8(offset++),
        length = (packet & 127) + 1;
      if (packet & 128) {
        for (let i = 0; i < length; i++) write(offset);
        offset += bytesPerPixel;
      } else {
        for (let i = 0; i < length; i++, offset += bytesPerPixel) write(offset);
      }
    }
  }
  return { width, height, data };
}
