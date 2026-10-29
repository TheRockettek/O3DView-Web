import test from "node:test";
import assert from "node:assert/strict";
import { parseMapTile } from "../src/map-tile.js";

const object = [
  "[object]",
  "1",
  "Sceneryobjects\\test\\house.sco",
  "3212903",
  "244.75",
  "364.5",
  "2.25",
  "113.6",
  "-4",
  "5",
  "2",
  "0",
  "value",
];
const spline = [
  "[spline]",
  "0",
  "Splines\\road.sli",
  "42",
  "41",
  "43",
  "160.4",
  "30",
  "191.2",
  "293.1",
  "300",
  "0",
  "1.5",
  "-2",
  "3",
  "4",
  "5",
  "6",
  "900",
  "",
];

test("parses real-format version 14 object and spline placement without coordinate conversion", () => {
  const text = [
    "\uFEFF[version]",
    "14",
    "[terrain]",
    "",
    "[variable_terrainlightmap]",
    "",
    "[variable_terrain]",
    "",
    ...spline,
    "[spline_terrain_align_2]",
    "1",
    "Object Nr. 0",
    ...object,
    "[varparent]",
    "321",
    "[spline_terrain_align]",
    "",
  ].join("\r\n");
  const tile = parseMapTile(text);
  assert.equal(tile.version, 14);
  assert.deepEqual(tile.terrain, { line: 3, payload: [""] });
  assert.equal(tile.variableTerrainLightmap.line, 5);
  assert.equal(tile.variableTerrain.line, 7);
  assert.deepEqual(tile.splines[0], {
    line: 9,
    type: "spline",
    complexity: 0,
    path: "Splines\\road.sli",
    idCode: 42,
    prevIDCode: 41,
    nextIDCode: 43,
    position: { x: 160.4, y: 30, z: 191.2 },
    heading: 293.1,
    length: 300,
    radius: 0,
    gradStart: 1.5,
    gradEnd: -2,
    useDeltaHeight: false,
    deltaHeight: null,
    cantStart: 3,
    cantEnd: 4,
    skewStart: 5,
    skewEnd: 6,
    startZ: 900,
    mirror: false,
    terrainAlignment: 1,
  });
  assert.deepEqual(tile.sceneObjects[0], {
    line: 32,
    type: "object",
    complexity: 1,
    path: "Sceneryobjects\\test\\house.sco",
    idCode: 3212903,
    position: { x: 244.75, z: 364.5, y: 2.25 },
    heading: 113.6,
    pitch: -4,
    bank: 5,
    parameters: ["0", "value"],
    varparentIdCode: 321,
    terrainAlignment: true,
  });
  assert.deepEqual(tile.warnings, []);
});

test("parses spline_h, mirror, old version layouts, and original array input", () => {
  const lines = [
    "[version]",
    "11",
    "[scenObj]",
    "5",
    "a.sco",
    "99",
    "1",
    "2",
    "3",
    "4",
    "1",
    "p",
    "[spline_h]",
    "3",
    "road.sli",
    "9",
    "8",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "mirror",
  ];
  const tile = parseMapTile(lines);
  assert.equal(tile.sceneObjects[0].type, "scenobj");
  assert.deepEqual(tile.sceneObjects[0].position, { x: 1, z: 2, y: 3 });
  assert.equal(tile.sceneObjects[0].pitch, null);
  assert.deepEqual(tile.sceneObjects[0].parameters, ["p"]);
  assert.deepEqual(tile.splines[0], {
    line: 13,
    type: "spline_h",
    complexity: 3,
    path: "road.sli",
    idCode: 9,
    prevIDCode: 8,
    nextIDCode: 10,
    position: { x: 11, y: 12, z: 13 },
    heading: 14,
    length: 15,
    radius: 16,
    gradStart: 17,
    gradEnd: 18,
    useDeltaHeight: true,
    deltaHeight: 19,
    cantStart: 20,
    cantEnd: 21,
    skewStart: null,
    skewEnd: null,
    startZ: 22,
    mirror: true,
  });
  assert.equal(tile.warnings.length, 1);
  assert.match(tile.warnings[0], /predecessor may be an index/);
});

test("parses older object/spline variants and counted empty parameter values", () => {
  const tile = parseMapTile(
    [
      "[version]",
      "6",
      "[object]",
      "a.sco",
      "3",
      "1",
      "2",
      "3",
      "90",
      "2",
      "",
      "abc",
      "[splineAbschnitt]",
      "b.sli",
      "4",
      "3",
      "1",
      "2",
      "3",
      "90",
      "10",
      "0",
      "0",
      "0",
      "1",
      "2",
    ].join("\n"),
  );
  assert.equal(tile.sceneObjects[0].complexity, null);
  assert.deepEqual(tile.sceneObjects[0].parameters, ["", "abc"]);
  assert.equal(tile.splines[0].nextIDCode, null);
  assert.equal(tile.splines[0].mirror, false);
  assert.equal(tile.splines[0].cantEnd, 2);
  assert.equal(tile.warnings.length, 1);
  assert.match(tile.warnings[0], /predecessor may be an index/);
});

test("preserves attachment IDs, reference indices and geometry", () => {
  const tile = parseMapTile(
    [
      "[version]",
      "14",
      "[attachObject]",
      "0",
      "a.sco",
      "10",
      "11",
      "0",
      "12",
      "30",
      "4",
      "5",
      "1",
      "p",
      "[varparent]",
      "8",
      "[splineAttachement]",
      "1",
      "b.sco",
      "20",
      "5",
      "1",
      "2",
      "3",
      "90",
      "4",
      "5",
      "10",
      "25",
      "1",
      "0",
      "[splineAttachement_repeater]",
      "0",
      "338",
      "14",
      "c.sco",
      "30",
      "7",
      "8",
      "9",
      "10",
      "180",
      "0",
      "0",
      "65",
      "1000",
      "0",
      "0",
    ].join("\n"),
  );
  assert.deepEqual(tile.attachObjects[0], {
    line: 3,
    type: "attachobject",
    complexity: 0,
    path: "a.sco",
    idCode: 10,
    attachObjId: 11,
    attachedInstances: 0,
    attachPoint: 12,
    heading: 30,
    pitch: 4,
    bank: 5,
    parameters: ["p"],
    varparentIdCode: 8,
  });
  assert.equal(tile.splineAttachments[0].splineId, 5);
  assert.deepEqual(tile.splineAttachments[0].position, { x: 1, y: 2, z: 3 });
  assert.equal(tile.splineAttachments[0].tangential, true);
  assert.equal(tile.splineAttachments[1].tile, 338);
  assert.equal(tile.splineAttachments[1].repeaterOffset, 14);
  assert.equal(tile.splineAttachments[1].distance, 1000);
  assert.deepEqual(tile.warnings, []);
});

test("malformed records are omitted and parsing resumes at subsequent commands", () => {
  const tile = parseMapTile(
    [
      "[version]",
      "14",
      "[object]",
      "0",
      "broken.sco",
      "1",
      "NaN",
      "[object]",
      ...object.slice(1),
      "[spline]",
      "0",
      "short.sli",
      "[object]",
      ...object.slice(1),
      "[object]",
      "0",
      "bad.sco",
      "1",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "999999",
      "[object]",
      ...object.slice(1),
    ].join("\n"),
  );
  assert.equal(tile.sceneObjects.length, 3);
  assert.equal(tile.splines.length, 0);
  assert.ok(tile.warnings.some((w) => w.includes("invalid position x")));
  assert.ok(tile.warnings.some((w) => w.includes("missing idCode")));
  assert.ok(tile.warnings.some((w) => w.includes("invalid parameter count")));
});

test("diagnoses unsupported commands, versions, terrain payload and orphaned children", () => {
  const tile = parseMapTile(
    [
      "[version]",
      "15",
      "[terrain]",
      "unparsed terrain",
      "[object]",
      ...object.slice(1),
      "[rule]",
      "abc",
      "[varparent]",
      "2",
    ].join("\n"),
  );
  assert.equal(tile.sceneObjects.length, 0);
  assert.deepEqual(tile.terrain.payload, ["unparsed terrain"]);
  for (const phrase of [
    "unsupported map version",
    "payload is not interpreted",
    "unsupported for version",
    "unsupported command [rule]",
    "no preceding object",
  ]) {
    assert.ok(
      tile.warnings.some((w) => w.includes(phrase)),
      phrase,
    );
  }
  const old = parseMapTile(
    ["[version]", "5", "[spline]", "x", "[attachObject]", "x"].join("\n"),
  );
  assert.equal(
    old.warnings.filter((w) => w.includes("unsupported for version")).length,
    2,
  );
});

test("disabled blocks are ignored, duplicate versions diagnosed, missing version assumed", () => {
  const tile = parseMapTile(
    [
      "-<DISABLED>-",
      ...object,
      "-<ENABLED>-",
      ...object,
      "[version]",
      "14",
      "[version]",
      "13",
    ].join("\n"),
  );
  assert.equal(tile.sceneObjects.length, 1);
  assert.ok(
    tile.warnings.some((w) => w.includes("placement before [version]")),
  );
  assert.ok(tile.warnings.some((w) => w.includes("duplicate [version]")));
  assert.ok(
    parseMapTile(object).warnings.some((w) => w.includes("missing [version]")),
  );
  assert.throws(() => parseMapTile(null), TypeError);
  assert.throws(() => parseMapTile(["ok", 1]), TypeError);
});
