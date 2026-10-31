import test from "node:test";
import assert from "node:assert/strict";
import {
  changeViewpoint,
  changeLodVisibility,
  changeGizmoVisibility,
  bindSceneVisibilityGroups,
  changeSceneGroupVisibility,
  isModelVisible,
  viewpointAllows,
} from "../src/scene-visibility.js";

test("viewpoint masks match desktop selection semantics", () => {
  for (const [viewpoint, expected] of [
    [0, [true, true, true, true, true]],
    [1, [true, true, false, false, true]],
    [2, [true, false, true, false, true]],
    [4, [true, false, false, true, false]],
  ]) {
    assert.deepEqual(
      [
        {},
        { viewpoint: 1 },
        { viewpoint: 2 },
        { viewpoint: 4 },
        { viewpoint: 3 },
      ].map((model) => viewpointAllows(model, viewpoint)),
      expected,
    );
  }
});

test("scene group visibility composes with nested groups and preserves child choices", () => {
  const models = [{}, {}, {}];
  const nested = { type: "map", children: [] };
  const parent = {
    type: "configuration",
    children: [
      { type: "model", modelIndex: 0, children: [] },
      nested,
      { type: "model", modelIndex: 2, children: [] },
    ],
  };
  nested.children.push({ type: "model", modelIndex: 1, children: [] });
  bindSceneVisibilityGroups([parent], models);
  const calls = [];
  const renderer = { setModelVisible: (...args) => calls.push(args) };
  const manual = [true, true, false];
  const config = [true, true, true];

  changeSceneGroupVisibility(
    renderer,
    models,
    manual,
    config,
    0,
    parent,
    false,
  );
  assert.deepEqual(calls, [
    [0, false],
    [1, false],
  ]);
  assert.equal(isModelVisible(models[2], manual[2], config[2], 0), false);
  assert.deepEqual(manual, [true, true, false]);

  changeSceneGroupVisibility(
    renderer,
    models,
    manual,
    config,
    0,
    parent,
    true,
  );
  assert.deepEqual(calls.slice(2), [
    [0, true],
    [1, true],
  ]);
  assert.equal(isModelVisible(models[2], manual[2], config[2], 0), false);

  calls.length = 0;
  changeSceneGroupVisibility(
    renderer,
    models,
    manual,
    config,
    0,
    nested,
    false,
  );
  assert.deepEqual(calls, [[1, false]]);
  assert.equal(isModelVisible(models[0], manual[0], config[0], 0), true);
  assert.equal(isModelVisible(models[1], manual[1], config[1], 0), false);
  changeSceneGroupVisibility(
    renderer,
    models,
    manual,
    config,
    0,
    nested,
    true,
  );
  assert.deepEqual(calls.slice(1), [[1, true]]);
});

test("scene group visibility rolls back renderer and group state on failure", () => {
  const group = {
    type: "configuration",
    children: [
      { type: "model", modelIndex: 0, children: [] },
      { type: "model", modelIndex: 1, children: [] },
    ],
  };
  const models = [{}, {}];
  bindSceneVisibilityGroups([group], models);
  const calls = [];
  const renderer = {
    setModelVisible(index, visible) {
      calls.push([index, visible]);
      if (index === 1 && !visible) throw new Error("device error");
    },
  };
  assert.throws(
    () =>
      changeSceneGroupVisibility(
        renderer,
        models,
        [true, true],
        [true, true],
        0,
        group,
        false,
      ),
    /device error/,
  );
  assert.equal(group.visible, true);
  assert.deepEqual(calls, [
    [0, false],
    [1, false],
    [1, true],
    [0, true],
  ]);
});

test("viewpoint changes preserve manual visibility and only update affected models", () => {
  const models = [
    {},
    { viewpoint: 1 },
    { viewpoint: 2 },
    { viewpoint: 4 },
    { viewpoint: 3 },
  ];
  const calls = [];
  const renderer = { setModelVisible: (...args) => calls.push(args) };
  const manual = [true, false, true, true, true];
  changeViewpoint(renderer, models, manual, 0, 1);
  assert.deepEqual(calls, [
    [2, false],
    [3, false],
  ]);
  calls.length = 0;
  changeViewpoint(renderer, models, manual, 1, 2);
  assert.deepEqual(calls, [[2, true]]);
  assert.throws(
    () => changeViewpoint(renderer, models, manual, 0, 3),
    /Invalid viewpoint/,
  );
  assert.deepEqual(manual, [true, false, true, true, true]);
});

test("failed viewpoint changes roll back and surface rollback failure", () => {
  const models = [{ viewpoint: 2 }, { viewpoint: 4 }];
  const calls = [];
  const renderer = {
    setModelVisible(index, value) {
      calls.push([index, value]);
      if (index === 1 && !value) throw new Error("device error");
    },
  };
  assert.throws(
    () => changeViewpoint(renderer, models, [true, true], 0, 1),
    /device error/,
  );
  assert.deepEqual(calls, [
    [0, false],
    [1, false],
    [1, true],
    [0, true],
  ]);
  assert.throws(
    () =>
      changeViewpoint(
        {
          setModelVisible() {
            throw new Error("lost");
          },
        },
        models,
        [true, true],
        0,
        1,
      ),
    /rollback was incomplete/,
  );
});

test("viewpoint changes never re-enable a variable-hidden mesh", () => {
  const calls = [];
  changeViewpoint(
    { setModelVisible: (...args) => calls.push(args) },
    [{ viewpoint: 1 }, { viewpoint: 2 }],
    [true, true],
    0,
    1,
    [true, false],
  );
  assert.deepEqual(calls, []);
});

test("LOD changes combine with manual, variable and viewpoint visibility", () => {
  const high = { visible: true },
    low = { visible: true };
  const models = [{ lod: high }, { lod: high, viewpoint: 2 }, { lod: low }, {}];
  const manual = [true, true, false, true],
    config = [true, true, true, true];
  const calls = [];
  const renderer = { setModelVisible: (...args) => calls.push(args) };
  changeLodVisibility(renderer, models, manual, config, 1, [
    [high, false],
    [low, false],
  ]);
  assert.deepEqual(calls, [[0, false]]);
  assert.equal(high.visible, false);
  assert.equal(low.visible, false);
  assert.equal(isModelVisible(models[1], true, true, 2), false);
  calls.length = 0;
  changeViewpoint(renderer, models, manual, 1, 2, config);
  assert.deepEqual(calls, []);
  changeLodVisibility(renderer, models, manual, config, 2, [[high, true]]);
  assert.deepEqual(calls, [
    [0, true],
    [1, true],
  ]);
  config[0] = false;
  calls.length = 0;
  changeLodVisibility(renderer, models, manual, config, 2, [[high, false]]);
  assert.deepEqual(calls, [[1, false]]);
});

test("failed LOD updates restore renderer state and retain group settings", () => {
  const lod = { visible: true };
  const models = [{ lod }, { lod }];
  const calls = [];
  const renderer = {
    setModelVisible(index, visible) {
      calls.push([index, visible]);
      if (index === 1 && !visible) throw new Error("device error");
    },
  };
  assert.throws(
    () =>
      changeLodVisibility(renderer, models, [true, true], [true, true], 0, [
        [lod, false],
      ]),
    /device error/,
  );
  assert.deepEqual(calls, [
    [0, false],
    [1, false],
    [1, true],
    [0, true],
  ]);
  assert.equal(lod.visible, true);
  assert.throws(
    () =>
      changeLodVisibility(renderer, models, [true, true], [true, true], 0, [
        [lod, 0],
      ]),
    /Invalid LOD/,
  );
  assert.throws(
    () =>
      changeLodVisibility(renderer, models, [true, true], [true, true], 0, [
        [lod, true],
        [lod, false],
      ]),
    /Invalid LOD/,
  );
});

test("gizmo visibility composes with the other filters and leaves ordinary meshes alone", () => {
  const lod = { visible: false };
  const models = [
    { gizmoVisible: true },
    { gizmoVisible: true, lod },
    {},
    { gizmoVisible: true },
  ];
  const manual = [true, true, true, false],
    config = [true, true, true, true];
  const calls = [];
  const renderer = { setModelVisible: (...args) => calls.push(args) };
  changeGizmoVisibility(renderer, models, manual, config, 0, false);
  assert.deepEqual(calls, [[0, false]]);
  assert.deepEqual(
    models.map((model) => model.gizmoVisible),
    [false, false, undefined, false],
  );
  calls.length = 0;
  changeLodVisibility(renderer, models, manual, config, 0, [[lod, true]]);
  assert.deepEqual(calls, []);
  changeGizmoVisibility(renderer, models, manual, config, 0, true);
  assert.deepEqual(calls, [
    [0, true],
    [1, true],
  ]);
  assert.throws(
    () => changeGizmoVisibility(renderer, models, manual, config, 0, 1),
    /Invalid gizmo/,
  );
});

test("gizmo update rolls back if the renderer rejects a change", () => {
  const models = [{ gizmoVisible: true }, { gizmoVisible: true }];
  const calls = [];
  const renderer = {
    setModelVisible(index, visible) {
      calls.push([index, visible]);
      if (index === 1 && !visible) throw new Error("device error");
    },
  };
  assert.throws(
    () =>
      changeGizmoVisibility(
        renderer,
        models,
        [true, true],
        [true, true],
        0,
        false,
      ),
    /device error/,
  );
  assert.deepEqual(calls, [
    [0, false],
    [1, false],
    [1, true],
    [0, true],
  ]);
  assert.ok(models.every((model) => model.gizmoVisible));
});
