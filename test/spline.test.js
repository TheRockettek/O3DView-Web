import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSplineProfile,
  parseScoPaths,
  generateSplineMesh,
} from "../src/spline.js";
import { loadScene } from "../src/scene.js";
import { writeO3D } from "../src/o3d-write.js";
import { parseO3D } from "../src/o3d.js";
import { exportWavefront } from "../src/obj-export.js";
import { generatePlacedSplineGeometry } from "../src/spline-edit.js";

const profileText = [
  "[texture]",
  "road.bmp",
  "[profile]",
  "0",
  "[profilepnt]",
  "-1",
  "0",
  "0",
  "0.5",
  "[profilepnt]",
  "1",
  "0",
  "1",
  "0.5",
].join("\n");
const spline = {
  length: 2,
  radius: 0,
  gradStart: 0,
  gradEnd: 0,
  useDeltaHeight: false,
  deltaHeight: null,
  cantStart: 0,
  cantEnd: 0,
  skewStart: 0,
  skewEnd: 0,
  mirror: false,
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test("parses texture indices and profile points and diagnoses invalid input", () => {
  const result = parseSplineProfile(profileText);
  assert.deepEqual(result.textures, ["road.bmp"]);
  assert.deepEqual(result.profiles[0].points, [
    { x: -1, height: 0, u: 0, v: 0.5 },
    { x: 1, height: 0, u: 1, v: 0.5 },
  ]);
  assert.deepEqual(result.warnings, []);
  assert.throws(
    () =>
      parseSplineProfile(profileText.replace("[profile]\n0", "[profile]\n1")),
    /missing texture/,
  );
  assert.throws(
    () =>
      parseSplineProfile(
        "[texture]\na\n[profile]\n0\n[profilepnt]\n0\n0\n0\n0",
      ),
    /at least two/,
  );
  assert.throws(
    () => parseSplineProfile("-<DISABLED>-\n" + profileText),
    /no profiles/,
  );
});

test("keeps usable spline strips when other profiles cannot be rendered", () => {
  const malformed = [
    "[texture]",
    "road.bmp",
    "[profile]",
    "0",
    "[profilepnt]",
    "0",
    "0",
    "0",
    "0",
    "[profile]",
    "1",
    "[profilepnt]",
    "-1",
    "0",
    "0",
    "1",
    "[profilepnt]",
    "1",
    "0",
    "1",
    "1",
    "[profile]",
    "0",
    "[profilepnt]",
    "-1",
    "0",
    "0",
    "0.5",
    "[profilepnt]",
    "1",
    "0",
    "1",
    "0.5",
  ].join("\n");
  const result = parseSplineProfile(malformed);
  assert.equal(result.profiles.length, 1);
  assert.match(result.warnings.join("\n"), /needs at least two points/);
  assert.match(result.warnings.join("\n"), /missing texture 1/);
  assert.deepEqual(
    generateSplineMesh(spline, result).triangles,
    generateSplineMesh(spline, parseSplineProfile(profileText)).triangles,
  );
});

test("generates desktop straight strips and mirror winding with longitudinal UVs", () => {
  const profile = parseSplineProfile(profileText);
  const mesh = generateSplineMesh(spline, profile);
  assert.equal(mesh.vertices.length, 6 * 8);
  assert.deepEqual([...mesh.vertices.slice(0, 8)], [-1, 0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual([...mesh.vertices.slice(32, 40)], [-1, 0, 2, 0, 1, 0, 0, 1]);
  assert.deepEqual([...mesh.triangles.slice(0, 8)], [0, 3, 1, 0, 0, 2, 3, 0]);
  const mirror = generateSplineMesh({ ...spline, mirror: true }, profile);
  assert.equal(mirror.vertices[0], 1);
  assert.deepEqual([...mirror.triangles.slice(0, 8)], [1, 3, 0, 0, 3, 2, 0, 0]);
});

test("rebuilds spline geometry with edited width and independent map placement", () => {
  const profile = parseSplineProfile(profileText);
  const placement = {
    ...spline,
    position: { x: 10, y: 2, z: 3 },
    heading: 90,
  };
  const original = generatePlacedSplineGeometry(placement, profile);
  const edited = generatePlacedSplineGeometry(
    { ...placement, width: 2, length: 4 },
    profile,
  );
  const withMapPlacement = generatePlacedSplineGeometry(
    { ...placement, width: 2, length: 4 },
    profile,
    { position: { x: 5, y: 1, z: 2 }, heading: 0 },
  );
  assert.notDeepEqual(edited.vertices, original.vertices);
  assert.equal(edited.vertices[1], original.vertices[1]);
  assert.equal(withMapPlacement.vertices[0], edited.vertices[0] + 5);
  assert.equal(withMapPlacement.vertices[1], edited.vertices[1] + 1);
  assert.equal(withMapPlacement.vertices[2], edited.vertices[2] + 2);
  assert.deepEqual(withMapPlacement.triangles, edited.triangles);
});

test("curves, gradient, cant and skew affect endpoints and UVs", () => {
  const profile = parseSplineProfile(profileText);
  const curve = generateSplineMesh(
    { ...spline, length: Math.PI * 5, radius: 10, gradStart: 10, gradEnd: 10 },
    profile,
  );
  const end = curve.vertices.length - 16;
  near(curve.vertices[end], 10);
  near(curve.vertices[end + 1], Math.PI / 2);
  near(curve.vertices[end + 2], 11);
  const skew = generateSplineMesh(
    { ...spline, cantStart: 100, cantEnd: 100, skewStart: 0.5, skewEnd: 0.5 },
    profile,
  );
  near(skew.vertices[0], -Math.SQRT1_2 - 0.5 * Math.SQRT1_2);
  near(skew.vertices[1], Math.SQRT1_2 - 0.5 * Math.SQRT1_2);
  near(skew.vertices[7], -0.25);
  const height = generateSplineMesh(
    { ...spline, useDeltaHeight: true, deltaHeight: 3 },
    profile,
  );
  near(height.vertices[height.vertices.length - 15], 3);
  assert.equal(
    generateSplineMesh({ ...spline, length: 0 }, profile).vertices.length,
    0,
  );
  assert.throws(
    () => generateSplineMesh({ ...spline, length: -1 }, profile),
    /Invalid spline geometry/,
  );
  assert.throws(
    () => generateSplineMesh({ ...spline, length: 1e9 }, profile),
    /too many/,
  );
});

test("map splines resolve profiles and textures and preserve separate placements", async () => {
  const file = (name, data) => ({
    name: name.split("/").pop(),
    webkitRelativePath: name,
    arrayBuffer: async () => new TextEncoder().encode(data).buffer,
  });

  const placement = (id, x) => [
    "[spline]",
    "0",
    "Splines\\road.sli",
    String(id),
    "0",
    "0",
    String(x),
    "2",
    "3",
    "0",
    "2",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "",
  ];
  const map = [
    "[version]",
    "14",
    ...placement(1, 10),
    ...placement(2, 20),
    ...placement(3, 30).map((line) =>
      line === "Splines\\road.sli" ? "Splines\\missing.sli" : line,
    ),
  ].join("\n");
  let decoded = 0;
  const bitmap = { close() {} };
  const result = await loadScene(
    [
      file("OMSI/Maps/a.map", map),
      file("OMSI/Splines/road.sli", `${profileText}\n[profile]\n4\n`),
      file("OMSI/Splines/texture/road.bmp", "data"),
    ],
    ["OMSI/Maps/a.map"],
    {
      decodeTexture: async () => {
        decoded++;
        return { bitmap, hasAlpha: false };
      },
    },
  );
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].vertices[0], 9);
  assert.equal(result.models[0].vertices[1], 2);
  assert.equal(result.models[0].vertices[2], 3);
  assert.equal(result.models[1].vertices[0], 19);
  assert.equal(result.models[0].materials[0].texture, bitmap);
  assert.equal(result.models[0].splineSource.profile.profiles.length, 1);
  assert.equal(result.models[0].splineSource.mapPlacement, null);
  assert.equal(result.models[0].gizmoVisible, true);
  assert.equal(parseO3D(writeO3D(result.models[0])).vertices[0], 9);
  assert.match(exportWavefront(result.models[0]).obj, /v -9 2 3/);
  assert.equal(decoded, 1);
  assert.match(result.warnings.join("\n"), /road\.sli:.*missing texture 4/);
  assert.match(result.warnings.join("\n"), /Missing map spline.*missing.sli/);
});

test("SCO paths parse variants and generate width-scaled geometry", () => {
  const text = [
    "[path]",
    "1",
    "2",
    "3",
    "90",
    "0",
    "2",
    "0",
    "0",
    "1",
    "6",
    "0",
    "0",
    "[path_2]",
    "0",
    "0",
    "0",
    "0",
    "0",
    "4",
    "0",
    "0",
    "0",
    "3",
    "1",
    "2",
    "10",
    "20",
    "[path]",
    "bad",
    "[mesh]",
    "example.o3d",
  ].join("\n");
  const result = parseScoPaths(text);
  assert.equal(result.paths.length, 2);
  assert.deepEqual(result.paths[0].position, { x: 1, y: 3, z: 2 });
  assert.equal(result.paths[0].width, 2);
  assert.deepEqual(
    [result.paths[1].cantStart, result.paths[1].cantEnd],
    [10, 20],
  );
  assert.match(result.warnings.join("\n"), /missing fields/);
  const generated = generateSplineMesh(
    result.paths[0],
    parseSplineProfile(profileText),
  );
  assert.equal(generated.vertices[0], -2);
  assert.equal(parseScoPaths("-<DISABLED>-\n" + text).paths.length, 0);
});

test("SCO paths use sidewalk profiles and compose map placements", async () => {
  const file = (name, data) => ({
    name: name.split("/").pop(),
    webkitRelativePath: name,
    arrayBuffer: async () => new TextEncoder().encode(data).buffer,
  });
  const path = [
    "[path]",
    "1",
    "2",
    "3",
    "90",
    "0",
    "2",
    "0",
    "0",
    "1",
    "6",
    "0",
    "0",
  ].join("\n");
  const map = [
    "[version]",
    "14",
    "[object]",
    "0",
    "Sceneryobjects\\Thing\\a.sco",
    "1",
    "10",
    "30",
    "20",
    "90",
    "0",
    "0",
    "0",
  ].join("\n");
  const result = await loadScene(
    [
      file("OMSI/Maps/a.map", map),
      file("OMSI/Sceneryobjects/Thing/a.sco", path),
      file("OMSI/Splines/invis_sidewalk.sli", profileText),
    ],
    ["OMSI/Maps/a.map"],
  );
  assert.equal(result.models.length, 1);
  const model = result.models[0];
  assert.equal(model.pathSource, "OMSI/Sceneryobjects/Thing/a.sco");
  near(model.vertices[0], 14);
  near(model.vertices[1], 23);
  near(model.vertices[2], 29);
  assert.match(result.warnings.join("\n"), /texture "road.bmp" not found/);
  assert.doesNotMatch(
    result.warnings.join("\n"),
    /unsupported\/ignored tags:.*\[path\]/,
  );
});
