import test from "node:test";
import assert from "node:assert/strict";
import { Renderer } from "../src/renderer.js";
import { WebGLRenderer } from "../src/webgl-renderer.js";
import {
  focusModels,
  focusPosition,
  modelBounds,
} from "../src/camera-controls.js";

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

test("focusing a position recenters without changing camera distance or angles", () => {
  const renderer = {
    _assertUsable() {},
    _requestFrame() {
      this.frames++;
    },
    frames: 0,
    _target: [0, 0, 0],
    _distance: 12,
    _viewRadius: 6,
    _yaw: 0.4,
    _pitch: -0.3,
  };
  focusPosition(renderer, [3, 4, 5]);
  assert.deepEqual(renderer._target, [3, 4, 5]);
  assert.equal(renderer._distance, 12);
  assert.equal(renderer._viewRadius, 6);
  assert.equal(renderer._yaw, 0.4);
  assert.equal(renderer._pitch, -0.3);
  assert.equal(renderer.frames, 1);
  assert.throws(() => focusPosition(renderer, [0, NaN, 0]), /focus position/);
  assert.throws(() => focusPosition(renderer, [0, 0]), /focus position/);
  assert.equal(renderer.frames, 1);
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
    const event = (id, x, y, button = 0, altKey = false, buttons) => ({
      pointerId: id,
      clientX: x,
      clientY: y,
      button,
      altKey,
      buttons,
      preventDefault: () => prevented++,
    });
    const start = [...renderer._target];
    listeners.get("pointerdown")(event(1, 0, 0, 2));
    assert.ok(captures.has(1));
    listeners.get("pointermove")(event(2, 20, 10));
    assert.deepEqual(renderer._target, start);
    listeners.get("pointermove")(event(1, 20, 10));
    const panSpeed = 0.013;
    assert.ok(
      Math.abs(renderer._target[0] - (start[0] - 20 * panSpeed)) < 1e-10,
    );
    assert.ok(
      Math.abs(renderer._target[1] - (start[1] + 10 * panSpeed)) < 1e-10,
    );
    assert.ok(Math.abs(renderer._target[2] - start[2]) < 1e-10);
    assert.equal(renderer._yaw, Math.PI / 2);
    listeners.get("pointerup")(event(1, 20, 10));
    assert.equal(captures.size, 0);

    renderer._yaw = 0;
    renderer._pitch = Math.PI / 4;
    renderer._distance = 20;
    const before = [...renderer._target];
    listeners.get("pointerdown")(event(3, 0, 0, 1));
    listeners.get("pointermove")(event(3, 10, 10));
    assert.ok(
      Math.abs(
        renderer._target[0] -
          (before[0] - 10 * panSpeed * Math.sin(Math.PI / 4)),
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(
        renderer._target[1] -
          (before[1] + 10 * panSpeed * Math.cos(Math.PI / 4)),
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(renderer._target[2] - (before[2] + 10 * panSpeed)) < 1e-10,
    );
    listeners.get("pointercancel")(event(3, 10, 10));
    const panned = [...renderer._target];
    listeners.get("pointermove")(event(3, 20, 20));
    assert.deepEqual(renderer._target, panned);
    listeners.get("pointerdown")(event(4, 0, 0));
    listeners.get("pointermove")(event(4, 10, 10));
    assert.equal(renderer._yaw, 0.05);
    assert.deepEqual(renderer._target, panned);
    listeners.get("lostpointercapture")(event(4, 10, 10));
    const beforeAltOrbit = [renderer._yaw, renderer._pitch, ...renderer._target];
    listeners.get("pointerdown")(event(5, 0, 0, 1, true));
    listeners.get("pointermove")(event(5, 10, 10, 1, true));
    assert.equal(renderer._yaw, beforeAltOrbit[0] + 0.05);
    assert.equal(renderer._pitch, beforeAltOrbit[1] + 0.05);
    assert.deepEqual(renderer._target, beforeAltOrbit.slice(2));
    listeners.get("pointerup")(event(5, 10, 10, 1, true));
    const beforeZoom = renderer._distance;
    listeners.get("pointerdown")(event(6, 0, 0));
    listeners.get("pointermove")(event(6, 0, 10, 0, false, 3));
    assert.ok(
      Math.abs(renderer._distance - beforeZoom * (1 - 10 * 0.013)) < 1e-10,
    );
    assert.deepEqual(renderer._target, beforeAltOrbit.slice(2));
    listeners.get("pointerup")(event(6, 0, 10));
    const beforeMiddleZoom = renderer._distance;
    listeners.get("pointerdown")(event(7, 0, 0, 1));
    listeners.get("pointermove")(event(7, 0, 10, 1, true, 6));
    assert.ok(
      Math.abs(
        renderer._distance - beforeMiddleZoom * (1 - 10 * 0.013),
      ) < 1e-10,
    );
    assert.deepEqual(renderer._target, beforeAltOrbit.slice(2));
    listeners.get("pointerup")(event(7, 0, 10, 1));
    renderer.resetCamera();
    assert.deepEqual(renderer._target, [2, 3, 4]);
    assert.notEqual(renderer._target, renderer._sceneCenter);
    listeners.get("contextmenu")({ preventDefault: () => prevented++ });
    assert.equal(prevented, 7);
    assert.equal(frames, 8);
    renderer._disposeControls();
  });

  test(`${name} matches desktop wheel zoom across browser delta modes`, () => {
    const listeners = new Map();
    const canvas = {
      clientWidth: 200,
      clientHeight: 100,
      addEventListener: (event, handler) => listeners.set(event, handler),
    };
    const renderer = create(canvas);
    let frames = 0,
      prevented = 0;
    renderer._requestFrame = () => frames++;
    renderer._installEvents();
    renderer._distance = 10;
    renderer._viewRadius = 5;
    const wheel = (deltaY, deltaMode) =>
      listeners.get("wheel")({
        deltaY,
        deltaMode,
        preventDefault: () => prevented++,
      });

    wheel(-100, 0);
    assert.equal(renderer._distance, 7);
    wheel(100, 0);
    assert.ok(Math.abs(renderer._distance - 9.1) < 1e-12);
    renderer._distance = 10;
    wheel(3, 1);
    assert.equal(renderer._distance, 13);
    renderer._distance = 10;
    wheel(1, 2);
    assert.equal(renderer._distance, 13);
    assert.equal(frames, 4);
    assert.equal(prevented, 4);
    renderer._disposeControls();
  });

  test(`${name} continuously moves in camera space while arrow keys are held`, () => {
    const listeners = new Map();
    const canvas = {
      clientWidth: 200,
      clientHeight: 100,
      addEventListener: (event, handler) => listeners.set(event, handler),
    };
    const renderer = create(canvas);
    let frames = 0,
      prevented = 0;
    renderer._requestFrame = () => frames++;
    renderer._target = [0, 0, 0];
    renderer._yaw = Math.PI / 2;
    renderer._pitch = 0;
    renderer._distance = 100;
    renderer._installEvents();
    const requestDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "requestAnimationFrame",
      ),
      cancelDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "cancelAnimationFrame",
      );
    let nextFrame = 0;
    const scheduledFrames = new Map();
    globalThis.requestAnimationFrame = (callback) => {
      const id = ++nextFrame;
      scheduledFrames.set(id, callback);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => scheduledFrames.delete(id);
    const keydown = (key) =>
      listeners.get("keydown")({
        key,
        preventDefault: () => prevented++,
      });
    const runFrame = (timestamp) => {
      const next = scheduledFrames.entries().next().value;
      assert.ok(next, "expected a scheduled keyboard movement frame");
      const [id, callback] = next;
      scheduledFrames.delete(id);
      callback(timestamp);
    };
    try {
      keydown("ArrowRight");
      assert.deepEqual(renderer._target, [0, 0, 0]);
      runFrame(0);
      runFrame(16);
      assert.ok(Math.abs(renderer._target[0] - 0.16) < 1e-10);
      assert.ok(Math.abs(renderer._target[1]) < 1e-10);

      keydown("ArrowUp");
      runFrame(32);
      assert.ok(Math.abs(renderer._target[0] - 0.32) < 1e-10);
      assert.ok(Math.abs(renderer._target[2] + 0.16) < 1e-10);
      renderer._keyUp({ key: "ArrowRight" });
      runFrame(48);
      assert.ok(Math.abs(renderer._target[0] - 0.32) < 1e-10);
      assert.ok(Math.abs(renderer._target[2] + 0.32) < 1e-10);
      renderer._keyUp({ key: "ArrowUp" });
      assert.equal(scheduledFrames.size, 0);
      assert.equal(renderer._yaw, Math.PI / 2);
      assert.equal(renderer._pitch, 0);
      assert.equal(frames, 3);
      assert.equal(prevented, 2);

      keydown("Enter");
      assert.equal(scheduledFrames.size, 0);
      assert.equal(frames, 3);
      assert.equal(prevented, 2);
      keydown("ArrowLeft");
      renderer._blur();
      assert.equal(scheduledFrames.size, 0);
    } finally {
      renderer._disposeControls();
      if (requestDescriptor)
        Object.defineProperty(
          globalThis,
          "requestAnimationFrame",
          requestDescriptor,
        );
      else delete globalThis.requestAnimationFrame;
      if (cancelDescriptor)
        Object.defineProperty(
          globalThis,
          "cancelAnimationFrame",
          cancelDescriptor,
        );
      else delete globalThis.cancelAnimationFrame;
    }
  });

  test(`${name} allows orbit to the desktop pitch limits`, () => {
    const listeners = new Map();
    const renderer = create({
      clientWidth: 200,
      clientHeight: 100,
      addEventListener: (event, handler) => listeners.set(event, handler),
    });
    renderer._requestFrame = () => {};
    renderer._pitch = 0;
    renderer._installEvents();
    const pointer = (id, y, button = 0) => ({
      pointerId: id,
      clientX: 0,
      clientY: y,
      button,
      preventDefault() {},
    });
    listeners.get("pointerdown")(pointer(1, 0));
    listeners.get("pointermove")(pointer(1, 1000));
    assert.ok(Math.abs(renderer._pitch - (Math.PI / 2 - 1e-6)) < 1e-12);
    listeners.get("pointerup")(pointer(1, 1000));
    renderer._pitch = 0;
    listeners.get("pointerdown")(pointer(2, 0));
    listeners.get("pointermove")(pointer(2, -1000));
    assert.ok(Math.abs(renderer._pitch - (-Math.PI / 2 + 1e-6)) < 1e-12);
    renderer._disposeControls();
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
