import test from "node:test";
import assert from "node:assert/strict";
import {
  duplicateLight,
  encodeInteriorLights,
  MAX_INTERIOR_LIGHTS,
} from "../src/light-data.js";
import { Renderer } from "../src/renderer.js";
import { WebGLRenderer } from "../src/webgl-renderer.js";

const light = (on = true) => ({
  position: [1, 2, 3],
  range: 4,
  color: [1, 0.5, 0],
  on,
});

test("duplicated lights are independent scene lights without source bindings", () => {
  const source = {
    ...light(false),
    name: "Lamp",
    variable: "lights_lamp",
    source: "vehicle.cfg",
    line: 12,
    mode: "directional",
    direction: [0, -1, 0],
    ambient: [0.1, 0.2, 0.3],
    intensity: 2,
  };
  const duplicate = duplicateLight(source, [source, { name: "Lamp copy" }]);
  assert.equal(duplicate.name, "Lamp copy 2");
  assert.equal(duplicate.created, true);
  assert.equal(duplicate.mode, "directional");
  assert.equal(duplicate.on, false);
  assert.equal("variable" in duplicate, false);
  assert.equal("source" in duplicate, false);
  duplicate.position[0] = 9;
  duplicate.direction[1] = -3;
  duplicate.color[0] = 0;
  duplicate.ambient[0] = 1;
  assert.deepEqual(source.position, [1, 2, 3]);
  assert.deepEqual(source.direction, [0, -1, 0]);
  assert.deepEqual(source.color, [1, 0.5, 0]);
  assert.deepEqual(source.ambient, [0.1, 0.2, 0.3]);
});

test("packs the desktop light limit without mutating inputs", () => {
  const lights = Array.from({ length: 17 }, (_light, index) => ({
    ...light(),
    position: [index, 2, 3],
  }));
  lights[1].on = false;
  const packed = encodeInteriorLights(lights);
  assert.equal(MAX_INTERIOR_LIGHTS, 16);
  assert.deepEqual([...packed.positions.slice(0, 4)], [0, 2, 3, 4]);
  assert.deepEqual([...packed.positions.slice(60, 64)], [15, 2, 3, 4]);
  assert.deepEqual(
    [...packed.colors.slice(0, 8)],
    [1, 0.5, 0, 1, 1, 0.5, 0, 0],
  );
  assert.equal(packed.positions.length, 64);
  assert.equal(packed.positions.includes(16), false);
  assert.equal(lights.length, 17);
  const limited = encodeInteriorLights(lights, 2);
  assert.deepEqual([...limited.positions.slice(0, 8)], [
    0, 2, 3, 4,
    1, 2, 3, 4,
  ]);
  assert.equal(limited.positions.slice(8).every((value) => value === 0), true);
  assert.equal(limited.colors.slice(8).every((value) => value === 0), true);
  for (const limit of [-1, 1.5, 17, NaN]) {
    assert.throws(() => encodeInteriorLights(lights, limit), /Light limit/);
  }
  assert.throws(
    () => encodeInteriorLights([light(), { ...light(), range: Infinity }]),
    /index 1/,
  );
  assert.throws(() => encodeInteriorLights([{ ...light(), on: 1 }]), /index 0/);
});

test("packs intensity into light color and rejects invalid or overflowing values", () => {
  const source = { ...light(false), intensity: 2.5 };
  const packed = encodeInteriorLights([source, { ...light(), intensity: 0 }]);
  assert.deepEqual(
    [...packed.colors.slice(0, 8)],
    [2.5, 1.25, 0, 0, 0, 0, 0, 1],
  );
  assert.deepEqual(source.color, [1, 0.5, 0]);
  for (const intensity of [null, NaN, Infinity, 1e40]) {
    assert.throws(
      () => encodeInteriorLights([{ ...light(), intensity }]),
      /index 0/,
    );
  }
  assert.throws(
    () =>
      encodeInteriorLights([{ ...light(), color: [3e38, 0, 0], intensity: 2 }]),
    /index 0/,
  );
});

test("packs directional and ambient lighting with desktop direction and intensity", () => {
  const directional = {
    ...light(),
    mode: "directional",
    direction: [0, -4, 0],
    intensity: 2,
    ambient: [0.1, 0.2, 0.3],
  };
  const packed = encodeInteriorLights([
    directional,
    { ...light(false), ambient: [0.5, 0, 0] },
  ]);
  assert.deepEqual([...packed.positions.slice(0, 4)], [0, -1, 0, 4]);
  assert.deepEqual([...packed.colors.slice(0, 4)], [2, 1, 0, 2]);
  assert.deepEqual(
    [...packed.ambients.slice(0, 4)],
    [...new Float32Array([0.2, 0.4, 0.6, 0])],
  );
  assert.equal(packed.colors[7], 0);
  for (const direction of [
    [0, 0, 0],
    [1e-100, 0, 0],
    [NaN, 0, 0],
  ]) {
    assert.throws(
      () => encodeInteriorLights([{ ...directional, direction }]),
      /Invalid/,
    );
  }
  const modes = encodeInteriorLights([
    { ...directional, mode: "ambient" },
    { ...directional, mode: "spot" },
  ]);
  assert.deepEqual([modes.colors[3], modes.colors[7]], [3, 4]);
  assert.throws(
    () => encodeInteriorLights([{ ...directional, mode: "unknown" }]),
    /Invalid/,
  );
  assert.throws(
    () => encodeInteriorLights([{ ...directional, ambient: [1e40, 0, 0] }]),
    /Invalid/,
  );
});

for (const [name, create] of [
  ["WebGPU", () => new Renderer({}, {})],
  ["WebGL", () => new WebGLRenderer({}, { isContextLost: () => false })],
]) {
  test(`${name} honors a configurable scene-light limit`, () => {
    const renderer = create();
    renderer._requestFrame = () => {};
    renderer.setLights([light(), light()], 1);
    assert.equal(renderer._lights.colors[3], 1);
    assert.equal(renderer._lights.colors.slice(4).every((value) => value === 0), true);
    assert.throws(() => renderer.setLights([light()], 17), /Light limit/);
  });
  test(`${name} updates lights atomically and schedules a redraw`, () => {
    const renderer = create();
    let frames = 0;
    renderer._requestFrame = () => {
      frames++;
    };
    renderer.setLights([light(), light(false)]);
    assert.deepEqual(
      [...renderer._lights.colors.slice(0, 8)],
      [1, 0.5, 0, 1, 1, 0.5, 0, 0],
    );
    renderer.setLights([{ ...light(), intensity: 2 }]);
    assert.deepEqual([...renderer._lights.colors.slice(0, 4)], [2, 1, 0, 1]);
    const original = renderer._lights;
    assert.throws(
      () => renderer.setLights([{ ...light(), position: [0, NaN, 0] }]),
      /Invalid/,
    );
    assert.throws(
      () => renderer.setLights([{ ...light(), intensity: Infinity }]),
      /Invalid/,
    );
    assert.equal(renderer._lights, original);
    assert.equal(frames, 2);
    renderer.setLights([]);
    assert.ok(renderer._lights.colors.every((value) => value === 0));
    renderer.lost = true;
    assert.throws(() => renderer.setLights([]), /lost/);
  });
  test(`${name} validates editable sun updates and preserves the previous state on failure`, () => {
    const renderer = create();
    let frames = 0;
    renderer._requestFrame = () => {
      frames++;
    };
    const sun = {
      ...light(),
      mode: "directional",
      direction: [0, -1, 0],
      intensity: 1,
    };
    renderer.setSun(sun);
    const previous = renderer._sun;
    assert.equal(previous.colors[3], 2);
    assert.throws(
      () => renderer.setSun({ ...sun, direction: [0, 0, 0] }),
      /Invalid direction/,
    );
    assert.equal(renderer._sun, previous);
    renderer.setSun(null);
    assert.equal(renderer._sun, null);
    assert.equal(frames, 2);
  });
}
