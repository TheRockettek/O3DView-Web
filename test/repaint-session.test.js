import test from "node:test";
import assert from "node:assert/strict";
import { loadScene } from "../src/scene.js";
import { createRepaintSession } from "../src/repaint-session.js";
import { collectSceneVariables } from "../src/scene-variables.js";

const file = (path, text) => ({
  name: path.split("/").pop(),
  webkitRelativePath: path,
  async arrayBuffer() {
    return new TextEncoder().encode(text).buffer;
  },
});
const config = [
  "[CTC]",
  "Colorscheme",
  "Texture\\Repaints",
  "0",
  "[CTCTexture]",
  "Body",
  "body.png",
  "[CTCTexture]",
  "Normal",
  "bump.png",
  "[mesh]",
  "part.obj",
  "[visible]",
  "show",
  "1",
  "[matl]",
  "body.png",
  "0",
  "[matl_bumpmap]",
  "bump.png",
  "1",
].join("\n");
const obj =
  "mtllib part.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl body\nf 1 2 3\n";
const mtl = "newmtl body\nmap_Kd body.png\n";
const cti = [
  "[item]",
  "Blue",
  "Body",
  "blue.png",
  "[setvar]",
  "show",
  "1",
  "[item]",
  "Blue",
  "Normal",
  "bluebump.png",
  "[item]",
  "Red",
  "Body",
  "missing.png",
].join("\n");

async function fixture() {
  const bitmaps = [];
  const files = [
    file("Bus/model/model.cfg", config),
    file("Bus/model/part.obj", obj),
    file("Bus/model/part.mtl", mtl),
    file("Bus/texture/body.png", ""),
    file("Bus/texture/bump.png", ""),
    file("Bus/texture/Repaints/paint.cti", cti),
    file("Bus/texture/Repaints/blue.png", ""),
    file("Bus/texture/Repaints/bluebump.png", ""),
    file("Other/Repaints/unrelated.cti", "[item]\nUnrelated\nBody\nx.png"),
  ];
  const result = await loadScene(files, ["Bus/model/model.cfg"], {
    decodeTexture: async (record) => {
      const bitmap = {
        path: record.path,
        closed: 0,
        close() {
          this.closed++;
        },
      };
      bitmaps.push(bitmap);
      return { bitmap, hasAlpha: record.path.endsWith("blue.png") };
    },
  });
  const session = createRepaintSession(
    result.models,
    result.repaintGroups,
    result.repaintTextures,
  );
  const variables = collectSceneVariables(result.models);
  const visibility = {
    models: result.models,
    manualVisibility: [true],
    configVisibility: [true],
    viewpoint: 0,
  };
  const calls = [];
  const renderer = {
    updateMaterial(index, material, value) {
      calls.push(["material", index, material, { ...value }]);
    },
    setModelVisible(index, value) {
      calls.push(["visible", index, value]);
    },
  };
  return { result, session, variables, visibility, renderer, calls, bitmaps };
}

test("CTC scopes CTIs and applies and restores diffuse and bump maps with setvars", async () => {
  const { result, session, variables, visibility, renderer, bitmaps } =
    await fixture();
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(session.schemes, ["Blue", "Red"]);
  assert.equal(
    result.repaintGroups[0].ctis[0].source,
    "Bus/texture/Repaints/paint.cti",
  );
  const material = result.models[0].materials[0];
  const original = material.texture,
    originalBump = material.bumpmap;
  assert.deepEqual(
    await session.apply(renderer, "Blue", variables, visibility),
    [],
  );
  assert.equal(material.texture.path, "Bus/texture/Repaints/blue.png");
  assert.equal(material.bumpmap.path, "Bus/texture/Repaints/bluebump.png");
  assert.equal(material.textureTransparent, true);
  assert.equal(material.repaintTextureName, "blue.png");
  assert.equal(variables[0].value, 1);
  assert.equal(visibility.configVisibility[0], true);
  await session.apply(renderer, null, variables, visibility);
  assert.equal(material.texture, original);
  assert.equal(material.bumpmap, originalBump);
  assert.equal(material.textureTransparent, false);
  assert.equal(material.repaintTextureName, "");
  assert.equal(variables[0].value, 1);
  session.dispose();
  session.dispose();
  assert.equal(original.closed, 0);
  assert.equal(originalBump.closed, 0);
  assert.deepEqual(
    bitmaps.slice(2).map((bitmap) => bitmap.closed),
    [1, 1],
  );
});

test("missing repaint texture leaves prior scene and variables unchanged", async () => {
  const { result, session, variables, visibility, renderer } = await fixture();
  await session.apply(renderer, "Blue", variables, visibility);
  const material = result.models[0].materials[0];
  const previous = material.texture;
  await assert.rejects(
    session.apply(renderer, "Red", variables, visibility),
    /missing\.png.*not found/,
  );
  assert.equal(material.texture, previous);
  assert.equal(variables[0].value, 1);
  session.dispose();
});

test("repaint renderer failure rolls textures and setvars back", async () => {
  const { result, session, variables, visibility, renderer } = await fixture();
  const material = result.models[0].materials[0],
    original = material.texture;
  let failed = false;
  renderer.setModelVisible = () => {
    if (!failed) {
      failed = true;
      throw new Error("visibility failure");
    }
  };
  visibility.configVisibility[0] = false;
  await assert.rejects(
    session.apply(renderer, "Blue", variables, visibility),
    /visibility failure/,
  );
  assert.equal(material.texture, original);
  assert.equal(material.repaintTextureName, undefined);
  assert.equal(variables[0].value, 0);
  assert.equal(visibility.configVisibility[0], false);
  session.dispose();
});

test("superseded asynchronous repaint does not modify the renderer", async () => {
  const { result, session, variables, visibility, renderer, calls } =
    await fixture();
  const original = result.models[0].materials[0].texture;
  await assert.rejects(
    session.apply(renderer, "Blue", variables, visibility, () => false),
    /superseded/,
  );
  assert.equal(result.models[0].materials[0].texture, original);
  assert.equal(calls.length, 0);
  session.dispose();
});

test("repaints work without a matching matl command and list all CTI schemes", async () => {
  const docs = "[item]\nName of item\nslot description\ntexture filename\n";
  const result = await loadScene(
    [
      file(
        "Bus/model/model.cfg",
        "[CTC]\ncolors\nTexture\n0\n[CTCTexture]\nBody\nbody.png\n[mesh]\npart.obj",
      ),
      file("Bus/model/part.obj", obj),
      file("Bus/model/part.mtl", mtl),
      file("Bus/texture/body.png", ""),
      file("Bus/texture/paint.cti", docs + "[item]\nBlue\nBody\nblue.png"),
      file("Bus/texture/blue.png", ""),
    ],
    ["Bus/model/model.cfg"],
    {
      decodeTexture: async (record) => ({
        bitmap: { path: record.path, close() {} },
        hasAlpha: false,
      }),
    },
  );
  const session = createRepaintSession(
    result.models,
    result.repaintGroups,
    result.repaintTextures,
  );
  assert.deepEqual(session.schemes, ["Name of item", "Blue"]);
  const visibility = {
    models: result.models,
    manualVisibility: [true],
    configVisibility: [true],
    viewpoint: 0,
  };
  await session.apply(
    { updateMaterial() {}, setModelVisible() {} },
    "Blue",
    [],
    visibility,
  );
  assert.equal(
    result.models[0].materials[0].texture.path,
    "Bus/texture/blue.png",
  );
  session.dispose();
});

test("imported CTIs apply globally in order and can be disabled or restored", async () => {
  const { result, session, variables, visibility, renderer } = await fixture();
  const extra = [
    file("Extra/paint.cti", "[item]\nBlue\nBody\ngreen.png\n[setvar]\nshow\n0"),
    file("Extra/green.png", ""),
  ];
  await session.importFiles(extra, () => true);
  assert.deepEqual(
    session.ctis.map((cti) => cti.active),
    [true, true],
  );
  await session.apply(renderer, "Blue", variables, visibility);
  assert.equal(result.models[0].materials[0].texture.path, "Extra/green.png");
  assert.equal(variables[0].value, 0);
  session.ctis[1].active = false;
  await session.apply(renderer, "Blue", variables, visibility);
  assert.equal(
    result.models[0].materials[0].texture.path,
    "Bus/texture/Repaints/blue.png",
  );
  assert.equal(variables[0].value, 1);
  await session.apply(renderer, null, variables, visibility);
  assert.equal(
    result.models[0].materials[0].texture.path,
    "Bus/texture/body.png",
  );
  await assert.rejects(
    session.importFiles(extra, () => true),
    /already exists/,
  );
  session.dispose();
});

test("failed or superseded imports do not register files or CTIs", async () => {
  const { session } = await fixture();
  const extra = [
    file("Extra/paint.cti", "[item]\nGreen\nBody\ngreen.png"),
    file("Extra/green.png", ""),
  ];
  await assert.rejects(
    session.importFiles(extra, () => false),
    /superseded/,
  );
  assert.equal(session.ctis.length, 1);
  await assert.rejects(
    session.importFiles([file("unsupported.txt", "")], () => true),
    /Select CTI files or supported textures/,
  );
  assert.equal(session.ctis.length, 1);
  await session.importFiles(extra, () => true);
  assert.deepEqual(session.schemes, ["Blue", "Red", "Green"]);
  session.dispose();
  await assert.rejects(
    session.importFiles([file("other.cti", "")], () => true),
    /closed/,
  );
});

test("missing imported textures can be added later without reimporting the CTI", async () => {
  const { result, session, variables, visibility, renderer } = await fixture();
  await session.importFiles(
    [file("Extra/paint.cti", "[item]\nGreen\nBody\ngreen.png")],
    () => true,
  );
  await assert.rejects(
    session.apply(renderer, "Green", variables, visibility),
    /green\.png.*not found/,
  );
  assert.equal(
    result.models[0].materials[0].texture.path,
    "Bus/texture/body.png",
  );
  const imported = await session.importFiles(
    [file("Extra/green.png", "")],
    () => true,
  );
  assert.deepEqual(imported.ctis, []);
  await session.apply(renderer, "Green", variables, visibility);
  assert.equal(result.models[0].materials[0].texture.path, "Extra/green.png");
  session.dispose();
});

test("all active CTIs participate in every configuration", async () => {
  const model = () => ({
    materials: [{ textureName: "body.png", texture: { id: "original" } }],
  });
  const models = [model(), model()];
  const groups = [
    {
      modelIndices: [0],
      ctc: { textures: [{ name: "Body", path: "body.png" }] },
      ctis: [
        {
          source: "first.cti",
          items: [{ name: "Blue", slot: "Body", path: "one.png", setvars: [] }],
        },
      ],
    },
    {
      modelIndices: [1],
      ctc: { textures: [{ name: "Body", path: "body.png" }] },
      ctis: [
        {
          source: "second.cti",
          items: [{ name: "Blue", slot: "Body", path: "two.png", setvars: [] }],
        },
      ],
    },
  ];
  const session = createRepaintSession(models, groups, {
    async load(source) {
      return { bitmap: { source }, hasAlpha: false };
    },
    dispose() {},
  });

  await session.apply({ updateMaterial() {} }, "Blue", [], {
    configVisibility: [],
  });
  assert.equal(models[0].materials[0].texture.source, "second.cti");
  assert.equal(models[1].materials[0].texture.source, "second.cti");
  session.ctis[1].active = false;
  await session.apply({ updateMaterial() {} }, "Blue", [], {
    configVisibility: [],
  });
  assert.equal(models[0].materials[0].texture.source, "first.cti");
  assert.equal(models[1].materials[0].texture.source, "first.cti");
});

test("duplicated models retain repaint mappings and original textures", async () => {
  const { result, session, variables, visibility, renderer } = await fixture();
  const source = result.models[0];
  const duplicate = {
    ...source,
    materials: source.materials.map((material) => ({ ...material })),
  };
  const duplicateIndex = result.models.length;
  const secondDuplicate = {
    ...source,
    materials: source.materials.map((material) => ({ ...material })),
  };
  result.models.push(duplicate, secondDuplicate);
  session.includeDuplicates([
    [0, duplicateIndex],
    [0, duplicateIndex + 1],
  ]);

  await session.apply(renderer, "Blue", variables, visibility);
  for (const copy of [duplicate, secondDuplicate]) {
    assert.equal(copy.materials[0].texture.path, "Bus/texture/Repaints/blue.png");
    assert.equal(
      copy.materials[0].bumpmap.path,
      "Bus/texture/Repaints/bluebump.png",
    );
  }
  await session.apply(renderer, null, variables, visibility);
  for (const copy of [duplicate, secondDuplicate]) {
    assert.equal(copy.materials[0].texture.path, "Bus/texture/body.png");
    assert.equal(copy.materials[0].bumpmap.path, "Bus/texture/bump.png");
  }
  session.dispose();
});

test("removing models reindexes repaint mappings for retained copies", async () => {
  const { result, session, visibility, renderer } = await fixture();
  const source = result.models[0];
  const copies = [0, 1].map(() => ({
    ...source,
    materials: source.materials.map((material) => ({ ...material })),
  }));
  result.models.push(...copies);
  session.includeDuplicates([
    [0, 1],
    [0, 2],
  ]);
  session.removeModels([0]);
  result.models.splice(0, 1);
  visibility.manualVisibility.splice(0, 1, true, true);
  visibility.configVisibility.splice(0, 1, true, true);
  const variables = collectSceneVariables(result.models);

  await session.apply(renderer, "Blue", variables, visibility);
  for (const copy of copies) {
    assert.equal(
      copy.materials[0].texture.path,
      "Bus/texture/Repaints/blue.png",
    );
    assert.equal(
      copy.materials[0].bumpmap.path,
      "Bus/texture/Repaints/bluebump.png",
    );
  }
  await session.apply(renderer, null, variables, visibility);
  for (const copy of copies) {
    assert.equal(copy.materials[0].texture.path, "Bus/texture/body.png");
    assert.equal(copy.materials[0].bumpmap.path, "Bus/texture/bump.png");
  }
  session.dispose();
});

test("material edits made while textures load survive repaint application", async () => {
  let resolveTexture;
  const material = { textureName: "body.png", texture: {}, specPower: 1 };
  const session = createRepaintSession(
    [{ materials: [material] }],
    [
      {
        modelIndices: [0],
        ctc: { textures: [{ name: "Body", path: "body.png" }] },
        ctis: [
          {
            source: "paint.cti",
            items: [
              { name: "Blue", slot: "Body", path: "blue.png", setvars: [] },
            ],
          },
        ],
      },
    ],
    {
      load: () =>
        new Promise((resolve) => {
          resolveTexture = resolve;
        }),
      dispose() {},
    },
  );
  const applying = session.apply({ updateMaterial() {} }, "Blue", [], {
    configVisibility: [],
  });
  material.specPower = 42;
  resolveTexture({ bitmap: {}, hasAlpha: false });
  await applying;
  assert.equal(material.specPower, 42);
});

test("repaint setvars update light intensities and restore them after a later failure", async () => {
  const models = [{ materials: [] }];
  const lights = [
    { variable: "lamp", intensity: 1 },
    { variable: "other", intensity: 1 },
  ];
  const groups = [
    {
      modelIndices: [0],
      ctc: { textures: [] },
      ctis: [
        {
          source: "paint.cti",
          items: [
            {
              name: "Blue",
              slot: "unused",
              path: "blue.png",
              setvars: [
                { name: "lamp", value: 0.25 },
                { name: "other", value: 0.5 },
              ],
            },
          ],
        },
      ],
    },
  ];
  // A recognized slot exposes the scheme even if it has no matching material.
  groups[0].ctc.textures.push({ name: "unused", path: "unused.png" });
  const session = createRepaintSession(models, groups, { dispose() {} });
  const variables = collectSceneVariables(models, lights);
  const visibility = {
    models,
    lights,
    manualVisibility: [true],
    configVisibility: [true],
    viewpoint: 0,
  };
  let fail = true;
  const renderer = {
    setLights(value) {
      if (fail && value[1].intensity === 0.5) {
        fail = false;
        throw new Error("light failure");
      }
    },
  };
  await assert.rejects(
    session.apply(renderer, "Blue", variables, visibility),
    /light failure/,
  );
  assert.deepEqual(
    lights.map((light) => light.intensity),
    [1, 1],
  );
  assert.deepEqual(
    variables.map((variable) => variable.value),
    [1, 1],
  );
  await session.apply(renderer, "Blue", variables, visibility);
  assert.deepEqual(
    lights.map((light) => light.intensity),
    [0.25, 0.5],
  );
  session.dispose();
});
