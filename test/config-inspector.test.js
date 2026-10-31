import test from "node:test";
import assert from "node:assert/strict";
import { decodeConfiguration, listCommands } from "../src/config-inspector.js";

const utf8 = (text) => new TextEncoder().encode(text);

test("decodes a user-selected File as UTF-8 and lists its commands", async () => {
  const file = new File(["\ufeff[mesh]\r\nmöbel.o3d\r[LOD]\n0.1"], "model.cfg");
  const text = decodeConfiguration(await file.arrayBuffer());
  assert.equal(text, "[mesh]\nmöbel.o3d\n[LOD]\n0.1");
  assert.deepEqual(listCommands(text), [
    { name: "mesh", line: 1 },
    { name: "LOD", line: 3 },
  ]);
});

test("decodes UTF-16 BOMs in both byte orders and tolerates malformed data", () => {
  const le = Uint8Array.of(0xff, 0xfe, 0x5b, 0, 0xe4, 0, 0x5d, 0);
  const be = Uint8Array.of(0xfe, 0xff, 0, 0x5b, 0, 0xe4, 0, 0x5d);
  for (const bytes of [le, be]) {
    assert.equal(decodeConfiguration(bytes.buffer), "[ä]");
    assert.deepEqual(listCommands(decodeConfiguration(bytes)), [
      { name: "ä", line: 1 },
    ]);
  }
  assert.equal(decodeConfiguration(Uint8Array.of(0xff, 0xfe, 0x41)), "\ufffd");
  assert.equal(
    decodeConfiguration(Uint8Array.of(0xfe, 0xff, 0xd8, 0)),
    "\ufffd",
  );
  assert.equal(
    decodeConfiguration(Uint8Array.of(0xff, 0xfe, 13, 0, 10, 0, 13, 0)),
    "\n\n",
  );
});

test("falls back to Windows-1252 for invalid UTF-8, including after a UTF-8 BOM", () => {
  const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x5b, 0x80, 0xe4, 0x5d);
  assert.equal(decodeConfiguration(bytes), "[€ä]");
  assert.deepEqual(listCommands(decodeConfiguration(bytes)), [
    { name: "€ä", line: 1 },
  ]);
  assert.equal(
    decodeConfiguration(Uint8Array.of(0x80, 0x82, 0x91, 0x92, 0x9f)),
    "€‚‘’Ÿ",
  );
  assert.equal(decodeConfiguration(Uint8Array.of(0xc3, 0x28)), "Ã(");
  assert.equal(decodeConfiguration(utf8("€ä")), "€ä");
  assert.equal(decodeConfiguration(utf8("\ufeff\ufefftext")), "\ufefftext");
  assert.equal(decodeConfiguration(new ArrayBuffer(0)), "");
});

test("decodes only the requested byte range of typed arrays and DataViews", () => {
  const bytes = utf8("x[mesh]y");
  assert.equal(decodeConfiguration(bytes.subarray(1, 7)), "[mesh]");
  assert.equal(decodeConfiguration(new DataView(bytes.buffer, 1, 6)), "[mesh]");
  assert.equal(decodeConfiguration(Buffer.from("[mesh]")), "[mesh]");
});

test("recognizes standalone commands, preserves occurrences, and counts mixed line endings", () => {
  const text = "\ufeff  [ Mesh ]  \r\nvalue\r[ümlaut]\n[Mesh]\n\n[last]";
  assert.deepEqual(listCommands(text), [
    { name: "Mesh", line: 1 },
    { name: "ümlaut", line: 3 },
    { name: "Mesh", line: 4 },
    { name: "last", line: 6 },
  ]);
  assert.deepEqual(listCommands(""), []);
});

test("ignores incomplete, empty, nested and non-standalone brackets", () => {
  const text = [
    "[]",
    "[   ]",
    "[unfinished",
    "unfinished]",
    "[nested[tag]]",
    "comment [mesh]",
    "[mesh] comment",
    "[mesh][LOD]",
    "; [mesh]",
    "[good name]",
    "[not\0valid]",
  ].join("\n");
  assert.deepEqual(listCommands(text), [
    { name: "good name", line: 10 },
    { name: "not\0valid", line: 11 },
  ]);
});

test("rejects incorrect argument types without reading files or coercing data", () => {
  for (const value of [null, undefined, 4, [1, 2]]) {
    assert.throws(() => decodeConfiguration(value), TypeError);
    assert.throws(() => listCommands(value), TypeError);
  }
  assert.throws(() => decodeConfiguration("text"), TypeError);
});
