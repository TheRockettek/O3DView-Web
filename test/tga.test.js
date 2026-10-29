import test from "node:test";
import assert from "node:assert/strict";
import { decodeTGA } from "../src/tga.js";

function fixture({
  width = 1,
  height = 1,
  type = 2,
  depth = 24,
  descriptor = 0,
  id = [],
  payload = [],
  trailing = [],
} = {}) {
  const bytes = new Uint8Array(
    18 + id.length + payload.length + trailing.length,
  );
  const view = new DataView(bytes.buffer);
  bytes[0] = id.length;
  bytes[2] = type;
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  bytes[16] = depth;
  bytes[17] = descriptor;
  bytes.set(id, 18);
  bytes.set(payload, 18 + id.length);
  bytes.set(trailing, 18 + id.length + payload.length);
  return bytes.buffer;
}

function extension(buffer, alphaType) {
  const bytes = new Uint8Array(buffer.byteLength + 495 + 26);
  bytes.set(new Uint8Array(buffer));
  const view = new DataView(bytes.buffer);
  view.setUint16(buffer.byteLength, 495, true);
  bytes[buffer.byteLength + 494] = alphaType;
  view.setUint32(buffer.byteLength + 495, buffer.byteLength, true);
  bytes.set(new TextEncoder().encode("TRUEVISION-XFILE.\0"), bytes.length - 18);
  return bytes.buffer;
}

test("decodes BGR and BGRA, IDs, extra bytes and straight alpha", () => {
  const result = decodeTGA(
    fixture({
      width: 2,
      descriptor: 0x20,
      id: [7, 8],
      payload: [3, 2, 1, 6, 5, 4],
      trailing: [99],
    }),
  );
  assert.deepEqual([result.width, result.height], [2, 1]);
  assert.ok(result.data instanceof Uint8ClampedArray);
  assert.deepEqual([...result.data], [1, 2, 3, 255, 4, 5, 6, 255]);
  for (const attributes of [0, 8]) {
    const rgba = decodeTGA(
      fixture({
        depth: 32,
        descriptor: 0x20 | attributes,
        payload: [10, 20, 30, 40],
      }),
    );
    assert.deepEqual([...rgba.data], [30, 20, 10, 40]);
  }
  assert.deepEqual(
    [...decodeTGA(fixture({ descriptor: 8, payload: [3, 2, 1] })).data],
    [1, 2, 3, 255],
  );
});

test("normalizes all four origins for non-square images", () => {
  const colors = [1, 2, 3, 4, 5, 6];
  for (const descriptor of [0, 0x10, 0x20, 0x30]) {
    const encoded = [];
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        const sourceX = descriptor & 0x10 ? 2 - x : x;
        const sourceY = descriptor & 0x20 ? y : 1 - y;
        encoded.push(0, 0, colors[sourceY * 3 + sourceX]);
      }
    }
    for (const [type, payload] of [
      [2, encoded],
      [10, [5, ...encoded]],
    ]) {
      const decoded = decodeTGA(
        fixture({ width: 3, height: 2, type, descriptor, payload }),
      );
      assert.deepEqual(
        [...decoded.data],
        colors.flatMap((r) => [r, 0, 0, 255]),
      );
    }
  }
});

test("decodes mixed RLE packets across rows and 128-pixel runs", () => {
  const decoded = decodeTGA(
    fixture({
      type: 10,
      width: 3,
      height: 2,
      descriptor: 0x20,
      depth: 32,
      payload: [
        0x81, 3, 2, 1, 4, 0x02, 7, 6, 5, 8, 11, 10, 9, 12, 15, 14, 13, 16, 0x80,
        19, 18, 17, 20,
      ],
    }),
  );
  assert.deepEqual(
    [...decoded.data],
    [
      1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
      19, 20,
    ],
  );
  const max = decodeTGA(
    fixture({ type: 10, width: 128, payload: [0xff, 3, 2, 1] }),
  );
  assert.equal(max.data.length, 512);
  assert.deepEqual([...max.data.slice(-4)], [1, 2, 3, 255]);
});

test("decodes uncompressed and RLE grayscale with and without alpha", () => {
  const gray = decodeTGA(
    fixture({ type: 3, depth: 8, width: 2, payload: [10, 220] }),
  );
  assert.deepEqual([...gray.data], [10, 10, 10, 255, 220, 220, 220, 255]);
  const grayAlpha = decodeTGA(
    fixture({
      type: 11,
      depth: 16,
      width: 3,
      descriptor: 0x28,
      payload: [0x81, 12, 34, 0, 56, 78],
    }),
  );
  assert.deepEqual(
    [...grayAlpha.data],
    [12, 12, 12, 34, 12, 12, 12, 34, 56, 56, 56, 78],
  );
});

test("uses TGA 2 extension to unpremultiply colors and bounds pixel data", () => {
  const encoded = fixture({
    width: 2,
    depth: 32,
    payload: [16, 32, 64, 128, 99, 99, 99, 0],
  });
  const decoded = decodeTGA(extension(encoded, 4));
  assert.deepEqual([...decoded.data], [128, 64, 32, 128, 0, 0, 0, 0]);
  assert.deepEqual(
    [...decodeTGA(extension(encoded, 3)).data],
    [64, 32, 16, 128, 99, 99, 99, 0],
  );
  assert.throws(
    () => decodeTGA(extension(fixture({ payload: [1, 2] }), 3)),
    /Truncated/,
  );
  assert.throws(
    () => decodeTGA(extension(encoded, 5)),
    /Unsupported.*alpha type/,
  );
  const invalid = extension(encoded, 3);
  new DataView(invalid).setUint16(encoded.byteLength, 494, true);
  assert.throws(() => decodeTGA(invalid), /extension/);
});

test("rejects unsupported and malformed headers", () => {
  assert.throws(() => decodeTGA(new Uint8Array(18)), TypeError);
  assert.throws(() => decodeTGA(new ArrayBuffer(17)), /Truncated.*header/);
  for (const [offset, value, pattern] of [
    [1, 1, /color map/],
    [2, 1, /image type/],
    [2, 0, /image type/],
    [16, 16, /depth/],
    [17, 0x40, /interleav/],
    [17, 1, /attribute/],
  ]) {
    const buffer = fixture({ payload: [0, 0, 0] });
    new DataView(buffer).setUint8(offset, value);
    assert.throws(() => decodeTGA(buffer), pattern);
  }
  assert.throws(() => decodeTGA(fixture({ type: 3, depth: 24 })), /depth/);
  assert.throws(() => decodeTGA(fixture({ width: 0 })), /dimensions/);
  assert.throws(() => decodeTGA(fixture({ height: 0 })), /dimensions/);
  assert.throws(
    () => decodeTGA(fixture({ width: 65535, height: 65535 })),
    /dimensions/,
  );
  const shortId = fixture();
  new DataView(shortId).setUint8(0, 3);
  assert.throws(() => decodeTGA(shortId), /image ID/);
});

test("rejects truncated images, RLE packets and overlong packets before allocation", () => {
  assert.throws(
    () => decodeTGA(fixture({ width: 2, payload: [1, 2, 3, 4, 5] })),
    /Truncated.*pixel/,
  );
  assert.throws(() => decodeTGA(fixture({ type: 10 })), /Truncated.*header/);
  assert.throws(
    () => decodeTGA(fixture({ type: 10, payload: [0x80, 1, 2] })),
    /Truncated.*data/,
  );
  assert.throws(
    () => decodeTGA(fixture({ type: 10, width: 2, payload: [1, 1, 2, 3] })),
    /Truncated.*data/,
  );
  assert.throws(
    () => decodeTGA(fixture({ type: 10, payload: [0x81, 1, 2, 3] })),
    /exceeds/,
  );
  assert.throws(
    () =>
      decodeTGA(fixture({ type: 10, width: 10000, height: 6000, payload: [] })),
    /Truncated/,
  );
});
