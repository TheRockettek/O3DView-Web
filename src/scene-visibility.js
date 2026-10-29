export function viewpointAllows(model, viewpoint) {
  const mask = model.viewpoint ?? 0;
  return viewpoint === 0 || mask === 0 || (mask & viewpoint) !== 0;
}

export function isModelVisible(model, manual, config, viewpoint) {
  return (
    manual &&
    config &&
    model.lod?.visible !== false &&
    model.gizmoVisible !== false &&
    viewpointAllows(model, viewpoint)
  );
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
      const newVisible =
        manualVisibility[index] &&
        configVisibility[index] &&
        model.lod?.visible !== false &&
        visible &&
        viewpointAllows(model, viewpoint);
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
      const newVisible =
        manualVisibility[index] &&
        configVisibility[index] &&
        desired.get(model.lod) &&
        model.gizmoVisible !== false &&
        viewpointAllows(model, viewpoint);
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
