/*
 * O3D binary reader, ported from O3DView/O3DParse/O3DParser.cs and
 * O3DBinaryReader.cs in https://github.com/space928/O3DView.
 * The original project is licensed under GPL-3.0;
 * this derivative is distributed under the same license. See
 * O3DView/LICENSE.txt.
 */

const MAX_GEOMETRY = 1_000_000;
const MAX_MATERIALS = 10_000;
const UNENCRYPTED = 0xffffffff;
const LEGACY_UNENCRYPTED = 0xffff;

function decodeVertex(state, vertex) {
  if (!state.enabled) return;
  if (state.productId === 0)
    state.productIdSalt = state.alternateSeed ? 304 : 0;
  const mixed =
    ((state.salt * state.vertexCount +
      state.vertexCount * state.productIdSalt) >>>
      0) %
    8000;
  state.productIdSalt = mixed;
  state.salt = Math.trunc(mixed / 8000);

  const fractional = (value) => value - Math.trunc(value);
  const product = Math.fround(
    Math.abs(
      Math.fround(
        Math.fround(
          Math.fround(fractional(vertex[0]) * fractional(vertex[1])) *
            fractional(vertex[2]),
        ) * 600,
      ),
    ),
  );
  state.salt = Math.trunc(product) & 0xff;

  if (state.productIdSalt >= 1000) {
    if (state.productIdSalt < 3000)
      [vertex[0], vertex[2]] = [vertex[2], vertex[0]];
    else if (state.productIdSalt > 7000)
      [vertex[1], vertex[2]] = [vertex[2], vertex[1]];
  } else {
    [vertex[0], vertex[1]] = [vertex[1], vertex[0]];
  }

  if (state.productIdSalt % 4 === 0) vertex[3] = -vertex[3];
  if (state.productIdSalt % 6 === 0) vertex[4] = -vertex[4];
  if (state.productIdSalt % 7 === 0) vertex[5] = -vertex[5];
  if (state.productIdSalt >= 600) {
    if (state.productIdSalt > 4500)
      [vertex[3], vertex[4]] = [vertex[4], vertex[3]];
  } else {
    [vertex[4], vertex[5]] = [vertex[5], vertex[4]];
  }

  if (state.productIdSalt % 5 === 0) {
    const offset = state.productIdSalt % 0x64;
    vertex[6] = Math.fround(
      vertex[6] - Math.fround(Math.fround(offset * offset) / 10000),
    );
  }
  if (state.productIdSalt % 3 === 0) {
    const offset = state.productIdSalt % 0x32;
    vertex[7] = Math.fround(
      vertex[7] - Math.fround(Math.fround(offset * offset) / 2500),
    );
  }
}

/**
 * Parse an O3D ArrayBuffer, including the supported encrypted-vertex variant.
 *
 * Vertices contain position, normal, and UV (8 floats each); triangles
 * contain three vertex indices and a material index (4 uints each).
 * Bones have the shape { name, weights: [{ index, weight }] }. Matrix
 * elements retain the file's order. Missing sections use the C# defaults:
 * empty arrays and a zero matrix. Repeated sections replace earlier ones.
 *
 * Version 3 files beginning with a zero marker followed by a vertex section
 * also use 32-bit section counts, as seen in some original OMSI models.
 * Strings are length-prefixed ISO-8859-1 bytes, not Windows-1252 or UTF-8.
 * Encrypted vertex recovery follows the OpenBusTest O3D vertex decode format;
 * it is not general-purpose decryption. Throws on invalid headers, unknown
 * sections, excessive counts, and truncated input.
 * @param {ArrayBuffer} arrayBuffer
 */
export function parseO3D(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new TypeError("parseO3D expects an ArrayBuffer");
  }

  const view = new DataView(arrayBuffer);
  let offset = 0;
  function requireBytes(size, context) {
    if (size > view.byteLength - offset) {
      throw new Error(
        `O3D: truncated ${context} at offset 0x${offset.toString(16)}`,
      );
    }
  }
  function u8(context) {
    requireBytes(1, context);
    return view.getUint8(offset++);
  }
  function u16(context) {
    requireBytes(2, context);
    const value = view.getUint16(offset, true);
    offset += 2;
    return value;
  }
  function u32(context) {
    requireBytes(4, context);
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }
  function f32(context) {
    requireBytes(4, context);
    const value = view.getFloat32(offset, true);
    offset += 4;
    return value;
  }
  function string(context) {
    const length = u8(`${context} length`);
    requireBytes(length, context);
    let value = "";
    for (let i = 0; i < length; i++)
      value += String.fromCharCode(view.getUint8(offset++));
    return value;
  }
  function floats(count, context) {
    const values = new Array(count);
    for (let i = 0; i < count; i++) values[i] = f32(context);
    return values;
  }
  function countAndCheck(context, limit, longCount, minimumSize) {
    const count = longCount ? u32(`${context} count`) : u16(`${context} count`);
    if (count > limit)
      throw new Error(`O3D: excessive ${context} count ${count}`);
    requireBytes(count * minimumSize, context);
    return count;
  }

  if (u16("header") !== 0x1984) throw new Error("O3D: invalid header");
  const version = u8("version");
  const extendedHeader = version > 3;
  const extendedOptions = extendedHeader ? u8("extended options") : 0;
  const encryptionKey = extendedHeader ? u32("encryption key") : UNENCRYPTED;
  const encrypted =
    extendedHeader &&
    encryptionKey !== UNENCRYPTED &&
    encryptionKey !== LEGACY_UNENCRYPTED;
  const vertexDecode = {
    enabled: encrypted,
    alternateSeed: (extendedOptions & 0x2) !== 0,
    productId: encryptionKey,
    productIdSalt: Math.trunc(encryptionKey + version - 4) & 0xffff || 0,
    vertexCount: 0,
    salt: 0,
  };
  if (encrypted && vertexDecode.alternateSeed)
    vertexDecode.productIdSalt =
      ((vertexDecode.productIdSalt + 381) % 65000) & 0xffff;
  else if (encrypted) vertexDecode.productIdSalt %= 65000;
  const legacyLongCounts =
    version === 3 &&
    view.byteLength - offset >= 2 &&
    view.getUint8(offset) === 0 &&
    view.getUint8(offset + 1) === 0x17;
  if (legacyLongCounts) offset++;
  const longCounts = extendedHeader || legacyLongCounts;
  const longIndices = (extendedOptions & 1) !== 0;
  const index = longIndices ? u32 : u16;

  let vertices = new Float32Array(0);
  let triangles = new Uint32Array(0);
  let materials = [];
  let bones = [];
  let transform = new Float32Array(16);

  while (offset < view.byteLength) {
    const sectionOffset = offset;
    const section = u8("section header");
    switch (section) {
      case 0x17: {
        const count = countAndCheck("vertices", MAX_GEOMETRY, longCounts, 32);
        vertices = new Float32Array(count * 8);
        vertexDecode.vertexCount = count % 65000;
        for (let i = 0; i < count; i++) {
          const vertex = new Array(8);
          for (let component = 0; component < vertex.length; component++)
            vertex[component] = f32("vertices");
          decodeVertex(vertexDecode, vertex);
          vertices.set(vertex, i * 8);
        }
        break;
      }
      case 0x49: {
        const count = countAndCheck(
          "triangles",
          MAX_GEOMETRY,
          longCounts,
          longIndices ? 14 : 8,
        );
        triangles = new Uint32Array(count * 4);
        for (let i = 0; i < triangles.length; i += 4) {
          triangles[i] = index("triangle index");
          triangles[i + 1] = index("triangle index");
          triangles[i + 2] = index("triangle index");
          triangles[i + 3] = u16("triangle material");
        }
        break;
      }
      case 0x26: {
        const count = countAndCheck("materials", MAX_MATERIALS, false, 45);
        materials = new Array(count);
        for (let i = 0; i < count; i++) {
          materials[i] = {
            diffuse: floats(4, "material diffuse"),
            spec: floats(3, "material specular"),
            emission: floats(3, "material emission"),
            specPower: f32("material specular power"),
            textureName: string("texture name"),
          };
        }
        break;
      }
      case 0x54: {
        const count = countAndCheck("bones", MAX_GEOMETRY, longCounts, 3);
        bones = new Array(count);
        for (let i = 0; i < count; i++) {
          const name = string("bone name");
          const weightCount = u16("weight count");
          requireBytes(weightCount * (longIndices ? 8 : 6), "weights");
          const weights = new Array(weightCount);
          for (let j = 0; j < weightCount; j++) {
            weights[j] = {
              index: index("weight index"),
              weight: f32("weight"),
            };
          }
          bones[i] = { name, weights };
        }
        break;
      }
      case 0x79:
        requireBytes(64, "transform");
        transform = new Float32Array(16);
        for (let i = 0; i < 16; i++) transform[i] = f32("transform");
        break;
      default:
        throw new Error(
          `O3D: unknown section 0x${section.toString(16)} at offset 0x${sectionOffset.toString(16)}`,
        );
    }
  }

  return {
    version,
    extendedOptions,
    encryptionKey,
    vertices,
    triangles,
    materials,
    bones,
    transform,
  };
}
