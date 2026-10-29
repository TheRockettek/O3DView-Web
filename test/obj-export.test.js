import test from "node:test";
import assert from "node:assert/strict";
import { exportWavefront, downloadWavefront, wavefrontStem, combineSceneModels } from "../src/obj-export.js";
import { parseOBJ, parseMTL } from "../src/obj.js";

function model() {
    return {
        name: "models/My bus.o3d",
        vertices: new Float32Array([
            1, 2, 3, 1, 0, 0, .25, .75,
            4, 2, 3, 0, 1, 0, 1, 0,
            1, 5, 3, 0, 0, 1, 0, 1,
            2, 6, 3, 0, 0, 1, .5, .5,
        ]),
        triangles: new Uint32Array([0, 1, 2, 1, 1, 3, 2, 0, 0, 2, 3, 1]),
        materials: [
            { diffuse: [.1, .2, .3, .5], spec: [.4, .5, .6], emission: [.7, .8, .9], specPower: 1200, textureName: "foo\\red car.png" },
            { diffuse: [1, 1, 1, 1], spec: [0, 0, 0], emission: [0, 0, 0], specPower: 4, textureName: "" },
        ],
        transform: new Float32Array(16).fill(100),
    };
}

test("exports desktop coordinates, UVs, winding, material switches and edited values", () => {
    const source = model();
    source.materials[1].diffuse = [.8, .7, .6, .25];
    const { obj, mtl, objName, mtlName } = exportWavefront(source);
    assert.equal(objName, "My_bus.obj");
    assert.equal(mtlName, "My_bus.mtl");
    assert.match(obj, /mtllib My_bus\.mtl\ns 0/);
    assert.match(obj, /v -1 2 3\nv -4 2 3/);
    assert.match(obj, /vt 0\.25 0\.25/);
    assert.match(obj, /vn -1 0 0/);
    assert.match(obj, /g matl_1\nusemtl matl_1\nf 3\/3\/3 2\/2\/2 1\/1\/1/);
    assert.match(obj, /g matl_0\nusemtl matl_0\nf 3\/3\/3 4\/4\/4 2\/2\/2/);
    assert.equal((obj.match(/usemtl matl_1/g) || []).length, 2);
    assert.match(mtl, /Ka 0\.1 0\.2 0\.3\nKd 0\.1 0\.2 0\.3\nKs 0\.4 0\.5 0\.6\nNs 1000\nKe 0\.7 0\.8 0\.9\nd 0\.5\nTr 0\.5\nillum 2\nmap_Kd texture\/red car\.png/);
    assert.match(mtl, /Kd 0\.8 0\.7 0\.6/);
    assert.match(mtl, /d 0\.25\nTr 0\.75/);
    assert.doesNotMatch(obj, /100 100/);
    assert.deepEqual([...source.triangles], [0, 1, 2, 1, 1, 3, 2, 0, 0, 2, 3, 1]);
});

test("exported pair can be imported with original geometry and material associations", () => {
    const source = model();
    const { obj, mtl } = exportWavefront(source);
    const result = parseOBJ(obj, { materials: parseMTL(mtl) });
    const triangles = mesh => Array.from({ length: mesh.triangles.length / 4 }, (_, n) => {
        const [a, b, c, material] = mesh.triangles.slice(n * 4, n * 4 + 4);
        return {
            vertices: [a, b, c].map(index => Array.from(mesh.vertices.slice(index * 8, index * 8 + 8), value => value === 0 ? 0 : value)),
            diffuse: mesh.materials[material].diffuse,
        };
    });
    assert.deepEqual(triangles(result), triangles(source));
    assert.equal(result.materials[result.materialNames.indexOf("matl_0")].textureName, "texture/red car.png");
});

test("combines all scene model occurrences with independent indices and material slots", () => {
    const first = model(), second = model();
    second.vertices = new Float32Array(second.vertices);
    for (let i = 0; i < second.vertices.length; i += 8) second.vertices[i] += 10;
    second.materials[0].diffuse = [.9, .8, .7, 1];
    second.materials[0].repaintTextureName = "repaints/blue.png";
    const combined = combineSceneModels([first, second]);
    assert.equal(combined.name, "scene.obj");
    assert.deepEqual([...combined.triangles.slice(12, 16)], [4, 5, 6, 3]);
    assert.equal(combined.materials.length, 4);
    const { obj, mtl, objName, mtlName } = exportWavefront(combined);
    assert.equal(objName, "scene.obj");
    assert.equal(mtlName, "scene.mtl");
    assert.equal(exportWavefront(combineSceneModels([first], "group.obj")).objName, "group.obj");
    assert.match(obj, /v -11 2 3/);
    assert.match(obj, /usemtl matl_3\nf 7\/7\/7 6\/6\/6 5\/5\/5/);
    assert.match(mtl, /newmtl matl_2[\s\S]*map_Kd texture\/blue\.png/);
    const imported = parseOBJ(obj, { materials: parseMTL(mtl) });
    assert.equal(imported.triangles.length, 24);
    assert.equal(first.vertices[0], 1);
    assert.equal(second.triangles[0], 0);
    assert.throws(() => combineSceneModels([]), /No scene models/);
    second.triangles[0] = 4;
    assert.throws(() => combineSceneModels([first, second]), /invalid vertex or material/);
});

test("supports empty models, safe names and texture paths", () => {
    assert.equal(wavefrontStem("a/../ä?.obj"), "model");
    const empty = exportWavefront({ name: "", vertices: new Float32Array(), triangles: new Uint32Array(), materials: [] });
    assert.equal(empty.objName, "model.obj");
    assert.equal(parseOBJ(empty.obj).triangles.length, 0);
    const source = model();
    source.materials[0].textureName = "../../evil#name\n.png";
    assert.match(exportWavefront(source).mtl, /map_Kd texture\/evil_name_\.png\n/);
});

test("exports large vertex arrays without exceeding argument limits", () => {
    const source = { name: "large.o3d", vertices: new Float32Array(150000 * 8), triangles: new Uint32Array(), materials: [] };
    const result = exportWavefront(source);
    assert.equal((result.obj.match(/^v /gm) || []).length, 150000);
});

test("rejects malformed or non-finite data instead of creating broken files", () => {
    assert.throws(() => exportWavefront(null), /Invalid model arrays/);
    const source = model();
    source.triangles[0] = 9;
    assert.throws(() => exportWavefront(source), /invalid vertex or material/);
    source.triangles[0] = 0;
    source.triangles[3] = 9;
    assert.throws(() => exportWavefront(source), /invalid vertex or material/);
    source.triangles[3] = 1;
    source.vertices[0] = NaN;
    assert.throws(() => exportWavefront(source), /finite/);
    source.vertices[0] = 1;
    source.materials[0].spec = [1, 2];
    assert.throws(() => exportWavefront(source), /specular must have 3/);
    source.materials[0].spec = [1, Infinity, 2];
    assert.throws(() => exportWavefront(source), /finite/);
});

test("download creates a correctly named blob and revokes its URL even when clicking fails", async () => {
    const created = [], revoked = [], clicked = [];
    const url = {
        createObjectURL(blob) { created.push(blob); return `blob:${created.length}`; },
        revokeObjectURL(href) { revoked.push(href); },
    };
    const document = { createElement: () => ({ click() { clicked.push([this.href, this.download]); } }) };
    assert.equal(downloadWavefront(model(), "obj", document, url), "My_bus.obj");
    assert.equal(downloadWavefront(model(), "mtl", document, url), "My_bus.mtl");
    assert.deepEqual(clicked, [["blob:1", "My_bus.obj"], ["blob:2", "My_bus.mtl"]]);
    assert.match(await created[0].text(), /mtllib My_bus\.mtl/);
    assert.match(await created[1].text(), /newmtl matl_0/);
    const broken = { createElement: () => ({ click() { throw new Error("blocked"); } }) };
    assert.throws(() => downloadWavefront(model(), "obj", broken, url), /blocked/);
    assert.throws(() => downloadWavefront(model(), "wrong", document, url), /Unknown/);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.deepEqual(revoked, ["blob:1", "blob:2", "blob:3"]);
});
