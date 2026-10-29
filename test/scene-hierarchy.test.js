import test from "node:test";
import assert from "node:assert/strict";
import {
  deletableSceneModelIndices,
  canContainSceneNode,
  moveSceneNode,
  reparentSceneNode,
  restoreSceneNodeParent,
} from "../src/scene-hierarchy.js";

test("scene deletion accepts standard models and isolated spline/path geometry", () => {
  const models = [
    {},
    { gizmoVisible: true, splineSource: {}, splinePlacement: {} },
    { gizmoVisible: true, splineSource: {}, pathPlacement: {} },
    { gizmoVisible: true, cabinPathSource: "cabin.cfg" },
  ];
  const model = { type: "model", modelIndex: 0, children: [] };
  const spline = { type: "spline", modelIndex: 1, children: [] };
  const path = { type: "path", modelIndex: 2, children: [] };

  assert.deepEqual(deletableSceneModelIndices(model, models), [0]);
  assert.deepEqual(deletableSceneModelIndices(spline, models), [1]);
  assert.deepEqual(deletableSceneModelIndices(path, models), [2]);
  assert.equal(
    deletableSceneModelIndices(
      { type: "model", modelIndex: 3, children: [] },
      models,
    ),
    null,
  );
  assert.equal(
    deletableSceneModelIndices(
      { type: "spline", modelIndex: 0, children: [] },
      models,
    ),
    null,
  );
});

test("scene deletion allows model-only groups with spline/path leaves, not mixed groups", () => {
  const models = [
    {},
    { gizmoVisible: true, splineSource: {}, splinePlacement: {} },
  ];
  const group = {
    type: "map",
    children: [
      { type: "model", modelIndex: 0, children: [] },
      { type: "spline", modelIndex: 1, children: [] },
    ],
  };
  assert.deepEqual(deletableSceneModelIndices(group, models), [0, 1]);
  assert.equal(
    deletableSceneModelIndices(
      {
        ...group,
        children: [...group.children, { type: "light", lightIndex: 0 }],
      },
      models,
    ),
    null,
  );
});

test("scene nodes move one position within their sibling list", () => {
  const first = { name: "first" };
  const second = { name: "second" };
  const third = { name: "third" };
  const siblings = [first, second, third];

  assert.equal(moveSceneNode(siblings, third, -1), true);
  assert.deepEqual(siblings, [first, third, second]);
  assert.equal(moveSceneNode(siblings, first, -1), false);
  assert.deepEqual(siblings, [first, third, second]);
  assert.equal(moveSceneNode(siblings, second, 1), false);
  assert.deepEqual(siblings, [first, third, second]);
});

test("the scene sun is a protected leaf, not a parent or deletable model group", () => {
  const sun = { type: "sun", children: [] };
  const parent = { type: "configuration", children: [] };

  assert.equal(canContainSceneNode(sun), false);
  assert.equal(canContainSceneNode(parent), true);
  assert.equal(deletableSceneModelIndices(sun, []), null);
  assert.throws(
    () => reparentSceneNode([sun, parent], parent, sun),
    /cannot contain children/,
  );
});

test("scene node moves reject invalid nodes and directions", () => {
  const siblings = [{}];
  assert.throws(
    () => moveSceneNode(siblings, {}, 1),
    /not in this sibling list/,
  );
  assert.throws(() => moveSceneNode(siblings, siblings[0], 0), /Invalid scene/);
});

test("scene groups can be reparented and restored without changing node data", () => {
  const child = { type: "map", name: "child", children: [] };
  const first = { type: "configuration", name: "first", children: [child] };
  const second = { type: "configuration", name: "second", children: [] };
  const hierarchy = [first, second];
  const move = reparentSceneNode(hierarchy, child, second);

  assert.equal(first.children.length, 0);
  assert.equal(second.children[0], child);
  assert.equal(child.name, "child");
  restoreSceneNodeParent(hierarchy, child, move);
  assert.deepEqual(first.children, [child]);
  assert.deepEqual(second.children, []);
});

test("model occurrences can be reparented without changing their model index", () => {
  const model = { type: "model", modelIndex: 3, children: [] };
  const source = { type: "configuration", children: [model] };
  const target = { type: "map", children: [] };
  const hierarchy = [source, target];

  const move = reparentSceneNode(hierarchy, model, target);
  assert.equal(model.modelIndex, 3);
  assert.equal(target.children[0], model);
  restoreSceneNodeParent(hierarchy, model, move);
  assert.equal(source.children[0], model);
});

test("light and cabin nodes can be reparented without changing their records", () => {
  const light = { type: "light", lightIndex: 2, children: [] };
  const cabinItem = { type: "cabin-item", info: { kind: "seat" }, children: [] };
  const source = {
    type: "configuration",
    children: [light, cabinItem],
  };
  const target = { type: "map", children: [] };
  const hierarchy = [source, target];

  const lightMove = reparentSceneNode(hierarchy, light, target);
  const cabinMove = reparentSceneNode(hierarchy, cabinItem, target);
  assert.equal(light.lightIndex, 2);
  assert.equal(cabinItem.info.kind, "seat");
  assert.deepEqual(target.children, [light, cabinItem]);
  restoreSceneNodeParent(hierarchy, cabinItem, cabinMove);
  restoreSceneNodeParent(hierarchy, light, lightMove);
  assert.deepEqual(source.children, [light, cabinItem]);
});

test("scene node reparenting rejects cycles, leaves and detached parents", () => {
  const child = { type: "map", children: [] };
  const parent = { type: "configuration", children: [child] };
  const lod = { type: "lod", children: [] };
  const hierarchy = [parent];
  const leaf = { type: "model", children: [] };
  hierarchy.push(leaf, lod);

  assert.throws(
    () => reparentSceneNode(hierarchy, parent, child),
    /itself or a descendant/,
  );
  assert.throws(
    () => reparentSceneNode(hierarchy, child, leaf),
    /cannot contain children/,
  );
  assert.throws(
    () => reparentSceneNode(hierarchy, child, lod),
    /cannot contain children/,
  );
  assert.throws(
    () =>
      reparentSceneNode(hierarchy, child, {
        type: "configuration",
        children: [],
      }),
    /not in this hierarchy/,
  );
  assert.equal(reparentSceneNode(hierarchy, child, parent), null);
});
