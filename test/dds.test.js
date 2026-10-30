import test from "node:test";
import assert from "node:assert/strict";
import { decodeDDS } from "../src/dds.js";

function fixture({
  width = 4,
  height = 4,
  format = "DXT1",
  bits = 32,
  masks = [0xff0000, 0xff00, 0xff, 0xff000000],
  alpha = true,
  pitch,
  payload = [],
  dxgiFormat = 71,
  resourceDimension = 3,
  miscFlag = 0,
  arraySize = 1,
} = {}) {
  const dataOffset = format === "DX10" ? 148 : 128;
  const bytes = new Uint8Array(dataOffset + payload.length);
  const v = new DataView(bytes.buffer);
  const put = (offset, value) => v.setUint32(offset, value, true);
  put(0, 0x20534444);
  put(4, 124);
  put(8, 0x1007 | (pitch === undefined ? 0 : 8));
  put(12, height);
  put(16, width);
  put(20, pitch ?? 0);
  put(76, 32);
  put(108, 0x1000);
  if (format === "RGB") {
    put(80, 0x40 | (alpha ? 1 : 0));
    put(88, bits);
    masks.forEach((mask, i) => put(92 + i * 4, mask));
  } else if (format === "A8") {
    put(80, 2);
    put(88, 8);
    put(104, 0xff);
  } else {
    put(80, 4);
    for (let i = 0; i < 4; i++) v.setUint8(84 + i, format.charCodeAt(i));
    if (format === "DX10") {
      put(128, dxgiFormat);
      put(132, resourceDimension);
      put(136, miscFlag);
      put(140, arraySize);
    }
  }
  bytes.set(payload, dataOffset);
  return bytes.buffer;
}

function block(c0, c1, indices = 0) {
  return [
    c0 & 255,
    c0 >>> 8,
    c1 & 255,
    c1 >>> 8,
    indices & 255,
    (indices >>> 8) & 255,
    (indices >>> 16) & 255,
    indices >>> 24,
  ];
}

function pixel(result, x, y) {
  return [
    ...result.data.slice(
      (y * result.width + x) * 4,
      (y * result.width + x + 1) * 4,
    ),
  ];
}

function packIndices(indices, bits, size) {
  let value = 0n;
  indices.forEach((index, i) => {
    value |= BigInt(index) << BigInt(bits * i);
  });
  return Array.from({ length: size }, (_, i) =>
    Number((value >> BigInt(i * 8)) & 255n),
  );
}

test("decodes 24-bit BGR with padded rows and ignores lower mip data", () => {
  const dds = fixture({
    format: "RGB",
    width: 2,
    height: 2,
    bits: 24,
    masks: [0xff0000, 0xff00, 0xff, 0],
    alpha: false,
    pitch: 8,
    payload: [3, 2, 1, 6, 5, 4, 99, 99, 9, 8, 7, 12, 11, 10, 99, 99, 123],
  });
  const result = decodeDDS(dds);
  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.ok(result.data instanceof Uint8ClampedArray);
  assert.deepEqual(
    [...result.data],
    [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255],
  );
});

test("decodes alternate channel orders, opaque X, packed RGB565 and alpha", () => {
  const rgba = decodeDDS(
    fixture({
      format: "RGB",
      width: 1,
      height: 1,
      masks: [0xff, 0xff00, 0xff0000, 0xff000000],
      payload: [11, 22, 33, 44],
    }),
  );
  assert.deepEqual(pixel(rgba, 0, 0), [11, 22, 33, 44]);
  const xrgb = decodeDDS(
    fixture({
      format: "RGB",
      width: 1,
      height: 1,
      alpha: false,
      payload: [1, 2, 3, 0],
    }),
  );
  assert.deepEqual(pixel(xrgb, 0, 0), [3, 2, 1, 255]);
  const rgb565 = decodeDDS(
    fixture({
      format: "RGB",
      width: 2,
      height: 1,
      bits: 16,
      masks: [0xf800, 0x7e0, 0x1f, 0],
      alpha: false,
      payload: [0x00, 0xf8, 0xff, 0x07],
    }),
  );
  assert.deepEqual([...rgb565.data], [255, 0, 0, 255, 0, 255, 255, 255]);
  const argb1555 = decodeDDS(
    fixture({
      format: "RGB",
      width: 1,
      height: 1,
      bits: 16,
      masks: [0x7c00, 0x3e0, 0x1f, 0x8000],
      payload: [0xff, 0xff],
    }),
  );
  assert.deepEqual(pixel(argb1555, 0, 0), [255, 255, 255, 255]);
  const rgb332 = decodeDDS(
    fixture({
      format: "RGB",
      width: 1,
      height: 1,
      bits: 8,
      masks: [0xe0, 0x1c, 3, 0],
      alpha: false,
      payload: [0xff],
    }),
  );
  assert.deepEqual(pixel(rgb332, 0, 0), [255, 255, 255, 255]);
});

test("A8 maps alpha to black RGBA and honors padded rows", () => {
  const dds = fixture({
    format: "A8",
    width: 3,
    height: 2,
    pitch: 4,
    payload: [0, 128, 255, 7, 42, 84, 126, 7],
  });
  const decoded = decodeDDS(dds);
  assert.deepEqual(
    [...decoded.data],
    [
      0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 255, 0, 0, 0, 42, 0, 0, 0, 84, 0, 0, 0,
      126,
    ],
  );
  new DataView(dds).setUint32(80, 1, true);
  assert.deepEqual([...decodeDDS(dds).data], [...decoded.data]);
});

test("rejects invalid alpha-only headers and truncated data", () => {
  const make = () =>
    fixture({ format: "A8", width: 2, height: 2, payload: [0, 1, 2, 3] });
  for (const [offset, value, error] of [
    [88, 16, /alpha bit count/],
    [104, 0, /alpha-only masks/],
    [92, 0xff, /alpha-only masks/],
    [80, 0x42, /pixel format flags/],
    [80, 0x06, /pixel format flags/],
  ]) {
    const dds = make();
    new DataView(dds).setUint32(offset, value, true);
    assert.throws(() => decodeDDS(dds), error);
  }
  assert.throws(
    () => decodeDDS(fixture({ format: "A8", width: 3, pitch: 2 })),
    /pitch/,
  );
  assert.throws(
    () =>
      decodeDDS(
        fixture({ format: "A8", width: 2, height: 2, payload: [0, 1, 2] }),
      ),
    /Truncated/,
  );
});

test("DXT1 interpolates four colors, including indices in the last row", () => {
  const indices = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 0];
  const packed = packIndices(indices, 2, 4);
  const dds = fixture({
    payload: [...block(0xf800, 0x001f).slice(0, 4), ...packed],
  });
  const decoded = decodeDDS(dds);
  assert.deepEqual(
    [0, 1, 2, 3].map((x) => pixel(decoded, x, 0)),
    [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [170, 0, 85, 255],
      [85, 0, 170, 255],
    ],
  );
  assert.deepEqual(pixel(decoded, 0, 3), [85, 0, 170, 255]);
});

test("DXT1 three-color mode includes transparent black", () => {
  const decoded = decodeDDS(fixture({ payload: block(0x0000, 0xffff, 0xe4) }));
  assert.deepEqual(
    [0, 1, 2, 3].map((x) => pixel(decoded, x, 0)),
    [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [127, 127, 127, 255],
      [0, 0, 0, 0],
    ],
  );
});

test("DXT3 explicit alpha uses all 16 nibbles and always four color mode", () => {
  const alpha = packIndices(
    Array.from({ length: 16 }, (_, i) => i),
    4,
    8,
  );
  const decoded = decodeDDS(
    fixture({
      format: "DXT3",
      payload: [...alpha, ...block(0, 0xffff, 0xffffffff)],
    }),
  );
  assert.deepEqual(pixel(decoded, 0, 0), [170, 170, 170, 0]);
  assert.deepEqual(pixel(decoded, 3, 3), [170, 170, 170, 255]);
  assert.equal(pixel(decoded, 2, 2)[3], 170);
});

test("DXT5 decodes both alpha interpolation modes and high index bits", () => {
  const indices = Array.from({ length: 16 }, (_, i) => i % 8);
  for (const [a0, a1, expected] of [
    [210, 0, [210, 0, 180, 150, 120, 90, 60, 30]],
    [0, 200, [0, 200, 40, 80, 120, 160, 0, 255]],
    [50, 50, [50, 50, 50, 50, 50, 50, 0, 255]],
  ]) {
    const decoded = decodeDDS(
      fixture({
        format: "DXT5",
        payload: [
          a0,
          a1,
          ...packIndices(indices, 3, 6),
          ...block(0, 0xffff, 0xffffffff),
        ],
      }),
    );
    assert.deepEqual(
      indices.map((_, i) => pixel(decoded, i % 4, Math.floor(i / 4))[3]),
      [...expected, ...expected],
    );
    assert.deepEqual(pixel(decoded, 0, 0).slice(0, 3), [170, 170, 170]);
  }
});

test("DXT2 converts premultiplied BC2 colors to straight alpha", () => {
  const indices = [0, 8, 15, 1, ...Array(12).fill(8)];
  const payload = [...packIndices(indices, 4, 8), ...block(0x4208, 0)];
  const decoded = decodeDDS(fixture({ format: "DXT2", payload }));
  assert.deepEqual(pixel(decoded, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(decoded, 1, 0), [124, 122, 124, 136]);
  assert.deepEqual(pixel(decoded, 2, 0), [66, 65, 66, 255]);
  assert.deepEqual(pixel(decoded, 3, 0), [255, 255, 255, 17]);
  assert.deepEqual(pixel(decoded, 3, 3), [124, 122, 124, 136]);
  assert.deepEqual(
    pixel(decodeDDS(fixture({ format: "DXT3", payload })), 1, 0),
    [66, 65, 66, 136],
  );
});

test("DXT4 converts premultiplied BC3 colors using interpolated alpha", () => {
  const indices = [0, 1, 2, 7, ...Array(12).fill(0)];
  const payload = [128, 0, ...packIndices(indices, 3, 6), ...block(0x4208, 0)];
  const decoded = decodeDDS(fixture({ format: "DXT4", payload }));
  assert.deepEqual(pixel(decoded, 0, 0), [131, 129, 131, 128]);
  assert.deepEqual(pixel(decoded, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(decoded, 2, 0), [154, 152, 154, 109]);
  assert.deepEqual(pixel(decoded, 3, 0), [255, 255, 255, 18]);
  assert.deepEqual(
    pixel(decodeDDS(fixture({ format: "DXT5", payload })), 0, 0),
    [66, 65, 66, 128],
  );
  const alternate = decodeDDS(
    fixture({
      format: "DXT4",
      width: 4,
      height: 2,
      payload: [
        0,
        200,
        ...packIndices([0, 1, 2, 6, 7], 3, 6),
        ...block(0x4208, 0),
      ],
    }),
  );
  assert.deepEqual(pixel(alternate, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(alternate, 1, 0), [84, 83, 84, 200]);
  assert.deepEqual(pixel(alternate, 2, 0), [255, 255, 255, 40]);
  assert.deepEqual(pixel(alternate, 3, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(alternate, 0, 1), [66, 65, 66, 255]);
});

test("decodes DX10 BC1, BC2 and BC3 2D textures", () => {
  for (const [dxgiFormats, payload, expected] of [
    [[70, 71, 72], block(0xf800, 0), [255, 0, 0, 255]],
    [
      [73, 74, 75],
      [...Array(8).fill(255), ...block(0x07e0, 0)],
      [0, 255, 0, 255],
    ],
    [
      [76, 77, 78],
      [255, 0, ...Array(6).fill(0), ...block(0x001f, 0)],
      [0, 0, 255, 255],
    ],
  ]) {
    for (const dxgiFormat of dxgiFormats) {
      const decoded = decodeDDS(
        fixture({ format: "DX10", dxgiFormat, payload }),
      );
      assert.deepEqual(pixel(decoded, 0, 0), expected);
    }
  }
});

test("decodes DX10 sRGB and typeless BC formats and rejects unsupported texture types", () => {
  const srgb = decodeDDS(
    fixture({
      format: "DX10",
      dxgiFormat: 72,
      payload: block(0x7800, 0),
    }),
  );
  assert.deepEqual(pixel(srgb, 0, 0), [51, 0, 0, 255]);
  assert.deepEqual(
    pixel(
      decodeDDS(
        fixture({
          format: "DX10",
          dxgiFormat: 70,
          payload: block(0xf800, 0),
        }),
      ),
      0,
      0,
    ),
    [255, 0, 0, 255],
  );
  for (const options of [
    { resourceDimension: 4 },
    { miscFlag: 4 },
    { arraySize: 2 },
  ]) {
    assert.throws(
      () =>
        decodeDDS(
          fixture({ format: "DX10", payload: block(0, 0), ...options }),
        ),
      /Unsupported DDS DX10 texture type/,
    );
  }
  assert.throws(
    () =>
      decodeDDS(
        fixture({ format: "DX10", dxgiFormat: 98, payload: block(0, 0) }),
      ),
    /Unsupported DDS DXGI format/,
  );
  assert.throws(
    () => decodeDDS(fixture({ format: "DX10" }).slice(0, 140)),
    /Truncated DDS DX10 header/,
  );
});

test("clips partial blocks and handles multiple blocks in row-major order", () => {
  const decoded = decodeDDS(
    fixture({
      width: 5,
      height: 5,
      payload: [
        ...block(0xf800, 0),
        ...block(0x07e0, 0),
        ...block(0x001f, 0),
        ...block(0xffff, 0),
      ],
    }),
  );
  assert.deepEqual(pixel(decoded, 3, 3), [255, 0, 0, 255]);
  assert.deepEqual(pixel(decoded, 4, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(decoded, 0, 4), [0, 0, 255, 255]);
  assert.deepEqual(pixel(decoded, 4, 4), [255, 255, 255, 255]);
});

test("rejects malformed headers, dimensions, and unsupported texture types", () => {
  assert.throws(() => decodeDDS(new Uint8Array(128)), /ArrayBuffer/);
  assert.throws(() => decodeDDS(new ArrayBuffer(127)), /Truncated DDS header/);
  const cases = [
    [0, 0, /magic/],
    [4, 123, /header size/],
    [76, 31, /header size/],
    [8, 0, /flags/],
    [108, 0, /caps/],
    [16, 0, /dimensions/],
    [12, 0xffffffff, /dimensions/],
    [112, 0x200, /cubemap/],
    [112, 0x200000, /volume/],
    [24, 2, /volume/],
  ];
  for (const [offset, value, error] of cases) {
    const dds = fixture({ payload: block(0, 0) });
    new DataView(dds).setUint32(offset, value, true);
    assert.throws(() => decodeDDS(dds), error);
  }
  for (const format of ["BC7 "]) {
    assert.throws(
      () => decodeDDS(fixture({ format })),
      /Unsupported DDS FourCC/,
    );
  }
  const unknown = fixture();
  new DataView(unknown).setUint32(80, 0x20000, true);
  assert.throws(() => decodeDDS(unknown), /DDS pixel format/);
  for (const flags of [0x44, 0x240, 0x60]) {
    new DataView(unknown).setUint32(80, flags, true);
    assert.throws(() => decodeDDS(unknown), /DDS pixel format flags/);
  }
});

test("rejects invalid RGB masks, pitch, bit depth, and truncated payloads", () => {
  const base = { format: "RGB", width: 1, height: 1, payload: [0, 0, 0, 0] };
  for (const masks of [
    [0, 0xff00, 0xff, 0xff000000],
    [0xf000f, 0xff00, 0xff, 0xff000000],
    [0xff, 0xff, 0xff0000, 0xff000000],
    [0xff0000, 0xff00, 0xff, 0],
  ])
    assert.throws(() => decodeDDS(fixture({ ...base, masks })), /mask/);
  assert.throws(() => decodeDDS(fixture({ ...base, bits: 12 })), /bit count/);
  assert.throws(
    () =>
      decodeDDS(
        fixture({
          ...base,
          bits: 16,
          masks: [0x10000, 0x7e0, 0x1f, 0],
          alpha: false,
        }),
      ),
    /mask/,
  );
  assert.throws(() => decodeDDS(fixture({ ...base, pitch: 3 })), /pitch/);
  assert.throws(
    () => decodeDDS(fixture({ ...base, height: 2, pitch: 8 })),
    /Truncated DDS pixel data/,
  );
  for (const format of ["DXT1", "DXT2", "DXT3", "DXT4", "DXT5"]) {
    assert.throws(
      () =>
        decodeDDS(
          fixture({
            format,
            payload: Array(format === "DXT1" ? 7 : 15).fill(0),
          }),
        ),
      /Truncated DDS pixel data/,
    );
  }
  const dds = fixture({ payload: block(0, 0) });
  const view = new DataView(dds);
  view.setUint32(8, 0x81007, true);
  view.setUint32(20, 7, true);
  assert.throws(() => decodeDDS(dds), /linear size/);
});

test("accepts a zero compressed linear size only when the actual payload is present", () => {
  for (const format of ["DXT1", "DXT2", "DXT3", "DXT4", "DXT5"]) {
    const size = format === "DXT1" ? 8 : 16;
    const make = (length) => {
      const dds = fixture({ format, payload: Array(length).fill(0) });
      new DataView(dds).setUint32(8, 0x81007, true);
      return dds;
    };
    assert.equal(decodeDDS(make(size)).data.length, 64);
    assert.throws(() => decodeDDS(make(size - 1)), /Truncated DDS pixel data/);
  }
});
