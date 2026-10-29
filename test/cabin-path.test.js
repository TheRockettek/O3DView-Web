import test from "node:test";
import assert from "node:assert/strict";
import {
  cabinPathPointWorldPosition,
  parseCabinPaths,
  parsePassengerCabin,
  generateCabinMarkerMesh,
  generateCabinPathMesh,
  updateCabinMarkerPosition,
  updateCabinPathPoint,
  updateCabinPathLink,
} from "../src/cabin-path.js";
import { loadScene } from "../src/scene.js";
import { changeGizmoVisibility } from "../src/scene-visibility.js";
import { translateSceneModel } from "../src/scene-transforms.js";

const file = (path, text) => ({
  name: path.split("/").pop(),
  webkitRelativePath: path,
  async arrayBuffer() {
    return new TextEncoder().encode(text).buffer;
  },
});

test("cabin path point world positions match rendered axes and map placement", () => {
  assert.deepEqual(cabinPathPointWorldPosition([1, 2, 3]), [1, 3, 2]);
  assert.deepEqual(
    cabinPathPointWorldPosition([1, 2, 3], {
      position: { x: 10, y: 20, z: 30 },
      heading: 90,
    }),
    [12, 23, 29],
  );
  assert.throws(
    () => cabinPathPointWorldPosition([1, 2]),
    /Invalid cabin path point position/,
  );
});

test("generates cabin record markers in renderer coordinates", () => {
  const geometry = generateCabinMarkerMesh([[1, 2, 3]]);
  assert.equal(geometry.vertices.length, 48);
  assert.equal(geometry.triangles.length, 32);
  assert.deepEqual(
    [...geometry.vertices.slice(0, 8)],
    [...new Float32Array([1, 3.075, 2, 0, 1, 0, 0, 0])],
  );
  const placed = generateCabinMarkerMesh([[1, 2, 3]], {
    position: { x: 10, y: 20, z: 30 },
    heading: 90,
  });
  assert.deepEqual(
    [...placed.vertices.slice(0, 8)],
    [...new Float32Array([12, 23.075, 29, 0, 1, 0, 0, 0])],
  );
  assert.throws(
    () => generateCabinMarkerMesh([[1, 2]]),
    /Invalid cabin marker position/,
  );
});

test("updates cabin marker positions atomically with renderer rollback", () => {
  const item = { position: [1, 2, 3] };
  const geometry = generateCabinMarkerMesh([item.position]);
  const markerModel = {
    ...geometry,
    cabinMarkerItems: [item],
    worldTranslation: [0, 0, 0],
  };
  const models = [markerModel];
  let fail = false,
    setCalls = 0;
  const renderer = {
    _target: [0, 0, 0],
    _distance: 2,
    _yaw: 0,
    _pitch: 0,
    _viewRadius: 1,
    _requestFrame() {},
    setModels() {
      setCalls++;
      if (fail && setCalls === 1) throw new Error("renderer update failed");
    },
    setModelVisible() {},
    setSelectedModel() {},
  };
  updateCabinMarkerPosition(
    markerModel,
    item,
    [4, 5, 6],
    renderer,
    models,
    [true],
    [true],
    0,
    null,
  );
  assert.deepEqual(item.position, [4, 5, 6]);
  assert.deepEqual(
    [...markerModel.vertices.slice(0, 8)],
    [...new Float32Array([4, 6.075, 5, 0, 1, 0, 0, 0])],
  );
  const updatedVertices = markerModel.vertices;
  const updatedPosition = item.position;
  fail = true;
  setCalls = 0;
  assert.throws(
    () =>
      updateCabinMarkerPosition(
        markerModel,
        item,
        [7, 8, 9],
        renderer,
        models,
        [true],
        [true],
        0,
        null,
      ),
    /renderer update failed/,
  );
  assert.equal(markerModel.vertices, updatedVertices);
  assert.equal(item.position, updatedPosition);
  assert.equal(setCalls, 2);
});

test("parses cabin path links and generates desktop-width geometry in OMSI coordinates", () => {
  const text = [
    "[pathpnt]",
    "1",
    "2",
    "3",
    "[pathpnt]",
    "5",
    "2",
    "3",
    "[next_roomheight]",
    "1.5",
    "[next_stepsound]",
    "2",
    "[pathlink_oneway]",
    "0",
    "1",
  ].join("\n");
  const paths = parseCabinPaths(text);
  assert.deepEqual(paths.warnings, []);
  assert.deepEqual(paths.points, [
    [1, 2, 3],
    [5, 2, 3],
  ]);
  assert.deepEqual(paths.links[0], {
    a: 0,
    b: 1,
    oneWay: true,
    roomHeight: 1.5,
    stepSound: 2,
    line: 13,
  });
  const geometry = generateCabinPathMesh(paths);
  assert.deepEqual(geometry.warnings, []);
  assert.deepEqual(
    [...geometry.triangles.slice(0, 8)],
    [2, 1, 0, 0, 5, 4, 3, 0],
  );
  assert.equal(geometry.triangles.length, 72);
  assert.deepEqual(
    [...geometry.vertices.slice(0, 8)],
    [...new Float32Array([1, 3, 2.1, 0, 1, 0, 0, 0])],
  );
  assert.deepEqual(
    [...geometry.vertices.slice(8, 16)],
    [...new Float32Array([1, 3, 1.9, 0, 1, 0, 0, 0])],
  );
  assert.deepEqual(
    [...geometry.vertices.slice(48, 56)],
    [...new Float32Array([1, 3.075, 2, 0, 1, 0, 0, 0])],
  );
});

test("invalid points retain their indices and unusable links are reported", () => {
  const paths = parseCabinPaths(
    [
      "[pathpnt]",
      "bad",
      "0",
      "0",
      "[pathpnt]",
      "0",
      "0",
      "0",
      "[pathpnt]",
      "0",
      "0",
      "3",
      "[pathpnt]",
      "2",
      "0",
      "0",
      "[pathlink]",
      "0",
      "3",
      "[pathlink]",
      "1",
      "2",
      "[pathlink]",
      "1",
      "3",
      "-<DISABLED>-",
      "[pathlink]",
      "1",
      "3",
      "-<ENABLED>-",
    ].join("\n"),
  );
  assert.equal(paths.points[0], null);
  assert.equal(paths.points.length, 4);
  assert.equal(paths.links.length, 3);
  assert.match(paths.warnings.join("\n"), /invalid numeric/);
  const geometry = generateCabinPathMesh(paths);
  assert.equal(geometry.triangles.length, 104);
  assert.match(geometry.warnings.join("\n"), /missing point/);
  assert.match(geometry.warnings.join("\n"), /no horizontal length/);
});

test("vehicle cabin paths load relative to the bus, join the hierarchy and honor gizmo visibility", async () => {
  const result = await loadScene(
    [
      file("Bus/vehicle.bus", "[paths]\npaths\\people.cfg\n"),
      file(
        "Bus/paths/people.cfg",
        "[pathpnt]\n0\n0\n0\n[pathpnt]\n0\n2\n1\n[pathlink]\n0\n1\n",
      ),
    ],
    ["Bus/vehicle.bus"],
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].cabinPathSource, "Bus/paths/people.cfg");
  assert.equal(result.models[0].gizmoVisible, true);
  const path = result.hierarchy[0].children.find(
    (node) => node.type === "cabin-path",
  );
  assert.equal(path.modelIndex, 0);
  const calls = [];
  changeGizmoVisibility(
    { setModelVisible: (...args) => calls.push(args) },
    result.models,
    [true],
    [true],
    0,
    false,
  );
  assert.deepEqual(calls, [[0, false]]);
});

test("missing and duplicate path references are reported", async () => {
  const result = await loadScene(
    [file("bus.bus", "[paths]\nmissing.cfg\n[paths]\nsecond.cfg\n")],
    ["bus.bus"],
  );
  assert.match(result.warnings.join("\n"), /duplicate \[paths\]/);
  assert.match(result.warnings.join("\n"), /Missing file "missing\.cfg"/);
});

test("parses passenger cabin seats, entrances and ticket points without consuming later tags", () => {
  const cabin = parsePassengerCabin(
    [
      "[entry]",
      "1",
      "[exit]",
      "0",
      "[passpos]",
      "1",
      "2",
      "3",
      "0.5",
      "90",
      "[drivpos]",
      "4",
      "5",
      "6",
      "0",
      "180",
      "[stamper]",
      "1",
      "7",
      "8",
      "9",
      "[ticket_sale_money_point_2]",
      "1",
      "2",
      "3",
      ".5",
      ".2",
      "parent",
      "[exit]",
      "bad",
      "[exit]",
      "1",
    ].join("\n"),
  );
  assert.deepEqual(
    cabin.items.map((item) => item.name),
    [
      "Entry 0",
      "Exit 0",
      "Seat 0",
      "Seat 1",
      "Stamper",
      "Ticket Money Point",
      "Exit 1",
    ],
  );
  assert.deepEqual(cabin.items[2].position, [1, 2, 3]);
  assert.equal(cabin.items[2].rotation, 90);
  assert.deepEqual(cabin.items[5].variation, [0.5, 0.2]);
  assert.equal(cabin.items[5].parent, "parent");
  assert.match(cabin.warnings.join("\n"), /invalid numeric/);
});

test("cabin items and path points are inspectable in the hierarchy", async () => {
  const result = await loadScene(
    [
      file(
        "Bus/vehicle.bus",
        "[paths]\npeople.cfg\n[passengercabin]\ncabin.cfg\n",
      ),
      file(
        "Bus/people.cfg",
        "[pathpnt]\n1\n2\n3\n[pathpnt]\n2\n2\n3\n[pathlink]\n0\n1",
      ),
      file(
        "Bus/cabin.cfg",
        "[entry]\n1\n[exit]\n20\n[passpos]\n4\n5\n6\n1\n90\n",
      ),
    ],
    ["Bus/vehicle.bus"],
  );
  const children = result.hierarchy[0].children;
  const points = children.find((node) => node.type === "cabin-points").children;
  const cabin = children.find((node) => node.type === "cabin").children;
  assert.deepEqual(points[1].info.position, [2, 2, 3]);
  assert.equal(points[1].info.line, 5);
  assert.deepEqual(cabin[0].info.position, [2, 2, 3]);
  assert.equal(cabin[1].info.pathPoint, 20);
  assert.deepEqual(cabin[2].info.position, [4, 5, 6]);
  assert.match(result.warnings.join("\n"), /missing cabin path point 20/);
});

test("passenger cabin records load even when the bus has no path file", async () => {
  const result = await loadScene(
    [
      file("vehicle.bus", "[passengercabin]\ncabin.cfg\n"),
      file("cabin.cfg", "[passpos]\n1\n2\n3\n1\n90\n[entry]\n4\n"),
    ],
    ["vehicle.bus"],
  );
  const cabin = result.hierarchy[0].children[0];
  assert.deepEqual(
    cabin.children
      .filter((item) => item.type === "cabin-item")
      .map((item) => item.name),
    ["Seat 0", "Entry 0"],
  );
  const markers = cabin.children.find((item) => item.type === "model");
  assert.ok(markers);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[markers.modelIndex].gizmoVisible, true);
  assert.equal(cabin.children[0].info.markerModelIndex, markers.modelIndex);
  assert.equal(
    result.models[markers.modelIndex].cabinMarkerItems[0],
    cabin.children[0].info,
  );
  assert.deepEqual(
    [...result.models[markers.modelIndex].vertices.slice(0, 8)],
    [...new Float32Array([1, 3.075, 2, 0, 1, 0, 0, 0])],
  );
  assert.match(result.warnings.join("\n"), /missing cabin path point 4/);
  const visibility = [];
  changeGizmoVisibility(
    { setModelVisible: (...args) => visibility.push(args) },
    result.models,
    [true],
    [true],
    0,
    false,
  );
  assert.deepEqual(visibility, [[0, false]]);
});

test("indexed cabin records keep their own markers apart from path references", async () => {
  const result = await loadScene(
    [
      file("vehicle.bus", "[paths]\npeople.cfg\n[passengercabin]\ncabin.cfg\n"),
      file("people.cfg", "[pathpnt]\n0\n0\n0\n"),
      file("cabin.cfg", "[stamper]\n0\n1\n2\n3\n[entry]\n0\n"),
    ],
    ["vehicle.bus"],
  );
  const cabin = result.hierarchy[0].children.find(
    (node) => node.type === "cabin",
  );
  const stamper = cabin.children.find(
    (node) => node.type === "cabin-item" && node.name === "Stamper",
  );
  const entry = cabin.children.find(
    (node) => node.type === "cabin-item" && node.name === "Entry 0",
  );
  const markerNode = cabin.children.find((node) => node.type === "model");
  assert.equal(result.models.length, 2);
  assert.equal(stamper.info.pathPoint, 0);
  assert.deepEqual(stamper.info.position, [1, 2, 3]);
  assert.equal(stamper.info.markerModelIndex, markerNode.modelIndex);
  assert.equal(entry.info.pathPoint, 0);
  assert.deepEqual(entry.info.position, [0, 0, 0]);
  assert.equal(entry.info.markerModelIndex, undefined);
  assert.deepEqual(
    [...result.models[markerNode.modelIndex].vertices.slice(0, 3)],
    [...new Float32Array([1, 3.075, 2])],
  );
});

test("editing a cabin point rebuilds links, retains translation, and updates referenced records", async () => {
  const result = await loadScene(
    [
      file("vehicle.bus", "[paths]\npeople.cfg\n[passengercabin]\ncabin.cfg\n"),
      file(
        "people.cfg",
        "[pathpnt]\n0\n0\n0\n[pathpnt]\n2\n0\n0\n[pathlink]\n0\n1\n",
      ),
      file("cabin.cfg", "[entry]\n1\n"),
    ],
    ["vehicle.bus"],
  );
  const point = result.hierarchy[0].children.find(
    (node) => node.type === "cabin-points",
  ).children[1].info;
  const entry = result.hierarchy[0].children.find(
    (node) => node.type === "cabin",
  ).children[0].info;
  const renderer = {
    _target: [1, 2, 3],
    _distance: 5,
    _yaw: 1,
    _pitch: 0,
    _viewRadius: 2,
    _requestFrame() {},
    setModels() {},
    setModelVisible() {},
    setSelectedModel() {},
  };
  const model = result.models[point.pathState.modelIndex];
  translateSceneModel(
    renderer,
    result.models,
    0,
    [3, 0, 0],
    [true],
    [true],
    0,
    0,
  );
  const before = model.vertices;
  assert.deepEqual(
    updateCabinPathPoint(
      point.pathState,
      1,
      [4, 0, 1],
      renderer,
      result.models,
      [true],
      [true],
      0,
      0,
    ),
    [],
  );
  assert.deepEqual(point.position, [4, 0, 1]);
  assert.deepEqual(entry.position, [4, 0, 1]);
  assert.notEqual(model.vertices, before);
  assert.deepEqual(model.worldTranslation, [3, 0, 0]);
  assert.equal(model.vertices[16], 1);
  assert.equal(model.vertices[17], 1);
  const updated = model.vertices;
  assert.throws(
    () =>
      updateCabinPathPoint(
        point.pathState,
        1,
        [0, Infinity, 0],
        renderer,
        result.models,
        [true],
        [true],
        0,
        0,
      ),
    /finite/,
  );
  assert.equal(model.vertices, updated);
  assert.deepEqual(point.position, [4, 0, 1]);
});

test("point markers create editable geometry when path links are degenerate", async () => {
  const result = await loadScene(
    [
      file("vehicle.bus", "[paths]\npeople.cfg\n"),
      file(
        "people.cfg",
        "[pathpnt]\n0\n0\n0\n[pathpnt]\n0\n0\n0\n[pathlink]\n0\n1\n",
      ),
    ],
    ["vehicle.bus"],
  );
  const point = result.hierarchy[0].children.find(
    (node) => node.type === "cabin-points",
  ).children[1].info;
  assert.equal(point.pathState.modelIndex, 0);
  const model = result.models[point.pathState.modelIndex];
  assert.equal(model.triangles.length, 64);
  const previous = model.vertices;
  const renderer = {
    _target: [0, 0, 0],
    _distance: 1,
    _yaw: 0,
    _pitch: 0,
    _viewRadius: 1,
    _requestFrame() {},
    setModels() {},
    setModelVisible() {},
    setSelectedModel() {},
  };
  assert.deepEqual(
    updateCabinPathPoint(
      point.pathState,
      1,
      [1, 0, 0],
      renderer,
      result.models,
      [true],
      [true],
      0,
      null,
    ),
    [],
  );
  assert.notEqual(model.vertices, previous);
  assert.equal(model.triangles.length, 72);
  assert.deepEqual(point.position, [1, 0, 0]);
});

test("point edits preserve existing geometry and metadata when renderer rebuild fails", async () => {
  const result = await loadScene(
    [
      file("vehicle.bus", "[paths]\npeople.cfg\n"),
      file(
        "people.cfg",
        "[pathpnt]\n0\n0\n0\n[pathpnt]\n2\n0\n0\n[pathlink]\n0\n1\n",
      ),
    ],
    ["vehicle.bus"],
  );
  const point = result.hierarchy[0].children.find(
    (node) => node.type === "cabin-points",
  ).children[1].info;
  const model = result.models[0],
    previous = model.vertices,
    triangles = model.triangles;
  let fail = true;
  const renderer = {
    _target: [0, 0, 0],
    _distance: 2,
    _yaw: 0,
    _pitch: 0,
    _viewRadius: 1,
    _requestFrame() {},
    setSelectedModel() {},
    setModelVisible() {},
    setModels() {
      if (fail) {
        fail = false;
        throw new Error("render failure");
      }
    },
  };
  assert.throws(
    () =>
      updateCabinPathPoint(
        point.pathState,
        1,
        [5, 0, 0],
        renderer,
        result.models,
        [true],
        [true],
        0,
        0,
      ),
    /render failure/,
  );
  assert.equal(model.vertices, previous);
  assert.equal(model.triangles, triangles);
  assert.deepEqual(point.position, [2, 0, 0]);
});

test("editing a link changes its mesh and metadata atomically", async () => {
  const result = await loadScene(
    [
      file("vehicle.bus", "[paths]\npeople.cfg\n"),
      file(
        "people.cfg",
        "[pathpnt]\n0\n0\n0\n[pathpnt]\n2\n0\n0\n[pathpnt]\n0\n4\n0\n[pathlink]\n0\n1\n",
      ),
    ],
    ["vehicle.bus"],
  );
  const info = result.hierarchy[0].children.find(
    (node) => node.type === "cabin-links",
  ).children[0].info;
  const renderer = {
    _target: [0, 0, 0],
    _distance: 2,
    _yaw: 0,
    _pitch: 0,
    _viewRadius: 1,
    _requestFrame() {},
    setModels() {},
    setModelVisible() {},
    setSelectedModel() {},
  };
  const model = result.models[0],
    previous = model.vertices;
  const changes = { a: 0, b: 2, oneWay: true, roomHeight: 2, stepSound: 3 };
  assert.deepEqual(
    updateCabinPathLink(
      info.pathState,
      0,
      changes,
      renderer,
      result.models,
      [true],
      [true],
      0,
      0,
    ),
    [],
  );
  assert.equal(info.link.b, 2);
  assert.equal(info.link.oneWay, true);
  assert.equal(info.link.roomHeight, 2);
  assert.equal(info.link.stepSound, 3);
  assert.notEqual(model.vertices, previous);
  assert.equal(model.vertices[18], 4);
  const updated = model.vertices;
  assert.throws(
    () =>
      updateCabinPathLink(
        info.pathState,
        0,
        { ...changes, b: 99 },
        renderer,
        result.models,
        [true],
        [true],
        0,
        0,
      ),
    /existing cabin path points/,
  );
  assert.equal(info.link.b, 2);
  assert.equal(model.vertices, updated);
});
