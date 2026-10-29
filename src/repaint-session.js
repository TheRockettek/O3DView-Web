import { updateSceneVariable } from "./scene-variables.js";
import { isModelVisible } from "./scene-visibility.js";

const MAPS = [
  "texture",
  "transmap",
  "nightmap",
  "lightmap",
  "bumpmap",
  "envmap",
];
const pathKey = (path) => path.replaceAll("\\", "/").toLowerCase();

export function createRepaintSession(models, groups, textures) {
  const originals = new Map(),
    bindings = new Map(),
    schemes = new Set();
  const ctis = new Map();
  function addCTIs(records) {
    const incoming = new Set();
    for (const cti of records) {
      const key = pathKey(cti.source);
      if (ctis.has(key) || incoming.has(key))
        throw new Error(`Repaint file "${cti.source}" is already loaded`);
      incoming.add(key);
    }
    for (const cti of records) {
      ctis.set(pathKey(cti.source), { ...cti, active: true });
      for (const item of cti.items) schemes.add(item.name);
    }
  }
  for (const group of groups) {
    for (const cti of group.ctis) {
      if (!ctis.has(pathKey(cti.source))) addCTIs([cti]);
    }
  }
  for (const group of groups) {
    const slots = new Map(
      group.ctc.textures.map((slot) => [slot.name.toLowerCase(), slot]),
    );
    const grouped = new Map();
    for (const modelIndex of group.modelIndices) {
      const model = models[modelIndex];
      if (!model) throw new RangeError("Invalid repaint model index");
      for (const [materialIndex, material] of model.materials.entries()) {
        for (const slot of slots.values()) {
          for (const map of MAPS) {
            const name = material[`${map}Name`];
            if (!name || pathKey(name) !== pathKey(slot.path)) continue;
            const key = `${modelIndex}:${materialIndex}`;
            if (!originals.has(key))
              originals.set(key, {
                modelIndex,
                materialIndex,
                material,
                maps: {},
              });
            const original = originals.get(key);
            if (!(map in original.maps)) {
              original.maps[map] = material[map] ?? null;
              if (map === "texture")
                original.textureTransparent =
                  material.textureTransparent ?? false;
            }
            const slotKey = slot.name.toLowerCase();
            if (!grouped.has(slotKey)) grouped.set(slotKey, []);
            grouped.get(slotKey).push({ key, map });
          }
        }
      }
    }
    bindings.set(group, grouped);
  }

  function includeDuplicates(pairs) {
    if (!Array.isArray(pairs)) throw new TypeError("Invalid duplicated models");
    const targetIndices = new Set();
    for (const [sourceIndex, targetIndex] of pairs) {
      if (
        !Number.isInteger(sourceIndex) ||
        !Number.isInteger(targetIndex) ||
        !models[sourceIndex] ||
        !models[targetIndex] ||
        sourceIndex === targetIndex ||
        targetIndices.has(targetIndex)
      )
        throw new RangeError("Invalid duplicated repaint model");
      targetIndices.add(targetIndex);
    }
    const additions = [];
    const groupTargets = new Map();
    for (const group of groups) {
      const grouped = bindings.get(group);
      if (!grouped) throw new Error("Missing repaint bindings for a group");
      const slots = new Map(
        group.ctc.textures.map((slot) => [slot.name.toLowerCase(), slot]),
      );
      for (const [sourceIndex, targetIndex] of pairs) {
        if (
          !group.modelIndices.includes(sourceIndex) ||
          group.modelIndices.includes(targetIndex)
        )
          continue;
        const target = models[targetIndex];
        if (!groupTargets.has(group)) groupTargets.set(group, []);
        groupTargets.get(group).push(targetIndex);
        for (const [materialIndex, material] of target.materials.entries()) {
          for (const slot of slots.values()) {
            for (const map of MAPS) {
              const name = material[`${map}Name`];
              if (!name || pathKey(name) !== pathKey(slot.path)) continue;
              const sourceOriginal = originals.get(
                `${sourceIndex}:${materialIndex}`,
              );
              if (!sourceOriginal) continue;
              const slotKey = slot.name.toLowerCase();
              const targets = grouped.get(slotKey);
              if (!targets)
                throw new Error(
                  `Missing repaint slot "${slotKey}" for duplicated model`,
                );
              const key = `${targetIndex}:${materialIndex}`;
              additions.push({
                key,
                map,
                targets,
                original: {
                  ...sourceOriginal,
                  modelIndex: targetIndex,
                  materialIndex,
                  material,
                  maps: { ...sourceOriginal.maps },
                },
              });
            }
          }
        }
      }
    }
    const newOriginals = new Map();
    for (const addition of additions)
      if (!newOriginals.has(addition.key))
        newOriginals.set(addition.key, addition.original);
    for (const [group, indices] of groupTargets)
      group.modelIndices.push(...indices);
    for (const [key, original] of newOriginals) originals.set(key, original);
    for (const addition of additions)
      addition.targets.push({ key: addition.key, map: addition.map });
  }

  function includeDuplicate(sourceIndex, targetIndex) {
    includeDuplicates([[sourceIndex, targetIndex]]);
  }

  function removeModels(indices) {
    if (!Array.isArray(indices)) throw new TypeError("Invalid removed models");
    const removed = new Set(indices);
    if (
      removed.size !== indices.length ||
      [...removed].some(
        (index) => !Number.isInteger(index) || !models[index],
      )
    )
      throw new RangeError("Invalid removed repaint model");
    if (!removed.size) return;

    const modelIndices = new Map();
    let nextIndex = 0;
    for (let index = 0; index < models.length; index++)
      if (!removed.has(index)) modelIndices.set(index, nextIndex++);

    const nextOriginals = new Map();
    for (const original of originals.values()) {
      const modelIndex = modelIndices.get(original.modelIndex);
      if (modelIndex === undefined) continue;
      const key = `${modelIndex}:${original.materialIndex}`;
      if (nextOriginals.has(key))
        throw new Error("Duplicate repaint material binding after removal");
      nextOriginals.set(key, { ...original, modelIndex });
    }

    const nextBindings = new Map(),
      nextGroupIndices = new Map();
    for (const group of groups) {
      const grouped = bindings.get(group);
      if (!grouped) throw new Error("Missing repaint bindings for a group");
      const nextGroup = new Map();
      for (const [slot, targets] of grouped) {
        const nextTargets = [];
        for (const target of targets) {
          const separator = target.key.indexOf(":");
          const oldModelIndex = Number(target.key.slice(0, separator));
          const materialIndex = Number(target.key.slice(separator + 1));
          if (
            separator < 0 ||
            !Number.isInteger(oldModelIndex) ||
            !Number.isInteger(materialIndex) ||
            !models[oldModelIndex]
          )
            throw new Error("Invalid repaint material binding");
          const modelIndex = modelIndices.get(oldModelIndex);
          if (modelIndex !== undefined)
            nextTargets.push({
              ...target,
              key: `${modelIndex}:${materialIndex}`,
            });
        }
        nextGroup.set(slot, nextTargets);
      }
      nextBindings.set(group, nextGroup);
      nextGroupIndices.set(
        group,
        group.modelIndices.flatMap((index) => {
          const modelIndex = modelIndices.get(index);
          return modelIndex === undefined ? [] : [modelIndex];
        }),
      );
    }

    originals.clear();
    for (const [key, original] of nextOriginals) originals.set(key, original);
    for (const group of groups) {
      group.modelIndices.length = 0;
      for (const index of nextGroupIndices.get(group))
        group.modelIndices.push(index);
      bindings.set(group, nextBindings.get(group));
    }
  }

  function referencesTexture(texture) {
    for (const original of originals.values())
      if (Object.values(original.maps).includes(texture)) return true;
    return false;
  }

  return {
    get schemes() {
      return [...schemes];
    },
    get ctis() {
      return [...ctis.values()];
    },
    includeDuplicates,
    includeDuplicate,
    removeModels,
    referencesTexture,
    ownsTexture(texture) {
      return textures.ownsTexture?.(texture) === true;
    },
    addCTIs,
    async importFiles(files, isCurrent) {
      const result = await textures.importFiles(files, isCurrent);
      addCTIs(result.ctis);
      return result;
    },
    async apply(
      renderer,
      scheme,
      variables,
      visibility,
      isCurrent = () => true,
    ) {
      if (scheme !== null && !schemes.has(scheme))
        throw new Error(`Unknown repaint scheme "${scheme}"`);
      const updates = new Map();
      for (const [key, original] of originals) {
        const next = { ...original.maps };
        if ("texture" in original.maps) {
          next.textureTransparent = original.textureTransparent;
          next.repaintTextureName = "";
        }
        updates.set(key, { ...original, next });
      }
      const variableUpdates = new Map(),
        warnings = new Set();
      if (scheme !== null) {
        for (const group of groups) {
          const groupBindings = bindings.get(group);
          for (const cti of ctis.values()) {
            if (!cti.active) continue;
            for (const item of cti.items) {
              if (item.name !== scheme) continue;
              const targets = groupBindings.get(item.slot.toLowerCase()) ?? [];
              if (targets.length) {
                const texture = await textures.load(cti.source, item.path);
                if (!isCurrent())
                  throw new Error("The repaint request was superseded");
                for (const target of targets) {
                  const next = updates.get(target.key).next;
                  next[target.map] = texture.bitmap;
                  if (target.map === "texture") {
                    next.textureTransparent = texture.hasAlpha;
                    next.repaintTextureName = item.path;
                  }
                }
              } else
                warnings.add(
                  `${cti.source}: repaint slot "${item.slot}" has no matching material`,
                );
              for (const setvar of item.setvars) {
                const variable = variables.find(
                  (candidate) => candidate.name === setvar.name,
                );
                if (variable) variableUpdates.set(variable, setvar.value);
                else
                  warnings.add(
                    `${cti.source}: repaint variable "${setvar.name}" is not available`,
                  );
              }
            }
          }
        }
      }
      if (!isCurrent()) throw new Error("The repaint request was superseded");
      for (const update of updates.values())
        update.next = { ...update.material, ...update.next };
      const snapshots = new Map();
      for (const update of updates.values())
        snapshots.set(update.material, { ...update.material });
      for (const variable of variableUpdates.keys()) {
        for (const binding of variable.bindings)
          snapshots.set(binding.material, { ...binding.material });
      }
      const variableValues = new Map(
        [...variableUpdates.keys()].map((variable) => [
          variable,
          variable.value,
        ]),
      );
      const previousVisibility = visibility.configVisibility.slice();
      const previousLights = visibility.lights?.slice();
      const affectsLights = [...variableUpdates.keys()].some(
        (variable) => variable.lightBindings?.length,
      );
      const affectedVisibility = new Set(
        [...variableUpdates.keys()].flatMap((variable) =>
          variable.visibilityBindings.map((binding) => binding.modelIndex),
        ),
      );
      try {
        for (const update of updates.values()) {
          renderer.updateMaterial(
            update.modelIndex,
            update.materialIndex,
            update.next,
          );
          Object.assign(update.material, update.next);
        }
        for (const [variable, value] of variableUpdates) {
          updateSceneVariable(renderer, variable, value, visibility);
        }
      } catch (error) {
        const errors = [error];
        for (const [material, snapshot] of snapshots) {
          const modelIndex = models.findIndex((model) =>
            model.materials.includes(material),
          );
          const materialIndex = models[modelIndex].materials.indexOf(material);
          const restore = { ...snapshot };
          for (const map of MAPS) restore[map] ??= null;
          try {
            renderer.updateMaterial(modelIndex, materialIndex, restore);
          } catch (rollbackError) {
            errors.push(rollbackError);
          }
          for (const key of Object.keys(material))
            if (!(key in snapshot)) delete material[key];
          Object.assign(material, snapshot);
        }
        for (const index of affectedVisibility) {
          try {
            renderer.setModelVisible(
              index,
              isModelVisible(
                models[index],
                visibility.manualVisibility[index],
                previousVisibility[index],
                visibility.viewpoint,
              ),
            );
          } catch (rollbackError) {
            errors.push(rollbackError);
          }
          visibility.configVisibility[index] = previousVisibility[index];
        }
        if (affectsLights && previousLights) {
          try {
            renderer.setLights(previousLights);
          } catch (rollbackError) {
            errors.push(rollbackError);
          }
          visibility.lights.splice(
            0,
            visibility.lights.length,
            ...previousLights,
          );
        }
        for (const [variable, value] of variableValues) variable.value = value;
        if (errors.length > 1)
          throw new AggregateError(
            errors,
            "Repaint update failed and renderer rollback was incomplete",
          );
        throw error;
      }
      return [...warnings];
    },
    dispose() {
      textures.dispose();
    },
  };
}
