import test from "node:test";
import assert from "node:assert/strict";
import { parseCabinPaths, parsePassengerCabin, generateCabinPathMesh, updateCabinPathPoint, updateCabinPathLink } from "../src/cabin-path.js";
import { loadScene } from "../src/scene.js";
import { changeGizmoVisibility } from "../src/scene-visibility.js";
import { translateSceneModel } from "../src/scene-transforms.js";

const file = (path, text) => ({
    name: path.split("/").pop(), webkitRelativePath: path,
    async arrayBuffer() { return new TextEncoder().encode(text).buffer; },
});

test("parses cabin path links and generates desktop-width geometry in OMSI coordinates", () => {
    const text = [
        "[pathpnt]", "1", "2", "3", "[pathpnt]", "5", "2", "3",
        "[next_roomheight]", "1.5", "[next_stepsound]", "2",
        "[pathlink_oneway]", "0", "1",
    ].join("\n");
    const paths = parseCabinPaths(text);
    assert.deepEqual(paths.warnings, []);
    assert.deepEqual(paths.points, [[1, 2, 3], [5, 2, 3]]);
    assert.deepEqual(paths.links[0], { a: 0, b: 1, oneWay: true, roomHeight: 1.5, stepSound: 2, line: 13 });
    const geometry = generateCabinPathMesh(paths);
    assert.deepEqual(geometry.warnings, []);
    assert.deepEqual([...geometry.triangles], [2, 1, 0, 0, 5, 4, 3, 0]);
    assert.deepEqual([...geometry.vertices.slice(0, 8)], [...new Float32Array([1, 3, 2.1, 0, 1, 0, 0, 0])]);
    assert.deepEqual([...geometry.vertices.slice(8, 16)], [...new Float32Array([1, 3, 1.9, 0, 1, 0, 0, 0])]);
});

test("invalid points retain their indices and unusable links are reported", () => {
    const paths = parseCabinPaths([
        "[pathpnt]", "bad", "0", "0", "[pathpnt]", "0", "0", "0",
        "[pathpnt]", "0", "0", "3", "[pathpnt]", "2", "0", "0",
        "[pathlink]", "0", "3", "[pathlink]", "1", "2", "[pathlink]", "1", "3",
        "-<DISABLED>-", "[pathlink]", "1", "3", "-<ENABLED>-",
    ].join("\n"));
    assert.equal(paths.points[0], null);
    assert.equal(paths.points.length, 4);
    assert.equal(paths.links.length, 3);
    assert.match(paths.warnings.join("\n"), /invalid numeric/);
    const geometry = generateCabinPathMesh(paths);
    assert.equal(geometry.triangles.length, 8);
    assert.match(geometry.warnings.join("\n"), /missing point/);
    assert.match(geometry.warnings.join("\n"), /no horizontal length/);
});

test("vehicle cabin paths load relative to the bus, join the hierarchy and honor gizmo visibility", async () => {
    const result = await loadScene([
        file("Bus/vehicle.bus", "[paths]\npaths\\people.cfg\n"),
        file("Bus/paths/people.cfg", "[pathpnt]\n0\n0\n0\n[pathpnt]\n0\n2\n1\n[pathlink]\n0\n1\n"),
    ], ["Bus/vehicle.bus"]);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.models.length, 1);
    assert.equal(result.models[0].cabinPathSource, "Bus/paths/people.cfg");
    assert.equal(result.models[0].gizmoVisible, true);
    const path = result.hierarchy[0].children.find(node => node.type === "cabin-path");
    assert.equal(path.modelIndex, 0);
    const calls = [];
    changeGizmoVisibility({ setModelVisible: (...args) => calls.push(args) },
        result.models, [true], [true], 0, false);
    assert.deepEqual(calls, [[0, false]]);
});

test("missing and duplicate path references are reported", async () => {
    const result = await loadScene([file("bus.bus", "[paths]\nmissing.cfg\n[paths]\nsecond.cfg\n")], ["bus.bus"]);
    assert.match(result.warnings.join("\n"), /duplicate \[paths\]/);
    assert.match(result.warnings.join("\n"), /Missing file "missing\.cfg"/);
});

test("parses passenger cabin seats, entrances and ticket points without consuming later tags", () => {
    const cabin = parsePassengerCabin([
        "[entry]", "1", "[exit]", "0", "[passpos]", "1", "2", "3", "0.5", "90",
        "[drivpos]", "4", "5", "6", "0", "180", "[stamper]", "1", "7", "8", "9",
        "[ticket_sale_money_point_2]", "1", "2", "3", ".5", ".2", "parent",
        "[exit]", "bad", "[exit]", "1",
    ].join("\n"));
    assert.deepEqual(cabin.items.map(item => item.name), ["Entry 0", "Exit 0", "Seat 0", "Seat 1", "Stamper", "Ticket Money Point", "Exit 1"]);
    assert.deepEqual(cabin.items[2].position, [1, 2, 3]);
    assert.equal(cabin.items[2].rotation, 90);
    assert.deepEqual(cabin.items[5].variation, [.5, .2]);
    assert.equal(cabin.items[5].parent, "parent");
    assert.match(cabin.warnings.join("\n"), /invalid numeric/);
});

test("cabin items and path points are inspectable in the hierarchy", async () => {
    const result = await loadScene([
        file("Bus/vehicle.bus", "[paths]\npeople.cfg\n[passengercabin]\ncabin.cfg\n"),
        file("Bus/people.cfg", "[pathpnt]\n1\n2\n3\n[pathpnt]\n2\n2\n3\n[pathlink]\n0\n1"),
        file("Bus/cabin.cfg", "[entry]\n1\n[exit]\n20\n[passpos]\n4\n5\n6\n1\n90\n"),
    ], ["Bus/vehicle.bus"]);
    const children = result.hierarchy[0].children;
    const points = children.find(node => node.type === "cabin-points").children;
    const cabin = children.find(node => node.type === "cabin").children;
    assert.deepEqual(points[1].info.position, [2, 2, 3]);
    assert.equal(points[1].info.line, 5);
    assert.deepEqual(cabin[0].info.position, [2, 2, 3]);
    assert.equal(cabin[1].info.pathPoint, 20);
    assert.deepEqual(cabin[2].info.position, [4, 5, 6]);
    assert.match(result.warnings.join("\n"), /missing cabin path point 20/);
});

test("passenger cabin records load even when the bus has no path file", async () => {
    const result = await loadScene([
        file("vehicle.bus", "[passengercabin]\ncabin.cfg\n"),
        file("cabin.cfg", "[passpos]\n1\n2\n3\n1\n90\n[entry]\n4\n"),
    ], ["vehicle.bus"]);
    assert.deepEqual(result.hierarchy[0].children[0].children.map(item => item.name), ["Seat 0", "Entry 0"]);
    assert.match(result.warnings.join("\n"), /missing cabin path point 4/);
});

test("editing a cabin point rebuilds links, retains translation, and updates referenced records", async () => {
    const result = await loadScene([
        file("vehicle.bus", "[paths]\npeople.cfg\n[passengercabin]\ncabin.cfg\n"),
        file("people.cfg", "[pathpnt]\n0\n0\n0\n[pathpnt]\n2\n0\n0\n[pathlink]\n0\n1\n"),
        file("cabin.cfg", "[entry]\n1\n"),
    ], ["vehicle.bus"]);
    const point = result.hierarchy[0].children.find(node => node.type === "cabin-points").children[1].info;
    const entry = result.hierarchy[0].children.find(node => node.type === "cabin").children[0].info;
    const renderer = {
        _target: [1, 2, 3], _distance: 5, _yaw: 1, _pitch: 0, _viewRadius: 2,
        _requestFrame() {}, setModels() {}, setModelVisible() {}, setSelectedModel() {},
    };
    const model = result.models[point.pathState.modelIndex];
    translateSceneModel(renderer, result.models, 0, [3, 0, 0], [true], [true], 0, 0);
    const before = model.vertices;
    assert.deepEqual(updateCabinPathPoint(point.pathState, 1, [4, 0, 1], renderer, result.models,
        [true], [true], 0, 0), []);
    assert.deepEqual(point.position, [4, 0, 1]);
    assert.deepEqual(entry.position, [4, 0, 1]);
    assert.notEqual(model.vertices, before);
    assert.deepEqual(model.worldTranslation, [3, 0, 0]);
    assert.equal(model.vertices[16], 1);
    assert.equal(model.vertices[17], 1);
    const updated = model.vertices;
    assert.throws(() => updateCabinPathPoint(point.pathState, 1, [0, Infinity, 0], renderer, result.models,
        [true], [true], 0, 0), /finite/);
    assert.equal(model.vertices, updated);
    assert.deepEqual(point.position, [4, 0, 1]);
});

test("point edits that would create a previously absent path mesh are rejected explicitly", async () => {
    const result = await loadScene([
        file("vehicle.bus", "[paths]\npeople.cfg\n"),
        file("people.cfg", "[pathpnt]\n0\n0\n0\n[pathpnt]\n0\n0\n0\n[pathlink]\n0\n1\n"),
    ], ["vehicle.bus"]);
    const point = result.hierarchy[0].children.find(node => node.type === "cabin-points").children[1].info;
    assert.equal(point.pathState.modelIndex, null);
    assert.throws(() => updateCabinPathPoint(point.pathState, 1, [1, 0, 0], {}, [], [], [], 0, null), /not supported/);
    assert.deepEqual(point.position, [0, 0, 0]);
});

test("point edits preserve existing geometry and metadata when renderer rebuild fails", async () => {
    const result = await loadScene([
        file("vehicle.bus", "[paths]\npeople.cfg\n"),
        file("people.cfg", "[pathpnt]\n0\n0\n0\n[pathpnt]\n2\n0\n0\n[pathlink]\n0\n1\n"),
    ], ["vehicle.bus"]);
    const point = result.hierarchy[0].children.find(node => node.type === "cabin-points").children[1].info;
    const model = result.models[0], previous = model.vertices, triangles = model.triangles;
    let fail = true;
    const renderer = {
        _target: [0, 0, 0], _distance: 2, _yaw: 0, _pitch: 0, _viewRadius: 1,
        _requestFrame() {}, setSelectedModel() {}, setModelVisible() {},
        setModels() { if (fail) { fail = false; throw new Error("render failure"); } },
    };
    assert.throws(() => updateCabinPathPoint(point.pathState, 1, [5, 0, 0], renderer,
        result.models, [true], [true], 0, 0), /render failure/);
    assert.equal(model.vertices, previous);
    assert.equal(model.triangles, triangles);
    assert.deepEqual(point.position, [2, 0, 0]);
});

test("editing a link changes its mesh and metadata atomically", async () => {
    const result = await loadScene([
        file("vehicle.bus", "[paths]\npeople.cfg\n"),
        file("people.cfg", "[pathpnt]\n0\n0\n0\n[pathpnt]\n2\n0\n0\n[pathpnt]\n0\n4\n0\n[pathlink]\n0\n1\n"),
    ], ["vehicle.bus"]);
    const info = result.hierarchy[0].children.find(node => node.type === "cabin-links").children[0].info;
    const renderer = { _target: [0, 0, 0], _distance: 2, _yaw: 0, _pitch: 0, _viewRadius: 1,
        _requestFrame() {}, setModels() {}, setModelVisible() {}, setSelectedModel() {} };
    const model = result.models[0], previous = model.vertices;
    const changes = { a: 0, b: 2, oneWay: true, roomHeight: 2, stepSound: 3 };
    assert.deepEqual(updateCabinPathLink(info.pathState, 0, changes, renderer, result.models, [true], [true], 0, 0), []);
    assert.equal(info.link.b, 2);
    assert.equal(info.link.oneWay, true);
    assert.equal(info.link.roomHeight, 2);
    assert.equal(info.link.stepSound, 3);
    assert.notEqual(model.vertices, previous);
    assert.equal(model.vertices[18], 4);
    const updated = model.vertices;
    assert.throws(() => updateCabinPathLink(info.pathState, 0, { ...changes, b: 99 }, renderer,
        result.models, [true], [true], 0, 0), /existing cabin path points/);
    assert.equal(info.link.b, 2);
    assert.equal(model.vertices, updated);
});
