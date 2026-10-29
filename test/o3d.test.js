// Run with: node --experimental-default-type=module --test web/test/o3d.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseO3D } from "../src/o3d.js";

class Writer {
    bytes = [];
    u8(n) { this.bytes.push(n & 255); return this; }
    u16(n) { return this.u8(n).u8(n >>> 8); }
    u32(n) { return this.u16(n).u16(n >>> 16); }
    f32(n) {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, n, true);
        for (let i = 0; i < 4; i++) this.u8(view.getUint8(i));
        return this;
    }
    str(...bytes) { this.u8(bytes.length); for (const byte of bytes) this.u8(byte); return this; }
    buffer() { return Uint8Array.from(this.bytes).buffer; }
}

function header(version = 3, options = 0, key = 0xffffffff) {
    const w = new Writer().u16(0x1984).u8(version);
    if (version > 3) w.u8(options).u32(key);
    return w;
}

function fixture(version, longIndices, legacyLongCounts = false) {
    const w = header(version, longIndices ? 1 : 0);
    if (legacyLongCounts) w.u8(0);
    const count = (n) => version > 3 || legacyLongCounts ? w.u32(n) : w.u16(n);
    const index = (n) => longIndices ? w.u32(n) : w.u16(n);
    w.u8(0x17); count(1);
    for (const value of [1, 2, 3, -1, -2, -3, 0.25, 0.5]) w.f32(value);
    w.u8(0x49); count(1);
    index(longIndices ? 70000 : 123); index(1); index(2); w.u16(321);
    w.u8(0x26).u16(1);
    for (let i = 1; i <= 11; i++) w.f32(i);
    w.str(0x41, 0x80, 0xe9, 0xff);
    w.u8(0x54); count(1);
    w.str(0x42, 0x80).u16(2);
    index(longIndices ? 80000 : 456); w.f32(0.25);
    index(7); w.f32(0.75);
    w.u8(0x79);
    for (let i = 0; i < 16; i++) w.f32(i + 0.5);
    return w.buffer();
}

for (const [version, longIndices, legacyLongCounts] of [[3, false, false], [3, false, true], [7, false, false], [7, true, false]]) {
    test(`reads version ${version} with ${longIndices ? "long" : "short"} indices${legacyLongCounts ? " and legacy long counts" : ""}`, () => {
        const model = parseO3D(fixture(version, longIndices, legacyLongCounts));
        assert.equal(model.version, version);
        assert.equal(model.extendedOptions, longIndices ? 1 : 0);
        assert.equal(model.encryptionKey, 0xffffffff);
        assert.ok(model.vertices instanceof Float32Array);
        assert.deepEqual([...model.vertices], [1, 2, 3, -1, -2, -3, 0.25, 0.5]);
        assert.ok(model.triangles instanceof Uint32Array);
        assert.deepEqual([...model.triangles], [longIndices ? 70000 : 123, 1, 2, 321]);
        assert.deepEqual(model.materials, [{
            diffuse: [1, 2, 3, 4], spec: [5, 6, 7], emission: [8, 9, 10],
            specPower: 11, textureName: "A\u0080éÿ",
        }]);
        assert.deepEqual(model.bones, [{
            name: "B\u0080", weights: [
                { index: longIndices ? 80000 : 456, weight: 0.25 },
                { index: 7, weight: 0.75 },
            ],
        }]);
        assert.ok(model.transform instanceof Float32Array);
        assert.deepEqual([...model.transform], Array.from({ length: 16 }, (_, i) => i + 0.5));
    });
}

test("missing sections use original defaults, and repeated sections replace earlier values", () => {
    const empty = parseO3D(header().buffer());
    assert.deepEqual([...empty.vertices], []);
    assert.deepEqual([...empty.triangles], []);
    assert.deepEqual(empty.materials, []);
    assert.deepEqual(empty.bones, []);
    assert.deepEqual([...empty.transform], Array(16).fill(0));
    const w = header().u8(0x17).u16(1);
    for (let i = 0; i < 8; i++) w.f32(i);
    w.u8(0x17).u16(0);
    assert.equal(parseO3D(w.buffer()).vertices.length, 0);
});

test("rejects invalid input, header, encryption, and unknown sections", () => {
    assert.throws(() => parseO3D(new Uint8Array(4)), /ArrayBuffer/);
    assert.throws(() => parseO3D(new ArrayBuffer(0)), /truncated header/);
    assert.throws(() => parseO3D(new Writer().u16(0).u8(3).buffer()), /invalid header/);
    assert.throws(() => parseO3D(header(7, 0, 0).buffer()), /encrypted/);
    assert.throws(() => parseO3D(header().u8(0xee).buffer()), /unknown section 0xee at offset 0x3/);
});

test("rejects excessive counts before allocation", () => {
    for (const section of [0x17, 0x49, 0x54]) {
        assert.throws(() => parseO3D(header(7).u8(section).u32(1_000_001).buffer()), /excessive/);
    }
    assert.throws(() => parseO3D(header().u8(0x26).u16(10_001).buffer()), /excessive/);
});

test("rejects truncated headers, section payloads, strings, and weights", () => {
    for (const bytes of [
        new Writer().u8(0x84).buffer(),
        new Writer().u16(0x1984).buffer(),
        header().u8(0x17).u8(1).buffer(),
        header(7).u8(0x17).u32(1).buffer(),
        header().u8(0).u8(0x17).u16(1).buffer(),
        header().u8(0x49).u16(1).u16(1).buffer(),
        header().u8(0x79).f32(1).buffer(),
        header().u8(0x26).u16(1).buffer(),
        header().u8(0x54).u16(1).u8(4).u8(65).u8(66).buffer(),
        header().u8(0x54).u16(1).str().u16(1).u16(0).buffer(),
    ]) assert.throws(() => parseO3D(bytes), /truncated/);

    const material = header().u8(0x26).u16(1);
    for (let i = 0; i < 11; i++) material.f32(0);
    material.u8(2).u8(65);
    assert.throws(() => parseO3D(material.buffer()), /truncated texture name/);
    assert.throws(() => parseO3D(header(7, 1).u8(0x54).u32(1).str().u16(1).u32(4).buffer()), /truncated weights/);
    for (let length = 3; length < 8; length++) {
        assert.throws(() => parseO3D(header(7).buffer().slice(0, length)), /truncated/);
    }
});

for (const name of ["player_standing.o3d", "player_sitting.o3d"]) {
    const path = new URL(`../../O3DView/O3DView/Resources/${name}`, import.meta.url);
    test(`parses repository sample ${name} when available`, { skip: !existsSync(path) }, () => {
        const bytes = readFileSync(path);
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const model = parseO3D(arrayBuffer);
        assert.ok(model.vertices.length > 0 && model.vertices.length % 8 === 0);
        assert.ok(model.triangles.length > 0 && model.triangles.length % 4 === 0);
        assert.ok(model.materials.length > 0);
        for (let i = 0; i < model.triangles.length; i += 4) {
            for (let j = 0; j < 3; j++) assert.ok(model.triangles[i + j] < model.vertices.length / 8);
            assert.ok(model.triangles[i + 3] < model.materials.length);
        }
    });
}
