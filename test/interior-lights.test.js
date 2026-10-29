import test from "node:test";
import assert from "node:assert/strict";
import { parseInteriorLights } from "../src/interior-lights.js";
import { loadScene } from "../src/scene.js";

test("parses enabled light records using desktop color and coordinate conventions", () => {
  const text = [
    "[interiorlight]",
    "lights_fahrerlicht",
    "0.5",
    "236",
    "225",
    "176",
    "0",
    "4.78",
    "1.75",
    "-<DISABLED>-",
    "[interiorlight]",
    "disabled",
    "1",
    "255",
    "255",
    "255",
    "0",
    "0",
    "0",
    "-<ENABLED>-",
    "[INTERIORLIGHT]",
    "second",
    "1.5",
    "0",
    "127",
    "255",
    "-1",
    "2",
    "3",
  ].join("\n");
  const result = parseInteriorLights(text);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.lights, [
    {
      variable: "lights_fahrerlicht",
      range: 0.5,
      color: [236 / 255, 225 / 255, 176 / 255],
      position: [0, 1.75, Math.fround(4.78)],
      on: true,
      line: 1,
    },
    {
      variable: "second",
      range: 1.5,
      color: [0, 127 / 255, 1],
      position: [-1, 3, 2],
      on: true,
      line: 21,
    },
  ]);
});

test("invalid and truncated records report errors without consuming following commands", () => {
  const result = parseInteriorLights([
    "[interiorlight]",
    "v",
    "1",
    "256",
    "0",
    "0",
    "0",
    "0",
    "0",
    "[interiorlight]",
    "v",
    "1e100",
    "1",
    "2",
    "3",
    "0",
    "0",
    "0",
    "[interiorlight]",
    "v",
    "[interiorlight]",
    "ok",
    "1",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
  ]);
  assert.equal(result.lights.length, 1);
  assert.equal(result.lights[0].variable, "ok");
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /invalid range, color, or position/);
  assert.match(result.warnings[2], /requires 8 parameters/);
});

test("scene follows nested configuration references and reports malformed lights", async () => {
  const makeFile = (name, contents) => ({
    name,
    arrayBuffer: async () => new TextEncoder().encode(contents).buffer,
  });
  const { lights, warnings } = await loadScene(
    [
      makeFile("bus.bus", "[model]\nmodel.cfg\n"),
      makeFile(
        "model.cfg",
        "[interiorlight]\nbright\n2\n255\n100\n0\n1\n2\n3\n[interiorlight]\nbroken\n",
      ),
    ],
    ["bus.bus"],
  );
  assert.deepEqual(
    lights.map((light) => [light.source, light.variable, light.position]),
    [["model.cfg", "bright", [1, 3, 2]]],
  );
  assert.match(
    warnings.join("\n"),
    /model.cfg: line 10: \[interiorlight\] requires 8/,
  );
  assert.doesNotMatch(
    warnings.join("\n"),
    /unsupported\/ignored tags:.*interiorlight/,
  );
});
