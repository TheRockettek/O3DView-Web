import { createRenderer } from "./renderer-selection.js";
import { loadScene } from "./scene.js";
import { decodeConfiguration, listCommands } from "./config-inspector.js";
import {
  collectSceneVariables,
  updateSceneVariable,
} from "./scene-variables.js";
import {
  changeViewpoint,
  changeLodVisibility,
  changeGizmoVisibility,
  isModelVisible,
  viewpointAllows,
} from "./scene-visibility.js";
import { captureDrop, readDroppedFiles } from "./drop-files.js";
import { downloadWavefront, combineSceneModels } from "./obj-export.js";
import { downloadO3D } from "./o3d-write.js";
import { MAX_INTERIOR_LIGHTS } from "./light-data.js";
import { updateNightStrength } from "./global-materials.js";
import { createRepaintSession } from "./repaint-session.js";
import { enhanceDropdowns, syncDropdown } from "./dropdowns.js";
import { pickModel } from "./picking.js";
import { translateSceneModel } from "./scene-transforms.js";
import { updateCabinPathPoint, updateCabinPathLink } from "./cabin-path.js";
import { focusModels } from "./camera-controls.js";

enhanceDropdowns();
const byId = (id) => document.getElementById(id);
let canvas = byId("viewport");
const status = byId("status");
const offlineStatus = byId("offline-status");
const entry = byId("entry");
const open = byId("open");
const fit = byId("fit");
const focusButton = byId("focus-model");
const fullbright = byId("fullbright");
const highlightSelection = byId("highlight-selection");
const wireframe = byId("wireframe");
const cullBackfaces = byId("cull-backfaces");
const showGizmos = byId("show-gizmos");
const sceneList = byId("scene-list");
const viewpointSelect = byId("viewpoint");
const configFile = byId("config-file");
const configCommand = byId("config-command");
const configText = byId("config-text");
const warningList = byId("warnings");
const warningDetails = byId("warning-details");
const materialModel = byId("material-model");
const materialSelect = byId("material-select");
const materialFields = byId("material-fields");
let files = [];
let renderer;
let loading = false;
let sceneModels = [];
let sceneLoaded = false;
let sceneHierarchy = [];
let selectedCabinItem = null;
let selectedSceneGroup = null;
let selectedExportGroup = null;
let nextGroupId = 0;
let selectedModel = null;
let lastPick = null;
let sceneVisibility = [];
let configVisibility = [];
let viewpoint = 0;
let sceneVariables = [];
let sceneLights = [];
let sun = {
  position: [0, 0, 0],
  direction: [0, -1, 0],
  color: [0.9, 0.9, 0.9],
  ambient: [0.1, 0.1, 0.1],
  intensity: 1,
  range: 1000,
  mode: "directional",
  on: true,
};
let sceneLods = [];
let repaintSession;
let repaintRequest = 0;
let repaintApplying = false;
let selectedRepaint = "";
let globalNightStrength = 0;
let configFiles = [];
let configRequest = 0;
let selectionRequest = 0;
let backend = "";

function closeTextures(models) {
  const textures = new Set(
    models.flatMap((model) =>
      model.materials.flatMap((material) =>
        [
          material.texture,
          material.transmap,
          material.nightmap,
          material.lightmap,
          material.bumpmap,
          material.envmap,
        ].filter(Boolean),
      ),
    ),
  );
  for (const texture of textures) texture.close();
}

function onRendererError(event) {
  const error = event.detail;
  console.error(`${backend} renderer failed`, error);
  status.textContent = `${backend} renderer failed: ${error.message}. Reload the app to retry.`;
  open.disabled = true;
  fit.disabled = true;
  focusButton.disabled = true;
  fullbright.disabled = true;
  highlightSelection.disabled = true;
  wireframe.disabled = true;
  cullBackfaces.disabled = true;
  showGizmos.disabled = true;
  viewpointSelect.disabled = true;
  materialFields.disabled = true;
  byId("model-name-fields").disabled = true;
  byId("model-translation-fields").disabled = true;
  byId("cabin-point-fields").disabled = true;
  byId("cabin-link-fields").disabled = true;
  byId("scene-group-fields").disabled = true;
  byId("scene-group-lod-fields").disabled = true;
  byId("focus-scene-group").disabled = true;
  byId("variable-select").disabled = true;
  byId("variable-value").disabled = true;
  byId("variable-apply").disabled = true;
  byId("bind-light-variables").disabled = true;
  byId("global-night-strength").disabled = true;
  byId("lod-radius").disabled = true;
  byId("lod-apply").disabled = true;
  byId("repaint-select").disabled = true;
  byId("desktop-sun").disabled = true;
  byId("sun-fields").disabled = true;
  showRepaintFiles();
  showSceneList();
  showLods();
  showLights();
}

function addOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  select.append(option);
}

function placementLabel(placement) {
  if (!placement) return "";
  const { x, y, z } = placement.position;
  return ` (map object ${placement.idCode ?? "unknown"} at ${x}, ${y}, ${z})`;
}

function modelLabel(model) {
  return (
    model.name +
    placementLabel(model.mapPlacement) +
    (model.cabinPathSource ? ` (${model.cabinPathSource})` : "") +
    (model.splinePlacement
      ? ` (map spline ${model.splinePlacement.idCode})`
      : "") +
    (model.pathPlacement
      ? ` (path ${model.pathSource}:${model.pathPlacement.line})`
      : "")
  );
}

function showMaterial() {
  const material =
    sceneModels[Number(materialModel.value)]?.materials[
      Number(materialSelect.value)
    ];
  materialFields.disabled = !material || !!renderer?.error;
  byId("material-texture").textContent = material
    ? `Texture: ${material.repaintTextureName || material.textureName || "(none)"}`
    : "";
  const mapLabel = (name) =>
    material[`${name}Name`]
      ? `${material[`${name}Name`]}${material[name] ? "" : " (not loaded)"}`
      : "(none)";
  byId("material-maps").textContent = material
    ? `Transparency: ${mapLabel("transmap")} · Night: ${mapLabel("nightmap")} · Light: ${mapLabel("lightmap")} · Bump: ${mapLabel("bumpmap")} · Environment: ${mapLabel("envmap")}`
    : "";
  if (!material) return;
  byId("material-diffuse").value = material.diffuse.join(" ");
  byId("material-spec").value = material.spec.join(" ");
  byId("material-emission").value = material.emission.join(" ");
  byId("material-power").value = material.specPower;
  byId("material-night-strength").value = material.nightmapStrength ?? 0;
  byId("material-light-strength").value = material.lightmapStrength ?? 1;
  byId("material-bump-strength").value = material.bumpmapStrength ?? 0;
  byId("material-env-strength").value = material.envmapStrength ?? 0;
  byId("material-light-strength").disabled = !!material.lightmapVar;
  byId("material-light-strength").title = material.lightmapVar
    ? `Controlled by variable ${material.lightmapVar}`
    : "";
  byId("material-alpha").value =
    material.alphaMode === undefined ? "auto" : String(material.alphaMode);
  syncDropdown(byId("material-alpha"));
  byId("material-nozcheck").checked = !!material.noZCheck;
  byId("material-nozwrite").checked = !!material.noZWrite;
}

function showModelMaterials() {
  const model = sceneModels[Number(materialModel.value)];
  byId("model-name-fields").disabled = !model || !!renderer?.error;
  byId("model-translation-fields").disabled = !model || !!renderer?.error;
  byId("model-name").value = model?.name ?? "";
  byId("model-translation").value = (model?.worldTranslation ?? [0, 0, 0]).join(
    " ",
  );
  byId("model-source").textContent = model
    ? `Source: ${model.cabinPathSource || model.sourceName || model.name}`
    : "";
  materialSelect.replaceChildren();
  for (const [index, material] of (model?.materials || []).entries()) {
    addOption(
      materialSelect,
      index,
      `${index}: ${material.textureName || material.name || "(unnamed)"}`,
    );
  }
  materialSelect.disabled = !model?.materials.length;
  if (materialSelect.disabled) addOption(materialSelect, "", "No materials");
  showMaterial();
}

byId("model-name-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const index = Number(materialModel.value),
    model = sceneModels[index];
  if (!model || renderer?.error) return;
  try {
    const name = byId("model-name").value.trim();
    if (!name || /[\u0000-\u001f\u007f]/.test(name))
      throw new Error("Enter a non-empty name without control characters.");
    model.sourceName ??= model.name;
    model.name = name;
    materialModel.children[index].textContent =
      `${index + 1}: ${modelLabel(model)}`;
    syncDropdown(materialModel);
    showModelMaterials();
    showSceneList();
    status.textContent =
      "Model renamed for this scene. Source files are unchanged.";
  } catch (error) {
    console.error("Unable to rename model", error);
    status.textContent = `Unable to rename model: ${error.message}`;
  }
});

byId("model-translation-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const index = Number(materialModel.value);
  if (!renderer || renderer.error || !sceneModels[index]) return;
  try {
    const translation = parseVector(
      byId("model-translation").value,
      3,
      "Translation",
    );
    translateSceneModel(
      renderer,
      sceneModels,
      index,
      translation,
      sceneVisibility,
      configVisibility,
      viewpoint,
      selectedModel,
    );
    lastPick = null;
    status.textContent =
      "Model translated for this scene. Source files are unchanged.";
  } catch (error) {
    console.error("Unable to translate model", error);
    status.textContent = `Unable to translate model: ${error.message}`;
  }
});

function showSceneMaterials(models) {
  sceneModels = models;
  materialModel.replaceChildren();
  for (const [index, model] of models.entries())
    addOption(materialModel, index, `${index + 1}: ${modelLabel(model)}`);
  materialModel.disabled = !models.length;
  byId("export-obj").disabled = !models.length;
  byId("export-mtl").disabled = !models.length;
  byId("export-scene-obj").disabled = !models.length;
  byId("export-scene-mtl").disabled = !models.length;
  byId("export-o3d").disabled = !models.length;
  byId("export-o3d-format").disabled = !models.length;
  showModelMaterials();
}

function selectModel(index) {
  try {
    renderer.setSelectedModel(index);
    selectedModel = index;
    materialModel.value = String(index);
    syncDropdown(materialModel);
    showModelMaterials();
    showSceneList();
  } catch (error) {
    materialModel.value = selectedModel === null ? "" : String(selectedModel);
    syncDropdown(materialModel);
    console.error("Unable to select model", error);
    status.textContent = `Unable to select model: ${error.message}`;
  }
}

function lightLabel(light, index) {
  const label = light.created
    ? `${light.name} (created)`
    : `${light.name || light.variable || "(unnamed)"} — ${light.source}:${light.line}${placementLabel(light.mapPlacement)}`;
  return label + (index >= MAX_INTERIOR_LIGHTS ? " (over light limit)" : "");
}

function setLightEnabled(index, on) {
  const next = sceneLights.map((value, i) =>
    i === index ? { ...value, on } : value,
  );
  renderer.setLights(next);
  sceneLights.splice(0, sceneLights.length, ...next);
  showLights();
  showSceneList();
}

function showLights() {
  const list = byId("light-list");
  list.replaceChildren();
  for (const [index, light] of sceneLights.entries()) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = light.on;
    toggle.disabled = !!renderer?.error;
    toggle.addEventListener("change", () => {
      try {
        setLightEnabled(index, toggle.checked);
      } catch (error) {
        toggle.checked = sceneLights[index].on;
        console.error("Unable to change light", error);
        status.textContent = `Unable to change light: ${error.message}`;
      }
    });
    label.append(toggle, document.createTextNode(lightLabel(light, index)));
    item.append(label);
    list.append(item);
  }
  byId("light-summary").textContent = sceneLights.length
    ? `${sceneLights.length} light${sceneLights.length === 1 ? "" : "s"}; first ${MAX_INTERIOR_LIGHTS} supported.`
    : "No lights.";
  byId("create-light").disabled = !sceneLoaded || !!renderer?.error;
  byId("create-point-light").disabled = !sceneLoaded || !!renderer?.error;
  byId("desktop-sun").disabled = !sceneLoaded || !!renderer?.error;
  byId("sun-fields").disabled =
    byId("desktop-sun").disabled || !byId("desktop-sun").checked;
  const select = byId("light-select");
  const previous = select.value;
  select.replaceChildren();
  for (const [index, light] of sceneLights.entries()) {
    addOption(select, String(index), lightLabel(light, index));
  }
  if (!sceneLights.length) addOption(select, "", "No lights");
  else if (previous !== "" && Number(previous) < sceneLights.length)
    select.value = previous;
  select.disabled = !sceneLights.length || !!renderer?.error;
  syncDropdown(select);
  showLightInspector();
}

byId("desktop-sun").addEventListener("change", (event) => {
  const enabled = event.target.checked;
  try {
    renderer.setSun(enabled ? sun : null);
    byId("sun-fields").disabled = !enabled;
    status.textContent = enabled
      ? "Desktop-style sun enabled."
      : "Original viewer lighting restored.";
  } catch (error) {
    event.target.checked = !enabled;
    console.error("Unable to change sun lighting", error);
    status.textContent = `Unable to change sun lighting: ${error.message}`;
  }
});

byId("sun-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!renderer || renderer.error || !byId("desktop-sun").checked) return;
  try {
    const intensity = byId("sun-intensity").value.trim();
    if (!intensity) throw new Error("Enter an intensity.");
    const updated = {
      ...sun,
      on: byId("sun-on").checked,
      direction: parseVector(byId("sun-direction").value, 3, "Direction"),
      color: parseVector(byId("sun-color").value, 3, "Color"),
      ambient: parseVector(byId("sun-ambient").value, 3, "Ambient"),
      intensity: Number(intensity),
    };
    renderer.setSun(updated);
    sun = updated;
    status.textContent =
      "Sun updated for this viewer session. Source files are unchanged.";
  } catch (error) {
    console.error("Unable to update sun", error);
    status.textContent = `Unable to update sun: ${error.message}`;
  }
});

function createLight(mode) {
  if (!renderer || renderer.error || !sceneLoaded) return;
  const title = mode === "directional" ? "Directional light" : "Point light";
  const light = {
    name: `${title} ${sceneLights.filter((value) => value.created).length + 1}`,
    created: true,
    mode,
    position: [0, 0, 0],
    direction: [0, -1, 0],
    color: [0.5, 0.5, 0.5],
    ambient: [0, 0, 0],
    range: 1000,
    intensity: 1,
    on: true,
  };
  try {
    renderer.setLights([...sceneLights, light]);
    sceneLights.push(light);
    sceneHierarchy.push({
      type: "light",
      name: light.name,
      lightIndex: sceneLights.length - 1,
      children: [],
    });
    showLights();
    showSceneList();
    byId("light-select").value = String(sceneLights.length - 1);
    syncDropdown(byId("light-select"));
    showLightInspector();
    status.textContent =
      sceneLights.length > MAX_INTERIOR_LIGHTS
        ? `${title} created but not rendered: only the first ${MAX_INTERIOR_LIGHTS} lights are supported.`
        : `${title} created for this scene. Source files are unchanged.`;
  } catch (error) {
    console.error(`Unable to create ${title.toLowerCase()}`, error);
    status.textContent = `Unable to create ${title.toLowerCase()}: ${error.message}`;
  }
}
byId("create-light").addEventListener("click", () =>
  createLight("directional"),
);
byId("create-point-light").addEventListener("click", () =>
  createLight("point"),
);

function showLightMode() {
  byId("light-direction").disabled = !["directional", "spot"].includes(
    byId("light-mode").value,
  );
}

function showLightInspector() {
  const light = sceneLights[Number(byId("light-select").value)];
  byId("light-fields").disabled = !light || !!renderer?.error;
  byId("delete-light").disabled =
    !light || !!renderer?.error || repaintApplying;
  if (!light) return;
  byId("light-name").value = light.name || light.variable || "(unnamed)";
  byId("light-mode").value = light.mode ?? "point";
  syncDropdown(byId("light-mode"));
  showLightMode();
  byId("light-position").value = light.position.join(" ");
  byId("light-direction").value = (light.direction ?? [0, -1, 0]).join(" ");
  byId("light-color").value = light.color.join(" ");
  byId("light-ambient").value = (light.ambient ?? [0, 0, 0]).join(" ");
  byId("light-range").value = String(light.range);
  byId("light-intensity").value = String(light.intensity ?? 1);
}

byId("light-select").addEventListener("change", showLightInspector);
byId("light-mode").addEventListener("change", showLightMode);
function removeHierarchyLight(nodes, index) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.type === "light" && node.lightIndex === index) nodes.splice(i, 1);
    else {
      if (node.type === "light" && node.lightIndex > index) node.lightIndex--;
      removeHierarchyLight(node.children, index);
      if (node.type === "lights" && !node.children.length) nodes.splice(i, 1);
    }
  }
}
byId("delete-light").addEventListener("click", () => {
  const index = Number(byId("light-select").value);
  if (!renderer || renderer.error || repaintApplying || !sceneLights[index])
    return;
  try {
    const next = sceneLights.filter((_light, i) => i !== index);
    renderer.setLights(next);
    sceneLights.splice(0, sceneLights.length, ...next);
    removeHierarchyLight(sceneHierarchy, index);
    byId("bind-light-variables").disabled = !sceneLights.length;
    showVariables(sceneModels, true);
    showLights();
    showSceneList();
    status.textContent =
      "Light removed from this scene. Source files are unchanged.";
  } catch (error) {
    console.error("Unable to delete light", error);
    status.textContent = `Unable to delete light: ${error.message}`;
  }
});
byId("light-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const index = Number(byId("light-select").value),
    light = sceneLights[index];
  if (!renderer || !light) return;
  try {
    const range = byId("light-range").value.trim(),
      intensity = byId("light-intensity").value.trim();
    if (!range || !intensity) throw new Error("Enter a range and intensity.");
    const name = byId("light-name").value.trim();
    if (!name || /[\u0000-\u001f\u007f]/.test(name))
      throw new Error("Enter a non-empty name without control characters.");
    const mode = byId("light-mode").value;
    const updated = {
      ...light,
      mode,
      position: parseVector(byId("light-position").value, 3, "Position"),
      direction: ["directional", "spot"].includes(mode)
        ? parseVector(byId("light-direction").value, 3, "Direction")
        : (light.direction ?? [0, -1, 0]),
      color: parseVector(byId("light-color").value, 3, "Color"),
      ambient: parseVector(byId("light-ambient").value, 3, "Ambient"),
      range: Number(range),
      intensity: Number(intensity),
    };
    if (name !== (light.name || light.variable || "(unnamed)"))
      updated.name = name;
    const next = sceneLights.map((value, i) => (i === index ? updated : value));
    renderer.setLights(next);
    sceneLights.splice(0, sceneLights.length, ...next);
    showLights();
    showSceneList();
    status.textContent =
      "Light updated for this scene. Source files are unchanged.";
  } catch (error) {
    console.error("Unable to update light", error);
    status.textContent = `Unable to update light: ${error.message}`;
  }
});

function showLods() {
  const list = byId("lod-list");
  list.replaceChildren();
  for (const lod of sceneLods) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = lod.visible;
    toggle.disabled = !!renderer?.error;
    toggle.addEventListener("change", () => {
      try {
        changeLodVisibility(
          renderer,
          sceneModels,
          sceneVisibility,
          configVisibility,
          viewpoint,
          [[lod, toggle.checked]],
        );
        showSceneList();
      } catch (error) {
        toggle.checked = lod.visible;
        console.error("Unable to change LOD visibility", error);
        status.textContent = `Unable to change LOD visibility: ${error.message}`;
      }
    });
    label.append(
      toggle,
      document.createTextNode(
        `${lod.source}:${lod.line} — LOD ${lod.viewRadius === null ? "(invalid radius)" : lod.radiusText}${placementLabel(lod.mapPlacement)}`,
      ),
    );
    item.append(label);
    list.append(item);
  }
}

byId("lod-apply").addEventListener("click", () => {
  try {
    const input = byId("lod-radius");
    const value = input.value.trim() ? Number(input.value) : NaN;
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError("LOD radius must be between 0 and 1.");
    const radius = Math.fround(value);
    const changes = sceneLods
      .filter((lod) => lod.viewRadius !== null)
      .map((lod) => [lod, radius >= lod.viewRadius]);
    changeLodVisibility(
      renderer,
      sceneModels,
      sceneVisibility,
      configVisibility,
      viewpoint,
      changes,
    );
    showLods();
    showSceneList();
    status.textContent = "LOD view radius applied.";
  } catch (error) {
    console.error("Unable to apply LOD view radius", error);
    status.textContent = `Unable to apply LOD view radius: ${error.message}`;
  }
});

function showRepaintFiles() {
  const list = byId("repaint-file-list");
  list.replaceChildren();
  for (const id of ["repaint-files", "repaint-folder"]) {
    byId(id).disabled =
      !repaintSession || loading || repaintApplying || !!renderer?.error;
  }
  for (const [index, cti] of (repaintSession?.ctis ?? []).entries()) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.dataset.ctiIndex = String(index);
    toggle.checked = cti.active;
    toggle.disabled = loading || repaintApplying || !!renderer?.error;
    toggle.addEventListener("change", async () => {
      const session = repaintSession;
      const previous = cti.active;
      cti.active = toggle.checked;
      if (
        !(await applyRepaint(selectedRepaint)) &&
        session === repaintSession
      ) {
        cti.active = previous;
        showRepaintFiles();
      }
      if (session === repaintSession && !loading)
        list.querySelector?.(`[data-cti-index="${index}"]`)?.focus();
    });
    label.append(toggle, document.createTextNode(` ${cti.source}`));
    item.append(label);
    list.append(item);
  }
}

function showRepaints(reset = true) {
  const select = byId("repaint-select");
  select.replaceChildren();
  addOption(select, "", "Original textures");
  for (const [index, scheme] of repaintSession.schemes.entries())
    addOption(select, String(index), scheme);
  if (reset) selectedRepaint = "";
  select.value = selectedRepaint;
  select.disabled =
    !repaintSession.schemes.length ||
    loading ||
    repaintApplying ||
    !!renderer?.error;
  syncDropdown(select);
  showRepaintFiles();
}

async function applyRepaint(value) {
  const select = byId("repaint-select");
  const request = ++repaintRequest;
  const session = repaintSession;
  const scheme = value === "" ? null : session.schemes[Number(value)];
  select.disabled = true;
  repaintApplying = true;
  showRepaintFiles();
  byId("delete-light").disabled = true;
  byId("bind-light-variables").disabled = true;
  status.textContent = "Applying repaint…";
  try {
    const warnings = await session.apply(
      renderer,
      scheme,
      sceneVariables,
      {
        models: sceneModels,
        manualVisibility: sceneVisibility,
        configVisibility,
        viewpoint,
        lights: sceneLights,
      },
      () => request === repaintRequest && session === repaintSession,
    );
    if (request !== repaintRequest || session !== repaintSession) return false;
    selectedRepaint = value;
    showMaterial();
    showVariable();
    showLightInspector();
    showSceneList();
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      warningList.append(item);
    }
    if (warnings.length) {
      warningDetails.hidden = false;
      warningDetails.open = true;
    }
    status.textContent = `Repaint ${scheme ?? "original textures"} applied${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`;
    return true;
  } catch (error) {
    if (request !== repaintRequest || session !== repaintSession) return false;
    select.value = selectedRepaint;
    syncDropdown(select);
    console.error("Unable to apply repaint", error);
    status.textContent = `Unable to apply repaint: ${error.message}`;
    return false;
  } finally {
    if (request === repaintRequest && session === repaintSession) {
      repaintApplying = false;
      select.disabled = !!renderer?.error || !session.schemes.length;
      byId("bind-light-variables").disabled =
        !sceneLights.length || !!renderer?.error;
      byId("delete-light").disabled = !sceneLights.length || !!renderer?.error;
      showRepaintFiles();
    }
  }
}

byId("repaint-select").addEventListener("change", (event) =>
  applyRepaint(event.target.value),
);
async function importRepaintFiles(event) {
  const selected = Array.from(event.target.files);
  event.target.value = "";
  if (!selected.length || !repaintSession || repaintApplying || loading) return;
  const session = repaintSession,
    request = ++repaintRequest;
  repaintApplying = true;
  byId("repaint-select").disabled = true;
  showRepaintFiles();
  status.textContent = "Importing repaint files…";
  try {
    const result = await session.importFiles(
      selected,
      () => request === repaintRequest && session === repaintSession,
    );
    if (request !== repaintRequest || session !== repaintSession) return;
    showRepaints(false);
    for (const warning of result.warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      warningList.append(item);
    }
    if (result.warnings.length) {
      warningDetails.hidden = false;
      warningDetails.open = true;
    }
    if (selectedRepaint !== "") {
      const added = new Set(result.ctis.map((cti) => cti.source));
      if (
        !(await applyRepaint(selectedRepaint)) &&
        session === repaintSession
      ) {
        for (const cti of session.ctis)
          if (added.has(cti.source)) cti.active = false;
        showRepaintFiles();
        if (!loading)
          status.textContent +=
            " Imported CTIs were disabled; add any missing textures and retry.";
        return;
      }
    }
    status.textContent = `Imported ${result.ctis.length} CTI file(s) and selected textures${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ""}.`;
  } catch (error) {
    if (request !== repaintRequest || session !== repaintSession) return;
    console.error("Unable to import repaint files", error);
    status.textContent = `Unable to import repaint files: ${error.message}`;
  } finally {
    if (
      session === repaintSession &&
      (request === repaintRequest || !repaintApplying)
    ) {
      repaintApplying = false;
      byId("repaint-select").disabled =
        !!renderer?.error || !session.schemes.length;
      showRepaintFiles();
    }
  }
}
byId("repaint-files").addEventListener("change", importRepaintFiles);
byId("repaint-folder").addEventListener("change", importRepaintFiles);

byId("global-night-strength").addEventListener("change", (event) => {
  const input = event.target;
  try {
    if (!input.value.trim()) throw new Error("Enter a night map strength.");
    const value = Number(input.value);
    updateNightStrength(renderer, sceneModels, value);
    globalNightStrength = value;
    showMaterial();
    status.textContent = "Global night map strength updated for this scene.";
  } catch (error) {
    input.value = globalNightStrength;
    console.error("Unable to change global night map strength", error);
    status.textContent = `Unable to change global night map strength: ${error.message}`;
  }
});

function showVariables(models, preserveValues = false) {
  const previous = new Map(
    sceneVariables.map((variable) => [variable.name, variable.value]),
  );
  sceneVariables = collectSceneVariables(
    models,
    byId("bind-light-variables").checked ? sceneLights : [],
  );
  if (preserveValues) {
    for (const variable of sceneVariables)
      if (previous.has(variable.name))
        variable.value = previous.get(variable.name);
  }
  const select = byId("variable-select");
  const selectedName = preserveValues
    ? select.selectedOptions?.[0]?.textContent
    : null;
  select.replaceChildren();
  for (const [index, variable] of sceneVariables.entries())
    addOption(select, index, variable.name);
  if (!sceneVariables.length) addOption(select, "", "No scene variables");
  const index = sceneVariables.findIndex(
    (variable) => variable.name === selectedName,
  );
  if (index >= 0) select.value = String(index);
  select.disabled = !sceneVariables.length || !!renderer?.error;
  syncDropdown(select);
  showVariable();
}

byId("bind-light-variables").addEventListener("change", () =>
  showVariables(sceneModels, true),
);

function showVariable() {
  const variable = sceneVariables[Number(byId("variable-select").value)];
  const input = byId("variable-value");
  input.disabled = !variable || !!renderer?.error;
  byId("variable-apply").disabled = !variable || !!renderer?.error;
  input.value = variable?.value ?? "";
  input.min = variable?.bindings.length ? "0" : "";
  input.max = variable?.bindings.length ? "1" : "";
  byId("variable-hint").textContent = variable?.bindings.length
    ? "Material-bound values range from 0 to 1."
    : "Enter a finite 32-bit floating-point value.";
}

byId("variable-select").addEventListener("change", showVariable);
byId("variable-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const variable = sceneVariables[Number(byId("variable-select").value)];
  if (!renderer || !variable) return;
  try {
    const input = byId("variable-value");
    if (!input.value.trim()) throw new Error("Enter a variable value.");
    updateSceneVariable(renderer, variable, Number(input.value), {
      models: sceneModels,
      manualVisibility: sceneVisibility,
      configVisibility,
      viewpoint,
      lights: sceneLights,
    });
    showMaterial();
    showSceneList();
    showLightInspector();
    status.textContent = `Variable ${variable.name} updated for this scene. Source files are unchanged.`;
  } catch (error) {
    console.error("Unable to update variable", error);
    status.textContent = `Unable to update variable: ${error.message}`;
  }
});

function showSceneList() {
  const query = byId("scene-search").value.toLocaleLowerCase();
  sceneList.replaceChildren();
  const labelFor = (node) => {
    if (node.modelIndex !== undefined)
      return modelLabel(sceneModels[node.modelIndex]);
    if (node.type === "light")
      return lightLabel(sceneLights[node.lightIndex], node.lightIndex);
    return node.name + placementLabel(node.mapPlacement);
  };
  const matches = (node) =>
    !query ||
    labelFor(node).toLocaleLowerCase().includes(query) ||
    node.children.some(matches);
  function renderNode(node, container, parentMatches = false) {
    if (!parentMatches && !matches(node)) return;
    const text = labelFor(node);
    if (
      node.modelIndex === undefined &&
      node.type !== "light" &&
      node.type !== "cabin-item"
    ) {
      const item = document.createElement("li");
      item.className = "scene-group";
      const details = document.createElement("details");
      details.open = query ? true : node.expanded !== false;
      details.addEventListener("toggle", () => {
        if (!query) node.expanded = details.open;
      });
      const summary = document.createElement("summary");
      if (node.type === "lod") {
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = node.lod.visible;
        toggle.disabled = !!renderer?.error;
        toggle.ariaLabel = `Enable ${text}`;
        toggle.addEventListener("click", (event) => event.stopPropagation());
        toggle.addEventListener("change", () => {
          try {
            changeLodVisibility(
              renderer,
              sceneModels,
              sceneVisibility,
              configVisibility,
              viewpoint,
              [[node.lod, toggle.checked]],
            );
            showSceneList();
            showLods();
          } catch (error) {
            toggle.checked = node.lod.visible;
            console.error("Unable to change LOD visibility", error);
            status.textContent = `Unable to change LOD visibility: ${error.message}`;
          }
        });
        summary.append(toggle, document.createTextNode(text));
      } else {
        summary.textContent = text;
      }
      const inspect = document.createElement("button");
      inspect.type = "button";
      inspect.className = "scene-select scene-group-select";
      inspect.textContent = "Inspect";
      inspect.ariaLabel = `Inspect group ${text}`;
      inspect.disabled = !!renderer?.error;
      node.inspectorKey ??= nextGroupId++;
      inspect.dataset.inspectGroup = String(node.inspectorKey);
      inspect.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedSceneGroup = node;
        showSceneGroupInspector();
        showSceneList();
        sceneList
          .querySelector?.(`[data-inspect-group="${node.inspectorKey}"]`)
          ?.focus();
      });
      summary.append(inspect);
      const groupModels = descendantModels(node);
      if (groupModels.length) {
        const select = document.createElement("button");
        select.type = "button";
        select.className = "scene-select scene-group-select";
        select.textContent =
          selectedExportGroup === node ? "Group selected" : "Export group";
        select.ariaPressed = String(selectedExportGroup === node);
        select.ariaLabel = `Select ${text} for group export`;
        node.exportKey ??= nextGroupId++;
        select.dataset.exportGroup = String(node.exportKey);
        select.addEventListener("click", (event) => {
          event.stopPropagation();
          selectedExportGroup = node;
          byId("export-group-label").textContent =
            `Group: ${text} (${groupModels.length} models)`;
          byId("export-group-obj").disabled = false;
          byId("export-group-mtl").disabled = false;
          showSceneList();
          sceneList
            .querySelector?.(`[data-export-group="${node.exportKey}"]`)
            ?.focus();
        });
        summary.append(select);
      }
      const children = document.createElement("ul");
      for (const child of node.children)
        renderNode(
          child,
          children,
          parentMatches ||
            (!!query && text.toLocaleLowerCase().includes(query)),
        );
      details.append(summary, children);
      item.append(details);
      container.append(item);
      return;
    }
    if (node.type === "cabin-item") {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = text;
      const select = document.createElement("button");
      select.type = "button";
      select.className = "scene-select";
      select.textContent = "Inspect";
      select.ariaLabel = `Inspect ${text}`;
      select.addEventListener("click", () => {
        selectedCabinItem = node;
        showCabinInspector();
      });
      item.append(label, select);
      container.append(item);
      return;
    }
    if (node.type === "light") {
      const index = node.lightIndex,
        light = sceneLights[index];
      const item = document.createElement("li");
      const label = document.createElement("label");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = light.on;
      toggle.disabled = !!renderer?.error;
      toggle.addEventListener("change", () => {
        try {
          setLightEnabled(index, toggle.checked);
        } catch (error) {
          toggle.checked = sceneLights[index].on;
          console.error("Unable to change light", error);
          status.textContent = `Unable to change light: ${error.message}`;
        }
      });
      label.append(toggle, document.createTextNode(text));
      const select = document.createElement("button");
      select.type = "button";
      select.className = "scene-select";
      select.textContent = "Inspect";
      select.ariaLabel = `Inspect ${text}`;
      select.disabled = !!renderer?.error;
      select.addEventListener("click", () => {
        byId("light-select").value = String(index);
        syncDropdown(byId("light-select"));
        showLightInspector();
        byId("light-position").focus?.();
      });
      item.append(label, select);
      container.append(item);
      return;
    }
    const index = node.modelIndex,
      model = sceneModels[index];
    const item = document.createElement("li");
    const label = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = sceneVisibility[index];
    toggle.disabled = !!renderer?.error;
    const description = document.createTextNode("");
    const updateDescription = () => {
      const reasons = [];
      if (toggle.checked && !configVisibility[index]) reasons.push("variable");
      if (toggle.checked && !viewpointAllows(model, viewpoint))
        reasons.push("viewpoint");
      if (toggle.checked && model.lod?.visible === false) reasons.push("LOD");
      if (toggle.checked && model.gizmoVisible === false)
        reasons.push("gizmos");
      description.textContent = `${modelLabel(model)}${reasons.length ? ` (hidden by ${reasons.join(" and ")})` : ""}`;
    };
    toggle.addEventListener("change", () => {
      try {
        renderer.setModelVisible(
          index,
          isModelVisible(
            model,
            toggle.checked,
            configVisibility[index],
            viewpoint,
          ),
        );
        sceneVisibility[index] = toggle.checked;
        updateDescription();
      } catch (error) {
        toggle.checked = sceneVisibility[index];
        status.textContent = `Unable to change visibility: ${error.message}`;
      }
    });
    updateDescription();
    label.append(toggle, description);
    item.append(label);
    const select = document.createElement("button");
    select.type = "button";
    select.className = "scene-select";
    select.textContent = selectedModel === index ? "Selected" : "Select";
    select.ariaPressed = String(selectedModel === index);
    select.ariaLabel = `Select ${modelLabel(model)}`;
    select.title = `Select ${modelLabel(model)}`;
    select.disabled = !!renderer?.error;
    select.addEventListener("click", () => {
      selectModel(index);
      sceneList.querySelector?.(`[data-model-index="${index}"]`)?.focus();
    });
    select.dataset.modelIndex = String(index);
    item.append(select);
    container.append(item);
  }
  for (const node of sceneHierarchy) renderNode(node, sceneList);
}

function showSceneGroupInspector() {
  const node = selectedSceneGroup;
  byId("scene-group-fields").disabled = !node || !!renderer?.error;
  byId("scene-group-name").value = node?.name ?? "";
  byId("scene-group-lod-form").hidden = node?.type !== "lod";
  byId("scene-group-lod-fields").disabled =
    node?.type !== "lod" || !!renderer?.error;
  byId("scene-group-lod-radius").value =
    node?.lod?.viewRadius === null ? "" : (node?.lod?.radiusText ?? "");
  byId("focus-scene-group").disabled =
    !node ||
    !!renderer?.error ||
    !descendantModels(node).some((model) => model.vertices?.length);
  byId("scene-group-info").textContent = node
    ? `Type: ${node.type}\nOriginal name: ${node.sourceName ?? node.name}\nDescendant models: ${descendantModels(node).length}`
    : "No group selected.";
}

byId("scene-group-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const node = selectedSceneGroup;
  if (!node || !renderer || renderer.error) return;
  try {
    const name = byId("scene-group-name").value.trim();
    if (!name || /[\u0000-\u001f\u007f]/.test(name))
      throw new Error("Enter a non-empty name without control characters.");
    node.sourceName ??= node.name;
    node.name = name;
    if (selectedExportGroup === node) {
      byId("export-group-label").textContent =
        `Group: ${name}${placementLabel(node.mapPlacement)} (${descendantModels(node).length} models)`;
    }
    showSceneGroupInspector();
    showSceneList();
    status.textContent =
      "Group renamed for this scene. Source files are unchanged.";
  } catch (error) {
    console.error("Unable to rename group", error);
    status.textContent = `Unable to rename group: ${error.message}`;
  }
});

byId("focus-scene-group").addEventListener("click", () => {
  if (!selectedSceneGroup || !renderer || renderer.error) return;
  try {
    focusModels(renderer, descendantModels(selectedSceneGroup));
    status.textContent = "Focused scene group.";
  } catch (error) {
    console.error("Unable to focus group", error);
    status.textContent = `Unable to focus group: ${error.message}`;
  }
});

byId("scene-group-lod-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const node = selectedSceneGroup;
  if (node?.type !== "lod" || !node.lod || !renderer || renderer.error) return;
  try {
    const text = byId("scene-group-lod-radius").value.trim();
    const value = Number(text),
      radius = Math.fround(value);
    if (!text || !Number.isFinite(value) || !Number.isFinite(radius))
      throw new Error("Enter a finite 32-bit view radius.");
    node.lod.viewRadius = radius;
    node.lod.radiusText = text;
    showSceneGroupInspector();
    showLods();
    status.textContent =
      "LOD threshold updated for this scene. Apply the LOD view radius to update visibility.";
  } catch (error) {
    console.error("Unable to update LOD threshold", error);
    status.textContent = `Unable to update LOD threshold: ${error.message}`;
  }
});

function showCabinInspector() {
  const info = selectedCabinItem?.info;
  const editable = info?.kind === "path point" && !!info.pathState;
  const editableLink = info?.kind === "path link" && !!info.pathState;
  byId("cabin-point-form").hidden = !editable;
  byId("cabin-point-fields").disabled = !editable || !!renderer?.error;
  byId("cabin-link-form").hidden = !editableLink;
  byId("cabin-link-fields").disabled = !editableLink || !!renderer?.error;
  if (!info) {
    byId("cabin-info").textContent = "No cabin item selected.";
    return;
  }
  const rows = [
    selectedCabinItem.name,
    `Source: ${info.source}:${info.line}`,
    `Type: ${info.kind}`,
  ];
  if (info.index !== undefined) rows.push(`Index: ${info.index}`);
  if (info.pathPoint !== undefined) rows.push(`Path point: ${info.pathPoint}`);
  if (info.position)
    rows.push(`OMSI position (X Y Z): ${info.position.join(" ")}`);
  if (info.height !== undefined) rows.push(`Height: ${info.height}`);
  if (info.rotation !== undefined) rows.push(`Rotation: ${info.rotation}`);
  if (info.variation) rows.push(`Variation: ${info.variation.join(" ")}`);
  if (info.parent !== undefined) rows.push(`Parent: ${info.parent}`);
  if (info.link) {
    rows.push(
      `Endpoints: ${info.link.a} ${info.link.b}`,
      `One-way: ${info.link.oneWay ? "yes" : "no"}`,
      `Room height: ${info.link.roomHeight}`,
      `Step sound: ${info.link.stepSound}`,
    );
  }
  byId("cabin-info").textContent = rows.join("\n");
  if (editable) byId("cabin-point-position").value = info.position.join(" ");
  if (editableLink) {
    byId("cabin-link-a").value = String(info.link.a);
    byId("cabin-link-b").value = String(info.link.b);
    byId("cabin-link-oneway").checked = info.link.oneWay;
    byId("cabin-link-room").value = String(info.link.roomHeight);
    byId("cabin-link-sound").value = String(info.link.stepSound);
  }
}

byId("cabin-point-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const info = selectedCabinItem?.info;
  if (!info?.pathState || !renderer || renderer.error) return;
  try {
    const position = parseVector(
      byId("cabin-point-position").value,
      3,
      "Position",
    );
    const warnings = updateCabinPathPoint(
      info.pathState,
      info.index,
      position,
      renderer,
      sceneModels,
      sceneVisibility,
      configVisibility,
      viewpoint,
      selectedModel,
    );
    lastPick = null;
    showCabinInspector();
    showSceneGroupInspector();
    status.textContent = `Cabin path point updated for this scene. Source files are unchanged.${warnings.length ? ` ${warnings.join(" ")}` : ""}`;
  } catch (error) {
    console.error("Unable to update cabin path point", error);
    status.textContent = `Unable to update cabin path point: ${error.message}`;
  }
});

byId("cabin-link-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const info = selectedCabinItem?.info;
  if (
    info?.kind !== "path link" ||
    !info.pathState ||
    !renderer ||
    renderer.error
  )
    return;
  try {
    const integer = (id, label) => {
      const text = byId(id).value.trim(),
        value = Number(text);
      if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(value))
        throw new Error(`${label} must be an integer.`);
      return value;
    };
    const room = byId("cabin-link-room").value.trim();
    if (!room) throw new Error("Enter a room height.");
    const changes = {
      a: integer("cabin-link-a", "First endpoint"),
      b: integer("cabin-link-b", "Second endpoint"),
      oneWay: byId("cabin-link-oneway").checked,
      roomHeight: Number(room),
      stepSound: integer("cabin-link-sound", "Step sound"),
    };
    const warnings = updateCabinPathLink(
      info.pathState,
      info.index,
      changes,
      renderer,
      sceneModels,
      sceneVisibility,
      configVisibility,
      viewpoint,
      selectedModel,
    );
    lastPick = null;
    showCabinInspector();
    showSceneGroupInspector();
    status.textContent = `Cabin path link updated for this scene. Source files are unchanged.${warnings.length ? ` ${warnings.join(" ")}` : ""}`;
  } catch (error) {
    console.error("Unable to update cabin path link", error);
    status.textContent = `Unable to update cabin path link: ${error.message}`;
  }
});

function descendantModels(node) {
  const indices = [];
  function collect(current) {
    if (current.modelIndex !== undefined) indices.push(current.modelIndex);
    for (const child of current.children) collect(child);
  }
  collect(node);
  return indices.map((index) => sceneModels[index]);
}

byId("scene-search").addEventListener("input", showSceneList);
viewpointSelect.addEventListener("change", () => {
  const next = Number(viewpointSelect.value);
  try {
    changeViewpoint(
      renderer,
      sceneModels,
      sceneVisibility,
      viewpoint,
      next,
      configVisibility,
    );
    viewpoint = next;
    showSceneList();
  } catch (error) {
    viewpointSelect.value = String(viewpoint);
    syncDropdown(viewpointSelect);
    console.error("Unable to change viewpoint", error);
    status.textContent = `Unable to change viewpoint: ${error.message}`;
  }
});

async function showConfiguration() {
  const request = ++configRequest;
  configText.value = "";
  configCommand.replaceChildren();
  configCommand.disabled = true;
  const file = configFiles[Number(configFile.value)];
  if (!file) {
    addOption(configCommand, "", "No commands");
    return;
  }
  try {
    const text = decodeConfiguration(await file.arrayBuffer());
    if (request !== configRequest) return;
    const commands = listCommands(text);
    configText.value = text;
    addOption(
      configCommand,
      "",
      commands.length ? "Select a command" : "No commands",
    );
    for (const command of commands)
      addOption(
        configCommand,
        command.line,
        `${command.line}: [${command.name}]`,
      );
    configCommand.disabled = !commands.length;
  } catch (error) {
    if (request !== configRequest) return;
    addOption(configCommand, "", "Unable to read commands");
    status.textContent = `Unable to read configuration: ${error.message}`;
  }
}

configFile.addEventListener("change", showConfiguration);
configCommand.addEventListener("change", () => {
  if (!configCommand.value) return;
  const line = Number(configCommand.value);
  const lines = configText.value.split("\n");
  const start = lines
    .slice(0, line - 1)
    .reduce((sum, text) => sum + text.length + 1, 0);
  configText.focus();
  configText.setSelectionRange(start, start + lines[line - 1].length);
});

function parseVector(input, count, label) {
  const parts = input.trim().split(/[\s,]+/);
  const values = parts.map(Number);
  if (
    parts.length !== count ||
    parts.some((part) => part === "") ||
    !values.every(Number.isFinite)
  ) {
    throw new Error(`${label} requires ${count} finite numbers.`);
  }
  return values;
}

materialModel.addEventListener("change", () =>
  selectModel(Number(materialModel.value)),
);
byId("export-o3d").addEventListener("click", () => {
  const model = sceneModels[Number(materialModel.value)];
  if (!model) return;
  try {
    const name = downloadO3D(model, byId("export-o3d-format").value);
    status.textContent = `Downloaded ${name}. Source files are unchanged.`;
  } catch (error) {
    console.error("Unable to export O3D", error);
    status.textContent = `Unable to export O3D: ${error.message}`;
  }
});
materialSelect.addEventListener("change", showMaterial);
for (const format of ["obj", "mtl"]) {
  byId(`export-${format}`).addEventListener("click", () => {
    try {
      const model = sceneModels[Number(materialModel.value)];
      if (!model) throw new Error("Select a scene model first.");
      const name = downloadWavefront(model, format);
      status.textContent = `Download started: ${name}. Download both files and provide any referenced textures separately.`;
    } catch (error) {
      console.error("Unable to export model", error);
      status.textContent = `Unable to export model: ${error.message}`;
    }
  });
  byId(`export-scene-${format}`).addEventListener("click", () => {
    try {
      const name = downloadWavefront(combineSceneModels(sceneModels), format);
      status.textContent = `Download started: ${name}. Download both scene files and provide any referenced textures separately.`;
    } catch (error) {
      console.error("Unable to export scene", error);
      status.textContent = `Unable to export scene: ${error.message}`;
    }
  });
  byId(`export-group-${format}`).addEventListener("click", () => {
    try {
      if (!selectedExportGroup) throw new Error("Select a scene group first.");
      const name = downloadWavefront(
        combineSceneModels(descendantModels(selectedExportGroup), "group.obj"),
        format,
      );
      status.textContent = `Download started: ${name}. Download both group files and provide any referenced textures separately.`;
    } catch (error) {
      console.error("Unable to export group", error);
      status.textContent = `Unable to export group: ${error.message}`;
    }
  });
}
byId("material-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const material =
    sceneModels[Number(materialModel.value)]?.materials[
      Number(materialSelect.value)
    ];
  if (!renderer || !material) return;
  try {
    const updated = {
      ...material,
      diffuse: parseVector(byId("material-diffuse").value, 4, "Diffuse"),
      spec: parseVector(byId("material-spec").value, 3, "Specular"),
      emission: parseVector(byId("material-emission").value, 3, "Emission"),
      specPower: Number(byId("material-power").value),
      nightmapStrength: Number(byId("material-night-strength").value),
      lightmapStrength: Number(byId("material-light-strength").value),
      bumpmapStrength: Number(byId("material-bump-strength").value),
      envmapStrength: Number(byId("material-env-strength").value),
      alphaMode:
        byId("material-alpha").value === "auto"
          ? undefined
          : Number(byId("material-alpha").value),
      noZCheck: byId("material-nozcheck").checked,
      noZWrite: byId("material-nozwrite").checked,
    };
    if (!Number.isFinite(updated.specPower) || updated.specPower < 0)
      throw new Error("Specular power must be a non-negative number.");
    if (
      ![updated.nightmapStrength, updated.lightmapStrength].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    ) {
      throw new Error("Map strengths must be non-negative numbers.");
    }
    if (
      ![updated.bumpmapStrength, updated.envmapStrength].every(
        (value) =>
          Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      )
    ) {
      throw new Error(
        "Bump and environment strengths must be finite 32-bit numbers.",
      );
    }
    renderer.updateMaterial(
      Number(materialModel.value),
      Number(materialSelect.value),
      updated,
    );
    Object.assign(material, updated);
    status.textContent =
      "Material updated for this scene. Source files are unchanged.";
  } catch (error) {
    status.textContent = `Unable to update material: ${error.message}`;
  }
});

function showWarnings(warnings) {
  warningList.replaceChildren(
    ...warnings.map((warning) => {
      const item = document.createElement("li");
      item.textContent = warning;
      return item;
    }),
  );
  warningDetails.hidden = warnings.length === 0;
  warningDetails.open = warnings.length > 0;
}

function selectFiles(selectedFiles) {
  files = selectedFiles;
  const candidates = files
    .map((file) => file.webkitRelativePath || file.name)
    .filter((path) => /\.(o3d|rdy|cfg|sco|bus|ovh|obj|map)$/i.test(path))
    .sort((a, b) => a.localeCompare(b));
  entry.replaceChildren();
  for (const path of candidates) {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path;
    entry.append(option);
  }
  if (!candidates.length) {
    const option = document.createElement("option");
    option.textContent = "No supported files selected";
    entry.append(option);
  }
  entry.disabled = !candidates.length;
  configFiles = files
    .filter((file) =>
      /\.(cfg|sco|bus|ovh|cti|sli|map)$/i.test(
        file.webkitRelativePath || file.name,
      ),
    )
    .sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(
        b.webkitRelativePath || b.name,
      ),
    );
  configFile.replaceChildren();
  configFiles.forEach((file, index) =>
    addOption(configFile, index, file.webkitRelativePath || file.name),
  );
  configFile.disabled = !configFiles.length;
  if (!configFiles.length)
    addOption(configFile, "", "No configuration files selected");
  showConfiguration();
  open.disabled =
    !candidates.length || !renderer || !!renderer.error || loading;
  status.textContent = candidates.length
    ? `${files.length} files selected. Choose a model or configuration.`
    : configFiles.length
      ? "Configuration files selected for inspection; no supported model entry found."
      : "No supported model or configuration files were found in the selection.";
  return candidates.length;
}

function onFileSelection(event) {
  selectionRequest++;
  selectFiles(Array.from(event.target.files));
  event.target.value = "";
}

byId("model-files").addEventListener("change", onFileSelection);
byId("folder-files").addEventListener("change", onFileSelection);
document.addEventListener("dragover", (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes("Files"))
    event.preventDefault();
});
document.addEventListener("drop", async (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
  const request = ++selectionRequest;
  try {
    const items = captureDrop(event.dataTransfer);
    status.textContent = "Reading dropped files…";
    const selected = await readDroppedFiles(items);
    if (request !== selectionRequest) return;
    const count = selectFiles(selected);
    if (count === 1 && !open.disabled) open.click();
  } catch (error) {
    if (request !== selectionRequest) return;
    console.error("Unable to read dropped files", error);
    status.textContent = `Unable to read dropped files: ${error.message}. The previous selection is unchanged.`;
  }
});
fit.addEventListener("click", () => {
  lastPick = null;
  renderer?.resetCamera();
});
function focusSelectedModel() {
  if (!renderer || renderer.error || !sceneModels.length) return;
  try {
    renderer.focusModel(Number(materialModel.value));
    lastPick = null;
  } catch (error) {
    console.error("Unable to focus model", error);
    status.textContent = `Unable to focus model: ${error.message}`;
  }
}
focusButton.addEventListener("click", focusSelectedModel);
document.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() !== "f" ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey ||
    event.repeat ||
    (event.target !== document.body && event.target !== canvas)
  )
    return;
  if (!focusButton.disabled) {
    event.preventDefault();
    focusSelectedModel();
  }
});
fullbright.addEventListener("change", () => {
  try {
    renderer.setFullbright(fullbright.checked);
  } catch (error) {
    fullbright.checked = !fullbright.checked;
    console.error("Unable to change fullbright mode", error);
    status.textContent = `Unable to change fullbright mode: ${error.message}`;
  }
});
highlightSelection.addEventListener("change", () => {
  try {
    renderer.setSelectionHighlight(highlightSelection.checked);
  } catch (error) {
    highlightSelection.checked = !highlightSelection.checked;
    console.error("Unable to change selection highlighting", error);
    status.textContent = `Unable to change selection highlighting: ${error.message}`;
  }
});
showGizmos.addEventListener("change", () => {
  try {
    changeGizmoVisibility(
      renderer,
      sceneModels,
      sceneVisibility,
      configVisibility,
      viewpoint,
      showGizmos.checked,
    );
    showSceneList();
  } catch (error) {
    showGizmos.checked = !showGizmos.checked;
    console.error("Unable to change gizmo visibility", error);
    status.textContent = `Unable to change gizmo visibility: ${error.message}`;
  }
});
wireframe.addEventListener("change", () => {
  try {
    renderer.setWireframe(wireframe.checked);
    lastPick = null;
  } catch (error) {
    wireframe.checked = !wireframe.checked;
    status.textContent = `Unable to change wireframe mode: ${error.message}`;
  }
});
cullBackfaces.addEventListener("change", () => {
  try {
    renderer.setBackfaceCulling(cullBackfaces.checked);
    lastPick = null;
  } catch (error) {
    cullBackfaces.checked = !cullBackfaces.checked;
    console.error("Unable to change back-face culling", error);
    status.textContent = `Unable to change back-face culling: ${error.message}`;
  }
});
open.addEventListener("click", async () => {
  if (!renderer || loading) return;
  repaintRequest++;
  byId("repaint-select").disabled = true;
  loading = true;
  showRepaintFiles();
  open.disabled = true;
  status.textContent = `Loading ${entry.value}…`;
  showWarnings([]);
  let newModels = [];
  let newRepaint;
  let adopted = false;
  try {
    const result = await loadScene(files, [entry.value]);
    newModels = result.models;
    newRepaint = createRepaintSession(
      result.models,
      result.repaintGroups,
      result.repaintTextures,
    );
    if (result.lights.length > MAX_INTERIOR_LIGHTS) {
      result.warnings.push(
        `Only the first ${MAX_INTERIOR_LIGHTS} interior lights are rendered (desktop default: 16 lights including the sun).`,
      );
    }
    showWarnings(result.warnings);
    if (
      !result.models.length &&
      (!byId("allow-empty-scene").checked || !result.hierarchy?.length)
    ) {
      status.textContent =
        "No models could be loaded. The previous scene remains visible; see load warnings.";
      return;
    }
    for (const model of result.models) {
      for (const material of model.materials)
        material.nightmapStrength = globalNightStrength;
    }
    renderer.setModels(result.models);
    renderer.setSelectedModel(result.models.length ? 0 : null);
    if (!showGizmos.checked) {
      changeGizmoVisibility(
        renderer,
        result.models,
        result.models.map(() => true),
        result.models.map(() => true),
        0,
        false,
      );
    }
    renderer.setLights(result.lights);
    repaintSession?.dispose();
    repaintSession = newRepaint;
    closeTextures(sceneModels);
    showSceneMaterials(result.models);
    selectedModel = result.models.length ? 0 : null;
    sceneLoaded = true;
    sceneHierarchy =
      result.hierarchy ??
      result.models.map((_model, modelIndex) => ({
        type: "model",
        modelIndex,
        children: [],
      }));
    selectedCabinItem = null;
    showCabinInspector();
    selectedSceneGroup = null;
    showSceneGroupInspector();
    selectedExportGroup = null;
    byId("export-group-label").textContent =
      "Choose a group in the scene tree to export its models.";
    byId("export-group-obj").disabled = true;
    byId("export-group-mtl").disabled = true;
    sceneLights = result.lights;
    repaintApplying = false;
    lastPick = null;
    byId("bind-light-variables").disabled =
      !sceneLights.length || !!renderer.error;
    showVariables(result.models);
    showRepaints();
    showLights();
    sceneLods = result.lods;
    adopted = true;
    sceneVisibility = result.models.map(() => true);
    configVisibility = result.models.map(() => true);
    viewpoint = 0;
    viewpointSelect.value = "0";
    syncDropdown(viewpointSelect);
    viewpointSelect.disabled =
      !result.models.some((model) => model.viewpoint > 0) || !!renderer.error;
    showSceneList();
    byId("lod-radius").value = "1";
    byId("lod-radius").disabled = !sceneLods.length;
    byId("lod-apply").disabled = !sceneLods.length;
    showLods();
    byId("scene-summary").textContent =
      `${result.models.length} model${result.models.length === 1 ? "" : "s"} loaded.`;
    byId("placeholder").hidden = !!result.models.length;
    byId("placeholder").textContent =
      "This configuration contains no loaded model geometry.";
    fit.disabled = !result.models.length;
    focusButton.disabled = !result.models.length;
    byId("global-night-strength").disabled = !result.models.length;
    status.textContent = `Loaded ${result.models.length} model${result.models.length === 1 ? "" : "s"}${result.warnings.length ? ` with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}` : ""}.`;
  } catch (error) {
    console.error("Unable to load model", error);
    status.textContent = `Unable to load model: ${error.message}`;
  } finally {
    if (!adopted) {
      newRepaint?.dispose();
      closeTextures(newModels);
      repaintApplying = false;
      if (repaintSession)
        byId("repaint-select").disabled =
          !!renderer?.error || !repaintSession.schemes.length;
    }
    loading = false;
    if (repaintSession)
      byId("repaint-select").disabled =
        !!renderer?.error || !repaintSession.schemes.length;
    showRepaintFiles();
    open.disabled = !renderer || !!renderer.error || entry.disabled;
  }
});

async function prepareOffline() {
  if (!("serviceWorker" in navigator)) {
    offlineStatus.textContent =
      "Offline installation unavailable in this browser.";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    const worker = registration.installing || registration.waiting;
    if (worker) {
      await new Promise((resolve, reject) => {
        function checkState() {
          if (worker.state === "activated") {
            worker.removeEventListener("statechange", checkState);
            resolve();
          } else if (worker.state === "redundant") {
            worker.removeEventListener("statechange", checkState);
            reject(new Error("The offline update failed to activate."));
          }
        }
        worker.addEventListener("statechange", checkState);
        checkState();
      });
    }
    await navigator.serviceWorker.ready;
    if (!registration.active)
      throw new Error("The offline worker did not activate.");
    offlineStatus.textContent = "Ready for offline use.";
  } catch (error) {
    console.error("Offline setup failed", error);
    offlineStatus.textContent = `Offline setup failed: ${error.message}`;
  }
}

prepareOffline();
try {
  const result = await createRenderer(canvas);
  renderer = result.renderer;
  canvas = result.canvas;
  backend = result.backend;
  canvas.addEventListener("renderererror", onRendererError);
  let pickPointer = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !pickPointer)
      pickPointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (
      lastPick &&
      (lastPick.x !== event.clientX || lastPick.y !== event.clientY)
    )
      lastPick = null;
    if (
      pickPointer?.id === event.pointerId &&
      (event.clientX !== pickPointer.x || event.clientY !== pickPointer.y)
    )
      pickPointer.moved = true;
  });
  canvas.addEventListener("wheel", () => {
    lastPick = null;
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (pickPointer?.id === event.pointerId) pickPointer = null;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pickPointer?.id !== event.pointerId) return;
    const pointer = pickPointer;
    pickPointer = null;
    if (
      pointer.moved ||
      event.clientX !== pointer.x ||
      event.clientY !== pointer.y ||
      !sceneModels.length ||
      renderer.error
    )
      return;
    try {
      const after =
        lastPick?.x === event.clientX &&
        lastPick.y === event.clientY &&
        lastPick.index === selectedModel
          ? lastPick.index
          : null;
      const index = pickModel(
        renderer,
        sceneModels,
        event.clientX,
        event.clientY,
        after,
      );
      lastPick =
        index === null ? null : { x: event.clientX, y: event.clientY, index };
      if (index !== null) selectModel(index);
    } catch (error) {
      console.error("Unable to pick model", error);
      status.textContent = `Unable to pick model: ${error.message}`;
    }
  });
  wireframe.disabled = false;
  cullBackfaces.disabled = false;
  fullbright.disabled = false;
  highlightSelection.disabled = false;
  showGizmos.disabled = false;
  if (result.webgpuError)
    console.warn("WebGPU unavailable; using WebGL 2:", result.webgpuError);
  byId("renderer-status").textContent = `Renderer: ${backend}`;
  status.textContent = `Ready (${backend}). Choose model files or a folder.`;
  open.disabled = entry.disabled;
} catch (error) {
  console.error("Renderer initialization failed", error);
  status.textContent = `Renderer unavailable: ${error.message}`;
  byId("renderer-status").textContent = "Renderer unavailable";
  byId("placeholder").textContent = "WebGPU or WebGL 2 is required.";
}
