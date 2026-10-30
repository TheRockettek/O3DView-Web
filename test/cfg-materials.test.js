import test from "node:test";
import assert from "node:assert/strict";
import { parseCfgMaterials } from "../src/cfg-materials.js";

test("associates material commands with each mesh instance and occurrence", () => {
  const text = [
    "[mesh]",
    "body.o3d",
    "[matl]",
    "Body.BMP",
    "0",
    "[matl_alpha]",
    "2",
    "[matl_noZcheck]",
    "[matl_noZwrite]",
    "[matl]",
    "body.bmp",
    "1",
    "[matl_alpha]",
    "1",
    "[mesh]",
    "body.o3d",
    "[matl]",
    "Body.BMP",
    "0",
    "[matl_alpha]",
    "0",
  ].join("\r\n");
  const result = parseCfgMaterials(text);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.meshes, [
    {
      path: "body.o3d",
      line: 1,
      materials: [
        {
          textureName: "Body.BMP",
          index: 0,
          line: 3,
          alphaMode: 2,
          noZCheck: true,
          noZWrite: true,
        },
        { textureName: "body.bmp", index: 1, line: 10, alphaMode: 1 },
      ],
    },
    {
      path: "body.o3d",
      line: 15,
      materials: [
        { textureName: "Body.BMP", index: 0, line: 17, alphaMode: 0 },
      ],
    },
  ]);
});

test("parses interior-light references per mesh and reports invalid indices", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "body.o3d",
    "[illumination_interior]",
    "0",
    "2",
    "-1",
    "3",
    "[mesh]",
    "window.o3d",
    "[illumination_interior]",
    "0",
    "1.5",
    "-1",
    "0",
    "[mesh]",
    "door.o3d",
  ]);
  assert.deepEqual(meshes[0].illuminationInterior, [0, 2, -1, 3]);
  assert.equal(meshes[1].illuminationInterior, undefined);
  assert.equal(meshes[2].illuminationInterior, undefined);
  assert.match(warnings.join("\n"), /invalid light indices/);
});

test("viewpoint flags attach to their mesh occurrence and later valid tags replace earlier ones", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[viewpoint]",
    "1",
    "[mesh]",
    "a.o3d",
    "[viewpoint]",
    "3",
    "[viewpoint]",
    "4",
    "[viewpoint]",
    "8",
    "[viewpoint]",
    "[matl]",
    "body.png",
    "0",
    "[matl_alpha]",
    "2",
    "[mesh]",
    "a.o3d",
    "-<DISABLED>-",
    "[viewpoint]",
    "2",
    "-<ENABLED>-",
    "[viewpoint]",
    "0",
    "[model]",
    "other.cfg",
    "[viewpoint]",
    "1",
  ]);
  assert.equal(meshes[0].viewpoint, 4);
  assert.equal(meshes[0].materials[0].alphaMode, 2);
  assert.equal(meshes[1].viewpoint, 0);
  assert.match(warnings.join("\n"), /\[viewpoint\] has no preceding \[mesh\]/);
  assert.match(warnings.join("\n"), /invalid flag value "8"/);
  assert.match(warnings.join("\n"), /\[viewpoint\] requires 1 parameter/);
});

test("visibility commands retain variable names and finite float conditions per mesh", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[visible]",
    "orphan",
    "1",
    "[mesh]",
    "a.o3d",
    "[visible]",
    "switch",
    "-2",
    "[visible]",
    "fraction",
    "0.1",
    "[visible]",
    "bad",
    "1e100",
    "[visible]",
    "bad",
    "[viewpoint]",
    "2",
    "-<DISABLED>-",
    "[visible]",
    "ignored",
    "1",
    "-<ENABLED>-",
    "[mesh]",
    "a.o3d",
    "[visible]",
    "switch",
    "3",
  ]);
  assert.deepEqual(meshes[0].visibles, [
    { variable: "switch", value: -2 },
    { variable: "fraction", value: Math.fround(0.1) },
  ]);
  assert.deepEqual(meshes[1].visibles, [{ variable: "switch", value: 3 }]);
  assert.equal(meshes[0].viewpoint, 2);
  assert.match(warnings.join("\n"), /\[visible\] has no preceding \[mesh\]/);
  assert.match(warnings.join("\n"), /invalid finite float value "1e100"/);
  assert.match(warnings.join("\n"), /\[visible\] requires 2 parameters/);
});

test("parses both color spellings into ordered channels without clamping", () => {
  const values = [
    "1",
    ".5",
    "-0.25",
    "0.8",
    "0.1",
    "0.2",
    "0.3",
    "0.4",
    "0.5",
    "0.6",
    "0.7",
    "0.8",
    "0.9",
    "2e1",
  ];
  for (const tag of ["matl_allcolor", "allcolor"]) {
    const { meshes, warnings } = parseCfgMaterials([
      "[mesh]",
      "x.o3d",
      "[matl]",
      "x.bmp",
      "0",
      `[${tag}]`,
      ...values,
    ]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(meshes[0].materials[0].allcolor, {
      diffuse: [1, 0.5, -0.25, 0.8],
      ambient: [0.1, 0.2, 0.3],
      specular: [0.4, 0.5, 0.6],
      emission: [0.7, 0.8, 0.9],
      specPower: 20,
    });
  }
});

test("unsupported material children are reported but do not steal the material", () => {
  const { meshes, warnings } = parseCfgMaterials(
    "[mesh]\nx.o3d\n[matl]\nx.bmp\n0\n[matl_raindropmap]\nrain.bmp\nvar\n[matl_alpha]\n2\n" +
      "[matl_envmap_mask]\nenv.bmp\n[matl_noZwrite]\n",
  );
  assert.equal(meshes[0].materials[0].alphaMode, 2);
  assert.equal(meshes[0].materials[0].noZWrite, true);
  assert.match(
    warnings.join("\n"),
    /unsupported\/ignored tag \[matl_raindropmap\]/,
  );
  assert.match(
    warnings.join("\n"),
    /unsupported\/ignored tag \[matl_envmap_mask\]/,
  );
});

test("parses bump and environment map paths and finite strengths per material", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "bus.o3d",
    "[matl]",
    "body.bmp",
    "0",
    "[matl_bumpmap]",
    " bump.dds ",
    "-0.25",
    "[matl_envmap]",
    "env.bmp",
    "0.5",
    "[matl_bumpmap]",
    "invalid.dds",
    "1e100",
    "[matl_envmap]",
    "missing.bmp",
    "[matl_alpha]",
    "2",
  ]);
  assert.deepEqual(meshes[0].materials[0], {
    textureName: "body.bmp",
    index: 0,
    line: 3,
    bumpmap: "bump.dds",
    bumpmapStrength: -0.25,
    envmap: "env.bmp",
    envmapStrength: 0.5,
    alphaMode: 2,
  });
  assert.match(warnings.join("\n"), /finite 32-bit strength/);
  assert.match(warnings.join("\n"), /\[matl_envmap\] requires 2 parameters/);
});

test("records static map paths and the optional lightmap strength variable", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "bus.o3d",
    "[matl]",
    "body.bmp",
    "0",
    "[MATL_TransMap]",
    "  Maps\\Body_T.TGA  ",
    "[matl_nightmap]",
    "night/body_lm.dds",
    "[matl_lightmap]",
    " D92_Panel_LM.bmp ",
    " lights_stand ",
    "[matl_alpha]",
    "2",
    "[matl]",
    "other.bmp",
    "1",
    "[matl_lightmap]",
    "other.bmp",
    "[matl_noZwrite]",
  ]);
  assert.deepEqual(meshes[0].materials, [
    {
      textureName: "body.bmp",
      index: 0,
      line: 3,
      transmap: "Maps\\Body_T.TGA",
      nightmap: "night/body_lm.dds",
      lightmap: "D92_Panel_LM.bmp",
      lightmapVar: "lights_stand",
      lightmapStrength: 0,
      alphaMode: 2,
    },
    {
      textureName: "other.bmp",
      index: 1,
      line: 15,
      lightmap: "other.bmp",
      noZWrite: true,
    },
  ]);
  assert.deepEqual(warnings, []);
});

test("parses free-texture replacement variables per material", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "bus.o3d",
    "[matl]",
    "body.bmp",
    "0",
    "[matl_freetex]",
    "textures/body.bmp",
    "paint_texture",
    "[matl_freetex]",
    "window.bmp",
    "window_texture",
    "[matl]",
    "glass.bmp",
    "0",
    "[matl_freetex]",
    "glass.bmp",
  ]);
  assert.deepEqual(meshes[0].materials[0].freetexes, [
    { path: "textures/body.bmp", varName: "paint_texture" },
    { path: "window.bmp", varName: "window_texture" },
  ]);
  assert.deepEqual(meshes[0].materials[1].freetexes, undefined);
  assert.match(warnings.join("\n"), /\[matl_freetex\] requires 2 parameters/);
});

test("preserves desktop texcoord translation variable names", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "bus.o3d",
    "[matl]",
    "body.bmp",
    "0",
    "[texcoordtransx]",
    "scroll_x",
    "[texcoordtransy]",
    "scroll_y",
  ]);
  assert.deepEqual(warnings, []);
  assert.equal(meshes[0].materials[0].texcoordTransXVar, "scroll_x");
  assert.equal(meshes[0].materials[0].texcoordTransYVar, "scroll_y");
});

test("collects desktop texttexture_enh string variables with empty defaults", () => {
  const { stringVariables, warnings } = parseCfgMaterials([
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
    "bus.o3d",
  ]);
  assert.deepEqual(stringVariables, [{ name: "display_text", value: "" }]);
  assert.deepEqual(warnings, []);
});

test("collects desktop light brightness variables without rendering light commands", () => {
  const { floatVariables, warnings } = parseCfgMaterials([
    "[light]",
    "legacy_brightness",
    "[light_enh]",
    "0",
    "0",
    "0",
    "255",
    "255",
    "255",
    "1",
    "enhanced_brightness",
    "0.6",
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
    "extended_brightness",
    "0.75",
  ]);
  assert.deepEqual(floatVariables, [
    { name: "legacy_brightness", value: 0 },
    { name: "enhanced_brightness", value: Math.fround(0.6) },
    { name: "extended_brightness", value: 0.75 },
  ]);
  assert.deepEqual(warnings, []);
});

test("malformed map paths warn without erasing valid paths or consuming commands", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[matl_transmap]",
    "t.tga",
    "[matl_nightmap]",
    "n.dds",
    "[matl_lightmap]",
    "l.bmp",
    "strength",
    "[matl_transmap]",
    "[matl_nightmap]",
    " ",
    "[matl_lightmap]",
    "-<DISABLED>-",
    "[matl_alpha]",
    "2",
    "-<ENABLED>-",
    "[matl_noZcheck]",
  ]);
  assert.deepEqual(meshes[0].materials[0], {
    textureName: "x.bmp",
    index: 0,
    line: 3,
    transmap: "t.tga",
    nightmap: "n.dds",
    lightmap: "l.bmp",
    lightmapVar: "strength",
    lightmapStrength: 0,
    noZCheck: true,
  });
  assert.deepEqual(warnings, [
    "line 13: [matl_transmap] requires 1 parameter",
    "line 14: [matl_nightmap] requires 1 parameter",
    "line 16: [matl_lightmap] requires 1 parameter",
  ]);
});

test("later valid maps replace earlier values and lightmaps clear stale variables", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[matl_transmap]",
    "old.tga",
    "[matl_transmap]",
    "new.tga",
    "[matl_nightmap]",
    "old.dds",
    "[matl_nightmap]",
    "new.dds",
    "[matl_lightmap]",
    "old.bmp",
    "brightness",
    "[matl_lightmap]",
    "new.bmp",
    "",
    "[matl_noZwrite]",
  ]);
  assert.deepEqual(meshes[0].materials[0], {
    textureName: "x.bmp",
    index: 0,
    line: 3,
    transmap: "new.tga",
    nightmap: "new.dds",
    lightmap: "new.bmp",
    noZWrite: true,
  });
  assert.deepEqual(warnings, []);
});

test("maps in dynamic, missing, and disabled contexts never attach to static materials", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[matl_transmap]",
    "outside.tga",
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[matl_transmap]",
    "static.tga",
    "[matl_change]",
    "x.bmp",
    "1",
    "var",
    "[matl_item]",
    "[matl_nightmap]",
    "dynamic.dds",
    "[matl_lightmap]",
    "dynamic.bmp",
    "strength",
    "[matl]",
    "y.bmp",
    "0",
    "-<DISABLED>-",
    "[matl_lightmap]",
    "ignored.bmp",
    "ignored_var",
    "-<ENABLED>-",
    "[matl_nightmap]",
    "static.dds",
    "[matl_lightmap]",
    "static.bmp",
    "-<DISABLED>-",
    "[matl_noZwrite]",
    "-<ENABLED>-",
  ]);
  assert.deepEqual(
    meshes[0].materials.map(
      ({ transmap, nightmap, lightmap, lightmapVar }) => ({
        transmap,
        nightmap,
        lightmap,
        lightmapVar,
      }),
    ),
    [
      {
        transmap: "static.tga",
        nightmap: undefined,
        lightmap: undefined,
        lightmapVar: undefined,
      },
      {
        transmap: undefined,
        nightmap: "static.dds",
        lightmap: "static.bmp",
        lightmapVar: undefined,
      },
    ],
  );
  assert.match(warnings.join("\n"), /\[matl_transmap\] has no active \[matl\]/);
  assert.match(warnings.join("\n"), /\[matl_nightmap\] has no active \[matl\]/);
  assert.match(warnings.join("\n"), /\[matl_lightmap\] has no active \[matl\]/);
  assert.match(warnings.join("\n"), /unsupported\/ignored tag \[matl_change\]/);
  assert.match(warnings.join("\n"), /unsupported\/ignored tag \[matl_item\]/);
  assert.equal(
    warnings.filter((w) => w.includes("variable evaluation")).length,
    0,
  );
  assert.equal(meshes[0].materials[1].noZWrite, undefined);
});

test("records address commands independently and border bytes in BGRA order", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[MATL_TexAdress_Clamp]",
    "[matl_texadress_mirror]",
    "[matl_texadress_mirroronce]",
    "[matl_texadress_border]",
    "1",
    "2",
    "3",
    "255",
    "[matl_alpha]",
    "2",
  ]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(meshes[0].materials[0].texAddress, {
    clamp: true,
    mirror: true,
    mirrorOnce: true,
    border: [1, 2, 3, 255],
  });
  assert.equal(meshes[0].materials[0].alphaMode, 2);
});

test("keeps the alphascale variable name rather than interpreting a numeric value", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[alphascale]",
    " Dirt_Norm ",
    "[matl_alpha]",
    "2",
    "[matl]",
    "other.bmp",
    "0",
    "[alphascale]",
    "0.5",
  ]);
  assert.equal(meshes[0].materials[0].alphaScaleVar, "Dirt_Norm");
  assert.equal(meshes[0].materials[0].alphaMode, 2);
  assert.equal(meshes[0].materials[1].alphaScaleVar, "0.5");
  assert.deepEqual(warnings, []);
});

test("invalid address and alphascale parameters do not erase valid fields or consume tags", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[matl_texadress_border]",
    "10",
    "20",
    "30",
    "40",
    "[matl_texadress_border]",
    "0",
    "256",
    "0",
    "0",
    "[matl_texadress_border]",
    "0",
    "-1",
    "0",
    "0",
    "[matl_texadress_border]",
    "0",
    "1.5",
    "0",
    "0",
    "[matl_texadress_border]",
    "0",
    "1",
    "2",
    "[matl_texadress_clamp]",
    "[alphascale]",
    "[matl_alpha]",
    "1",
  ]);
  assert.deepEqual(meshes[0].materials[0].texAddress, {
    border: [10, 20, 30, 40],
    clamp: true,
  });
  assert.equal(meshes[0].materials[0].alphaScaleVar, undefined);
  assert.equal(meshes[0].materials[0].alphaMode, 1);
  assert.equal(
    warnings.filter((w) => w.includes("requires four BGRA byte values")).length,
    3,
  );
  assert.match(
    warnings.join("\n"),
    /\[matl_texadress_border\] requires 4 parameters/,
  );
  assert.match(warnings.join("\n"), /\[alphascale\] requires 1 parameter/);
});

test("new commands cannot attach to dynamic or absent materials", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[matl_texadress_clamp]",
    "[alphascale]",
    "outside",
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[matl_texadress_mirror]",
    "[matl_change]",
    "x.bmp",
    "0",
    "var",
    "[matl_item]",
    "[alphascale]",
    "dynamic",
    "[matl_texadress_border]",
    "1",
    "2",
    "3",
    "4",
    "[matl]",
    "y.bmp",
    "0",
    "[matl_texadress_clamp]",
    "-<DISABLED>-",
    "[matl_texadress_mirroronce]",
    "[alphascale]",
    "ignored",
    "-<ENABLED>-",
  ]);
  assert.deepEqual(
    meshes[0].materials.map((m) => m.texAddress),
    [{ mirror: true }, { clamp: true }],
  );
  assert.equal(meshes[0].materials[0].alphaScaleVar, undefined);
  assert.match(warnings.join("\n"), /unsupported\/ignored tag \[matl_change\]/);
  assert.match(warnings.join("\n"), /unsupported\/ignored tag \[matl_item\]/);
  assert.equal(
    warnings.filter((w) =>
      w.includes("unsupported/ignored dynamic tag [alphascale]"),
    ).length,
    2,
  );
  assert.match(
    warnings.join("\n"),
    /\[matl_texadress_border\] has no active \[matl\]/,
  );
});

test("malformed fields do not produce guessed overrides or swallow subsequent tags", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[mesh]",
    "[mesh]",
    "ok.o3d",
    "[matl]",
    "bad.bmp",
    "-1",
    "[matl_alpha]",
    "2",
    "[matl]",
    "bad.bmp",
    "NaN",
    "[matl]",
    "missing.bmp",
    "[matl]",
    "valid.bmp",
    "0",
    "[matl_alpha]",
    "3",
    "[matl_noZcheck]",
    "[matl_allcolor]",
    ...Array(13).fill("1"),
    "[matl_noZwrite]",
    "[matl_allcolor]",
    ...Array(13).fill("1"),
    "Infinity",
    "[matl_alpha]",
    "1.0",
  ]);
  assert.deepEqual(meshes, [
    {
      path: "ok.o3d",
      line: 2,
      materials: [
        {
          textureName: "valid.bmp",
          index: 0,
          line: 14,
          noZCheck: true,
          noZWrite: true,
        },
      ],
    },
  ]);
  const message = warnings.join("\n");
  assert.match(message, /line 1: \[mesh\] requires 1 parameter/);
  assert.match(message, /invalid occurrence index "-1"/);
  assert.match(message, /invalid occurrence index "NaN"/);
  assert.match(message, /\[matl\] requires 2 parameters/);
  assert.match(message, /invalid alpha mode "3"/);
  assert.match(message, /invalid alpha mode "1.0"/);
  assert.match(message, /\[matl_allcolor\] requires 14 parameters/);
  assert.match(message, /requires 14 finite numeric values/);
  assert.match(message, /\[matl_alpha\] has no active \[matl\]/);
});

test("LOD, model, invalid meshes and change commands prevent stale associations", () => {
  const { meshes, warnings } = parseCfgMaterials([
    "[matl]",
    "x.bmp",
    "0",
    "[mesh]",
    "x.o3d",
    "[matl]",
    "x.bmp",
    "0",
    "[matl_alpha]",
    "1",
    "[matl_change]",
    "x.bmp",
    "1",
    "var",
    "[matl_item]",
    "[matl_alpha]",
    "2",
    "[mesh_ident]",
    "some-name",
    "[matl_noZcheck]",
    "[LOD]",
    "0.1",
    "[matl]",
    "x.bmp",
    "0",
    "[mesh]",
    "[matl]",
    "x.bmp",
    "0",
    "[model]",
    "other.cfg",
    "[matl]",
    "x.bmp",
    "0",
    "[mesh]",
    "y.o3d",
    "[matl]",
    "y.bmp",
    "0",
    "[matl_noZwrite]",
  ]);
  assert.equal(meshes.length, 2);
  assert.equal(meshes[0].materials[0].alphaMode, 1);
  assert.equal(meshes[0].materials[0].noZCheck, undefined);
  assert.equal(meshes[1].materials[0].noZWrite, true);
  const message = warnings.join("\n");
  assert.match(message, /unsupported\/ignored tag \[matl_change\]/);
  assert.match(message, /unsupported\/ignored tag \[matl_item\]/);
  assert.match(message, /\[matl_alpha\] has no active \[matl\]/);
  assert.match(message, /\[matl_nozcheck\] has no active \[matl\]/);
  assert.equal(
    warnings.filter((w) => w.includes("no preceding [mesh]")).length,
    4,
  );
});

test("duplicate keys are retained in order and warned case-insensitively", () => {
  const { meshes, warnings } = parseCfgMaterials(
    "[mesh]\nx.o3d\n[matl]\nX.bmp\n0\n[matl_alpha]\n1\n" +
      "[matl]\nx.BMP\n0\n[matl_alpha]\n2\n",
  );
  assert.deepEqual(
    meshes[0].materials.map((m) => m.alphaMode),
    [1, 2],
  );
  assert.match(warnings.join("\n"), /duplicate \[matl\].*occurrence 0/);
});

test("disabled blocks are ignored, including malformed and mesh tags", () => {
  const { meshes, warnings } = parseCfgMaterials(
    "[mesh]\nx.o3d\n[matl]\nx.bmp\n0\n-<DISABLED>-\n[mesh]\nignored.o3d\n" +
      "[matl_alpha]\n3\n-<ENABLED>-\n[matl_alpha]\n1\n",
  );
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0].materials[0].alphaMode, 1);
  assert.deepEqual(warnings, []);
  assert.match(
    parseCfgMaterials("-<DISABLED>-\n[mesh]").warnings[0],
    /Unterminated/,
  );
});

test("rejects invalid API inputs and permits empty configs", () => {
  assert.throws(() => parseCfgMaterials(null), TypeError);
  assert.throws(() => parseCfgMaterials(["ok", 1]), TypeError);
  assert.deepEqual(parseCfgMaterials(""), {
    meshes: [],
    stringVariables: [],
    floatVariables: [],
    warnings: [],
  });
});
