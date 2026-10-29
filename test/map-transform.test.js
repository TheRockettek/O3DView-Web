import test from "node:test";
import assert from "node:assert/strict";
import { placeMapVertices, placeMapLight } from "../src/map-transform.js";
import { loadScene } from "../src/scene.js";

test("map placement reflects positions and rotates normals without mutating geometry", () => {
  const source = new Float32Array([1, 2, 3, 1, 0, 0, 0.25, 0.5]);
  const placement = { position: { x: 10, y: 20, z: 30 }, heading: 90 };
  const result = placeMapVertices(source, placement);
  assert.ok(Math.abs(result[0] - 13) < 1e-6);
  assert.equal(result[1], 22);
  assert.equal(result[2], 29);
  assert.ok(Math.abs(result[3]) < 1e-6);
  assert.equal(result[5], -1);
  assert.deepEqual([...source], [1, 2, 3, 1, 0, 0, 0.25, 0.5]);
  const light = placeMapLight({ position: [1, 2, 3] }, placement);
  assert.ok(Math.abs(light.position[0] + 13) < 1e-6);
  assert.equal(light.position[1], 22);
  assert.equal(light.position[2], 31);
});

test("map scene loads repeated placed scenery and transforms lights independently", async () => {
  const file = (name, text) => ({
    name: name.split("/").pop(),
    webkitRelativePath: name,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  });
  const obj = "v 1 0 0\nv 2 0 0\nv 1 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n";
  const sco =
    "[LOD]\n0.2\n[mesh]\npart.obj\n[interiorlight]\nlamp\n1\n255\n0\n0\n1\n3\n2\n";
  const record = (x, heading) => [
    "[object]",
    "0",
    "Sceneryobjects\\Trees\\tree.sco",
    "1",
    String(x),
    "30",
    "20",
    String(heading),
    "0",
    "0",
    "0",
  ];
  const map = [
    "[version]",
    "14",
    ...record(10, 90),
    ...record(50, 0),
    "[object]",
    "0",
    "Sceneryobjects\\missing.sco",
    "2",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
  ].join("\n");
  const result = await loadScene(
    [
      file("OMSI/Maps/demo/tile.map", map),
      file("OMSI/Sceneryobjects/Trees/tree.sco", sco),
      file("OMSI/Sceneryobjects/Trees/model/part.obj", obj),
    ],
    ["OMSI/Maps/demo/tile.map"],
  );
  assert.equal(result.models.length, 2);
  assert.equal(result.lods.length, 2);
  assert.notEqual(result.lods[0], result.lods[1]);
  assert.equal(result.models[0].lod, result.lods[0]);
  assert.equal(result.models[1].lod, result.lods[1]);
  const first = result.models[0].vertices,
    second = result.models[1].vertices;
  assert.ok(Math.abs(first[0] - 10) < 1e-6);
  assert.equal(first[1], 20);
  assert.equal(first[2], 31);
  assert.equal(second[0], 49);
  assert.equal(second[1], 20);
  assert.equal(second[2], 30);
  assert.equal(result.lights.length, 2);
  const root = result.hierarchy[0];
  assert.equal(root.type, "map");
  assert.deepEqual(
    root.children.map((node) => node.type),
    ["configuration", "configuration"],
  );
  assert.notEqual(root.children[0], root.children[1]);
  assert.equal(root.children[0].mapPlacement.position.x, 10);
  assert.equal(root.children[1].mapPlacement.position.x, 50);
  assert.deepEqual(
    root.children.map((node) => node.children[0].children[0].modelIndex),
    [0, 1],
  );
  assert.deepEqual(
    root.children.map((node) => node.children[1].children[0].lightIndex),
    [0, 1],
  );
  assert.deepEqual(result.lights[0].position, [-13, 22, 31]);
  assert.deepEqual(result.lights[1].position, [-49, 22, 33]);
  assert.match(result.warnings.join("\n"), /Missing map object.*missing\.sco/);
});
