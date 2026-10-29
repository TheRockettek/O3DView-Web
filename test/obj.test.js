import test from "node:test";
import assert from "node:assert/strict";
import { parseOBJ, parseMTL } from "../src/obj.js";

const triangle = `v 0 0 0
v 1 0 0
v 0 1 0`;

test("reflects X, flips V and reverses winding like the desktop reader", () => {
  const model = parseOBJ(`${triangle}
vt .25 .75
vt 1 0
vt 0 1
vn 1 2 3
f 1/1/1 2/2/1 3/3/1`);
  assert.ok(model.vertices instanceof Float32Array);
  assert.deepEqual(
    [...model.vertices],
    [
      -0, 0, 0, -1, 2, 3, 0.25, 0.25, -1, 0, 0, -1, 2, 3, 1, 1, -0, 1, 0, -1, 2,
      3, 0, 0,
    ],
  );
  assert.ok(model.triangles instanceof Uint32Array);
  assert.deepEqual([...model.triangles], [2, 1, 0, 0]);
  assert.deepEqual(model.materialNames, [null]);
  assert.deepEqual(model.materials, [
    {
      diffuse: [1, 1, 1, 1],
      spec: [0, 0, 0],
      emission: [0, 0, 0],
      specPower: 8,
      textureName: "",
    },
  ]);
  assert.deepEqual(
    [...model.transform],
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  );
});

test("relative indices resolve when each face is read and tuple seams split vertices", () => {
  const model = parseOBJ(`${triangle}
vt 0 0
vt 1 0
vn 0 0 1
f -3/-2/-1 -2/-1/-1 -1/-2/-1
v 2 2 0
f 1/2/1 2/2/1 3/1/1
f -4//-1 -3//-1 -2//-1`);
  assert.deepEqual([...model.triangles], [2, 1, 0, 0, 2, 1, 3, 0, 6, 5, 4, 0]);
  assert.equal(model.vertices.length / 8, 7);
  assert.deepEqual([...model.vertices.slice(4 * 8 + 6, 4 * 8 + 8)], [0, 0]);
});

test("generates flat normals, including mixed explicit and missing normals", () => {
  const model = parseOBJ(`${triangle}
v 0 0 1
vn 0 0 2
f 1//1 2 3
f 1 4 2`);
  assert.deepEqual([...model.vertices.slice(3, 6)], [-0, 0, 2]);
  assert.deepEqual([...model.vertices.slice(11, 14)], [-0, -0, 1]);
  assert.deepEqual([...model.vertices.slice(27, 30)], [-0, 1, -0]);
  assert.equal(model.vertices.length / 8, 6);
});

test("triangulates concave polygons with correct area, winding, and material", () => {
  const model = parseOBJ(`v 0 0 0
v 2 0 0
v 2 2 0
v 1 1 0
v 0 2 0
usemtl concave
f 1 2 3 4 5`);
  assert.equal(model.triangles.length, 12);
  let area = 0;
  for (let i = 0; i < model.triangles.length; i += 4) {
    const [a, b, c, mat] = model.triangles.slice(i, i + 4);
    const v = model.vertices;
    const cross =
      (v[b * 8] - v[a * 8]) * (v[c * 8 + 1] - v[a * 8 + 1]) -
      (v[b * 8 + 1] - v[a * 8 + 1]) * (v[c * 8] - v[a * 8]);
    assert.ok(cross > 0);
    assert.equal(mat, 0);
    area += cross / 2;
  }
  assert.equal(area, 3);
  assert.equal(model.materialNames[0], "concave");
});

test("triangulates quads on different planes and in either winding", () => {
  for (const [coordinates, normal] of [
    ["v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0", [0, 0, 1]],
    ["v 0 0 0\nv 0 1 0\nv 0 1 1\nv 0 0 1", [-1, 0, 0]],
    ["v 0 0 0\nv 0 0 1\nv 1 0 1\nv 1 0 0", [0, 1, 0]],
  ]) {
    for (const [order, sign] of [
      ["1 2 3 4", 1],
      ["4 3 2 1", -1],
    ]) {
      const model = parseOBJ(`${coordinates}\nf ${order}`);
      assert.equal(model.triangles.length, 8);
      for (let j = 0; j < 3; j++)
        assert.equal(Math.abs(model.vertices[3 + j] - normal[j] * sign), 0);
    }
  }
});

test("parses MTL, resolves usemtl and returns library names without loading files", () => {
  const lib = parseMTL(`# comment
newmtl Shiny metal
Kd .1 .2 .3
Ks .4 .5 .6
Ke 0 .1 .2
Ns 123
d .8
Tr .25
map_Kd textures/metal plate.png
newmtl other
map_Kd other.png`);
  assert.deepEqual(lib.get("Shiny metal"), {
    diffuse: [0.1, 0.2, 0.3, 0.75],
    spec: [0.4, 0.5, 0.6],
    emission: [0, 0.1, 0.2],
    specPower: 123,
    textureName: "textures/metal plate.png",
  });
  const model = parseOBJ(
    `mtllib a.mtl b.mtl
${triangle}
f 1 2 3
usemtl Shiny metal
f 1 2 3
usemtl other
f 1 2 3
usemtl missing
f 1 2 3`,
    { materials: lib },
  );
  assert.deepEqual(model.materialLibraries, ["a.mtl", "b.mtl"]);
  assert.deepEqual(model.materialNames, [
    null,
    "Shiny metal",
    "other",
    "missing",
  ]);
  assert.deepEqual(
    [...model.triangles].filter((_, i) => i % 4 === 3),
    [0, 1, 2, 3],
  );
  assert.deepEqual(model.materials[1], lib.get("Shiny metal"));
  assert.notEqual(model.materials[1].diffuse, lib.get("Shiny metal").diffuse);
  assert.match(model.warnings.join("\n"), /missing.*not provided/);
});

test("accepts comments, whitespace, exponent notation, and reports unsupported features", () => {
  const model = parseOBJ(
    "\t# comment\r\nv 0 0 0 # position\r\nv 1e0 0 0\r\nv 0 1 0\r\ns 1\r\ns 2\r\nl 1 2\r\nl 2 3\r\nf 1 2 3",
  );
  assert.equal(model.warnings.length, 2);
  assert.match(model.warnings[0], /smoothing/);
  assert.match(model.warnings[1], /unsupported 'l'/);
  const lib = parseMTL("newmtl x\nmap_Kd -s 1 1 1 a.png\nKa 1 1 1\n");
  assert.equal(lib.get("x").textureName, "");
  assert.equal(lib.warnings.length, 2);
});

test("empty input creates a valid empty model", () => {
  const model = parseOBJ("");
  assert.equal(model.vertices.length, 0);
  assert.equal(model.triangles.length, 0);
  assert.equal(model.materials.length, 1);
  assert.deepEqual(model.warnings, []);
});

test("rejects malformed or out-of-range OBJ records with line numbers", () => {
  for (const [input, pattern] of [
    ["v 1 2", /line 1.*components/],
    ["vn 1 2 3 4", /line 1.*components/],
    ["vt 0 NaN", /line 1.*invalid number/],
    ["v 1e100 0 0", /line 1.*out of range/],
    ["v 0x10 0 0", /line 1.*invalid number/],
    [`${triangle}\nf 1 2`, /line 4.*at least three/],
    [`${triangle}\nf 0 2 3`, /line 4.*position.*range/],
    [`${triangle}\nf -4 2 3`, /line 4.*position.*range/],
    [`${triangle}\nf 1/1 2 3`, /line 4.*UV.*range/],
    [`${triangle}\nf 1//1 2 3`, /line 4.*normal.*range/],
    [`${triangle}\nf 1/ 2 3`, /line 4.*invalid face/],
    [`${triangle}\nf 1/1/1/1 2 3`, /line 4.*invalid face/],
    [`${triangle}\nf 1 1 1`, /line 4.*degenerate/],
    ["v 0 0 0\nv 3 3 0\nv 0 3 0\nv 2 0 0\nf 1 2 3 4", /line 5.*non-simple/],
    ["usemtl", /line 1.*missing material/],
    ["mtllib", /line 1.*missing material/],
  ])
    assert.throws(() => parseOBJ(input), pattern, input);
  assert.throws(() => parseOBJ(null), /expected a string/);
  assert.throws(() => parseOBJ("", { materials: {} }), /must be a Map/);
});

test("rejects malformed MTL, duplicates and material properties before newmtl", () => {
  for (const input of [
    "newmtl",
    "Kd 1 1 1",
    "newmtl x\nKd 1 2",
    "newmtl x\nNs 1 2",
    "newmtl x\nmap_Kd",
    "newmtl x\nnewmtl x",
    "newmtl x\nd Infinity",
  ]) {
    assert.throws(() => parseMTL(input), /MTL: line \d+:/, input);
  }
  assert.throws(() => parseMTL(5), /expected a string/);
});
