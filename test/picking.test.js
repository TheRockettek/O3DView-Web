import test from "node:test";
import assert from "node:assert/strict";
import {
  pickModel,
  pickModelHit,
  projectWorldPosition,
  projectVisibleWorldPosition,
} from "../src/picking.js";
import { modelBounds } from "../src/camera-controls.js";

function triangle(z, x = 0) {
  const vertices = new Float32Array([
    x - 1,
    -1,
    z,
    0,
    0,
    1,
    0,
    0,
    x + 1,
    -1,
    z,
    0,
    0,
    1,
    0,
    0,
    x,
    1,
    z,
    0,
    0,
    1,
    0,
    0,
  ]);
  return { vertices, triangles: new Uint32Array([0, 1, 2, 0]) };
}

function camera(models) {
  return {
    canvas: {
      width: 200,
      height: 100,
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        right: 210,
        bottom: 120,
        width: 200,
        height: 100,
      }),
    },
    _assertUsable() {},
    _target: [0, 0, 0],
    _distance: 10,
    _yaw: Math.PI / 2,
    _pitch: 0,
    _sceneCenter: [0, 0, 0],
    _radius: 10,
    _viewRadius: 10,
    _modelBounds: models.map((model) => modelBounds(model.vertices)),
    _modelVisibility: models.map(() => true),
  };
}

test("picking selects the nearest visible triangle and respects viewport bounds", () => {
  const models = [triangle(0), triangle(2)];
  const renderer = camera(models);
  assert.equal(pickModel(renderer, models, 110, 70), 1);
  assert.equal(pickModel(renderer, models, 110, 70, 1), 0);
  assert.equal(pickModel(renderer, models, 110, 70, 0), null);
  renderer._modelVisibility[1] = false;
  assert.equal(pickModel(renderer, models, 110, 70), 0);
  assert.equal(pickModel(renderer, models, 10, 20), null);
  assert.equal(pickModel(renderer, models, 0, 70), null);
});

test("detailed picking reports the nearest triangle while model picking stays compatible", () => {
  const first = triangle(0),
    second = triangle(2);
  const model = {
    vertices: new Float32Array([...first.vertices, ...second.vertices]),
    triangles: new Uint32Array([0, 1, 2, 0, 3, 4, 5, 0]),
  };
  const models = [model],
    renderer = camera(models);
  assert.deepEqual(pickModelHit(renderer, models, 110, 70), {
    index: 0,
    triangleIndex: 1,
  });
  assert.equal(pickModel(renderer, models, 110, 70), 0);
});

test("world projection maps camera target to viewport center and excludes points behind the camera", () => {
  const renderer = camera([]);
  assert.deepEqual(projectWorldPosition(renderer, [0, 0, 0]), {
    x: 100,
    y: 50,
  });
  assert.equal(projectWorldPosition(renderer, [0, 0, 11]), null);
});

test("projected markers are hidden by closer geometry but not by their own model", () => {
  const wall = triangle(5),
    models = [wall],
    renderer = camera(models);
  const assertCentered = (position, excludedIndex) => {
    const projected = projectVisibleWorldPosition(
      renderer,
      models,
      position,
      excludedIndex,
    );
    assert.ok(projected);
    assert.ok(Math.abs(projected.x - 100) < 1e-10);
    assert.equal(projected.y, 50);
  };
  assert.equal(projectVisibleWorldPosition(renderer, models, [0, 0, 0]), null);
  assertCentered([0, 0, 8]);
  assertCentered([0, 0, 0], 0);
  renderer._modelVisibility[0] = false;
  assertCentered([0, 0, 0]);
});

test("picking uses reflected model X, camera orientation, clipping and inside bounds", () => {
  const models = [triangle(0, -4)];
  const renderer = camera(models);
  const x = 110 + (4 / (10 * Math.tan(Math.PI / 6))) * 50;
  assert.equal(pickModel(renderer, models, x, 70), 0);
  assert.equal(pickModel(renderer, models, 110, 70), null);
  renderer._modelBounds[0] = { center: [4, 0, 11], radius: 20 };
  assert.equal(pickModel(renderer, models, x, 70), 0);
  renderer._sceneCenter = [0, 0, 100];
  renderer._radius = 1;
  assert.equal(pickModel(renderer, models, x, 70), null);
  renderer._assertUsable = () => {
    throw new Error("lost");
  };
  assert.throws(() => pickModel(renderer, models, x, 70), /lost/);
});

test("picking remains two-sided like desktop when rendering culls back faces", () => {
  const front = triangle(0),
    back = triangle(2);
  back.triangles = new Uint32Array([0, 2, 1, 0]);
  const models = [front, back],
    renderer = camera(models);
  renderer._cullBackfaces = true;
  assert.equal(pickModel(renderer, models, 110, 70), 1);
  assert.equal(pickModel(renderer, models, 110, 70, 1), 0);
  renderer._wireframe = true;
  assert.equal(pickModel(renderer, models, 110, 70, 1), 0);
  renderer._cullBackfaces = false;
  renderer._wireframe = false;
  assert.equal(pickModel(renderer, models, 110, 70, 1), 0);
});
