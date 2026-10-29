export function viewpointAllows(model, viewpoint) {
  const mask = model.viewpoint ?? 0;
  return viewpoint === 0 || mask === 0 || (mask & viewpoint) !== 0;
}

export function bindSceneVisibilityGroups(hierarchy, models) {
  const visibilityGroups = models.map(() => []);
  function visit(nodes, ancestors) {
    for (const node of nodes) {
      if (node.type === "model") {
        if (Number.isInteger(node.modelIndex) && models[node.modelIndex])
          visibilityGroups[node.modelIndex] = ancestors;
        continue;
      }
      const groups =
        node.type === "lod" ? ancestors : [...ancestors, node];
      visit(node.children || [], groups);
    }
  }
  visit(hierarchy, []);
  for (const [index, model] of models.entries())
    model.visibilityGroups = visibilityGroups[index];
}

export function isModelVisible(model, manual, config, viewpoint) {
  return (
    manual &&
    config &&
    (!model.visibilityGroups ||
      model.visibilityGroups.every((group) => group.visible !== false)) &&
    model.lod?.visible !== false &&
    model.gizmoVisible !== false &&
    viewpointAllows(model, viewpoint)
  );
}

export function changeSceneGroupVisibility(
  renderer,
  models,
  manualVisibility,
  configVisibility,
  viewpoint,
  node,
  visible,
) {
  if (!node || !Array.isArray(node.children) || typeof visible !== "boolean")
    throw new TypeError("Invalid scene group visibility change");
  const previous = node.visible !== false;
  if (previous === visible) return;
  const affected = [];
  for (const [index, model] of models.entries()) {
    if (!model.visibilityGroups?.includes(node)) continue;
    affected.push({
      index,
      model,
      oldVisible: isModelVisible(
        model,
        manualVisibility[index],
        configVisibility[index],
        viewpoint,
      ),
    });
  }
  const attempted = [];
  node.visible = visible;
  try {
    for (const { index, model, oldVisible } of affected) {
      const newVisible = isModelVisible(
        model,
        manualVisibility[index],
        configVisibility[index],
        viewpoint,
      );
      if (oldVisible === newVisible) continue;
      attempted.push({ index, oldVisible });
      renderer.setModelVisible(index, newVisible);
    }
  } catch (error) {
    const errors = [error];
    node.visible = previous;
    for (const { index, oldVisible } of attempted.reverse()) {
      try {
        renderer.setModelVisible(index, oldVisible);
      } catch (rollbackError) {
        errors.push(rollbackError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "Scene group visibility change failed and renderer rollback was incomplete",
      );
    throw error;
  }
}

export function changeGizmoVisibility(
  renderer,
  models,
  manualVisibility,
  configVisibility,
  viewpoint,
  visible,
) {
  if (typeof visible !== "boolean")
    throw new TypeError("Invalid gizmo visibility");
  const attempted = [];
  try {
    for (const [index, model] of models.entries()) {
      if (model.gizmoVisible === undefined) continue;
      const oldVisible = isModelVisible(
        model,
        manualVisibility[index],
        configVisibility[index],
        viewpoint,
      );
      const newVisible = isModelVisible(
        { ...model, gizmoVisible: visible },
        manualVisibility[index],
        configVisibility[index],
        viewpoint,
      );
      if (oldVisible === newVisible) continue;
      attempted.push({ index, oldVisible });
      renderer.setModelVisible(index, newVisible);
    }
  } catch (error) {
    const errors = [error];
    for (const { index, oldVisible } of attempted.reverse()) {
      try {
        renderer.setModelVisible(index, oldVisible);
      } catch (rollbackError) {
        errors.push(rollbackError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "Gizmo change failed and renderer rollback was incomplete",
      );
    throw error;
  }
  for (const model of models)
    if (model.gizmoVisible !== undefined) model.gizmoVisible = visible;
}

export function changeLodVisibility(
  renderer,
  models,
  manualVisibility,
  configVisibility,
  viewpoint,
  changes,
) {
  const desired = new Map();
  for (const [lod, visible] of changes) {
    if (!lod || typeof visible !== "boolean" || desired.has(lod))
      throw new TypeError("Invalid LOD visibility change");
    desired.set(lod, visible);
  }
  const attempted = [];
  try {
    for (const [index, model] of models.entries()) {
      if (!desired.has(model.lod)) continue;
      const oldVisible = isModelVisible(
        model,
        manualVisibility[index],
        configVisibility[index],
        viewpoint,
      );
      const newVisible = isModelVisible(
        {
          ...model,
          lod: { ...model.lod, visible: desired.get(model.lod) },
        },
        manualVisibility[index],
        configVisibility[index],
        viewpoint,
      );
      if (oldVisible === newVisible) continue;
      attempted.push({ index, oldVisible });
      renderer.setModelVisible(index, newVisible);
    }
  } catch (error) {
    const errors = [error];
    for (const { index, oldVisible } of attempted.reverse()) {
      try {
        renderer.setModelVisible(index, oldVisible);
      } catch (rollbackError) {
        errors.push(rollbackError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "LOD change failed and renderer rollback was incomplete",
      );
    throw error;
  }
  for (const [lod, visible] of desired) lod.visible = visible;
}

export function changeViewpoint(
  renderer,
  models,
  manualVisibility,
  previous,
  next,
  configVisibility = models.map(() => true),
) {
  if (![0, 1, 2, 4].includes(next) || ![0, 1, 2, 4].includes(previous)) {
    throw new RangeError("Invalid viewpoint");
  }
  const attempted = [];
  try {
    for (const [index, model] of models.entries()) {
      const oldVisible = isModelVisible(
        model,
        manualVisibility[index],
        configVisibility[index],
        previous,
      );
      const newVisible = isModelVisible(
        model,
        manualVisibility[index],
        configVisibility[index],
        next,
      );
      if (oldVisible === newVisible) continue;
      attempted.push({ index, oldVisible });
      renderer.setModelVisible(index, newVisible);
    }
  } catch (error) {
    const errors = [error];
    for (const { index, oldVisible } of attempted.reverse()) {
      try {
        renderer.setModelVisible(index, oldVisible);
      } catch (rollbackError) {
        errors.push(rollbackError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "Viewpoint change failed and renderer rollback was incomplete",
      );
    throw error;
  }
}
