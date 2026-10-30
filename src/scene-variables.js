import { isModelVisible } from "./scene-visibility.js";

const textureMaps = [
  "texture",
  "transmap",
  "nightmap",
  "lightmap",
  "bumpmap",
  "envmap",
];
const pathKey = (path) => path.replaceAll("\\", "/").toLowerCase();

export function collectSceneVariables(
  models,
  lights = [],
  stringVariables = [],
  floatVariables = [],
) {
  const variables = new Map();
  function addStringVariable(name, value) {
    let variable = variables.get(name);
    if (variable && !variable.stringType) return null;
    if (!variable) {
      variable = {
        name,
        value,
        bindings: [],
        visibilityBindings: [],
        stringType: true,
        freeTextureRules: [],
        textureBindings: [],
      };
      variables.set(name, variable);
    }
    return variable;
  }
  for (const variable of stringVariables)
    addStringVariable(variable.name, variable.value);
  for (const { name, value } of floatVariables) {
    let variable = variables.get(name);
    if (variable?.stringType) continue;
    if (!variable) {
      variable = {
        name,
        value,
        bindings: [],
        visibilityBindings: [],
      };
      variables.set(name, variable);
    } else {
      variable.value = value;
    }
  }
  for (const [modelIndex, model] of models.entries()) {
    for (const [materialIndex, material] of model.materials.entries()) {
      for (const [name, property] of [
        [material.alphaScaleVar, "alphaScale"],
        [material.lightmapVar, "lightmapStrength"],
        [material.texcoordTransXVar, null],
        [material.texcoordTransYVar, null],
      ]) {
        if (!name) continue;
        const defaultValue =
          property === "lightmapStrength" || property === null ? 0 : 1;
        if (!variables.has(name))
          variables.set(name, {
            name,
            value: defaultValue,
            bindings: [],
            visibilityBindings: [],
          });
        const variable = variables.get(name);
        if (variable.stringType) continue;
        variable.value = defaultValue;
        if (!property) continue;
        const bindings = variable.bindings;
        let binding = bindings.find(
          (item) =>
            item.modelIndex === modelIndex &&
            item.materialIndex === materialIndex,
        );
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
        variables.set(condition.variable, {
          name: condition.variable,
          value: 0,
          bindings: [],
          visibilityBindings: [],
        });
      }
      const variable = variables.get(condition.variable);
      if (!variable.stringType)
        variable.visibilityBindings.push({
          modelIndex,
          value: condition.value,
        });
    }
  }
  for (const [index, light] of lights.entries()) {
    if (!light.variable) continue;
    if (!variables.has(light.variable)) {
      variables.set(light.variable, {
        name: light.variable,
        value: light.intensity ?? 1,
        bindings: [],
        visibilityBindings: [],
      });
    }
    const variable = variables.get(light.variable);
    if (variable.stringType) continue;
    (variable.lightBindings ??= []).push(index);
  }
  for (const model of models) {
    for (const material of model.materials) {
      for (const entry of material.freeTextures ?? []) {
        const variable = addStringVariable(entry.varName, entry.path);
        if (!variable) continue;
        if (
          !variable.freeTextureRules.some(
            (rule) =>
              pathKey(rule.path) === pathKey(entry.path) &&
              rule.source === entry.source,
          )
        )
          variable.freeTextureRules.push({
            path: entry.path,
            source: entry.source,
          });
      }
    }
  }
  for (const variable of variables.values()) {
    if (!variable.stringType) continue;
    const seen = new Set();
    for (const rule of variable.freeTextureRules) {
      for (const [modelIndex, model] of models.entries()) {
        for (const [materialIndex, material] of model.materials.entries()) {
          for (const map of textureMaps) {
            if (pathKey(material[`${map}Name`] ?? "") !== pathKey(rule.path))
              continue;
            const key = `${modelIndex}:${materialIndex}:${map}`;
            if (seen.has(key)) continue;
            seen.add(key);
            variable.textureBindings.push({
              modelIndex,
              materialIndex,
              material,
              map,
              source: rule.source,
            });
          }
        }
      }
    }
  }
  return [...variables.values()];
}

export function initializeSceneVariableDefaults(models, lights = []) {
  const configVisibility = models.map(() => true);
  for (const variable of collectSceneVariables(models, lights)) {
    for (const binding of variable.bindings) {
      for (const property of binding.properties)
        binding.material[property] = variable.value;
    }
    for (const binding of variable.visibilityBindings)
      configVisibility[binding.modelIndex] =
        Math.fround(variable.value) === binding.value;
    for (const index of variable.lightBindings ?? [])
      lights[index].intensity = variable.value;
  }
  return configVisibility;
}

export function updateSceneVariable(renderer, variable, value, visibility) {
  if (!variable || variable.stringType)
    throw new TypeError("Expected a numeric scene variable");
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
  if (
    lightBindings.length &&
    (!visibility ||
      !Array.isArray(visibility.lights) ||
      lightBindings.some(
        (index) => !Number.isInteger(index) || !visibility.lights[index],
      ))
  ) {
    throw new TypeError("Light state is required for this variable");
  }
  const nextLights = lightBindings.length
    ? visibility.lights.map((light, index) =>
        lightBindings.includes(index) ? { ...light, intensity: value } : light,
      )
    : null;
  const updates = variable.bindings.map((binding) => {
    const updated = { ...binding.material };
    for (const property of binding.properties) updated[property] = value;
    return { ...binding, updated };
  });
  const visibilityUpdates = new Map();
  for (const binding of variable.visibilityBindings) {
    visibilityUpdates.set(
      binding.modelIndex,
      Math.fround(value) === binding.value,
    );
  }
  const attempted = [];
  try {
    for (const update of updates) {
      attempted.push(() =>
        renderer.updateMaterial(
          update.modelIndex,
          update.materialIndex,
          update.material,
        ),
      );
      renderer.updateMaterial(
        update.modelIndex,
        update.materialIndex,
        update.updated,
      );
    }
    for (const [index, visible] of visibilityUpdates) {
      const { models, manualVisibility, configVisibility, viewpoint } =
        visibility;
      const oldVisible = isModelVisible(
        models[index],
        manualVisibility[index],
        configVisibility[index],
        viewpoint,
      );
      const newVisible = isModelVisible(
        models[index],
        manualVisibility[index],
        visible,
        viewpoint,
      );
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
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "Variable update failed and renderer rollback was incomplete",
      );
    throw error;
  }
  for (const update of updates) Object.assign(update.material, update.updated);
  for (const [index, visible] of visibilityUpdates)
    visibility.configVisibility[index] = visible;
  if (nextLights)
    visibility.lights.splice(0, visibility.lights.length, ...nextLights);
  variable.value = value;
}

export async function updateSceneStringVariable(
  renderer,
  variable,
  value,
  loadTexture,
) {
  if (!variable?.stringType || typeof value !== "string")
    throw new TypeError("Expected a string scene variable");
  if (variable.freeTextureRules?.length && !value.trim())
    throw new RangeError("Texture path must not be empty");
  const bindings = variable.textureBindings ?? [];
  if (bindings.length && typeof loadTexture !== "function")
    throw new TypeError("Texture loader is required for this variable");
  const textures = new Map();
  const updates = new Map();
  for (const binding of bindings) {
    let texture = textures.get(binding.source);
    if (!texture) {
      texture = await loadTexture(binding.source, value);
      if (!texture || !texture.bitmap || typeof texture.hasAlpha !== "boolean")
        throw new TypeError("Texture loader returned invalid texture data");
      textures.set(binding.source, texture);
    }
    const key = `${binding.modelIndex}:${binding.materialIndex}`;
    let update = updates.get(key);
    if (!update) {
      update = {
        modelIndex: binding.modelIndex,
        materialIndex: binding.materialIndex,
        material: binding.material,
        updated: { ...binding.material },
      };
      updates.set(key, update);
    }
    update.updated[binding.map] = texture.bitmap;
    if (binding.map === "texture")
      update.updated.textureTransparent = texture.hasAlpha;
  }
  const attempted = [];
  try {
    for (const update of updates.values()) {
      attempted.push(update);
      renderer.updateMaterial(
        update.modelIndex,
        update.materialIndex,
        update.updated,
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
        "String variable update failed and renderer rollback was incomplete",
      );
    throw error;
  }
  for (const update of updates.values())
    Object.assign(update.material, update.updated);
  variable.value = value;
}
