import test from "node:test";
import assert from "node:assert/strict";
import { Renderer } from "../src/renderer.js";
import { WebGLRenderer } from "../src/webgl-renderer.js";
import { focusModels, modelBounds } from "../src/camera-controls.js";

test("model bounds reflect X and preserve an empty model", () => {
  assert.equal(modelBounds(new Float32Array()), null);
  assert.deepEqual(
    modelBounds(
      new Float32Array([2, 1, 3, 0, 0, 0, 0, 0, 4, 5, 7, 0, 0, 0, 0, 0]),
    ),
    { center: [-3, 3, 5], radius: 3 },
  );
});

test("focusing a group uses all descendant geometry and preserves viewing angles", () => {
  const renderer = {
    _assertUsable() {},
    _requestFrame() {
      this.frames++;
    },
    frames: 0,
    _target: [0, 0, 0],
    _distance: 1,
    _yaw: 0.4,
    _pitch: -0.3,
  };
  const models = [
    { vertices: new Float32Array([2, 1, 3, 0, 0, 0, 0, 0]) },
    { vertices: new Float32Array([-4, 5, 7, 0, 0, 0, 0, 0]) },
  ];
  focusModels(renderer, models);
  assert.deepEqual(renderer._target, [1, 3, 5]);
  assert.equal(renderer._viewRadius, Math.sqrt(17));
  assert.equal(renderer._distance, 2 * Math.sqrt(17));
  assert.equal(renderer._yaw, 0.4);
  assert.equal(renderer._pitch, -0.3);
  assert.equal(renderer.frames, 1);
  assert.throws(() => focusModels(renderer, []), /without vertices/);
  assert.throws(
    () =>
      focusModels(renderer, [
        { vertices: new Float32Array([NaN, 0, 0, 0, 0, 0, 0, 0]) },
      ]),
    /Invalid model position/,
  );
});

for (const [name, create] of [
  ["WebGPU", (canvas) => new Renderer(canvas, {})],
  [
    "WebGL",
    (canvas) => new WebGLRenderer(canvas, { isContextLost: () => false }),
  ],
]) {
  test(`${name} pans in camera space, retains orbit and recenters on fit`, () => {
    const listeners = new Map(),
      captures = new Set();
    const canvas = {
      clientWidth: 200,
      clientHeight: 100,
      addEventListener: (name, handler) => listeners.set(name, handler),
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture: (id) => captures.delete(id),
    };
    const renderer = create(canvas);
    let frames = 0,
      prevented = 0;
    renderer._requestFrame = () => {
      frames++;
    };
    renderer._installEvents();
    renderer._sceneCenter = [2, 3, 4];
    renderer.resetCamera();
    renderer._distance = 10;
    const event = (id, x, y, button = 0) => ({
      pointerId: id,
      clientX: x,
      clientY: y,
      button,
      preventDefault: () => prevented++,
    });
    const start = [...renderer._target];
    listeners.get("pointerdown")(event(1, 0, 0, 2));
    assert.ok(captures.has(1));
    listeners.get("pointermove")(event(2, 20, 10));
    assert.deepEqual(renderer._target, start);
    listeners.get("pointermove")(event(1, 20, 10));
    const scale = (2 * 10 * Math.tan(Math.PI / 6)) / 100;
    assert.ok(Math.abs(renderer._target[0] - (start[0] - 20 * scale)) < 1e-10);
    assert.ok(Math.abs(renderer._target[1] - (start[1] + 10 * scale)) < 1e-10);
    assert.ok(Math.abs(renderer._target[2] - start[2]) < 1e-10);
    assert.equal(renderer._yaw, Math.PI / 2);
    listeners.get("pointerup")(event(1, 20, 10));
    assert.equal(captures.size, 0);

    renderer._yaw = 0;
    renderer._pitch = Math.PI / 4;
    const before = [...renderer._target];
    listeners.get("pointerdown")(event(3, 0, 0, 1));
    listeners.get("pointermove")(event(3, 10, 10));
    assert.ok(
      Math.abs(
        renderer._target[0] - (before[0] - 10 * scale * Math.sin(Math.PI / 4)),
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(
        renderer._target[1] - (before[1] + 10 * scale * Math.cos(Math.PI / 4)),
      ) < 1e-10,
    );
    assert.ok(Math.abs(renderer._target[2] - (before[2] + 10 * scale)) < 1e-10);
    listeners.get("pointercancel")(event(3, 10, 10));
    const panned = [...renderer._target];
    listeners.get("pointermove")(event(3, 20, 20));
    assert.deepEqual(renderer._target, panned);
    listeners.get("pointerdown")(event(4, 0, 0));
    listeners.get("pointermove")(event(4, 10, 10));
    assert.equal(renderer._yaw, 0.05);
    assert.deepEqual(renderer._target, panned);
    listeners.get("lostpointercapture")(event(4, 10, 10));
    renderer.resetCamera();
    assert.deepEqual(renderer._target, [2, 3, 4]);
    assert.notEqual(renderer._target, renderer._sceneCenter);
    listeners.get("contextmenu")({ preventDefault: () => prevented++ });
    assert.equal(prevented, 4);
    assert.equal(frames, 5);
  });

  test(`${name} focuses a selected occurrence and fit restores the scene`, () => {
    const renderer = create({ clientWidth: 200, clientHeight: 100 });
    renderer._requestFrame = () => {};
    renderer._sceneCenter = [100, 0, 0];
    renderer._radius = 100;
    renderer._modelBounds = [{ center: [-3, 3, 5], radius: 3 }, null];
    renderer._yaw = 0.4;
    renderer._pitch = -0.3;
    renderer.focusModel(0);
    assert.deepEqual(renderer._target, [-3, 3, 5]);
    assert.equal(renderer._distance, 6);
    assert.equal(renderer._viewRadius, 3);
    assert.equal(renderer._yaw, 0.4);
    assert.equal(renderer._pitch, -0.3);
    assert.throws(() => renderer.focusModel(1), /without vertices/);
    assert.throws(() => renderer.focusModel(-1), /Invalid model index/);
    assert.throws(() => renderer.focusModel("0"), /Invalid model index/);
    renderer.resetCamera();
    assert.deepEqual(renderer._target, [100, 0, 0]);
    assert.equal(renderer._viewRadius, 100);
  });
}
