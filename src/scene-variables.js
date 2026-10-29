import { isModelVisible } from "./scene-visibility.js";

export function collectSceneVariables(models, lights = []) {
  const variables = new Map();
  for (const [modelIndex, model] of models.entries()) {
    for (const [materialIndex, material] of model.materials.entries()) {
      for (const [name, property] of [
        [material.alphaScaleVar, "alphaScale"],
        [material.lightmapVar, "lightmapStrength"],
      ]) {
        if (!name) continue;
        if (!variables.has(name)) variables.set(name, { name, value: 1, bindings: [], visibilityBindings: [] });
        const bindings = variables.get(name).bindings;
        let binding = bindings.find(item => item.modelIndex === modelIndex && item.materialIndex === materialIndex);
        if (!binding) {
          binding = { modelIndex, materialIndex, material, properties: [] };
          bindings.push(binding);
        }
        binding.properties.push(property);
      }
    }
  }
  for (const [modelIndex, model] of models.entries()) {
    for (const condition of model.visibles ?? []) {
      if (!variables.has(condition.variable)) {
        variables.set(condition.variable, { name: condition.variable, value: 0, bindings: [], visibilityBindings: [] });
      }
      variables.get(condition.variable).visibilityBindings.push({ modelIndex, value: condition.value });
    }
  }
  for (const [index, light] of lights.entries()) {
    if (!light.variable) continue;
    if (!variables.has(light.variable)) {
      variables.set(light.variable, { name: light.variable, value: light.intensity ?? 1, bindings: [], visibilityBindings: [] });
    }
    const variable = variables.get(light.variable);
    (variable.lightBindings ??= []).push(index);
  }
  return [...variables.values()];
}

export function updateSceneVariable(renderer, variable, value, visibility) {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new RangeError("Variable value must be a finite 32-bit float");
  }
  if (variable.bindings.length && (value < 0 || value > 1)) {
    throw new RangeError("Variable value must be between 0 and 1");
  }
  if (variable.visibilityBindings.length && !visibility) {
    throw new TypeError("Visibility state is required for this variable");
  }
  const lightBindings = variable.lightBindings ?? [];
  if (lightBindings.length && (!visibility || !Array.isArray(visibility.lights) ||
      lightBindings.some(index => !Number.isInteger(index) || !visibility.lights[index]))) {
    throw new TypeError("Light state is required for this variable");
  }
  const nextLights = lightBindings.length ? visibility.lights.map((light, index) =>
    lightBindings.includes(index) ? { ...light, intensity: value } : light) : null;
  const updates = variable.bindings.map(binding => {
    const updated = { ...binding.material };
    for (const property of binding.properties) updated[property] = value;
    return { ...binding, updated };
  });
  const visibilityUpdates = new Map();
  for (const binding of variable.visibilityBindings) {
    visibilityUpdates.set(binding.modelIndex, Math.fround(value) === binding.value);
  }
  const attempted = [];
  try {
    for (const update of updates) {
      attempted.push(() => renderer.updateMaterial(update.modelIndex, update.materialIndex, update.material));
      renderer.updateMaterial(update.modelIndex, update.materialIndex, update.updated);
    }
    for (const [index, visible] of visibilityUpdates) {
      const { models, manualVisibility, configVisibility, viewpoint } = visibility;
      const oldVisible = isModelVisible(models[index], manualVisibility[index], configVisibility[index], viewpoint);
      const newVisible = isModelVisible(models[index], manualVisibility[index], visible, viewpoint);
      if (oldVisible === newVisible) continue;
      attempted.push(() => renderer.setModelVisible(index, oldVisible));
      renderer.setModelVisible(index, newVisible);
    }
    if (nextLights) {
      attempted.push(() => renderer.setLights(visibility.lights));
      renderer.setLights(nextLights);
    }
  } catch (error) {
    const errors = [error];
    for (const undo of attempted.reverse()) {
      try {
        undo();
      } catch (rollbackError) {
        errors.push(rollbackError);
      }
    }
    if (errors.length > 1) throw new AggregateError(errors, "Variable update failed and renderer rollback was incomplete");
    throw error;
  }
  for (const update of updates) Object.assign(update.material, update.updated);
  for (const [index, visible] of visibilityUpdates) visibility.configVisibility[index] = visible;
  if (nextLights) visibility.lights.splice(0, visibility.lights.length, ...nextLights);
  variable.value = value;
}
