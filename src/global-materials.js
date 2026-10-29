export function updateNightStrength(renderer, models, value) {
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new RangeError("Night map strength must be between 0 and 2");
  }
  const updates = [];
  for (const [modelIndex, model] of models.entries()) {
    for (const [materialIndex, material] of model.materials.entries()) {
      updates.push({
        modelIndex,
        materialIndex,
        material,
        next: { ...material, nightmapStrength: value },
      });
    }
  }
  const attempted = [];
  try {
    for (const update of updates) {
      attempted.push(update);
      renderer.updateMaterial(
        update.modelIndex,
        update.materialIndex,
        update.next,
      );
    }
  } catch (error) {
    const errors = [error];
    for (const update of attempted.reverse()) {
      try {
        renderer.updateMaterial(
          update.modelIndex,
          update.materialIndex,
          update.material,
        );
      } catch (rollbackError) {
        errors.push(rollbackError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "Night map update failed and renderer rollback was incomplete",
      );
    throw error;
  }
  for (const update of updates) update.material.nightmapStrength = value;
}
