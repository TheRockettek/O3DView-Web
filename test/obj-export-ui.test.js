import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { duplicateLight, encodeInteriorLights } from "../src/light-data.js";
import { parseO3D } from "../src/o3d.js";
import { bindSceneVisibilityGroups } from "../src/scene-visibility.js";
import { initializeSceneVariableDefaults } from "../src/scene-variables.js";
import {
  canContainSceneNode,
  containsSceneNode,
  deletableSceneModelIndices,
  findSceneNodeParent,
  moveSceneNode,
  reparentSceneNode,
  restoreSceneNodeParent,
} from "../src/scene-hierarchy.js";
import { focusPosition } from "../src/camera-controls.js";
import {
  CABIN_MARKER_TRIANGLE_COUNT,
  CABIN_PATH_LINK_TRIANGLE_COUNT,
  cabinMarkerIcon,
  cabinMarkerExportModel,
  cabinPathPointWorldPosition,
  updateCabinMarkerPosition,
  updateCabinSeatProperties,
  updateCabinSeatPreview,
} from "../src/cabin-path.js";

class Element {
  constructor(id = "") {
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.value = "";
    this.disabled = false;
    this.checked = false;
    this.textContent = "";
    this.hidden = false;
    this.dataset = {};
    this.style = {};
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
  replaceChildren(...children) {
    this.children = children;
    this.value = children[0]?.value ?? "";
  }
  prepend(...children) {
    this.children.unshift(...children);
  }
  append(...children) {
    this.children.push(...children);
    if (
      this.children.length === children.length &&
      children[0]?.value !== undefined
    )
      this.value = children[0].value;
  }
  querySelector(selector) {
    if (selector === 'button[type="submit"]')
      return (this.submitButton ??= new Element());
    return null;
  }
  async emit(type, extra = {}) {
    return this.listeners[type]?.({
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    });
  }
}

test("scene selection and applied material edits reach export; failures appear in status", async () => {
  const elements = new Map();
  const listeners = new Map();
  const document = {
    body: new Element("body"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element(id));
      return elements.get(id);
    },
    createElement: () => new Element(),
    createTextNode: () => new Element(),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  };
  const get = (id) => document.getElementById(id);
  const originalFetch = globalThis.fetch;
  const seatPreviewFiles = new Map(
    await Promise.all(
      ["player_standing.o3d", "player_sitting.o3d"].map(async (name) => [
        name,
        await readFile(
          new URL(`../O3DView/O3DView/Resources/${name}`, import.meta.url),
        ),
      ]),
    ),
  );
  globalThis.fetch = async (input) => {
    const name = new URL(input).pathname.split("/").at(-1);
    const data = seatPreviewFiles.get(name);
    if (!data) throw new Error(`Unexpected preview asset request: ${input}`);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };
  get("entry").disabled = true;
  get("export-obj").disabled = true;
  get("export-mtl").disabled = true;
  const material = () => ({
    diffuse: [1, 1, 1, 1],
    spec: [0, 0, 0],
    emission: [0, 0, 0],
    specPower: 8,
    textureName: "",
  });
  const models = [
    {
      name: "same.o3d",
      vertices: new Float32Array(8),
      triangles: new Uint32Array(4),
      materials: [material()],
      illuminationInterior: [0],
    },
    {
      name: "same.o3d",
      vertices: new Float32Array(8),
      triangles: new Uint32Array(4),
      materials: [material()],
    },
  ];
  const startingModelCount = models.length;
  const lights = [
    {
      variable: "lamp",
      source: "model.cfg",
      line: 4,
      position: [1, 2, 3],
      color: [1, 0.5, 0],
      range: 4,
      on: true,
    },
  ];
  const hierarchy = [
    {
      type: "configuration",
      name: "model.cfg",
      children: [
        {
          type: "model",
          modelIndex: 0,
          sourceName: "same.o3d",
          children: [],
        },
        {
          type: "lod",
          name: "LOD 0.8",
          children: [
            {
              type: "model",
              modelIndex: 1,
              sourceName: "same.o3d",
              children: [],
            },
          ],
        },
        {
          type: "lights",
          name: "Interior lights",
          children: [{ type: "light", lightIndex: 0, children: [] }],
        },
        {
          type: "cabin",
          name: "Passenger Cabin",
          children: [
            {
              type: "cabin-item",
              name: "Seat 0",
              children: [],
              info: {
                kind: "passpos",
                source: "cabin.cfg",
                line: 12,
                position: [1, 2, 3],
                height: 1,
                rotation: 90,
              },
            },
            {
              type: "cabin-item",
              name: "Path point 0",
              children: [],
              info: {
                kind: "path point",
                source: "path.cfg",
                line: 1,
                index: 0,
                position: [0, 0, 0],
                pathState: { placement: null },
              },
            },
            {
              type: "cabin-item",
              name: "Path link 0",
              children: [],
              info: {
                kind: "path link",
                source: "path.cfg",
                line: 5,
                index: 0,
                pathState: {},
                link: {
                  a: 0,
                  b: 1,
                  oneWay: false,
                  roomHeight: 0,
                  stepSound: 0,
                },
              },
            },
          ],
        },
      ],
    },
  ];
  const lods = [
    {
      source: "model.cfg",
      line: 1,
      viewRadius: Math.fround(0.8),
      radiusText: "0.8",
      visible: true,
    },
  ];
  hierarchy[0].children[1].lod = lods[0];
  models[0].lod = lods[0];
  const calls = [];
  const focusedPositions = [];
  const lightUpdates = [];
  const collectedLights = [];
  const picks = [];
  let pickHit = null;
  let sceneResult = { models, lights, lods, hierarchy, warnings: [] };
  let failCreate = false;
  let failDelete = false;
  let failSceneDelete = false;
  let failModelDuplicate = false;
  let failRepaint = false;
  const repaintCalls = [];
  const duplicateBindings = [];
  const removalCalls = [];
  const repaint = {
    schemes: ["Blue"],
    ctis: [{ source: "paint.cti", active: true }],
    async apply(_renderer, scheme) {
      repaintCalls.push(scheme);
      if (failRepaint) throw new Error("repaint failed");
      return [];
    },
    async importFiles() {
      const cti = { source: "additional.cti", active: true };
      this.ctis.push(cti);
      this.schemes.push("Red");
      return { ctis: [cti], warnings: [] };
    },
    includeDuplicates(pairs) {
      duplicateBindings.push(...pairs);
    },
    removeModels(indices) {
      removalCalls.push([...indices]);
    },
    referencesTexture() {
      return false;
    },
    ownsTexture() {
      return false;
    },
    dispose() {},
  };
  const sunUpdates = [];
  let hideReferenceSamples = false;
  const projectPoint = (_renderer, position) => ({
    x: 30 + position[0] * 100,
    y: 40 + position[2] * 100,
  });
  const renderer = {
    _target: [0, 0, 0],
    _distance: 10,
    _yaw: Math.PI / 2,
    _pitch: 0,
    _viewRadius: 10,
    _requestFrame() {},
    setModels(value) {
      if (failModelDuplicate && value.length > startingModelCount)
        throw new Error("duplicate failed");
      if (failSceneDelete && value.length < models.length)
        throw new Error("model deletion failed");
    },
    setModelVisible() {},
    setSelectedModel() {},
    setLights(value) {
      if (value[0]?.range === 13) throw new Error("invalid light");
      if (failCreate && value.some((light) => light.created))
        throw new Error("creation failed");
      if (failDelete && value.length < lights.length)
        throw new Error("deletion failed");
      encodeInteriorLights(value);
      lightUpdates.push(value);
    },
    setSun(value) {
      if (value) encodeInteriorLights([value]);
      sunUpdates.push(value);
    },
    updateMaterial() {},
    setSelectedModel() {},
    setSelectionHighlight() {},
    focusModel(index) {
      calls.push({ focus: index });
    },
    setBackfaceCulling(value) {
      calls.push({ cull: value });
    },
    setFullbright(value) {
      calls.push({ fullbright: value });
    },
  };
  globalThis.document = document;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.__appTestDeps = {
    createRenderer: async (canvas) => ({ renderer, canvas, backend: "test" }),
    loadScene: async () => sceneResult,
    parseO3D,
    decodeConfiguration() {},
    listCommands: () => [],
    collectSceneVariables: (_models, lights) => {
      collectedLights.push(lights);
      return [];
    },
    initializeSceneVariableDefaults,
    updateSceneVariable() {},
    changeViewpoint() {},
    changeGizmoVisibility() {},
    changeLodVisibility(
      _renderer,
      _models,
      _manual,
      _config,
      _viewpoint,
      changes,
    ) {
      calls.push({
        lodChanges: changes.map(([lod, visible]) => [lod, visible]),
      });
      for (const [lod, visible] of changes) lod.visible = visible;
    },
    isModelVisible: () => true,
    viewpointAllows: () => true,
    captureDrop() {},
    readDroppedFiles() {},
    MAX_INTERIOR_LIGHTS: 16,
    duplicateLight,
    bindSceneVisibilityGroups,
    canContainSceneNode,
    containsSceneNode,
    deletableSceneModelIndices,
    findSceneNodeParent,
    moveSceneNode,
    reparentSceneNode,
    restoreSceneNodeParent,
    CABIN_MARKER_TRIANGLE_COUNT,
    CABIN_PATH_LINK_TRIANGLE_COUNT,
    cabinMarkerIcon,
    cabinMarkerExportModel,
    cabinPathPointWorldPosition,
    updateCabinMarkerPosition,
    updateCabinSeatProperties,
    updateCabinSeatPreview,
    updateNightStrength() {},
    createRepaintSession: () => repaint,
    enhanceDropdowns() {},
    syncDropdown() {},
    pickModelHit: (_renderer, _models, _x, _y, after) => {
      picks.push(after);
      return (
        pickHit ??
        (after === 1
          ? { index: 0, triangleIndex: 0 }
          : { index: 1, triangleIndex: 0 })
      );
    },
    projectWorldPosition: projectPoint,
    projectVisibleWorldPosition: (activeRenderer, _models, position) =>
      hideReferenceSamples ? null : projectPoint(activeRenderer, position),
    translateSceneModel: (_renderer, models, index, translation) => {
      models[index].worldTranslation = translation;
    },
    updateCabinPathPoint: (_state, _index, position) => {
      hierarchy[0].children[3].children[1].info.position = position;
      return [];
    },
    updateCabinPathReference: (state, item, pathPoint) => {
      item.pathPoint = pathPoint;
      if (
        ["entry", "exit", "linktonextveh", "linktoprevveh"].includes(item.kind)
      )
        item.position = state.paths.points[pathPoint];
      return [];
    },
    updateCabinPathLink: (_state, _index, changes) => {
      Object.assign(hierarchy[0].children[3].children[2].info.link, changes);
      return [];
    },
    focusModels: (_renderer, models) => calls.push({ focusGroup: models }),
    focusPosition: (_renderer, position) => focusedPositions.push(position),
    combineSceneModels: (value, name = "scene.obj") => ({
      name,
      materials: value[0].materials,
      sceneModels: value,
    }),
    downloadO3D(model, format) {
      calls.push({ model, format });
      return "same.o3d";
    },
    downloadWavefront(model, format) {
      if (format === "mtl") throw new Error("downloads blocked");
      calls.push({ model, diffuse: [...model.materials[0].diffuse] });
      return "same.obj";
    },
  };
  try {
    const appUrl = new URL("../src/app.js", import.meta.url).href;
    const source = (
      await readFile(new URL("../src/app.js", import.meta.url), "utf8")
    )
      .replace(/^import[\s\S]*?;\r?\n/gm, "")
      .replaceAll(
        "new URL(path, import.meta.url)",
        `new URL(path, ${JSON.stringify(appUrl)})`,
      )
      .replaceAll("import.meta.url", JSON.stringify(appUrl));
    assert.doesNotMatch(source, /^import\s/m);
    const prefix =
      "const { createRenderer, loadScene, parseO3D, decodeConfiguration, listCommands, collectSceneVariables, initializeSceneVariableDefaults, updateSceneVariable, changeViewpoint, changeLodVisibility, changeGizmoVisibility, bindSceneVisibilityGroups, isModelVisible, viewpointAllows, captureDrop, readDroppedFiles, downloadWavefront, downloadO3D, combineSceneModels, MAX_INTERIOR_LIGHTS, duplicateLight, canContainSceneNode, containsSceneNode, deletableSceneModelIndices, findSceneNodeParent, moveSceneNode, reparentSceneNode, restoreSceneNodeParent, CABIN_MARKER_TRIANGLE_COUNT, CABIN_PATH_LINK_TRIANGLE_COUNT, cabinMarkerIcon, cabinMarkerExportModel, updateNightStrength, createRepaintSession, enhanceDropdowns, syncDropdown, pickModelHit, projectWorldPosition, projectVisibleWorldPosition, translateSceneModel, updateCabinPathPoint, updateCabinPathReference, updateCabinPathLink, updateCabinMarkerPosition, updateCabinSeatProperties, updateCabinSeatPreview, focusModels, focusPosition, cabinPathPointWorldPosition } = globalThis.__appTestDeps;\n";
    await import(
      `data:text/javascript;base64,${Buffer.from(prefix + source).toString("base64")}`
    );
    let openShortcutCalls = 0,
      shortcutPrevented = false;
    get("open").click = () => openShortcutCalls++;
    const keydown = listeners.get("keydown");
    keydown({
      target: document.body,
      key: "o",
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault() {
        shortcutPrevented = true;
      },
    });
    assert.equal(openShortcutCalls, 1);
    assert.equal(shortcutPrevented, true);
    keydown({
      target: get("model-name"),
      key: "o",
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault() {
        shortcutPrevented = false;
      },
    });
    assert.equal(openShortcutCalls, 1);
    assert.equal(shortcutPrevented, true);
    delete get("open").click;
    assert.equal(get("export-obj").disabled, true);
    get("model-files").files = [{ name: "same.o3d" }];
    await get("model-files").emit("change");
    await get("open").emit("click");
    const modelInspect =
      get("scene-list").children[1].children[0].children[1].children[0]
        .children[1];
    await modelInspect.emit("click");
    assert.match(get("scene-group-info").textContent, /Model source: same\.o3d/);
    assert.match(get("scene-group-info").textContent, /Vertices: 1/);
    assert.match(get("scene-group-info").textContent, /Triangles: 1/);
    assert.match(get("scene-group-info").textContent, /Materials: 1/);
    let focusPrevented = false;
    listeners.get("keydown")({
      target: document.body,
      key: "f",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault() {
        focusPrevented = true;
      },
    });
    assert.equal(focusPrevented, true);
    assert.deepEqual(calls.shift(), { focus: 0 });
    get("show-light-references").checked = true;
    await get("show-light-references").emit("change");
    assert.equal(
      get("light-reference-layer").children.filter(
        (child) => child.className === "light-reference-line",
      ).length,
      1,
    );
    let lightReferenceLine = get("light-reference-layer").children.find(
      (child) => child.className === "light-reference-line",
    );
    assert.equal(lightReferenceLine.style.left, "30px");
    assert.equal(lightReferenceLine.style.top, "40px");
    hideReferenceSamples = true;
    await get("show-light-references").emit("change");
    lightReferenceLine = get("light-reference-layer").children.find(
      (child) => child.className === "light-reference-line",
    );
    assert.match(lightReferenceLine.style.background, /transparent/);
    hideReferenceSamples = false;
    await get("show-light-references").emit("change");
    const lightReference = get("light-reference-layer").children.find(
      (child) => child.className === "light-reference-marker",
    );
    await lightReference.emit("click");
    assert.match(get("scene-group-info").textContent, /Type: light/);
    assert.equal(get("light-select").value, "0");
    pickHit = { index: 0, triangleIndex: 0 };
    const groupPointer = {
      pointerId: 7,
      button: 0,
      clientX: 20,
      clientY: 25,
      altKey: true,
    };
    await get("viewport").emit("pointerdown", groupPointer);
    await get("viewport").emit("pointerup", groupPointer);
    assert.match(get("scene-group-info").textContent, /Type: configuration/);
    const cabinInspect =
      get("scene-list").children[1].children[0].children[1].children[3]
        .children[0].children[1].children[0].children[1];
    await cabinInspect.emit("click");
    assert.match(get("cabin-info").textContent, /cabin\.cfg:12/);
    assert.match(
      get("cabin-info").textContent,
      /OMSI position \(X Y Z\): 1 2 3/,
    );
    assert.equal(get("focus-scene-group").textContent, "Focus cabin item");
    await get("focus-scene-group").emit("click");
    assert.deepEqual(focusedPositions.at(-1), [1, 3, 2]);
    assert.match(
      get("status").textContent,
      /Centered the view on the selected cabin item/,
    );
    assert.equal(get("cabin-seat-form").hidden, false);
    get("cabin-seat-height").value = "1.25";
    get("cabin-seat-rotation").value = "180";
    await get("cabin-seat-form").emit("submit");
    assert.equal(hierarchy[0].children[3].children[0].info.height, 1.25);
    assert.equal(hierarchy[0].children[3].children[0].info.rotation, 180);
    assert.match(get("cabin-info").textContent, /Height: 1.25/);
    assert.match(get("status").textContent, /Seat properties updated/);
    const seatError = console.error;
    try {
      console.error = () => {};
      get("cabin-seat-height").value = "2";
      get("cabin-seat-rotation").value = "1e1000";
      await get("cabin-seat-form").emit("submit");
    } finally {
      console.error = seatError;
    }
    assert.equal(hierarchy[0].children[3].children[0].info.height, 1.25);
    assert.equal(hierarchy[0].children[3].children[0].info.rotation, 180);
    assert.match(get("status").textContent, /finite 32-bit/);
    assert.equal(get("cabin-item-name-form").hidden, false);
    assert.equal(get("cabin-item-name").value, "Seat 0");
    get("cabin-item-name").value = "Front seat";
    await get("cabin-item-name-form").emit("submit");
    assert.equal(hierarchy[0].children[3].children[0].name, "Front seat");
    assert.match(
      get("cabin-info").textContent,
      /^Front seat\nOriginal name: Seat 0/,
    );
    assert.match(get("status").textContent, /renamed for this scene/);
    assert.equal(get("cabin-point-form").hidden, true);
    const pointInspect =
      get("scene-list").children[1].children[0].children[1].children[3]
        .children[0].children[1].children[1].children[1];
    await pointInspect.emit("click");
    assert.equal(get("cabin-point-form").hidden, false);
    assert.equal(get("cabin-seat-form").hidden, true);
    get("cabin-point-position").value = "4 5 6";
    await get("cabin-point-form").emit("submit");
    assert.match(
      get("cabin-info").textContent,
      /OMSI position \(X Y Z\): 4 5 6/,
    );
    assert.match(get("status").textContent, /Cabin path point updated/);
    assert.equal(get("focus-scene-group").textContent, "Focus cabin point");
    await get("focus-scene-group").emit("click");
    assert.deepEqual(focusedPositions.at(-1), [4, 6, 5]);
    assert.match(
      get("status").textContent,
      /Centered the view on the selected cabin path point/,
    );
    const linkInspect =
      get("scene-list").children[1].children[0].children[1].children[3]
        .children[0].children[1].children[2].children[1];
    await linkInspect.emit("click");
    assert.equal(get("cabin-point-form").hidden, true);
    assert.equal(get("cabin-link-form").hidden, false);
    assert.equal(get("focus-scene-group").disabled, true);
    const focusCallsBeforeLink = calls.length;
    let linkFocusPrevented = false;
    listeners.get("keydown")({
      target: document.body,
      key: "f",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault() {
        linkFocusPrevented = true;
      },
    });
    assert.equal(linkFocusPrevented, false);
    assert.equal(calls.length, focusCallsBeforeLink);
    get("cabin-link-a").value = "1";
    get("cabin-link-b").value = "2";
    get("cabin-link-oneway").checked = true;
    get("cabin-link-room").value = "1.5";
    get("cabin-link-sound").value = "3";
    await get("cabin-link-form").emit("submit");
    assert.match(get("cabin-info").textContent, /Endpoints: 1 2/);
    assert.match(get("cabin-info").textContent, /One-way: yes/);
    get("cull-backfaces").checked = true;
    await get("cull-backfaces").emit("change");
    assert.deepEqual(calls.shift(), { cull: true });
    assert.equal(get("desktop-sun").disabled, false);
    get("desktop-sun").checked = true;
    await get("desktop-sun").emit("change");
    assert.deepEqual(sunUpdates.at(-1).color, [0.9, 0.9, 0.9]);
    get("sun-direction").value = "0 -2 0";
    get("sun-color").value = "1 .5 0";
    get("sun-ambient").value = ".2 0 0";
    get("sun-intensity").value = "2";
    get("sun-on").checked = true;
    await get("sun-form").emit("submit");
    assert.equal(sunUpdates.at(-1).intensity, 2);
    const sunError = console.error;
    try {
      console.error = () => {};
      get("sun-direction").value = "0 0 0";
      await get("sun-form").emit("submit");
    } finally {
      console.error = sunError;
    }
    assert.match(get("status").textContent, /Unable to update sun/);
    assert.equal(sunUpdates.at(-1).intensity, 2);
    get("desktop-sun").checked = false;
    await get("desktop-sun").emit("change");
    assert.equal(sunUpdates.at(-1), null);
    assert.equal(get("repaint-select").disabled, false);
    get("repaint-select").value = "0";
    await get("repaint-select").emit("change");
    assert.equal(repaintCalls.at(-1), "Blue");
    const repaintToggle = () =>
      get("repaint-file-list").children[0].children[0].children[0];
    repaintToggle().checked = false;
    await repaintToggle().emit("change");
    assert.equal(repaint.ctis[0].active, false);
    failRepaint = true;
    repaintToggle().checked = true;
    const oldRepaintError = console.error;
    try {
      console.error = () => {};
      await repaintToggle().emit("change");
    } finally {
      console.error = oldRepaintError;
    }
    assert.equal(repaint.ctis[0].active, false);
    assert.match(get("status").textContent, /Unable to apply repaint/);
    failRepaint = false;
    get("repaint-files").files = [{ name: "additional.cti" }];
    await get("repaint-files").emit("change");
    assert.equal(repaint.ctis.length, 2);
    assert.equal(repaintCalls.at(-1), "Blue");
    assert.equal(get("repaint-select").value, "0");
    assert.equal(get("repaint-select").disabled, false);
    assert.equal(
      get("scene-list").children[1].children[0].children[0].textContent,
      "model.cfg",
    );
    get("scene-search").value = "not-present";
    await get("scene-search").emit("input");
    assert.equal(get("scene-list").children.length, 0);
    get("scene-search").value = "lamp";
    await get("scene-search").emit("input");
    assert.equal(get("scene-list").children.length, 1);
    get("scene-search").value = "";
    await get("scene-search").emit("input");
    const lodToggle = () =>
      get("scene-list").children[1].children[0].children[1].children[1]
        .children[0].children[0].children[0];
    const groupSummary = () =>
      get("scene-list").children[1].children[0].children[1].children[1]
        .children[0].children[0];
    const groupButton = groupSummary().children[3];
    await groupButton.emit("click", { stopPropagation() {} });
    assert.equal(get("export-group-obj").disabled, false);
    await groupSummary().children[2].emit("click", { stopPropagation() {} });
    assert.match(
      get("scene-group-info").textContent,
      /Original name: LOD 0\.8/,
    );
    assert.equal(get("focus-scene-group").disabled, false);
    await get("focus-scene-group").emit("click");
    assert.deepEqual(calls.shift(), { focusGroup: [models[1]] });
    assert.equal(get("scene-group-lod-form").hidden, false);
    get("scene-group-lod-radius").value = "0.9";
    await get("scene-group-lod-form").emit("submit");
    assert.equal(lods[0].viewRadius, Math.fround(0.9));
    assert.equal(lods[0].visible, true);
    assert.match(get("status").textContent, /Apply the LOD view radius/);
    const lodError = console.error;
    try {
      console.error = () => {};
      get("scene-group-lod-radius").value = "1e100";
      await get("scene-group-lod-form").emit("submit");
      assert.equal(lods[0].viewRadius, Math.fround(0.9));
      assert.match(get("status").textContent, /finite 32-bit/);
    } finally {
      console.error = lodError;
    }
    get("scene-group-name").value = "Renamed group";
    await get("scene-group-form").emit("submit");
    assert.equal(hierarchy[0].children[1].name, "Renamed group");
    assert.equal(hierarchy[0].children[1].sourceName, "LOD 0.8");
    assert.match(get("export-group-label").textContent, /Renamed group/);
    const groupError = console.error;
    try {
      console.error = () => {};
      get("scene-group-name").value = "  ";
      await get("scene-group-form").emit("submit");
      assert.equal(hierarchy[0].children[1].name, "Renamed group");
      assert.match(get("status").textContent, /Unable to rename group/);
    } finally {
      console.error = groupError;
    }
    lodToggle().checked = false;
    await lodToggle().emit("change");
    assert.deepEqual(calls.shift(), { lodChanges: [[lods[0], false]] });
    assert.equal(lods[0].visible, false);
    lodToggle().checked = true;
    await lodToggle().emit("change");
    assert.deepEqual(calls.shift(), { lodChanges: [[lods[0], true]] });
    assert.deepEqual(collectedLights.at(-1), []);
    get("bind-light-variables").checked = true;
    await get("bind-light-variables").emit("change");
    assert.equal(collectedLights.at(-1), lights);
    assert.equal(get("light-fields").disabled, false);
    assert.equal(get("light-position").value, "1 2 3");
    assert.equal(get("light-intensity").value, "1");
    get("light-position").value = "4 5 6";
    get("light-name").value = "Renamed lamp";
    get("light-color").value = ".2 .3 .4";
    get("light-range").value = "7";
    get("light-intensity").value = "2";
    await get("light-form").emit("submit");
    assert.match(get("light-select").children[0].textContent, /Renamed lamp/);
    assert.deepEqual(lightUpdates.at(-1)[0], {
      ...lights[0],
      mode: "point",
      direction: [0, -1, 0],
      ambient: [0, 0, 0],
      position: [4, 5, 6],
      color: [0.2, 0.3, 0.4],
      range: 7,
      intensity: 2,
    });
    failCreate = true;
    await get("duplicate-light").emit("click");
    assert.equal(lights.length, 1);
    assert.equal(hierarchy[0].children[2].children.length, 1);
    assert.match(
      get("status").textContent,
      /Unable to duplicate light: creation failed/,
    );
    failCreate = false;
    await get("duplicate-light").emit("click");
    assert.equal(lights.length, 2);
    assert.equal(get("light-select").value, "1");
    assert.deepEqual(hierarchy[0].children[2].children[1], {
      type: "light",
      name: "Renamed lamp copy",
      lightIndex: 1,
      children: [],
    });
    assert.equal(lights[1].created, true);
    assert.equal("variable" in lights[1], false);
    assert.deepEqual(lights[1].position, [4, 5, 6]);
    assert.deepEqual(lights[1].color, [0.2, 0.3, 0.4]);
    assert.equal(get("focus-scene-group").textContent, "Focus light");
    await get("focus-scene-group").emit("click");
    assert.deepEqual(focusedPositions.at(-1), [4, 5, 6]);
    assert.match(get("status").textContent, /Centered the view on the selected light/);
    await get("delete-light").emit("click");
    assert.equal(lights.length, 1);
    assert.equal(hierarchy[0].children[2].children.length, 1);
    assert.equal(get("scene-group-info").textContent, "No scene node selected.");
    const oldLightError = console.error;
    try {
      console.error = () => {};
      get("light-range").value = "13";
      await get("light-form").emit("submit");
      assert.match(
        get("status").textContent,
        /Unable to update light: invalid light/,
      );
      get("light-select").value = "0";
      await get("light-select").emit("change");
      assert.equal(get("light-range").value, "7");
    } finally {
      console.error = oldLightError;
    }
    try {
      console.error = () => {};
      failCreate = true;
      await get("create-point-light").emit("click");
      assert.match(
        get("status").textContent,
        /Unable to create point light: creation failed/,
      );
      assert.equal(lights.length, 1);
    } finally {
      console.error = oldLightError;
    }
    failCreate = false;
    await get("create-point-light").emit("click");
    assert.equal(lights.length, 2);
    assert.equal(get("light-select").value, "1");
    assert.deepEqual(lights[1], {
      name: "Point light 1",
      created: true,
      mode: "point",
      position: [0, 0, 0],
      direction: [0, -1, 0],
      color: [0.5, 0.5, 0.5],
      ambient: [0, 0, 0],
      range: 1000,
      intensity: 1,
      on: true,
    });
    await get("create-light").emit("click");
    assert.equal(lights[2].mode, "directional");
    assert.equal(get("light-mode").value, "directional");
    assert.equal(get("light-direction").disabled, false);
    get("light-direction").value = "0 0 0";
    try {
      console.error = () => {};
      await get("light-form").emit("submit");
      assert.match(get("status").textContent, /Invalid direction/);
    } finally {
      console.error = oldLightError;
    }
    assert.equal(lights[2].direction[1], -1);
    get("light-direction").value = "0 0 -1";
    get("light-ambient").value = ".2 .1 0";
    await get("light-form").emit("submit");
    assert.deepEqual(lights[2].direction, [0, 0, -1]);
    assert.deepEqual(lights[2].ambient, [0.2, 0.1, 0]);
    get("light-mode").value = "ambient";
    await get("light-mode").emit("change");
    assert.equal(get("light-direction").disabled, true);
    await get("light-form").emit("submit");
    assert.equal(lights[2].mode, "ambient");
    get("light-mode").value = "spot";
    await get("light-mode").emit("change");
    assert.equal(get("light-direction").disabled, false);
    await get("light-form").emit("submit");
    assert.equal(lights[2].mode, "spot");
    try {
      console.error = () => {};
      failDelete = true;
      await get("delete-light").emit("click");
      assert.match(
        get("status").textContent,
        /Unable to delete light: deletion failed/,
      );
      assert.equal(lights.length, 3);
    } finally {
      console.error = oldLightError;
    }
    failDelete = false;
    await get("delete-light").emit("click");
    assert.equal(lights.length, 2);
    assert.equal(collectedLights.at(-1), lights);
    assert.match(get("status").textContent, /Light removed/);
    assert.equal(get("lod-apply").disabled, false);
    get("lod-radius").value = "0.5";
    await get("lod-apply").emit("click");
    assert.deepEqual(calls.shift(), { lodChanges: [[lods[0], false]] });
    assert.equal(lods[0].visible, false);
    get("lod-radius").value = "0.8";
    await get("lod-apply").emit("click");
    assert.deepEqual(calls.shift(), { lodChanges: [[lods[0], false]] });
    assert.equal(lods[0].visible, false);
    get("lod-radius").value = "0.5";
    await get("lod-apply").emit("click");
    assert.deepEqual(calls.shift(), { lodChanges: [[lods[0], false]] });
    assert.equal(lods[0].visible, false);
    await groupSummary().children[2].emit("click", { stopPropagation() {} });
    get("scene-group-lod-radius").value = "0.3";
    await get("scene-group-lod-form").emit("submit");
    assert.equal(lods[0].viewRadius, Math.fround(0.3));
    assert.equal(get("lod-radius").value, "0.5");
    assert.equal(lods[0].visible, false);
    await get("lod-apply").emit("click");
    assert.deepEqual(calls.shift(), { lodChanges: [[lods[0], true]] });
    assert.equal(lods[0].visible, true);
    assert.equal(get("export-obj").disabled, false);
    assert.equal(get("export-mtl").disabled, false);
    assert.deepEqual(
      get("material-model").children.map((option) => option.textContent),
      ["1: same.o3d", "2: same.o3d"],
    );
    pickHit = null;
    const pointer = { pointerId: 1, button: 0, clientX: 40, clientY: 50 };
    await get("viewport").emit("pointerdown", pointer);
    await get("viewport").emit("pointerup", pointer);
    assert.equal(get("material-model").value, "1");
    await get("viewport").emit("pointerdown", pointer);
    await get("viewport").emit("pointerup", pointer);
    assert.equal(get("material-model").value, "0");
    assert.deepEqual(picks, [null, null, 1]);
    await get("viewport").emit("pointerdown", pointer);
    await get("viewport").emit("pointermove", { ...pointer, clientX: 41 });
    await get("viewport").emit("pointerup", { ...pointer, clientX: 41 });
    assert.equal(picks.length, 3);
    get("material-model").value = "1";
    await get("material-model").emit("change");
    get("model-name").value = "Renamed";
    await get("model-name-form").emit("submit");
    assert.equal(models[1].name, "Renamed");
    assert.equal(get("model-source").textContent, "Source: same.o3d");
    assert.equal(get("material-model").children[1].textContent, "2: Renamed");
    get("model-translation").value = "1 2 3";
    await get("model-translation-form").emit("submit");
    assert.deepEqual(models[1].worldTranslation, [1, 2, 3]);
    assert.match(get("status").textContent, /Model translated/);
    const translationError = console.error;
    try {
      console.error = () => {};
      get("model-translation").value = "1 nope 3";
      await get("model-translation-form").emit("submit");
      assert.deepEqual(models[1].worldTranslation, [1, 2, 3]);
      assert.match(
        get("status").textContent,
        /Translation requires 3 finite numbers/,
      );
    } finally {
      console.error = translationError;
    }
    assert.match(
      get("scene-list").children[1].children[0].children[1].children[1]
        .children[0].children[1].children[0].children[0].children[1]
        .textContent,
      /Renamed/,
    );
    await get("focus-model").emit("click");
    assert.deepEqual(calls.shift(), { focus: 1 });
    let prevented = false;
    listeners.get("keydown")({
      key: "f",
      target: document.body,
      preventDefault() {
        prevented = true;
      },
    });
    assert.ok(prevented);
    assert.deepEqual(calls.shift(), { focus: 1 });
    listeners.get("keydown")({
      key: "f",
      target: get("material-diffuse"),
      preventDefault() {
        assert.fail();
      },
    });
    assert.equal(calls.length, 0);
    get("fullbright").checked = true;
    await get("fullbright").emit("change");
    assert.deepEqual(calls.shift(), { fullbright: true });
    get("material-diffuse").value = ".2 .3 .4 .5";
    await get("material-form").emit("submit");
    await get("export-obj").emit("click");
    assert.equal(calls[0].model, models[1]);
    assert.deepEqual(calls[0].diffuse, [0.2, 0.3, 0.4, 0.5]);
    assert.match(get("status").textContent, /Download started: same\.obj/);
    get("export-o3d-format").value = "v7";
    await get("export-o3d").emit("click");
    assert.deepEqual(calls[1], { model: models[1], format: "v7" });
    const oldError = console.error;
    try {
      console.error = () => {};
      await get("export-mtl").emit("click");
    } finally {
      console.error = oldError;
    }
    assert.match(
      get("status").textContent,
      /Unable to export model: downloads blocked/,
    );
    assert.equal(get("export-scene-obj").disabled, false);
    await get("export-scene-obj").emit("click");
    assert.deepEqual(calls.at(-1).model.sceneModels, models);
    assert.match(get("status").textContent, /Download started/);
    await get("export-group-obj").emit("click");
    assert.deepEqual(calls.at(-1).model.sceneModels, [models[1]]);
    assert.equal(calls.at(-1).model.name, "group.obj");
    while (lights.length < 16) await get("create-point-light").emit("click");
    const beyondLimit = get("light-list").children[15].children[0].children[0];
    assert.equal(beyondLimit.disabled, false);
    beyondLimit.checked = false;
    await beyondLimit.emit("change");
    assert.equal(lights[15].on, false);
    const hierarchyToggle =
      get("scene-list").children.at(-1).children[0].children[0];
    assert.equal(hierarchyToggle.disabled, false);
    hierarchyToggle.checked = true;
    await hierarchyToggle.emit("change");
    assert.equal(lights[15].on, true);
    get("light-select").value = "0";
    await get("delete-light").emit("click");
    assert.equal(lights[14].on, true);
    assert.equal(
      encodeInteriorLights(lightUpdates.at(-1)).colors[14 * 4 + 3],
      1,
    );
    sceneResult = {
      models: [],
      lights: [],
      lods: [],
      warnings: [],
      hierarchy: [
        {
          type: "configuration",
          name: "empty.bus",
          children: [
            {
              type: "cabin-item",
              name: "Seat 0",
              children: [],
              info: {
                kind: "passpos",
                source: "cabin.cfg",
                line: 1,
                position: [1, 2, 3],
              },
            },
          ],
        },
      ],
    };
    await get("open").emit("click");
    assert.match(get("status").textContent, /previous scene remains visible/);
    assert.equal(get("scene-summary").textContent, "2 models loaded.");
    get("allow-empty-scene").checked = true;
    await get("open").emit("click");
    assert.equal(get("scene-summary").textContent, "0 models loaded.");
    assert.equal(get("export-obj").disabled, true);
    assert.equal(get("focus-model").disabled, true);
    assert.equal(get("create-light").disabled, false);
    await get(
      "scene-list",
    ).children[1].children[0].children[1].children[0].children[1].emit("click");
    assert.match(
      get("cabin-info").textContent,
      /OMSI position \(X Y Z\): 1 2 3/,
    );
    const makeCabinRecord = (name, line) => ({
      kind: "passpos",
      source: "cabin.cfg",
      line,
      name,
      position: [line, 0, 0],
      height: 1,
      rotation: 0,
      ...(line === 1 ? { illuminationInterior: [0, -1, -1, -1] } : {}),
    });
    const firstRecord = makeCabinRecord("Seat 0", 1);
    const secondRecord = makeCabinRecord("Seat 1", 2);
    const moneyRecord = {
      kind: "ticket_sale_money_point_2",
      source: "cabin.cfg",
      line: 4,
      name: "Ticket Money Point",
      position: [3, 0, 0],
      variation: [0.5, 0.75],
      parent: "ticket_parent",
      markerModelIndex: 0,
    };
    const nextReference = {
      kind: "linktonextveh",
      source: "cabin.cfg",
      line: 3,
      name: "Link To Next Veh",
      pathPoint: 0,
      position: [0, 0, 0],
      pathState: {
        paths: { points: [[0, 0, 0], [1, 0, 0]] },
        modelIndex: 1,
      },
    };
    const entryRecord = {
      kind: "entry",
      source: "cabin.cfg",
      line: 5,
      name: "Entry 0",
      pathPoint: 0,
      noTicketSale: true,
      withButton: false,
      position: [0, 0, 0],
      pathState: nextReference.pathState,
    };
    const firstPoint = {
      kind: "path point",
      source: "people.cfg",
      line: 1,
      index: 4,
      position: [0, 0, 0],
      pathState: { paths: { points: [[0, 0, 0], [1, 0, 0]] }, modelIndex: 1 },
    };
    const secondPoint = {
      ...firstPoint,
      line: 5,
      index: 8,
      position: [1, 0, 0],
    };
    const firstLinkValue = {
      a: 0,
      b: 1,
      oneWay: true,
      roomHeight: 1.5,
      stepSound: 0,
      line: 9,
    };
    const firstLink = {
      kind: "path link",
      source: "people.cfg",
      line: 9,
      index: 0,
      link: firstLinkValue,
      pathState: {
        paths: {
          points: [
            [0, 0, 0],
            [1, 0, 0],
          ],
          links: [firstLinkValue],
        },
        modelIndex: 1,
      },
    };
    const markerModel = {
      name: "Cabin markers",
      vertices: new Float32Array(8),
      triangles: new Uint32Array(4),
      materials: [material()],
      cabinMarkerItems: [firstRecord, secondRecord, moneyRecord],
    };
    const pathModel = {
      name: "Cabin Paths",
      vertices: new Float32Array(8),
      triangles: new Uint32Array(4),
      materials: [material()],
      cabinPathLinkItems: [firstLink],
      cabinPathPointItems: [firstPoint, secondPoint],
      cabinPathPointMarkerTriangleStart: 3,
    };
    firstRecord.markerModelIndex = 0;
    secondRecord.markerModelIndex = 0;
    sceneResult = {
      models: [markerModel, pathModel],
      lights: [
        {
          variable: "cabin-light",
          source: "vehicle.bus",
          line: 1,
          position: [2, 0, 0],
          color: [1, 1, 1],
          range: 5,
          on: true,
        },
        {
          variable: "cabin-light-2",
          source: "vehicle.bus",
          line: 2,
          position: [3, 0, 0],
          color: [1, 1, 1],
          range: 5,
          on: true,
        },
      ],
      lods: [],
      warnings: [],
      hierarchy: [
        {
          type: "configuration",
          name: "vehicle.bus",
          children: [
            {
              type: "cabin-points",
              name: "Cabin path points",
              children: [
                {
                  type: "cabin-item",
                  name: "Path point 4",
                  info: firstPoint,
                  children: [],
                },
                {
                  type: "cabin-item",
                  name: "Path point 8",
                  info: secondPoint,
                  children: [],
                },
              ],
            },
            {
              type: "cabin-links",
              name: "Cabin path links",
              children: [
                {
                  type: "cabin-item",
                  name: "Path link 0",
                  info: firstLink,
                  children: [],
                },
              ],
            },
            {
              type: "cabin",
              name: "Passenger Cabin",
              children: [
                {
                  type: "cabin-item",
                  name: "Seat 0",
                  info: firstRecord,
                  children: [],
                },
                {
                  type: "cabin-item",
                  name: "Seat 1",
                  info: secondRecord,
                  children: [],
                },
                {
                  type: "cabin-item",
                  name: "Link To Next Veh",
                  info: nextReference,
                  children: [],
                },
                {
                  type: "cabin-item",
                  name: "Ticket Money Point",
                  info: moneyRecord,
                  children: [],
                },
                {
                  type: "cabin-item",
                  name: "Entry 0",
                  info: entryRecord,
                  children: [],
                },
                {
                  type: "model",
                  name: "Cabin markers",
                  modelIndex: 0,
                  children: [],
                },
              ],
            },
            {
              type: "cabin-path",
              name: "people.cfg",
              modelIndex: 1,
              children: [],
            },
          ],
        },
      ],
    };
    get("show-gizmos").checked = true;
    await get("open").emit("click");
    const cabinMarkerLayer = get("cabin-marker-layer");
    assert.equal(cabinMarkerLayer.hidden, false);
    assert.equal(cabinMarkerLayer.children.length, 5);
    assert.equal(cabinMarkerLayer.children[0].style.left, "130px");
    assert.equal(cabinMarkerLayer.children[0].style.top, "40px");
    assert.ok(
      Math.abs(
        parseFloat(cabinMarkerLayer.children[0].children[0].style.width) - 10,
      ) < 1e-8,
    );
    assert.equal(
      cabinMarkerLayer.children[0].children[0].src,
      new URL(
        "../O3DView/O3DView/Resources/gizmo_seat.png",
        new URL("../src/app.js", import.meta.url),
      ).href,
    );
    assert.equal(
      cabinMarkerLayer.children[2].children[0].src,
      new URL(
        "../O3DView/O3DView/Resources/gizmo_link_next.png",
        new URL("../src/app.js", import.meta.url),
      ).href,
    );
    assert.equal(
      cabinMarkerLayer.children[3].children[0].src,
      new URL(
        "../O3DView/O3DView/Resources/gizmo_ticket_money.png",
        new URL("../src/app.js", import.meta.url),
      ).href,
    );
    await cabinMarkerLayer.children[2].emit("click");
    assert.equal(get("cabin-reference-form").hidden, false);
    get("cabin-reference-point").value = "1";
    await get("cabin-reference-form").emit("submit");
    assert.equal(nextReference.pathPoint, 1);
    assert.deepEqual(nextReference.position, [1, 0, 0]);
    await cabinMarkerLayer.children[3].emit("click");
    assert.equal(get("cabin-metadata-form").hidden, false);
    assert.equal(get("cabin-variation").value, "0.5 0.75");
    assert.equal(get("cabin-parent").value, "ticket_parent");
    get("cabin-variation").value = "0.25 0.5";
    get("cabin-parent").value = "new_parent";
    await get("cabin-metadata-form").emit("submit");
    assert.deepEqual(moneyRecord.variation, [0.25, 0.5]);
    assert.equal(moneyRecord.parent, "new_parent");
    await cabinMarkerLayer.children[4].emit("click");
    assert.equal(get("cabin-entry-options-form").hidden, false);
    assert.equal(get("cabin-entry-no-ticket-sale").checked, true);
    assert.equal(get("cabin-entry-with-button").checked, false);
    get("cabin-entry-no-ticket-sale").checked = false;
    get("cabin-entry-with-button").checked = true;
    await get("cabin-entry-options-form").emit("submit");
    assert.equal(entryRecord.noTicketSale, false);
    assert.equal(entryRecord.withButton, true);
    await cabinMarkerLayer.children[0].emit("click");
    assert.equal(get("cabin-seat-lights-form").hidden, false);
    assert.equal(get("cabin-seat-light-references").value, "0 -1 -1 -1");
    assert.equal(
      get("light-reference-layer").children.filter(
        (child) => child.className === "light-reference-line",
      ).length,
      1,
    );
    get("cabin-seat-light-references").value = "1 -1 -1 -1";
    await get("cabin-seat-lights-form").emit("submit");
    assert.deepEqual(firstRecord.illuminationInterior, [1, -1, -1, -1]);
    assert.equal(
      get("light-reference-layer").children.find(
        (child) => child.className === "light-reference-line",
      ).dataset.lightIndex,
      "1",
    );
    get("cabin-seat-light-references").value = "";
    await get("cabin-seat-lights-form").emit("submit");
    assert.equal(Object.hasOwn(firstRecord, "illuminationInterior"), false);
    assert.equal(
      get("light-reference-layer").children.some(
        (child) => child.className === "light-reference-line",
      ),
      false,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(markerModel.cabinSeatPreview.item, firstRecord);
    assert.equal(cabinMarkerLayer.children[0].hidden, true);
    get("show-gizmos").checked = false;
    await get("show-gizmos").emit("change");
    assert.equal(cabinMarkerLayer.hidden, true);
    get("show-gizmos").checked = true;
    await get("show-gizmos").emit("change");
    assert.equal(cabinMarkerLayer.hidden, false);
    pickHit = { index: 0, triangleIndex: CABIN_MARKER_TRIANGLE_COUNT };
    const markerPointer = {
      pointerId: 2,
      button: 0,
      clientX: 40,
      clientY: 50,
    };
    await get("viewport").emit("pointerdown", markerPointer);
    await get("viewport").emit("pointerup", markerPointer);
    assert.match(get("cabin-info").textContent, /^Seat 1\n/);
    assert.equal(get("cabin-seat-form").hidden, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(markerModel.cabinSeatPreview.item, secondRecord);
    assert.ok(markerModel.cabinSeatPreviewTriangleStart !== null);
    pickHit = {
      index: 0,
      triangleIndex: markerModel.cabinSeatPreviewTriangleStart,
    };
    const previewPointer = {
      ...markerPointer,
      clientX: markerPointer.clientX + 1,
    };
    await get("viewport").emit("pointerdown", previewPointer);
    await get("viewport").emit("pointerup", previewPointer);
    assert.match(get("cabin-info").textContent, /^Seat 1\n/);
    assert.equal(markerModel.cabinSeatPreview.item, secondRecord);
    pickHit = {
      index: 1,
      triangleIndex: 3 + CABIN_MARKER_TRIANGLE_COUNT,
    };
    const pathPointer = { ...markerPointer, clientX: markerPointer.clientX + 2 };
    await get("viewport").emit("pointerdown", pathPointer);
    await get("viewport").emit("pointerup", pathPointer);
    assert.match(get("cabin-info").textContent, /^Path point 8\n/);
    assert.equal(get("cabin-point-form").hidden, false);
    assert.equal(markerModel.cabinSeatPreview, null);
    pickHit = {
      index: 1,
      triangleIndex: CABIN_PATH_LINK_TRIANGLE_COUNT - 1,
    };
    const linkPointer = { ...pathPointer, clientX: pathPointer.clientX + 1 };
    await get("viewport").emit("pointerdown", linkPointer);
    await get("viewport").emit("pointerup", linkPointer);
    assert.match(get("cabin-info").textContent, /^Path link 0\n/);
    assert.equal(get("focus-scene-group").disabled, false);
    assert.equal(get("focus-scene-group").textContent, "Focus cabin link");
    await get("focus-scene-group").emit("click");
    assert.deepEqual(focusedPositions.at(-1), [0.5, 0, 0]);
    sceneResult = { models, lights, lods, hierarchy, warnings: [] };
    await get("open").emit("click");
    get("material-model").value = "0";
    await get("material-model").emit("change");
    const originalDiffuse = models[0].materials[0].diffuse;
    failModelDuplicate = true;
    await get("duplicate-model").emit("click");
    assert.equal(models.length, 2);
    assert.match(get("status").textContent, /Unable to duplicate model: duplicate failed/);
    failModelDuplicate = false;
    await get("duplicate-model").emit("click");
    assert.equal(models.length, 3);
    assert.equal(models[2].name, `${models[0].name} copy`);
    assert.notEqual(models[2].materials[0], models[0].materials[0]);
    assert.notEqual(models[2].materials[0].diffuse, originalDiffuse);
    assert.equal(get("material-model").value, "2");
    assert.deepEqual(duplicateBindings, [[0, 2]]);
    assert.match(
      get("status").textContent,
      /Model duplicated for this scene/,
    );

    const root = hierarchy[0],
      modelNode = root.children.find((node) => node.modelIndex === 0),
      lodNode = root.children.find((node) => node.type === "lod");
    root.children.splice(root.children.indexOf(modelNode), 1);
    root.children.splice(root.children.indexOf(lodNode), 1);
    const batchGroup = {
      type: "group",
      name: "Model-only batch",
      children: [modelNode, lodNode],
    };
    root.children.unshift(batchGroup);
    models[1].lod = lods[0];
    await get("material-model").emit("change");
    const findElement = (element, predicate) => {
      if (predicate(element)) return element;
      for (const child of element.children) {
        const found = findElement(child, predicate);
        if (found) return found;
      }
      return null;
    };
    const groupSelect = findElement(
      get("scene-list"),
      (element) => element.ariaLabel === "Select group Model-only batch",
    );
    assert.ok(groupSelect);
    await groupSelect.emit("click");
    assert.equal(get("duplicate-group").disabled, false);
    await get("duplicate-group").emit("click");
    assert.equal(models.length, 5);
    assert.equal(models[3].name, `${models[0].name} copy`);
    assert.equal(models[4].name, `${models[1].name} copy`);
    const batchCopy = root.children.find(
      (node) => node.name === "Model-only batch copy",
    );
    assert.ok(batchCopy);
    assert.notEqual(batchCopy.children[1].lod, lods[0]);
    assert.equal(models[4].lod, batchCopy.children[1].lod);
    const sourceExport = findElement(
      get("scene-list"),
      (element) =>
        element.ariaLabel ===
        "Select Model-only batch for group export",
    );
    const copyExport = findElement(
      get("scene-list"),
      (element) =>
        element.ariaLabel ===
        "Select Model-only batch copy for group export",
    );
    assert.ok(sourceExport);
    assert.ok(copyExport);
    assert.notEqual(
      sourceExport.dataset.exportGroup,
      copyExport.dataset.exportGroup,
    );
    assert.deepEqual(duplicateBindings, [
      [0, 2],
      [0, 3],
      [1, 4],
    ]);
    assert.match(get("status").textContent, /Group duplicated with 2 models/);
    const mixedGroupSelect = findElement(
      get("scene-list"),
      (element) => element.ariaLabel === "Select group model.cfg",
    );
    assert.ok(mixedGroupSelect);
    await mixedGroupSelect.emit("click");
    assert.equal(get("duplicate-group").disabled, true);
    assert.equal(get("delete-scene-node").disabled, true);
    const batchGroupSelect = findElement(
      get("scene-list"),
      (element) => element.ariaLabel === "Select group Model-only batch",
    );
    assert.ok(batchGroupSelect);
    await batchGroupSelect.emit("click");
    assert.equal(get("delete-scene-node").disabled, false);
    const focusGroupButton = get("focus-scene-group");
    const previousGroupFocusCount = calls.filter(
      (call) => "focusGroup" in call,
    ).length;
    focusGroupButton.click = () => focusGroupButton.emit("click");
    let hierarchyFocusPrevented = false;
    listeners.get("keydown")({
      target: document.body,
      key: "f",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault() {
        hierarchyFocusPrevented = true;
      },
    });
    assert.equal(hierarchyFocusPrevented, true);
    assert.deepEqual(
      calls.filter((call) => "focusGroup" in call).slice(
        previousGroupFocusCount,
      ),
      [{ focusGroup: [models[0], models[1]] }],
    );
    delete focusGroupButton.click;
    failSceneDelete = true;
    await get("delete-scene-node").emit("click");
    assert.equal(models.length, 5);
    assert.ok(root.children.includes(batchGroup));
    assert.match(
      get("status").textContent,
      /Unable to delete scene item: model deletion failed/,
    );
    failSceneDelete = false;
    await get("delete-scene-node").emit("click");
    assert.equal(models.length, 3);
    assert.equal(root.children.includes(batchGroup), false);
    assert.equal(models[0].name, `${models[0].sourceName} copy`);
    assert.equal(models[2].lod, batchCopy.children[1].lod);
    assert.equal(get("material-model").value, "1");
    assert.deepEqual(removalCalls, [[0, 1]]);
    assert.match(get("status").textContent, /Group removed with 2 models/);
    const rootSelect = findElement(
      get("scene-list"),
      (element) => element.ariaLabel === "Select group model.cfg",
    );
    assert.ok(rootSelect);
    await rootSelect.emit("click");
    assert.equal(get("delete-scene-node").disabled, true);
    const sunSelect = findElement(
      get("scene-list"),
      (element) =>
        element.ariaLabel === "Select Desktop-style sun (opt-in)",
    );
    assert.ok(sunSelect);
    await sunSelect.emit("click");
    const focusCallsBeforeSunSelection = calls.length;
    let sunFocusPrevented = false;
    listeners.get("keydown")({
      target: document.body,
      key: "f",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault() {
        sunFocusPrevented = true;
      },
    });
    assert.equal(sunFocusPrevented, false);
    assert.equal(calls.length, focusCallsBeforeSunSelection);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
    delete globalThis.__appTestDeps;
  }
});
