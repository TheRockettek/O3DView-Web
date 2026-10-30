import test from "node:test";
import assert from "node:assert/strict";
import { loadScene, textureFormat } from "../src/scene.js";

function file(path, data) {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return {
    name: path.split("/").pop(),
    webkitRelativePath: path,
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  };
}

function mesh() {
  const bytes = new Uint8Array(3 + 3 + 32 + 3 + 8 + 1 + 64);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x1984, true);
  bytes[2] = 3;
  bytes[3] = 0x17;
  view.setUint16(4, 1, true);
  view.setFloat32(6, 12.5, true);
  bytes[38] = 0x49;
  view.setUint16(39, 1, true);
  view.setUint16(47, 2, true);
  bytes[49] = 0x79;
  view.setFloat32(50, 1, true);
  view.setFloat32(110, 1, true);
  return bytes;
}

test("textures are detected by signature, including images named .dds", () => {
  assert.equal(
    textureFormat(
      "fake.dds",
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
    ),
    "image/png",
  );
  assert.equal(
    textureFormat("fake.dds", Uint8Array.from([0x42, 0x4d]).buffer),
    "image/bmp",
  );
  assert.equal(
    textureFormat("fake.dds", Uint8Array.from([0xff, 0xd8, 0xff]).buffer),
    "image/jpeg",
  );
  assert.equal(
    textureFormat("real.dds", new TextEncoder().encode("DDS ").buffer),
    "dds",
  );
  assert.equal(textureFormat("image.tga", new Uint8Array(18).buffer), "tga");
  assert.throws(
    () => textureFormat("bad.dds", new Uint8Array([0]).buffer),
    /Unsupported or invalid texture/,
  );
});

test("direct O3D and RDY entries expose parsed geometry and transform", async () => {
  const files = [file("Models/First.O3D", mesh()), file("Second.rdy", mesh())];
  const { models, warnings } = await loadScene(files, [
    "Models/First.O3D",
    "Second.rdy",
  ]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    models.map((model) => model.name),
    ["Models/First.O3D", "Second.rdy"],
  );
  assert.equal(models[0].vertices[0], 12.5);
  assert.deepEqual(Array.from(models[0].triangles), [0, 0, 0, 2]);
  assert.deepEqual(models[0].materials, []);
  assert.equal(models[0].transform[0], 1);
  assert.equal(models[0].transform[15], 1);
});

test("SCO meshes use model subdirectory; vehicle model CFG and CFG meshes resolve relative to their files", async () => {
  const files = [
    file("Root/Thing.sco", "[mesh]\r\nheuballen.o3d\r\n"),
    file("Root/model/Heuballen.O3D", mesh()),
    file("Root/Bus/vehicle.bus", "[model]\nmodel\\nested\\main.cfg\n"),
    file("Root/Bus/model/nested/main.cfg", "[mesh]\n..\\Parts\\BODY.O3D\n"),
    file("Root/Bus/model/parts/body.o3d", mesh()),
  ];
  const { models, warnings } = await loadScene(files, [
    "Root/Thing.sco",
    "Root/Bus/vehicle.bus",
  ]);
  assert.deepEqual(
    models.map((model) => model.name),
    ["Root/model/Heuballen.O3D", "Root/Bus/model/parts/body.o3d"],
  );
  assert.deepEqual(warnings, []);
});

test("all LODs load with separate groups, ungrouped meshes and repeated instances", async () => {
  const config =
    "[mesh]\ncommon.o3d\n[LOD]\n0.1\n[mesh]\nhigh.o3d\n[mesh]\nhigh.o3d\n[LOD]\n0\n[mesh]\nlow.o3d\n[mesh]\nmissing-low.o3d\n";
  const { models, lods, warnings } = await loadScene(
    [
      file("model.cfg", config),
      file("common.o3d", mesh()),
      file("high.o3d", mesh()),
      file("low.o3d", mesh()),
    ],
    ["model.cfg"],
  );
  assert.deepEqual(
    models.map((model) => model.name),
    ["common.o3d", "high.o3d", "high.o3d", "low.o3d"],
  );
  assert.equal(models[0].lod, undefined);
  assert.equal(models[1].lod, lods[0]);
  assert.equal(models[2].lod, lods[0]);
  assert.equal(models[3].lod, lods[1]);
  assert.deepEqual(
    lods.map((lod) => [lod.viewRadius, lod.visible]),
    [
      [Math.fround(0.1), true],
      [0, true],
    ],
  );
  assert.match(warnings.join("\n"), /missing-low/);
});

test("scene hierarchy retains configuration, LOD, mesh and light occurrences in source order", async () => {
  const config =
    "[mesh]\ncommon.o3d\n[LOD]\n0.1\n[mesh]\nhigh.o3d\n[mesh]\nhigh.o3d\n[interiorlight]\nlamp\n3\n255\n128\n0\n0\n0\n0\n";
  const result = await loadScene(
    [
      file("model.cfg", config),
      file("common.o3d", mesh()),
      file("high.o3d", mesh()),
    ],
    ["model.cfg"],
  );
  assert.equal(result.hierarchy.length, 1);
  const root = result.hierarchy[0];
  assert.equal(root.type, "configuration");
  assert.deepEqual(
    root.children.map((node) => node.type),
    ["model", "lod", "lights"],
  );
  assert.equal(root.children[0].modelIndex, 0);
  assert.equal(root.children[1].lod, result.lods[0]);
  assert.deepEqual(
    root.children[1].children.map((node) => node.modelIndex),
    [1, 2],
  );
  assert.equal(root.children[2].children[0].lightIndex, 0);
  assert.equal(result.lights[0].variable, "lamp");
});

test("malformed LOD radius is reported without losing its meshes", async () => {
  const { models, lods, warnings } = await loadScene(
    [
      file("model.cfg", "[LOD]\nnot-a-number\n[mesh]\npart.o3d\n"),
      file("part.o3d", mesh()),
    ],
    ["model.cfg"],
  );
  assert.equal(models[0].lod, lods[0]);
  assert.equal(lods[0].viewRadius, null);
  assert.match(warnings.join("\n"), /invalid \[LOD\] view radius/);
});
test("viewpoint flags are retained per mesh occurrence and malformed tags warn", async () => {
  const config = [
    "[mesh]",
    "same.o3d",
    "[viewpoint]",
    "3",
    "[mesh]",
    "same.o3d",
    "[viewpoint]",
    "4",
    "[mesh]",
    "same.o3d",
    "[viewpoint]",
    "-1",
  ].join("\n");
  const { models, warnings } = await loadScene(
    [file("vehicle.cfg", config), file("same.o3d", mesh())],
    ["vehicle.cfg"],
  );
  assert.deepEqual(
    models.map((model) => model.viewpoint),
    [3, 4, undefined],
  );
  assert.match(warnings.join("\n"), /invalid flag value "-1"/);
  assert.doesNotMatch(
    warnings.join("\n"),
    /unsupported\/ignored tags:.*viewpoint/,
  );
});

test("visibility commands attach to selected mesh instances, not other LODs or instances", async () => {
  const config = [
    "[LOD]",
    "1",
    "[mesh]",
    "same.o3d",
    "[visible]",
    "switch",
    "2",
    "[mesh]",
    "same.o3d",
    "[visible]",
    "switch",
    "0",
    "[LOD]",
    "0",
    "[mesh]",
    "missing.o3d",
    "[visible]",
    "other",
    "1",
  ].join("\n");
  const { models, warnings } = await loadScene(
    [file("vehicle.cfg", config), file("same.o3d", mesh())],
    ["vehicle.cfg"],
  );
  assert.deepEqual(
    models.map((model) => model.visibles),
    [[{ variable: "switch", value: 2 }], [{ variable: "switch", value: 0 }]],
  );
  assert.doesNotMatch(
    warnings.join("\n"),
    /unsupported\/ignored tags:.*visible/,
  );
  assert.match(warnings.join("\n"), /missing\.o3d/);
});

test("missing references, unsupported tags, parse failures, and cycles produce warnings and do not stop other models", async () => {
  const files = [
    file("a.ovh", "[model]\nb.cfg\n[mesh]\nmissing.o3d\n[newanim]\n"),
    file("b.cfg", "[model]\na.ovh\n[mesh]\nbad.o3d\n[mesh]\ngood.o3d\n"),
    file("bad.o3d", new Uint8Array([0])),
    file("good.o3d", mesh()),
  ];
  const { models, warnings } = await loadScene(files, ["a.ovh", "absent.cfg"]);
  assert.deepEqual(
    models.map((model) => model.name),
    ["good.o3d"],
  );
  const text = warnings.join("\n");
  assert.match(text, /Cyclic reference/);
  assert.match(text, /missing\.o3d/);
  assert.match(text, /unsupported\/ignored tags: \[newanim\]/);
  assert.match(text, /Could not load bad\.o3d/);
  assert.match(text, /Missing entry file: absent\.cfg/);
});

test("entry selection is exact, paths cannot escape the file set, and ambiguous case is reported", async () => {
  const files = [
    file(
      "Dir/a.cfg",
      "[mesh]\n../../outside.o3d\n[mesh]\nC:\\secret.o3d\n[mesh]\nTHING.O3D\n",
    ),
    file("Dir/Thing.o3d", mesh()),
    file("Dir/thing.o3d", mesh()),
  ];
  const { models, warnings } = await loadScene(files, [
    "dir/a.cfg",
    "Dir/a.cfg",
  ]);
  assert.deepEqual(
    models.map((model) => model.name),
    ["Dir/Thing.o3d"],
  );
  const text = warnings.join("\n");
  assert.match(text, /Missing entry file: dir\/a.cfg/);
  assert.match(text, /Ambiguous case-insensitive path/);
  assert.match(text, /Invalid reference/);
  assert.match(text, /Unsupported absolute reference/);
});

test("Windows-1252 paths and malformed commands are handled", async () => {
  const config = Uint8Array.from([
    ...new TextEncoder().encode("[mesh]\n"),
    0xe4,
    ...new TextEncoder().encode(".o3d\n[mesh]\n[mesh]\nvalid.o3d\n"),
  ]);
  const { models, warnings } = await loadScene(
    [file("obj.cfg", config), file("ä.o3d", mesh()), file("valid.o3d", mesh())],
    ["obj.cfg"],
  );
  assert.deepEqual(
    models.map((model) => model.name),
    ["ä.o3d", "valid.o3d"],
  );
  assert.match(warnings.join("\n"), /missing path after \[mesh\]/);
});

test("unsupported skeletal data and unreadable files are reported", async () => {
  const bytes = Uint8Array.from([...mesh(), 0x54, 1, 0, 1, 65, 0, 0]);
  const broken = {
    name: "broken.o3d",
    webkitRelativePath: "broken.o3d",
    async arrayBuffer() {
      throw new Error("read failed");
    },
  };
  const { models, warnings } = await loadScene(
    [file("bones.o3d", bytes), broken],
    ["bones.o3d", "broken.o3d"],
  );
  assert.equal(models.length, 1);
  assert.match(warnings.join("\n"), /skeletal animation and bone weights/);
  assert.match(warnings.join("\n"), /broken\.o3d: read failed/);
});

function texturedMesh() {
  const material = new Uint8Array(3 + 44 + 1 + 8);
  material[0] = 0x26;
  material[1] = 1;
  material[47] = 8;
  material.set(new TextEncoder().encode("body.png"), 48);
  return Uint8Array.from([...mesh(), ...material]);
}

test("a missing texture is reported", async () => {
  const { models, warnings } = await loadScene(
    [file("textured.o3d", texturedMesh())],
    ["textured.o3d"],
  );
  assert.equal(models.length, 1);
  assert.match(warnings.join("\n"), /texture "body.png" not found/);
});

test("textures resolve case-insensitively with DDS preference and are decoded once", async () => {
  const seen = [];
  const bitmap = { width: 1, height: 1 };
  const files = [
    file("vehicle/model/textured.o3d", texturedMesh()),
    file("vehicle/texture/Body.DDS", new Uint8Array([1])),
    file("vehicle/texture/body.png", new Uint8Array([2])),
  ];
  const { models, warnings } = await loadScene(
    files,
    ["vehicle/model/textured.o3d", "vehicle/model/textured.o3d"],
    {
      decodeTexture: async (record) => {
        seen.push(record.path);
        return { bitmap, hasAlpha: false };
      },
    },
  );
  assert.deepEqual(seen, ["vehicle/texture/Body.DDS"]);
  assert.equal(models[0].materials[0].texture, bitmap);
  assert.equal(models[1].materials[0].texture, bitmap);
  assert.equal(models[0].materials[0].textureTransparent, false);
  assert.deepEqual(warnings, []);
});

test("texture decoding failures are reported without aborting the model", async () => {
  const { models, warnings } = await loadScene(
    [
      file("textured.o3d", texturedMesh()),
      file("body.png", new Uint8Array([1])),
    ],
    ["textured.o3d"],
    {
      decodeTexture: async () => {
        throw new Error("bad image");
      },
    },
  );
  assert.equal(models.length, 1);
  assert.match(
    warnings.join("\n"),
    /could not decode texture body\.png: bad image/,
  );
});

test("configuration color overrides attach to the individual mesh occurrence", async () => {
  const config = [
    "[mesh]",
    "textured.o3d",
    "[illumination_interior]",
    "0",
    "-1",
    "-1",
    "-1",
    "[matl]",
    "BODY.PNG",
    "0",
    "[allcolor]",
    "0.1",
    "0.2",
    "0.3",
    "0.4",
    "0.1",
    "0.2",
    "0.3",
    "0.4",
    "0.5",
    "0.6",
    "0.7",
    "0.8",
    "0.9",
    "8",
    "[matl_alpha]",
    "1",
    "[matl_noZcheck]",
    "[matl_noZwrite]",
    "[mesh]",
    "textured.o3d",
  ].join("\n");
  const bitmap = { width: 1, height: 1 };
  const { models, warnings } = await loadScene(
    [
      file("vehicle.cfg", config),
      file("textured.o3d", texturedMesh()),
      file("body.png", new Uint8Array([0])),
    ],
    ["vehicle.cfg"],
    { decodeTexture: async () => ({ bitmap, hasAlpha: false }) },
  );
  assert.equal(models.length, 2);
  assert.deepEqual(models[0].materials[0].diffuse, [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(models[0].materials[0].spec, [0.4, 0.5, 0.6]);
  assert.deepEqual(
    models[0].materials[0].emission.map((value) => Math.round(value * 10) / 10),
    [0.8, 1, 1.2],
  );
  assert.equal(models[0].materials[0].specPower, 8);
  assert.equal(models[0].materials[0].alphaMode, 1);
  assert.equal(models[0].materials[0].noZCheck, true);
  assert.equal(models[0].materials[0].noZWrite, true);
  assert.deepEqual(models[0].illuminationInterior, [0, -1, -1, -1]);
  assert.equal(models[1].illuminationInterior, undefined);
  assert.notDeepEqual(
    models[1].materials[0].diffuse,
    models[0].materials[0].diffuse,
  );
  assert.equal(models[1].materials[0].alphaMode, undefined);
  assert.deepEqual(warnings, []);
});

test("a matching CFG material defaults to opaque while an unmatched material retains automatic alpha", async () => {
  const config = "[mesh]\ntextured.o3d\n[matl]\nbody.png\n0\n";
  const result = await loadScene(
    [
      file("vehicle.cfg", config),
      file("textured.o3d", texturedMesh()),
      file("body.png", new Uint8Array([0])),
    ],
    ["vehicle.cfg"],
    { decodeTexture: async () => ({ bitmap: {}, hasAlpha: true }) },
  );
  assert.equal(result.models[0].materials[0].alphaMode, 0);
  assert.equal(result.models[0].materials[0].textureTransparent, true);
  assert.deepEqual(result.warnings, []);
});

test("CFG maps follow the config path, material occurrence, and shared texture cache", async () => {
  const data = texturedMesh();
  const start = mesh().length;
  data[start + 1] = 2;
  const twoMaterials = Uint8Array.from([...data, ...data.slice(start + 3)]);
  const config = [
    "[mesh]",
    "../model/textured.o3d",
    "[matl]",
    "BODY.PNG",
    "1",
    "[matl_transmap]",
    "shared.png",
    "[matl_nightmap]",
    "shared.png",
    "[matl_lightmap]",
    "glow.png",
    "[matl_bumpmap]",
    "glow.png",
    "-0.5",
    "[matl_envmap]",
    "shared.png",
    "0.25",
    "[mesh]",
    "../model/textured.o3d",
  ].join("\n");
  const seen = [];
  const bitmaps = new Map();
  const { models, warnings } = await loadScene(
    [
      file("vehicle/config/main.cfg", config),
      file("vehicle/model/textured.o3d", twoMaterials),
      file("vehicle/model/body.png", new Uint8Array([0])),
      file("vehicle/model/shared.dds", new Uint8Array([0])),
      file("vehicle/config/texture/Shared.DDS", new Uint8Array([0])),
      file("vehicle/config/texture/glow.png", new Uint8Array([0])),
    ],
    ["vehicle/config/main.cfg"],
    {
      decodeTexture: async (record) => {
        seen.push(record.path);
        const bitmap = { path: record.path };
        bitmaps.set(record.path, bitmap);
        return { bitmap, hasAlpha: false };
      },
    },
  );
  assert.equal(models.length, 2);
  assert.equal(models[0].materials[0].transmap, undefined);
  const material = models[0].materials[1];
  assert.equal(material.transmapName, "shared.png");
  assert.equal(
    material.transmap,
    bitmaps.get("vehicle/config/texture/Shared.DDS"),
  );
  assert.equal(material.nightmap, material.transmap);
  assert.equal(
    material.lightmap,
    bitmaps.get("vehicle/config/texture/glow.png"),
  );
  assert.equal(material.bumpmap, material.lightmap);
  assert.equal(material.bumpmapStrength, -0.5);
  assert.equal(material.envmap, material.transmap);
  assert.equal(material.envmapStrength, 0.25);
  assert.equal(material.bumpmapName, "glow.png");
  assert.equal(material.envmapName, "shared.png");
  assert.equal(models[1].materials[1].transmap, undefined);
  assert.equal(
    seen.filter((path) => path === "vehicle/config/texture/Shared.DDS").length,
    1,
  );
  assert.ok(!seen.includes("vehicle/model/shared.dds"));
  assert.deepEqual(warnings, []);
});

test("material variable names follow matching mesh and material occurrences", async () => {
  const data = texturedMesh();
  const start = mesh().length;
  data[start + 1] = 2;
  const twoMaterials = Uint8Array.from([...data, ...data.slice(start + 3)]);
  const config = [
    "[light_enh_2]",
    "0",
    "0",
    "0",
    "0",
    "0",
    "1",
    "0",
    "1",
    "0",
    "0",
    "0",
    "255",
    "255",
    "255",
    "1",
    "30",
    "60",
    "lamp_dim",
    "0.4",
    "[texttexture_enh]",
    "display_text",
    "Arial",
    "256",
    "64",
    "0",
    "1",
    "1",
    "1",
    "[texttexture_enh]",
    "display_text",
    "Arial",
    "256",
    "64",
    "0",
    "1",
    "1",
    "1",
    "[mesh]",
    "textured.o3d",
    "[matl]",
    "body.png",
    "1",
    "[alphascale]",
    "fade",
    "[matl_lightmap]",
    "light.png",
    "interior",
    "[matl_freetex]",
    "body.png",
    "paint",
    "[texcoordtransx]",
    "shift_x",
    "[texcoordtransy]",
    "shift_y",
    "[mesh]",
    "textured.o3d",
  ].join("\n");
  const result = await loadScene(
    [
      file("vehicle.cfg", config),
      file("textured.o3d", twoMaterials),
      file("body.png", new Uint8Array([0])),
      file("light.png", new Uint8Array([0])),
    ],
    ["vehicle.cfg"],
    { decodeTexture: async () => ({ bitmap: {}, hasAlpha: false }) },
  );
  const { models, warnings } = result;
  assert.equal(models[0].materials[0].alphaScaleVar, undefined);
  assert.equal(models[0].materials[1].alphaScaleVar, "fade");
  assert.equal(models[0].materials[1].lightmapVar, "interior");
  assert.equal(models[0].materials[1].lightmapStrength, 0);
  assert.deepEqual(models[0].materials[1].freeTextures, [
    { path: "body.png", varName: "paint", source: "vehicle.cfg" },
  ]);
  assert.equal(models[0].materials[1].texcoordTransXVar, "shift_x");
  assert.equal(models[0].materials[1].texcoordTransYVar, "shift_y");
  assert.equal(models[1].materials[1].alphaScaleVar, undefined);
  assert.deepEqual(result.stringVariables, [
    { name: "display_text", value: "" },
  ]);
  assert.deepEqual(result.floatVariables, [
    { name: "lamp_dim", value: Math.fround(0.4) },
  ]);
  assert.deepEqual(warnings, []);
});

test("missing and undecodable CFG maps are reported and light variables are retained", async () => {
  const config = [
    "[mesh]",
    "textured.o3d",
    "[matl]",
    "body.png",
    "0",
    "[matl_transmap]",
    "missing.png",
    "[matl_nightmap]",
    "bad.png",
    "[matl_lightmap]",
    "light.png",
    "interior_lights",
  ].join("\n");
  const { models, warnings } = await loadScene(
    [
      file("model.cfg", config),
      file("textured.o3d", texturedMesh()),
      file("body.png", new Uint8Array([0])),
      file("bad.png", new Uint8Array([0])),
      file("light.png", new Uint8Array([0])),
    ],
    ["model.cfg"],
    {
      decodeTexture: async (record) => {
        if (record.path === "bad.png") throw new Error("invalid image");
        return { bitmap: {}, hasAlpha: false };
      },
    },
  );
  assert.equal(models.length, 1);
  assert.equal(models[0].materials[0].lightmapName, "light.png");
  assert.match(warnings.join("\n"), /transmap "missing.png" not found/);
  assert.match(
    warnings.join("\n"),
    /could not decode nightmap bad.png: invalid image/,
  );
  assert.equal(models[0].materials[0].lightmapVar, "interior_lights");
  assert.doesNotMatch(
    warnings.join("\n"),
    /lightmap.*variable evaluation is unsupported/,
  );
  assert.doesNotMatch(
    warnings.join("\n"),
    /unsupported\/ignored tags:.*matl_(?:trans|night|light)map/,
  );
});

test("orphan alpha and depth material tags produce warnings instead of guessed overrides", async () => {
  const result = await loadScene(
    [
      file(
        "vehicle.cfg",
        "[mesh]\ntextured.o3d\n[matl_alpha]\n2\n[matl_noZwrite]\n",
      ),
      file("textured.o3d", texturedMesh()),
    ],
    ["vehicle.cfg"],
  );
  assert.equal(result.models[0].materials[0].alphaMode, undefined);
  assert.match(
    result.warnings.join("\n"),
    /\[matl_alpha\] has no active \[matl\]/,
  );
  assert.match(
    result.warnings.join("\n"),
    /\[matl_nozwrite\] has no active \[matl\]/,
  );
});

test("disabled config sections do not load meshes or apply their materials", async () => {
  const config =
    "-<DISABLED>-\n[mesh]\nmissing.o3d\n-<ENABLED>-\n[mesh]\nexists.o3d\n";
  const { models, warnings } = await loadScene(
    [file("model.cfg", config), file("exists.o3d", mesh())],
    ["model.cfg"],
  );
  assert.equal(models.length, 1);
  assert.doesNotMatch(warnings.join("\n"), /missing.o3d/);
});

test("OBJ loads its MTL and resolves material textures relative to the library", async () => {
  const bitmap = { width: 1, height: 1 };
  const seen = [];
  const { models, warnings } = await loadScene(
    [
      file(
        "root/model.obj",
        "mtllib mats/paint.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl paint\nf 1 2 3\n",
      ),
      file(
        "root/mats/paint.mtl",
        "newmtl paint\nKd 0.2 0.4 0.6\nmap_Kd detail/paint.png\n",
      ),
      file("root/mats/detail/paint.png", new Uint8Array([0])),
    ],
    ["root/model.obj"],
    {
      decodeTexture: async (record) => {
        seen.push(record.path);
        return { bitmap, hasAlpha: false };
      },
    },
  );
  assert.equal(models.length, 1);
  assert.deepEqual(models[0].materials[0].diffuse, [0.2, 0.4, 0.6, 1]);
  assert.equal(models[0].materials[0].texture, bitmap);
  assert.deepEqual(seen, ["root/mats/detail/paint.png"]);
  assert.deepEqual(warnings, []);
});

test("OBJ missing material library reports missing and unresolved material", async () => {
  const { models, warnings } = await loadScene(
    [
      file(
        "missing.obj",
        "mtllib absent.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl paint\nf 1 2 3\n",
      ),
    ],
    ["missing.obj"],
  );
  assert.equal(models.length, 1);
  assert.match(warnings.join("\n"), /Missing file "absent\.mtl"/);
  assert.match(warnings.join("\n"), /material 'paint' not provided/);
});

test("a missing transform is retained without changing scene geometry", async () => {
  const { models, warnings } = await loadScene(
    [file("no-transform.o3d", new Uint8Array([0x84, 0x19, 3]))],
    ["no-transform.o3d"],
  );
  assert.deepEqual(Array.from(models[0].transform), Array(16).fill(0));
  assert.deepEqual(warnings, []);
});
