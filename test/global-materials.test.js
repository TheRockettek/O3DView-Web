import test from "node:test";
import assert from "node:assert/strict";
import { updateNightStrength } from "../src/global-materials.js";

test("global night strength updates every material without changing other values", () => {
    const materials = [{ nightmapStrength: 0.2 }, { nightmapStrength: 1, alphaScale: 0.5 }];
    const calls = [];
    updateNightStrength({ updateMaterial: (...args) => calls.push(args) }, [{ materials }], 1.5);
    assert.deepEqual(materials, [{ nightmapStrength: 1.5 }, { nightmapStrength: 1.5, alphaScale: 0.5 }]);
    assert.deepEqual(calls.map(call => call.slice(0, 2)), [[0, 0], [0, 1]]);
});

test("invalid input and failed GPU updates preserve original materials", () => {
    const materials = [{}, { nightmapStrength: 0.5 }];
    const calls = [];
    const renderer = { updateMaterial: (model, index, value) => {
        calls.push([index, value.nightmapStrength]);
        if (index === 1 && value.nightmapStrength === 1) throw new Error("upload failed");
    } };
    for (const value of [-1, 3, NaN, Infinity]) assert.throws(() => updateNightStrength(renderer, [{ materials }], value), /between/);
    assert.throws(() => updateNightStrength(renderer, [{ materials }], 1), /upload failed/);
    assert.deepEqual(calls, [[0, 1], [1, 1], [1, 0.5], [0, undefined]]);
    assert.deepEqual(materials, [{}, { nightmapStrength: 0.5 }]);
});

test("rollback failure is surfaced", () => {
    assert.throws(() => updateNightStrength({ updateMaterial() { throw new Error("lost"); } },
        [{ materials: [{}] }], 1), /rollback was incomplete/);
});
