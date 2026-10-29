/*
 * O3D writer informed by O3DView/O3DParse/O3DParser.cs.
 * Distributed under GPL-3.0; see O3DView/LICENSE.txt.
 */

import { wavefrontStem } from "./obj-export.js";

const MAX_GEOMETRY = 1_000_000;
const MAX_MATERIALS = 10_000;
const UNENCRYPTED = 0xffffffff;

/**
 * Serialize a scene model as an unencrypted O3D ArrayBuffer. Retains the
 * original O3D version, options, bones, and transform when available.
 * Options may override version and extendedOptions. OBJ models default to
 * version 7 with long indices. Material values are the current scene values.
 */
export function writeO3D(model, options = {}) {
    if (!model || typeof model !== "object" || !options || typeof options !== "object") {
        throw new TypeError("O3D: expected a model and options");
    }

    const metadata = model.o3dMetadata || {};
    const version = options.version ?? metadata.version ?? 7;
    const extendedOptions = options.extendedOptions ?? metadata.extendedOptions ?? (version > 3 ? 1 : 0);
    if (!Number.isInteger(version) || version < 0 || version > 255) throw new RangeError("O3D: invalid version");
    if (!Number.isInteger(extendedOptions) || extendedOptions < 0 || extendedOptions > 255 ||
        (version <= 3 && extendedOptions !== 0)) throw new RangeError("O3D: invalid extended options for version");
    const longCounts = version > 3;
    const longIndices = longCounts && (extendedOptions & 1) !== 0;
    const indexLimit = longIndices ? 0xffffffff : 0xffff;
    const countLimit = longCounts ? MAX_GEOMETRY : 0xffff;
    const vertices = model.vertices, triangles = model.triangles;
    const materials = model.materials, bones = metadata.bones ?? [];
    if (!(vertices instanceof Float32Array) || vertices.length % 8 ||
        !(triangles instanceof Uint32Array) || triangles.length % 4 ||
        !Array.isArray(materials) || !Array.isArray(bones)) {
        throw new TypeError("O3D: invalid model arrays");
    }
    const vertexCount = vertices.length / 8, triangleCount = triangles.length / 4;
    if (vertexCount > countLimit || triangleCount > countLimit || bones.length > countLimit ||
        materials.length > MAX_MATERIALS) throw new RangeError("O3D: section count exceeds supported limit");
    function finite(value, label) {
        if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
            throw new RangeError(`O3D: ${label} must be a finite 32-bit float`);
        }
    }
    function string(value, label) {
        if (typeof value !== "string" || value.length > 255 || [...value].some(char => char.charCodeAt(0) > 255)) {
            throw new RangeError(`O3D: ${label} must be at most 255 Latin-1 characters`);
        }
        return value;
    }
    function vector(value, length, label) {
        if (!value || value.length !== length) throw new TypeError(`O3D: invalid ${label}`);
        for (const component of value) finite(component, label);
    }
    for (const value of vertices) finite(value, "vertex component");
    for (let i = 0; i < triangles.length; i += 4) {
        for (let j = 0; j < 3; j++) {
            if (triangles[i + j] >= vertexCount || triangles[i + j] > indexLimit) {
                throw new RangeError("O3D: triangle references an invalid or unrepresentable vertex");
            }
        }
        if (triangles[i + 3] >= materials.length || triangles[i + 3] > 0xffff) {
            throw new RangeError("O3D: triangle references an invalid material");
        }
    }
    let materialBytes = 0;
    for (const material of materials) {
        if (!material) throw new TypeError("O3D: invalid material");
        vector(material.diffuse, 4, "material diffuse");
        vector(material.spec, 3, "material specular");
        vector(material.emission, 3, "material emission");
        finite(material.specPower, "material specular power");
        materialBytes += 45 + string(material.textureName, "texture name").length;
    }
    let boneBytes = 0;
    for (const bone of bones) {
        if (!bone || !Array.isArray(bone.weights) || bone.weights.length > 0xffff) {
            throw new TypeError("O3D: invalid bone weights");
        }
        boneBytes += 3 + string(bone.name, "bone name").length + bone.weights.length * (longIndices ? 8 : 6);
        for (const weight of bone.weights) {
            if (!weight || !Number.isInteger(weight.index) || weight.index < 0 ||
                weight.index >= vertexCount || weight.index > indexLimit) {
                throw new RangeError("O3D: bone references an invalid or unrepresentable vertex");
            }
            finite(weight.weight, "bone weight");
        }
    }
    vector(model.transform, 16, "transform");

    const sectionCountBytes = longCounts ? 4 : 2;
    const size = (longCounts ? 8 : 3) + 65 +
        (vertexCount ? 1 + sectionCountBytes + vertexCount * 32 : 0) +
        (triangleCount ? 1 + sectionCountBytes + triangleCount * (longIndices ? 14 : 8) : 0) +
        (materials.length ? 3 + materialBytes : 0) +
        (bones.length ? 1 + sectionCountBytes + boneBytes : 0);
    const buffer = new ArrayBuffer(size), view = new DataView(buffer);
    let offset = 0;
    const u8 = value => { view.setUint8(offset, value); offset++; };
    const u16 = value => { view.setUint16(offset, value, true); offset += 2; };
    const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
    const f32 = value => { view.setFloat32(offset, value, true); offset += 4; };
    const writeString = value => { u8(value.length); for (let i = 0; i < value.length; i++) u8(value.charCodeAt(i)); };
    const count = longCounts ? u32 : u16, index = longIndices ? u32 : u16;
    u16(0x1984); u8(version);
    if (longCounts) { u8(extendedOptions); u32(UNENCRYPTED); }
    if (vertexCount) {
        u8(0x17); count(vertexCount);
        for (const value of vertices) f32(value);
    }
    if (triangleCount) {
        u8(0x49); count(triangleCount);
        for (let i = 0; i < triangles.length; i += 4) {
            index(triangles[i]); index(triangles[i + 1]); index(triangles[i + 2]); u16(triangles[i + 3]);
        }
    }
    if (materials.length) {
        u8(0x26); u16(materials.length);
        for (const material of materials) {
            for (const value of material.diffuse) f32(value);
            for (const value of material.spec) f32(value);
            for (const value of material.emission) f32(value);
            f32(material.specPower); writeString(material.textureName);
        }
    }
    if (bones.length) {
        u8(0x54); count(bones.length);
        for (const bone of bones) {
            writeString(bone.name); u16(bone.weights.length);
            for (const weight of bone.weights) { index(weight.index); f32(weight.weight); }
        }
    }
    u8(0x79); for (const value of model.transform) f32(value);
    return buffer;
}

export function downloadO3D(model, format = "preserve", documentObject = document, url = URL) {
    const formats = {
        preserve: {},
        v7: { version: 7, extendedOptions: 1 },
        v3: { version: 3, extendedOptions: 0 },
    };
    if (!Object.hasOwn(formats, format)) throw new Error("Unknown O3D export format");
    const data = writeO3D(model, formats[format]);
    const filename = `${wavefrontStem(model.name)}.o3d`;
    const href = url.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
    try {
        const link = documentObject.createElement("a");
        link.href = href;
        link.download = filename;
        link.click();
    } finally {
        setTimeout(() => url.revokeObjectURL(href), 1000);
    }
    return filename;
}
