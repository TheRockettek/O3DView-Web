import test from "node:test";
import assert from "node:assert/strict";
import {
  transformSceneModel,
  translateSceneModel,
} from "../src/scene-transforms.js";
import { modelBounds } from "../src/camera-controls.js";
import { pickModel } from "../src/picking.js";
import { combineSceneModels, exportWavefront } from "../src/obj-export.js";
import { writeO3D } from "../src/o3d-write.js";
import { parseO3D } from "../src/o3d.js";

function model() {
  return {
    name: "test.o3d",
    vertices: new Float32Array([
      -1, -1, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0]),
    materials: [
      {
        diffuse: [1, 1, 1, 1],
        spec: [0, 0, 0],
        emission: [0, 0, 0],
        specPower: 1,
        textureName: "",
      },
    ],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

function renderer() {
  return {
    canvas: {
      width: 200,
      height: 100,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
      }),
    },
    _assertUsable() {},
    _requestFrame() {},
    _target: [0, 0, 0],
    _distance: 10,
    _yaw: Math.PI / 2,
    _pitch: 0,
    _sceneCenter: [0, 0, 0],
    _radius: 10,
    _viewRadius: 10,
    setModels(models) {
      this._modelBounds = models.map((item) => modelBounds(item.vertices));
      this._modelVisibility = models.map(() => true);
      this._target = [100, 100, 100];
      this._distance = 1;
      this._selectedModel = null;
    },
    setModelVisible(index, visible) {
      this._modelVisibility[index] = visible;
    },
    setSelectedModel(index) {
      this._selectedModel = index;
    },
  };
}

test("world translation preserves scene state and is reflected in picking and exports", () => {
  const models = [model(), model()],
    r = renderer();
  r.setModels(models);
  r._target = [0, 0, 0];
  r._distance = 10;
  const original = models[0].vertices;
  translateSceneModel(
    r,
    models,
    0,
    [4, 0, 0],
    [true, false],
    [true, true],
    0,
    0,
  );
  assert.deepEqual(r._target, [0, 0, 0]);
  assert.equal(r._distance, 10);
  assert.deepEqual(r._modelVisibility, [true, false]);
  assert.equal(r._selectedModel, 0);
  assert.equal(models[0].vertices[0], -5);
  assert.equal(original[0], -1);
  assert.equal(pickModel(r, models, 100, 50), null);
  assert.equal(
    pickModel(r, models, 100 + (4 / (10 * Math.tan(Math.PI / 6))) * 50, 50),
    0,
  );
  assert.match(exportWavefront(models[0]).obj, /\nv 5 -1 0\n/);
  assert.match(exportWavefront(combineSceneModels(models)).obj, /\nv 5 -1 0\n/);
  assert.equal(parseO3D(writeO3D(models[0])).vertices[0], -5);
  translateSceneModel(
    r,
    models,
    0,
    [0, 2, 0],
    [true, false],
    [true, true],
    0,
    0,
  );
  assert.equal(models[0].vertices[0], -1);
  assert.equal(models[0].vertices[1], 1);
  assert.deepEqual(models[0].worldTranslation, [0, 2, 0]);
});

test("invalid and failed translations preserve model data and restore renderer state", () => {
  const models = [model()],
    r = renderer(),
    original = models[0].vertices;
  r.setModels(models);
  r._target = [0, 0, 0];
  r._distance = 10;
  assert.throws(
    () =>
      translateSceneModel(r, models, 0, [Infinity, 0, 0], [true], [true], 0, 0),
    /finite/,
  );
  assert.equal(models[0].vertices, original);
  let fail = true;
  const setVisible = r.setModelVisible;
  r.setModelVisible = function (...args) {
    if (fail) {
      fail = false;
      throw new Error("visibility failed");
    }
    return setVisible.apply(this, args);
  };
  assert.throws(
    () => translateSceneModel(r, models, 0, [1, 0, 0], [false], [true], 0, 0),
    /visibility failed/,
  );
  assert.equal(models[0].vertices, original);
  assert.equal(models[0].worldTranslation, undefined);
  assert.deepEqual(r._modelVisibility, [false]);
  assert.deepEqual(r._target, [0, 0, 0]);
  assert.equal(r._distance, 10);
});

test("rotation and positive scale affect rendering geometry, picking, and exports", () => {
  const models = [model()],
    r = renderer();
  r.setModels(models);
  r._target = [0, 0, 0];
  r._distance = 10;
  transformSceneModel(
    r,
    models,
    0,
    [0, 0, 90],
    [2, 1, 1],
    [true],
    [true],
    0,
    0,
  );
  assert.ok(Math.abs(models[0].vertices[0] + 1) < 1e-5);
  assert.ok(Math.abs(models[0].vertices[1] - 2) < 1e-5);
  assert.deepEqual(models[0].sceneTransform.rotation, [0, 0, 90]);
  assert.deepEqual(models[0].sceneTransform.scale, [2, 1, 1]);
  assert.equal(
    pickModel(r, models, 100 + 0.5 / (10 * Math.tan(Math.PI / 6)) * 50, 50),
    0,
  );
  assert.match(exportWavefront(models[0]).obj, /\nv 1 2 0\n/);
  assert.equal(parseO3D(writeO3D(models[0])).vertices[0], -1);
});

test("reapplying transforms uses the original geometry and rejects invalid scale", () => {
  const models = [model()],
    r = renderer();
  r.setModels(models);
  const original = models[0].vertices;
  const args = [r, models, 0, [0, 0, 90], [2, 1, 1], [true], [true], 0, 0];
  transformSceneModel(...args);
  transformSceneModel(
    r,
    models,
    0,
    [0, 0, 0],
    [1, 1, 1],
    [true],
    [true],
    0,
    0,
  );
  assert.deepEqual(models[0].vertices, original);
  assert.throws(
    () =>
      transformSceneModel(
        r,
        models,
        0,
        [0, 0, 0],
        [1, 0, 1],
        [true],
        [true],
        0,
        0,
      ),
    /positive finite/,
  );
  assert.deepEqual(models[0].vertices, original);
});
