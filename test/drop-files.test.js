import test from "node:test";
import assert from "node:assert/strict";
import { captureDrop, readDroppedFiles } from "../src/drop-files.js";
import { loadScene } from "../src/scene.js";

function file(name, text) {
  return { name, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
}

function fileEntry(name, text) {
  return { name, isFile: true, file: resolve => resolve(file(name, text)) };
}

function directory(name, batches) {
  return {
    name, isDirectory: true,
    createReader: () => {
      let index = 0;
      return { readEntries: resolve => resolve(batches[index++] || []) };
    },
  };
}

test("captures files and entries synchronously, including a fallback without entry support", async () => {
  const plain = file("loose.obj", "content");
  const entry = fileEntry("model.obj", "model");
  const captured = captureDrop({ items: [
    { kind: "string" },
    { kind: "file", webkitGetAsEntry: () => entry },
    { kind: "file", webkitGetAsEntry: () => null, getAsFile: () => plain },
  ] });
  assert.deepEqual(captured, [{ entry }, { file: plain }]);
  const result = await readDroppedFiles(captured);
  assert.equal(result[0].webkitRelativePath, "model.obj");
  assert.equal(new TextDecoder().decode(await result[0].arrayBuffer()), "model");
  assert.equal(result[1], plain);
  assert.deepEqual(captureDrop({ files: [plain] }), [{ file: plain }]);
  assert.throws(() => captureDrop({ items: [{ kind: "file", getAsFile: () => null }] }), /could not be read/);
});

test("traverses all directory batches and keeps paths usable for scene references", async () => {
  const root = directory("Bus", [
    [fileEntry("bus.cfg", "[mesh]\nmodels\\body.obj\n")],
    [directory("models", [[fileEntry("body.obj", "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")]])],
  ]);
  const files = await readDroppedFiles([{ entry: root }]);
  assert.deepEqual(files.map(item => item.webkitRelativePath), ["Bus/bus.cfg", "Bus/models/body.obj"]);
  const result = await loadScene(files, ["Bus/bus.cfg"]);
  assert.deepEqual(result.models.map(model => model.name), ["Bus/models/body.obj"]);
  assert.deepEqual(result.warnings, []);
});

test("surfaces read errors and rejects unsafe or unsupported directory entries", async () => {
  const problem = new Error("permission denied");
  await assert.rejects(readDroppedFiles([{ entry: { name: "broken", isFile: true, file: (_, reject) => reject(problem) } }]), /permission denied/);
  const brokenDirectory = { name: "folder", isDirectory: true,
    createReader: () => ({ readEntries: (_, reject) => reject(problem) }) };
  await assert.rejects(readDroppedFiles([{ entry: brokenDirectory }]), /permission denied/);
  await assert.rejects(readDroppedFiles([{ entry: fileEntry("../escape", "") }]), /invalid name/);
  await assert.rejects(readDroppedFiles([{ entry: { name: "unknown" } }]), /Unsupported dropped item/);
});
