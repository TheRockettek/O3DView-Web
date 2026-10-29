import test from "node:test";
import assert from "node:assert/strict";
import { collectSceneVariables, updateSceneVariable } from "../src/scene-variables.js";

test("variables group matching names across materials and both bindings", () => {
    const first = { alphaScaleVar: "lights", lightmapVar: "lights" };
    const second = { lightmapVar: "lights" };
    const third = { alphaScaleVar: "Lights" };
    const variables = collectSceneVariables([{ materials: [first, second] }, { materials: [third] }]);
    assert.deepEqual(variables.map(v => [v.name, v.value, v.bindings.length]),
        [["lights", 1, 2], ["Lights", 1, 1]]);
    const calls = [];
    updateSceneVariable({ updateMaterial: (...args) => calls.push(args) }, variables[0], 0.25);
    assert.equal(calls.length, 2);
    assert.deepEqual([first.alphaScale, first.lightmapStrength, second.lightmapStrength], [0.25, 0.25, 0.25]);
    assert.equal(third.alphaScale, undefined);
    assert.equal(variables[0].value, 0.25);
    assert.deepEqual(calls.map(call => call.slice(0, 2)), [[0, 0], [0, 1]]);
});

test("invalid values and renderer failures do not commit variable values", () => {
    const materials = [{ alphaScaleVar: "x" }, { lightmapVar: "x" }];
    const [variable] = collectSceneVariables([{ materials }]);
    const calls = [];
    const renderer = {
        updateMaterial(model, index, material) {
            calls.push([model, index, material]);
            if (index === 1 && material.lightmapStrength === 0.5) throw new Error("upload failed");
        },
    };
    for (const value of [-1, 2]) {
        assert.throws(() => updateSceneVariable(renderer, variable, value), /between 0 and 1/);
    }
    for (const value of [NaN, Infinity]) assert.throws(() => updateSceneVariable(renderer, variable, value), /finite/);
    assert.equal(calls.length, 0);
    assert.throws(() => updateSceneVariable(renderer, variable, 0.5), /upload failed/);
    assert.deepEqual(calls.map(call => call[1]), [0, 1, 1, 0]);
    assert.deepEqual(materials, [{ alphaScaleVar: "x" }, { lightmapVar: "x" }]);
    assert.equal(variable.value, 1);
});

test("failed rollback is surfaced explicitly", () => {
    const [variable] = collectSceneVariables([{ materials: [{ alphaScaleVar: "x" }] }]);
    assert.throws(() => updateSceneVariable({
        updateMaterial() { throw new Error("device lost"); },
    }, variable, 0.5), /rollback was incomplete/);
    assert.equal(variable.value, 1);
});

test("visibility variables share names with material variables and respect manual and viewpoint filters", () => {
    const material = { alphaScaleVar: "switch" };
    const models = [
        { materials: [material], viewpoint: 1, visibles: [{ variable: "switch", value: 0 }] },
        { materials: [], viewpoint: 2, visibles: [{ variable: "switch", value: 0 }] },
        { materials: [], visibles: [{ variable: "switch", value: 0 }] },
    ];
    const [variable] = collectSceneVariables(models);
    const visibility = { models, manualVisibility: [true, true, false], configVisibility: [true, true, true], viewpoint: 1 };
    const calls = [];
    const renderer = {
        updateMaterial: (...args) => calls.push(["material", ...args]),
        setModelVisible: (...args) => calls.push(["visible", ...args]),
    };
    assert.equal(variable.value, 1);
    updateSceneVariable(renderer, variable, 1, visibility);
    assert.deepEqual(visibility.configVisibility, [false, false, false]);
    assert.deepEqual(calls.map(call => call.slice(0, 3)), [["material", 0, 0], ["visible", 0, false]]);
    calls.length = 0;
    updateSceneVariable(renderer, variable, 0, visibility);
    assert.deepEqual(visibility.configVisibility, [true, true, true]);
    assert.deepEqual(calls.map(call => call.slice(0, 3)), [["material", 0, 0], ["visible", 0, true]]);
    assert.equal(material.alphaScale, 0);
    assert.throws(() => updateSceneVariable(renderer, variable, 2, visibility), /between 0 and 1/);
});

test("visibility-only values are finite floats and repeated conditions use the last changed binding", () => {
    const models = [{ materials: [], visibles: [
        { variable: "a", value: Math.fround(0.1) }, { variable: "a", value: 2 },
        { variable: "b", value: -4 },
    ] }];
    const [a, b] = collectSceneVariables(models);
    assert.deepEqual([a.value, b.value], [0, 0]);
    const state = { models, manualVisibility: [true], configVisibility: [true], viewpoint: 0 };
    const calls = [];
    const renderer = { setModelVisible: (...args) => calls.push(args) };
    updateSceneVariable(renderer, a, 0.1, state);
    assert.deepEqual(state.configVisibility, [false]);
    updateSceneVariable(renderer, a, 2, state);
    assert.deepEqual(state.configVisibility, [true]);
    updateSceneVariable(renderer, b, -4, state);
    assert.deepEqual(state.configVisibility, [true]);
    updateSceneVariable(renderer, b, 0, state);
    assert.deepEqual(state.configVisibility, [false]);
    assert.deepEqual(calls, [[0, false], [0, true], [0, false]]);
    assert.throws(() => updateSceneVariable(renderer, a, Infinity, state), /finite/);
    assert.throws(() => updateSceneVariable(renderer, a, 1e100, state), /finite/);
});

test("visibility values compare with desktop 32-bit float precision", () => {
    const models = [{ materials: [], visibles: [{ variable: "fraction", value: Math.fround(0.1) }] }];
    const [variable] = collectSceneVariables(models);
    const state = { models, manualVisibility: [true], configVisibility: [true], viewpoint: 0 };
    const calls = [];
    const renderer = { setModelVisible: (...args) => calls.push(args) };
    updateSceneVariable(renderer, variable, 0, state);
    updateSceneVariable(renderer, variable, 0.1, state);
    assert.deepEqual(state.configVisibility, [true]);
    assert.deepEqual(calls, [[0, false], [0, true]]);
});

test("visibility variables do not reveal meshes hidden by an LOD", () => {
    const lod = { visible: false };
    const models = [{ materials: [], lod, visibles: [{ variable: "switch", value: 1 }] }];
    const [variable] = collectSceneVariables(models);
    const state = { models, manualVisibility: [true], configVisibility: [false], viewpoint: 0 };
    const calls = [];
    updateSceneVariable({ setModelVisible: (...args) => calls.push(args) }, variable, 1, state);
    assert.deepEqual(state.configVisibility, [true]);
    assert.deepEqual(calls, []);
});

test("failure changing visibility rolls back material and visibility updates", () => {
    const material = { alphaScaleVar: "switch" };
    const models = [
        { materials: [material], visibles: [{ variable: "switch", value: 1 }] },
        { materials: [], visibles: [{ variable: "switch", value: 1 }] },
    ];
    const [variable] = collectSceneVariables(models);
    const state = { models, manualVisibility: [true, true], configVisibility: [true, true], viewpoint: 0 };
    const calls = [];
    const renderer = {
        updateMaterial: (i, j, m) => calls.push(["material", i, j, m.alphaScale]),
        setModelVisible: (i, visible) => {
            calls.push(["visibility", i, visible]);
            if (i === 1 && !visible) throw new Error("visibility failed");
        },
    };
    assert.throws(() => updateSceneVariable(renderer, variable, 0, state), /visibility failed/);
    assert.deepEqual(calls, [
        ["material", 0, 0, 0], ["visibility", 0, false], ["visibility", 1, false],
        ["visibility", 1, true], ["visibility", 0, true], ["material", 0, 0, undefined],
    ]);
    assert.equal(material.alphaScale, undefined);
    assert.equal(variable.value, 1);
    assert.deepEqual(state.configVisibility, [true, true]);
});

test("optional light variables update all matching lights and shared material bindings", () => {
    const material = { alphaScaleVar: "lamp" };
    const models = [{ materials: [material] }];
    const lights = [
        { variable: "lamp", intensity: 1, position: [0, 0, 0], color: [1, 1, 1], range: 1, on: true },
        { variable: "lamp", position: [1, 0, 0], color: [1, 0, 0], range: 1, on: false },
        { variable: "other", intensity: 3, position: [2, 0, 0], color: [0, 1, 0], range: 1, on: true },
    ];
    assert.deepEqual(collectSceneVariables(models).map(v => v.name), ["lamp"]);
    const variables = collectSceneVariables(models, lights);
    assert.deepEqual(variables.map(v => v.name), ["lamp", "other"]);
    assert.equal(variables[1].value, 3);
    const calls = [];
    const renderer = { updateMaterial: (...args) => calls.push(["material", ...args]), setLights: value => calls.push(["lights", value]) };
    const state = { lights };
    updateSceneVariable(renderer, variables[0], 0.5, state);
    assert.deepEqual(lights.map(light => light.intensity), [0.5, 0.5, 3]);
    assert.equal(lights[1].on, false);
    assert.equal(material.alphaScale, 0.5);
    assert.deepEqual(calls.map(call => call[0]), ["material", "lights"]);
    assert.throws(() => updateSceneVariable(renderer, variables[0], 2, state), /between 0 and 1/);
    updateSceneVariable(renderer, variables[1], 2, state);
    assert.equal(lights[2].intensity, 2);
    assert.throws(() => updateSceneVariable(renderer, variables[1], 1), /Light state/);
});

test("a failed light update rolls back other bindings and leaves light state unchanged", () => {
    const material = { alphaScaleVar: "lamp" };
    const models = [{ materials: [material] }];
    const lights = [{ variable: "lamp", intensity: 1 }];
    const [variable] = collectSceneVariables(models, lights);
    const calls = [];
    const renderer = {
        updateMaterial(_model, _material, value) { calls.push(["material", value.alphaScale]); },
        setLights(value) {
            calls.push(["lights", value[0].intensity]);
            if (value[0].intensity === 0.25) throw new Error("light upload failed");
        },
    };
    assert.throws(() => updateSceneVariable(renderer, variable, 0.25, { lights }), /light upload failed/);
    assert.deepEqual(calls, [["material", 0.25], ["lights", 0.25], ["lights", 1], ["material", undefined]]);
    assert.equal(material.alphaScale, undefined);
    assert.equal(lights[0].intensity, 1);
    assert.equal(variable.value, 1);
});

test("recollecting variables after deletion binds remaining light indices", () => {
    const models = [{ materials: [] }];
    const lights = [{ variable: "first" }, { variable: "lamp" }, { variable: "lamp" }];
    lights.splice(0, 1);
    const [variable] = collectSceneVariables(models, lights);
    assert.deepEqual(variable.lightBindings, [0, 1]);
    updateSceneVariable({ setLights() {} }, variable, 2, { lights });
    assert.deepEqual(lights.map(light => light.intensity), [2, 2]);
});
