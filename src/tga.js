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
 * types 1/9 (8/16-bit indexed), 2/10 (15/16/24/32-bit truecolor), and
 * 3/11 (8-bit gray or 16-bit gray/alpha).
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
  const colorMapStart = view.getUint16(3, true);
  const colorMapLength = view.getUint16(5, true);
  const colorMapDepth = view.getUint8(7);
  const width = view.getUint16(12, true),
    height = view.getUint16(14, true);
  const depth = view.getUint8(16),
    descriptor = view.getUint8(17);
  if (![0, 1].includes(colorMapType))
    throw new Error("Invalid TGA color map type");
  if (![1, 2, 3, 9, 10, 11].includes(imageType))
    throw new Error(`Unsupported TGA image type ${imageType}`);
  const indexed = imageType === 1 || imageType === 9;
  if (indexed !== (colorMapType === 1))
    throw new Error(
      indexed
        ? "TGA indexed image has no color map"
        : "Unexpected TGA color map",
    );
  const gray = imageType === 3 || imageType === 11;
  const rle = imageType === 9 || imageType === 10 || imageType === 11;
  if (
    !(indexed ? [8, 16] : gray ? [8, 16] : [15, 16, 24, 32]).includes(depth)
  ) {
    throw new Error(
      `Unsupported TGA ${indexed ? "indexed" : gray ? "grayscale" : "truecolor"} depth ${depth}`,
    );
  }
  if (indexed && (!colorMapLength || ![15, 16, 24, 32].includes(colorMapDepth)))
    throw new Error("Unsupported or invalid TGA color map");
  if (!indexed && (colorMapStart || colorMapLength || colorMapDepth))
    throw new Error("Unexpected TGA color map data");
  if (descriptor & 0xc0) throw new Error("Unsupported TGA interleaving");
  const attributes = descriptor & 15;
  // Some OMSI 24-bit textures report eight attribute bits despite having none.
  const allowedAttributes = indexed
    ? colorMapDepth === 16
      ? [0, 1]
      : colorMapDepth === 32
        ? [0, 8]
        : [0]
    : gray
      ? depth === 16
        ? [0, 8]
        : [0]
      : depth === 16
        ? [0, 1]
        : depth >= 24
          ? [0, 8]
          : [0];
  if (!allowedAttributes.includes(attributes))
    throw new Error("Unsupported TGA attribute bit count");
  if (!width || !height || width * height > MAX_PIXELS)
    throw new Error("Invalid or excessive TGA dimensions");
  const pixels = width * height,
    bytesPerPixel = depth / 8,
    colorMapBytesPerEntry = Math.ceil(colorMapDepth / 8);
  const idEnd = HEADER_SIZE + idLength;
  const { end, premultiplied } = metadata(view);
  if (idEnd > end) throw new Error("Truncated TGA image ID");
  const colorMapOffset = idEnd;
  const start = colorMapOffset + colorMapLength * colorMapBytesPerEntry;
  if (start > end) throw new Error("Truncated TGA color map");

  const readColor = (source, colorDepth) => {
    let b,
      g,
      r,
      alpha = 255;
    if (colorDepth === 15 || colorDepth === 16) {
      const packed = view.getUint16(source, true);
      b = ((packed & 31) * 255) / 31;
      g = (((packed >> 5) & 31) * 255) / 31;
      r = (((packed >> 10) & 31) * 255) / 31;
      if (colorDepth === 16 && (descriptor & 15) > 0)
        alpha = packed & 0x8000 ? 255 : 0;
    } else {
      b = view.getUint8(source);
      g = view.getUint8(source + 1);
      r = view.getUint8(source + 2);
      if (colorDepth === 32) alpha = view.getUint8(source + 3);
    }
    const scale = premultiplied ? (alpha ? 255 / alpha : 0) : 1;
    return [
      Math.min(255, Math.round(r * scale)),
      Math.min(255, Math.round(g * scale)),
      Math.min(255, Math.round(b * scale)),
      alpha,
    ];
  };
  const readIndex = (source) =>
    bytesPerPixel === 1 ? view.getUint8(source) : view.getUint16(source, true);
  const readIndexedColor = (source) => {
    const index = readIndex(source);
    const paletteIndex = index - colorMapStart;
    if (paletteIndex < 0 || paletteIndex >= colorMapLength)
      throw new Error("TGA color map index is out of range");
    return readColor(
      colorMapOffset + paletteIndex * colorMapBytesPerEntry,
      colorMapDepth,
    );
  };

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
    const [r, g, b, alpha] = indexed
      ? readIndexedColor(source)
      : gray
        ? (() => {
            const value = view.getUint8(source);
            const alpha = depth === 16 ? view.getUint8(source + 1) : 255;
            const scale = premultiplied ? (alpha ? 255 / alpha : 0) : 1;
            const channel = Math.min(255, Math.round(value * scale));
            return [channel, channel, channel, alpha];
          })()
        : readColor(source, depth);
    data[dst] = r;
    data[dst + 1] = g;
    data[dst + 2] = b;
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
