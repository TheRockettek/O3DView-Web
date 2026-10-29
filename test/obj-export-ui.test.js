import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeInteriorLights } from "../src/light-data.js";

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
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
  replaceChildren(...children) {
    this.children = children;
    this.value = children[0]?.value ?? "";
  }
  append(...children) {
    this.children.push(...children);
    if (
      this.children.length === children.length &&
      children[0]?.value !== undefined
    )
      this.value = children[0].value;
  }
  async emit(type, extra = {}) {
    return this.listeners[type]?.({
      target: this,
      preventDefault() {},
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
      materials: [material()],
    },
    {
      name: "same.o3d",
      vertices: new Float32Array(8),
      materials: [material()],
    },
  ];
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
        { type: "model", modelIndex: 0, children: [] },
        {
          type: "lod",
          name: "LOD 0.8",
          children: [{ type: "model", modelIndex: 1, children: [] }],
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
                pathState: {},
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
  const lightUpdates = [];
  const collectedLights = [];
  const picks = [];
  let sceneResult = { models, lights, lods, hierarchy, warnings: [] };
  let failCreate = false;
  let failDelete = false;
  let failRepaint = false;
  const repaintCalls = [];
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
    dispose() {},
  };
  const sunUpdates = [];
  const renderer = {
    setModels() {},
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
  globalThis.__appTestDeps = {
    createRenderer: async (canvas) => ({ renderer, canvas, backend: "test" }),
    loadScene: async () => sceneResult,
    decodeConfiguration() {},
    listCommands: () => [],
    collectSceneVariables: (_models, lights) => {
      collectedLights.push(lights);
      return [];
    },
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
    MAX_INTERIOR_LIGHTS: 15,
    updateNightStrength() {},
    createRepaintSession: () => repaint,
    enhanceDropdowns() {},
    syncDropdown() {},
    pickModel: (_renderer, _models, _x, _y, after) => {
      picks.push(after);
      return after === 1 ? 0 : 1;
    },
    translateSceneModel: (_renderer, models, index, translation) => {
      models[index].worldTranslation = translation;
    },
    updateCabinPathPoint: (_state, _index, position) => {
      hierarchy[0].children[3].children[1].info.position = position;
      return [];
    },
    updateCabinPathLink: (_state, _index, changes) => {
      Object.assign(hierarchy[0].children[3].children[2].info.link, changes);
      return [];
    },
    focusModels: (_renderer, models) => calls.push({ focusGroup: models }),
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
    const source = (
      await readFile(new URL("../src/app.js", import.meta.url), "utf8")
    ).replace(/^import .*;\n/gm, "");
    const prefix =
      "const { createRenderer, loadScene, decodeConfiguration, listCommands, collectSceneVariables, updateSceneVariable, changeViewpoint, changeLodVisibility, changeGizmoVisibility, isModelVisible, viewpointAllows, captureDrop, readDroppedFiles, downloadWavefront, downloadO3D, combineSceneModels, MAX_INTERIOR_LIGHTS, updateNightStrength, createRepaintSession, enhanceDropdowns, syncDropdown, pickModel, translateSceneModel, updateCabinPathPoint, updateCabinPathLink, focusModels } = globalThis.__appTestDeps;\n";
    await import(
      `data:text/javascript;base64,${Buffer.from(prefix + source).toString("base64")}`
    );
    assert.equal(get("export-obj").disabled, true);
    get("model-files").files = [{ name: "same.o3d" }];
    await get("model-files").emit("change");
    await get("open").emit("click");
    const cabinInspect =
      get("scene-list").children[0].children[0].children[1].children[3]
        .children[0].children[1].children[0].children[1];
    await cabinInspect.emit("click");
    assert.match(get("cabin-info").textContent, /cabin\.cfg:12/);
    assert.match(
      get("cabin-info").textContent,
      /OMSI position \(X Y Z\): 1 2 3/,
    );
    assert.equal(get("cabin-point-form").hidden, true);
    const pointInspect =
      get("scene-list").children[0].children[0].children[1].children[3]
        .children[0].children[1].children[1].children[1];
    await pointInspect.emit("click");
    assert.equal(get("cabin-point-form").hidden, false);
    get("cabin-point-position").value = "4 5 6";
    await get("cabin-point-form").emit("submit");
    assert.match(
      get("cabin-info").textContent,
      /OMSI position \(X Y Z\): 4 5 6/,
    );
    assert.match(get("status").textContent, /Cabin path point updated/);
    const linkInspect =
      get("scene-list").children[0].children[0].children[1].children[3]
        .children[0].children[1].children[2].children[1];
    await linkInspect.emit("click");
    assert.equal(get("cabin-point-form").hidden, true);
    assert.equal(get("cabin-link-form").hidden, false);
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
      get("scene-list").children[0].children[0].children[0].textContent,
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
      get("scene-list").children[0].children[0].children[1].children[1]
        .children[0].children[0].children[0];
    const groupSummary = () =>
      get("scene-list").children[0].children[0].children[1].children[1]
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
    get("scene-group-lod-radius").value = "0.3";
    await get("scene-group-lod-form").emit("submit");
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
    const pointer = { pointerId: 1, button: 0, clientX: 40, clientY: 50 };
    await get("viewport").emit("pointerdown", pointer);
    await get("viewport").emit("pointerup", pointer);
    assert.equal(get("material-model").value, "1");
    await get("viewport").emit("pointerdown", pointer);
    await get("viewport").emit("pointerup", pointer);
    assert.equal(get("material-model").value, "0");
    assert.deepEqual(picks, [null, 1]);
    await get("viewport").emit("pointerdown", pointer);
    await get("viewport").emit("pointermove", { ...pointer, clientX: 41 });
    await get("viewport").emit("pointerup", { ...pointer, clientX: 41 });
    assert.equal(picks.length, 2);
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
      get("scene-list").children[0].children[0].children[1].children[1]
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
    assert.equal(calls.at(-1).model.sceneModels, models);
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
    ).children[0].children[0].children[1].children[0].children[1].emit("click");
    assert.match(
      get("cabin-info").textContent,
      /OMSI position \(X Y Z\): 1 2 3/,
    );
  } finally {
    delete globalThis.document;
    delete globalThis.__appTestDeps;
  }
});
