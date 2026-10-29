import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("WebGPU environment and emissive maps are applied once after point lighting", async () => {
    const source = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
    const start = source.indexOf("for (var i = 0u; i < 16u; i++) {");
    assert.notEqual(start, -1);
    let depth = 0, end = -1;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) { end = i; break; }
    }
    assert.ok(end > start);
    const fragmentEnd = source.indexOf("return vec4<f32>(color", end);
    assert.ok(fragmentEnd > end);
    const effects = source.slice(end, fragmentEnd);
    assert.match(effects, /color = mix\(color, env,/);
    assert.match(effects, /color \+= material\.emission\.rgb/);
    assert.match(effects, /night \* material\.options\.z/);
    assert.match(effects, /lightmap \* material\.options\.w/);
});

test("fullbright bypasses lighting but retains environment and emissive effects in both shaders", async () => {
    const gpu = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
    const gl = await readFile(new URL("../src/webgl-renderer.js", import.meta.url), "utf8");
    for (const [source, condition, env] of [
        [gpu, "if (camera.eye.w < 0.5)", "let envUv"],
        [gl, "if (!fullbright)", "if (useEnvmap"],
    ]) {
        const start = source.indexOf(condition);
        const loop = source.indexOf("for (", start);
        const end = source.indexOf(env, loop);
        assert.ok(start >= 0 && loop > start && end > loop);
        assert.match(source.slice(start, end), /pointColor/);
        assert.match(source.slice(end), /color \+=/);
    }
});

test("both shaders apply selection highlighting after lighting without changing alpha", async () => {
    const gpu = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
    const gl = await readFile(new URL("../src/webgl-renderer.js", import.meta.url), "utf8");
    assert.match(gpu, /color \+= vec3<f32>\(0\.8, 0\.8, 0\.3\) \* camera\.selection\.x \* object\.selection\.x/);
    assert.match(gl, /if \(selected\) color \+= vec3\(0\.8, 0\.8, 0\.3\) \* selectionPulse/);
});

test("both shaders distinguish point, directional, ambient and non-rendering spot modes", async () => {
    for (const path of ["../src/renderer.js", "../src/webgl-renderer.js"]) {
        const source = await readFile(new URL(path, import.meta.url), "utf8");
        assert.match(source, /pointColor\.w > 2\.5 && pointColor\.w < 3\.5/);
        assert.match(source, /color \+= albedo\.rgb \* ambient/);
        assert.match(source, /pointColor\.w > 1\.5 && pointColor\.w < 2\.5/);
        assert.match(source, /pointColor\.w > 0\.5 && pointColor\.w < 1\.5/);
    }
});
