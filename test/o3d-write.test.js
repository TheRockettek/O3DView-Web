import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseO3D } from "../src/o3d.js";
import { downloadO3D, writeO3D } from "../src/o3d-write.js";
import { loadScene } from "../src/scene.js";

function model() {
    return {
        vertices: new Float32Array([
            1, 2, 3, 0, 0, 1, 0.25, 0.5,
            4, 5, 6, 0, 0, 1, 0, 1,
            7, 8, 9, 0, 0, 1, 1, 0,
        ]),
        triangles: new Uint32Array([0, 1, 2, 0]),
        materials: [{ diffuse: [1, 0.5, 0.25, 1], spec: [1, 2, 3],
            emission: [4, 5, 6], specPower: 42, textureName: "é\u0080.bmp" }],
        o3dMetadata: { version: 3, extendedOptions: 0,
            bones: [{ name: "bé", weights: [{ index: 1, weight: 0.75 }] }] },
        transform: Float32Array.from({ length: 16 }, (_, i) => i + 0.5),
    };
}

for (const [version, extendedOptions] of [[3, 0], [7, 0], [7, 1]]) {
    test(`writes version ${version} with option ${extendedOptions} and preserves all sections`, () => {
        const source = model();
        const bytes = writeO3D(source, { version, extendedOptions });
        const parsed = parseO3D(bytes);
        assert.equal(parsed.version, version);
        assert.equal(parsed.extendedOptions, extendedOptions);
        assert.equal(parsed.encryptionKey, 0xffffffff);
        assert.deepEqual(parsed.vertices, source.vertices);
        assert.deepEqual(parsed.triangles, source.triangles);
        assert.deepEqual(parsed.materials, source.materials);
        assert.deepEqual(parsed.bones, source.o3dMetadata.bones);
        assert.deepEqual(parsed.transform, source.transform);
        assert.deepEqual([...new Uint8Array(bytes).slice(0, 3)], [0x84, 0x19, version]);
    });
}

test("scene loading retains O3D metadata and writing retains bones and material edits", async () => {
    const source = model();
    const bytes = writeO3D(source);
    const file = { name: "model.o3d", arrayBuffer: async () => bytes };
    const { models, warnings } = await loadScene([file], ["model.o3d"]);
    assert.equal(models.length, 1);
    assert.match(warnings.join("\n"), /skeletal animation/);
    assert.deepEqual(models[0].o3dMetadata, source.o3dMetadata);
    models[0].materials[0].diffuse[0] = 0.125;
    const saved = parseO3D(writeO3D(models[0]));
    assert.equal(saved.materials[0].diffuse[0], 0.125);
    assert.deepEqual(saved.bones, source.o3dMetadata.bones);
    assert.deepEqual(saved.transform, source.transform);
});

test("repository O3D fixtures round-trip geometry, materials, bones, and format metadata", () => {
    for (const name of ["player_standing.o3d", "player_sitting.o3d"]) {
        const bytes = readFileSync(new URL(`../../O3DView/O3DView/Resources/${name}`, import.meta.url));
        const original = parseO3D(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const source = { ...original, o3dMetadata: {
            version: original.version, extendedOptions: original.extendedOptions, bones: original.bones,
        } };
        assert.deepEqual(parseO3D(writeO3D(source)), original);
    }
});

test("long indices handle vertices beyond 65535; legacy and short-index options reject them", () => {
    const source = model();
    source.vertices = new Float32Array(65537 * 8);
    source.triangles = new Uint32Array([0, 1, 65536, 0]);
    assert.equal(parseO3D(writeO3D(source, { version: 7, extendedOptions: 1 })).triangles[2], 65536);
    assert.throws(() => writeO3D(source, { version: 7, extendedOptions: 0 }), /unrepresentable vertex/);
    assert.throws(() => writeO3D(source, { version: 3, extendedOptions: 0 }), /section count/);
});

test("invalid inputs fail without creating lossy files", () => {
    const source = model();
    assert.throws(() => writeO3D(source, { version: 3, extendedOptions: 1 }), /extended options/);
    assert.throws(() => writeO3D(source, { version: 256 }), /version/);
    source.materials[0].textureName = "😀.bmp";
    assert.throws(() => writeO3D(source), /Latin-1/);
    source.materials[0].textureName = "a".repeat(256);
    assert.throws(() => writeO3D(source), /Latin-1/);
    source.materials[0].textureName = "ok.bmp";
    source.materials[0].specPower = Infinity;
    assert.throws(() => writeO3D(source), /finite/);
    source.materials[0].specPower = 1;
    source.triangles[3] = 10;
    assert.throws(() => writeO3D(source), /invalid material/);
    source.triangles[3] = 0;
    source.o3dMetadata.bones[0].weights[0].index = 4;
    assert.throws(() => writeO3D(source), /bone references/);
});

test("downloads O3D and retains selected format and current material values", async () => {
    const source = model();
    source.name = "dir/vehicle model.o3d";
    const blobs = [], revoked = [], clicked = [];
    const url = {
        createObjectURL(blob) { blobs.push(blob); return "blob:test"; },
        revokeObjectURL(value) { revoked.push(value); },
    };
    const document = { createElement: () => ({ click() { clicked.push([this.href, this.download]); } }) };
    assert.equal(downloadO3D(source, "v7", document, url), "vehicle_model.o3d");
    assert.deepEqual(clicked, [["blob:test", "vehicle_model.o3d"]]);
    assert.equal(parseO3D(await blobs[0].arrayBuffer()).version, 7);
    assert.throws(() => downloadO3D(source, "bad", document, url), /Unknown/);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.deepEqual(revoked, ["blob:test"]);
});
