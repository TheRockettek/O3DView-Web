import test from "node:test";
import assert from "node:assert/strict";
import { WebGLRenderer } from "../src/webgl-renderer.js";

class Bitmap {
  constructor(width = 2, height = 2) {
    this.width = width;
    this.height = height;
  }
}

function fixture() {
  let id = 0,
    error = 0,
    boundVao = null,
    boundIndex = null,
    depthWrite = true,
    blending = false;
  let depthFunction,
    depthTest = false,
    cutout = 0,
    activeUnit = 0;
  const boundTextures = new Map(),
    uniforms = {};
  const calls = [],
    deleted = [],
    listeners = new Map(),
    frames = new Map();
  const constants = [
    "VERTEX_SHADER",
    "FRAGMENT_SHADER",
    "COMPILE_STATUS",
    "LINK_STATUS",
    "TEXTURE_2D",
    "TEXTURE_MIN_FILTER",
    "TEXTURE_MAG_FILTER",
    "TEXTURE_WRAP_S",
    "TEXTURE_WRAP_T",
    "LINEAR",
    "REPEAT",
    "RGBA",
    "UNSIGNED_BYTE",
    "ARRAY_BUFFER",
    "ELEMENT_ARRAY_BUFFER",
    "STATIC_DRAW",
    "FLOAT",
    "MAX_VIEWPORT_DIMS",
    "MAX_RENDERBUFFER_SIZE",
    "COLOR_BUFFER_BIT",
    "DEPTH_BUFFER_BIT",
    "DEPTH_TEST",
    "LESS",
    "LEQUAL",
    "ALWAYS",
    "CULL_FACE",
    "TEXTURE0",
    "BLEND",
    "SRC_ALPHA",
    "ONE_MINUS_SRC_ALPHA",
    "ONE",
    "TRIANGLES",
    "LINES",
    "UNSIGNED_INT",
    "UNPACK_PREMULTIPLY_ALPHA_WEBGL",
    "UNPACK_FLIP_Y_WEBGL",
  ];
  const gl = Object.fromEntries(
    constants.map((key, index) => [key, index + 1]),
  );
  Object.assign(gl, {
    NO_ERROR: 0,
    createShader: () => ({ id: ++id }),
    shaderSource: (_, source) => calls.push(["shader", source]),
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader() {},
    createProgram: () => ({ id: ++id }),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram: (value) => deleted.push(value),
    getUniformLocation: (_, name) => name,
    createTexture: () => ({ id: ++id }),
    bindTexture: (_, value) => boundTextures.set(activeUnit, value),
    texParameteri() {},
    texImage2D: (...args) => calls.push(["texture", ...args]),
    pixelStorei() {},
    deleteTexture: (value) => deleted.push(value),
    getError: () => {
      const result = error;
      error = 0;
      return result;
    },
    isContextLost: () => false,
    createBuffer: () => ({ id: ++id }),
    bindBuffer: (target, value) => {
      if (target === gl.ELEMENT_ARRAY_BUFFER) boundIndex = value;
    },
    bufferData: (target, data) => calls.push(["buffer", target, data.slice()]),
    deleteBuffer: (value) => deleted.push(value),
    createVertexArray: () => ({ id: ++id }),
    bindVertexArray: (value) => {
      boundVao = value;
    },
    deleteVertexArray: (value) => deleted.push(value),
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getParameter: (name) =>
      name === gl.MAX_VIEWPORT_DIMS ? [4096, 4096] : 4096,
    viewport: (...args) => calls.push(["viewport", ...args]),
    clearColor() {},
    clearDepth() {},
    clear: () => calls.push(["clear", depthWrite]),
    depthMask: (value) => {
      depthWrite = value;
    },
    depthFunc: (value) => {
      depthFunction = value;
    },
    enable: (value) => {
      if (value === gl.BLEND) blending = true;
      if (value === gl.DEPTH_TEST) depthTest = true;
      if (value === gl.CULL_FACE) calls.push(["cull", true]);
    },
    disable: (value) => {
      if (value === gl.BLEND) blending = false;
      if (value === gl.DEPTH_TEST) depthTest = false;
      if (value === gl.CULL_FACE) calls.push(["cull", false]);
    },
    useProgram() {},
    uniformMatrix4fv: (_, __, value) => calls.push(["matrix", value]),
    uniform3fv() {},
    uniform1i: (name, value) => {
      uniforms[name] = value;
      if (name === "cutout") cutout = value;
      calls.push(["uniform1i", name, value]);
    },
    uniform1f: (name, value) => {
      uniforms[name] = value;
    },
    uniform4fv: (name, value) =>
      calls.push(["uniform4fv", name, Array.from(value)]),
    activeTexture: (unit) => {
      activeUnit = unit - gl.TEXTURE0;
    },
    blendFuncSeparate: (...args) => calls.push(["blendFunc", ...args]),
    drawElements: (mode, count) => {
      calls.push([
        "draw",
        boundVao,
        count,
        depthWrite,
        blending,
        mode,
        boundIndex,
      ]);
      calls.push([
        "drawState",
        boundVao,
        depthTest,
        depthFunction,
        depthWrite,
        blending,
        cutout,
        mode,
      ]);
      calls.push([
        "mapState",
        boundVao,
        [...boundTextures.entries()],
        { ...uniforms },
      ]);
    },
  });
  const canvas = {
    width: 100,
    height: 100,
    clientWidth: 100,
    clientHeight: 100,
    getContext: (type) => (type === "webgl2" ? gl : null),
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
    dispatchEvent: (event) => {
      listeners.get(event.type)?.(event);
      return true;
    },
  };
  let nextFrame = 0;
  const saved = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    ImageBitmap: globalThis.ImageBitmap,
    CustomEvent: globalThis.CustomEvent,
    OffscreenCanvas: globalThis.OffscreenCanvas,
  };
  globalThis.requestAnimationFrame = (callback) => {
    const key = ++nextFrame;
    frames.set(key, callback);
    return key;
  };
  globalThis.cancelAnimationFrame = (key) => frames.delete(key);
  globalThis.ImageBitmap = Bitmap;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        drawImage: (bitmap) => {
          this.bitmap = bitmap;
        },
      };
    }
  };
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  return {
    gl,
    canvas,
    calls,
    deleted,
    listeners,
    frames,
    error: (value) => {
      error = value;
    },
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    cleanup: () => Object.assign(globalThis, saved),
  };
}

function model(materials = [{}]) {
  return {
    vertices: new Float32Array([
      1, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0]),
    materials,
  };
}

test("requires WebGL 2 and initializes without WebGPU", async () => {
  await assert.rejects(
    WebGLRenderer.create({ getContext: () => null }),
    /WebGL 2/,
  );
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    assert.ok(renderer);
    assert.equal(f.frames.size, 1);
    renderer.destroy();
    assert.equal(f.frames.size, 0);
    assert.equal(f.listeners.size, 0);
  } finally {
    f.cleanup();
  }
});

test("back-face culling applies to triangles but not wireframe", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    renderer.setModels([model()]);
    f.flush();
    assert.equal(f.calls.filter((call) => call[0] === "cull").at(-1)[1], true);
    renderer.setWireframe(true);
    f.flush();
    assert.equal(f.calls.filter((call) => call[0] === "cull").at(-1)[1], false);
    renderer.setWireframe(false);
    f.flush();
    assert.equal(f.calls.filter((call) => call[0] === "cull").at(-1)[1], true);
    renderer.setBackfaceCulling(false);
    f.flush();
    assert.equal(f.calls.filter((call) => call[0] === "cull").at(-1)[1], false);
    assert.throws(() => renderer.setBackfaceCulling(1), TypeError);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("uploads interior point lights to the shader", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    renderer.setModels([model()]);
    renderer.setLights([
      {
        position: [1, 2, 3],
        range: 4,
        color: [0.25, 0.5, 1],
        ambient: [0.25, 0.5, 1],
        intensity: 2,
        on: true,
      },
      {
        position: [0, 0, 0],
        range: 4,
        mode: "directional",
        direction: [0, -1, 0],
        color: [1, 1, 1],
        on: true,
      },
      ...Array.from({ length: 14 }, (_light, index) => ({
        position: [index + 2, 0, 0],
        range: 4,
        color: [1, 1, 1],
        on: true,
      })),
    ]);
    f.flush();
    const positions = f.calls
      .filter(
        (call) => call[0] === "uniform4fv" && call[1] === "pointPositions[0]",
      )
      .at(-1)[2];
    const colors = f.calls
      .filter(
        (call) => call[0] === "uniform4fv" && call[1] === "pointColors[0]",
      )
      .at(-1)[2];
    const ambients = f.calls
      .filter(
        (call) => call[0] === "uniform4fv" && call[1] === "pointAmbients[0]",
      )
      .at(-1)[2];
    assert.deepEqual(positions.slice(0, 4), [1, 2, 3, 4]);
    assert.deepEqual(positions.slice(4, 8), [0, -1, 0, 4]);
    assert.equal(positions.length, 64);
    assert.deepEqual(positions.slice(60, 64), [15, 0, 0, 4]);
    assert.deepEqual(colors.slice(0, 8), [0.5, 1, 2, 1, 1, 1, 1, 2]);
    assert.equal(colors.length, 64);
    assert.deepEqual(ambients.slice(0, 4), [0.5, 1, 2, 0]);
    renderer.setSun({
      position: [0, 0, 0],
      range: 1000,
      mode: "directional",
      direction: [0, -1, 0],
      color: [1, 0.5, 0],
      ambient: [0.25, 0, 0],
      intensity: 2,
      on: true,
    });
    f.flush();
    assert.equal(
      f.calls
        .filter(
          (call) => call[0] === "uniform1i" && call[1] === "useDesktopSun",
        )
        .at(-1)[2],
      1,
    );
    assert.deepEqual(
      f.calls
        .filter((call) => call[0] === "uniform4fv" && call[1] === "sunPosition")
        .at(-1)[2],
      [0, -1, 0, 1000],
    );
    assert.deepEqual(
      f.calls
        .filter((call) => call[0] === "uniform4fv" && call[1] === "sunColor")
        .at(-1)[2],
      [2, 1, 0, 2],
    );
    assert.deepEqual(
      f.calls
        .filter((call) => call[0] === "uniform4fv" && call[1] === "sunAmbient")
        .at(-1)[2],
      [0.5, 0, 0, 0],
    );
    renderer.setSun(null);
    f.flush();
    assert.equal(
      f.calls
        .filter(
          (call) => call[0] === "uniform1i" && call[1] === "useDesktopSun",
        )
        .at(-1)[2],
      0,
    );
    const shader = f.calls
      .filter((call) => call[0] === "shader")
      .map((call) => call[1])
      .find((source) => source.includes("pointPositions"));
    assert.match(shader, /uniform vec4 pointPositions\[16\]/);
    assert.match(shader, /i < 17/);
    assert.match(shader, /i == 16/);
    assert.match(shader, /position\.w \/ \(distanceSquared \+ 1\.0\)/);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("fullbright updates the shader uniform without rebuilding the scene", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    renderer.setModels([model()]);
    const draws = renderer._draws;
    assert.deepEqual(renderer._modelBounds[0].center, [-1.5, 0.5, 0]);
    renderer.focusModel(0);
    assert.deepEqual(renderer._target, [-1.5, 0.5, 0]);
    renderer.setFullbright(true);
    f.flush();
    assert.equal(
      f.calls
        .filter((call) => call[0] === "uniform1i" && call[1] === "fullbright")
        .at(-1)[2],
      1,
    );
    assert.equal(renderer._draws, draws);
    renderer.setFullbright(false);
    f.flush();
    assert.equal(
      f.calls
        .filter((call) => call[0] === "uniform1i" && call[1] === "fullbright")
        .at(-1)[2],
      0,
    );
    assert.throws(() => renderer.setFullbright("true"), TypeError);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("selection highlighting follows the selected model and only animates visible draws", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    renderer.setModels([model(), model()]);
    renderer.setSelectedModel(1);
    f.flush();
    const states = f.calls.filter((call) => call[0] === "mapState").slice(-2);
    assert.deepEqual(
      states.map((call) => call[3].selected),
      [0, 1],
    );
    assert.ok(
      states[1][3].selectionPulse >= 0 && states[1][3].selectionPulse <= 1,
    );
    assert.equal(f.frames.size, 1);
    renderer.setModelVisible(1, false);
    f.flush();
    assert.equal(f.frames.size, 0);
    renderer.setModelVisible(1, true);
    f.flush();
    assert.equal(f.frames.size, 1);
    renderer.setSelectionHighlight(false);
    f.flush();
    assert.equal(f.frames.size, 0);
    assert.equal(
      f.calls.filter((call) => call[0] === "mapState").at(-1)[3].selected,
      0,
    );
    assert.throws(() => renderer.setSelectedModel(-1), RangeError);
    assert.throws(() => renderer.setSelectionHighlight(1), TypeError);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("alpha scale updates blending and uniforms without reuploading unchanged textures", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const bitmap = new Bitmap();
    const material = { texture: bitmap, textureTransparent: false };
    renderer.setModels([model([material])]);
    const draw = renderer._draws[0],
      oldTexture = draw.texture;
    const uploads = f.calls.filter((call) => call[0] === "texture").length;
    renderer.updateMaterial(0, 0, { ...material, alphaScale: 0.25 });
    assert.equal(draw.texture, oldTexture);
    assert.equal(
      f.calls.filter((call) => call[0] === "texture").length,
      uploads,
    );
    assert.equal(draw.transparent, true);
    f.flush();
    const state = f.calls.filter((call) => call[0] === "mapState").at(-1)[3];
    assert.equal(state.alphaScale, 0.25);
    const shader = f.calls
      .filter((call) => call[0] === "shader")
      .map((call) => call[1])
      .find((source) => source.includes("alphaScale"));
    assert.ok(
      shader.indexOf("discard;") < shader.indexOf("albedo.a * alphaScale"),
    );
    renderer.updateMaterial(0, 0, {
      ...material,
      alphaScale: 0.25,
      alphaMode: 1,
    });
    assert.equal(draw.transparent, false);
    assert.throws(
      () => renderer.updateMaterial(0, 0, { alphaScale: 2 }),
      /alphaScale/,
    );
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("reflects positions and normals, reverses indices, fits bounds, and preserves the previous scene on failures", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const source = model();
    renderer.setModels([source]);
    const vertex = f.calls.find(
      (call) => call[0] === "buffer" && call[1] === f.gl.ARRAY_BUFFER,
    )[2];
    const indices = f.calls.find(
      (call) => call[0] === "buffer" && call[1] === f.gl.ELEMENT_ARRAY_BUFFER,
    )[2];
    assert.deepEqual([vertex[0], vertex[3], vertex[8]], [-1, -1, -2]);
    assert.deepEqual(Array.from(indices), [2, 1, 0]);
    assert.equal(source.vertices[0], 1);
    assert.deepEqual(renderer._target, [-1.5, 0.5, 0]);
    renderer._target = [100, 100, 100];
    renderer.resetCamera();
    assert.deepEqual(renderer._target, [-1.5, 0.5, 0]);
    const draws = renderer._draws,
      resources = renderer._resources,
      distance = renderer._distance;
    const bad = model();
    bad.triangles[0] = 10;
    assert.throws(() => renderer.setModels([model(), bad]), /invalid vertex/);
    assert.equal(renderer._draws, draws);
    assert.equal(renderer._resources, resources);
    assert.equal(renderer._distance, distance);
    assert.ok(f.deleted.length > 0);
    assert.throws(
      () => renderer.setModels([model([{ diffuse: [NaN] }])]),
      /finite/,
    );
    assert.equal(renderer._draws, draws);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("texture overrides, alpha classification and atomic material updates", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const bitmap = new Bitmap();
    renderer.setModels([
      model([
        { texture: bitmap, textureTransparent: false, diffuse: [1, 1, 1, 0.2] },
      ]),
    ]);
    const draw = renderer._draws[0],
      oldTexture = draw.texture,
      distance = renderer._distance;
    assert.equal(draw.transparent, false);
    assert.equal(draw.material.emission[3], 1);
    assert.ok(
      f.calls.some(
        (call) => call[0] === "texture" && call.at(-1).bitmap === bitmap,
      ),
    );
    assert.throws(
      () => renderer.updateMaterial(0, 0, { texture: {} }),
      /ImageBitmap/,
    );
    assert.throws(
      () => renderer.updateMaterial(0, 0, { specPower: Infinity }),
      /finite/,
    );
    assert.equal(draw.texture, oldTexture);
    f.error(1285);
    assert.throws(
      () => renderer.updateMaterial(0, 0, { texture: new Bitmap() }),
      /texture upload/,
    );
    assert.equal(draw.texture, oldTexture);
    renderer.updateMaterial(0, 0, {
      diffuse: [1, 1, 1, 0.5],
      emission: [1, 2, 3],
    });
    assert.equal(draw.texture, renderer._white);
    assert.equal(draw.transparent, true);
    assert.deepEqual(draw.material.emission, [1, 2, 3, 0]);
    assert.ok(f.deleted.includes(oldTexture));
    assert.equal(renderer._distance, distance);
    renderer.updateMaterial(0, 0, { texture: bitmap });
    assert.equal(draw.transparent, true);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("static maps bind independently, classify alpha, and respect overrides and wireframe", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const maps = {
      texture: new Bitmap(),
      transmap: new Bitmap(),
      nightmap: new Bitmap(),
      lightmap: new Bitmap(),
      bumpmap: new Bitmap(),
      envmap: new Bitmap(),
    };
    const materials = [
      {
        ...maps,
        textureTransparent: false,
        bumpmapStrength: -2,
        envmapStrength: 0.75,
      },
      { transmap: maps.transmap, alphaMode: 0 },
      { transmap: maps.transmap, alphaMode: 1, noZWrite: true },
      { transmap: maps.transmap, alphaMode: 2, noZCheck: true },
      {},
    ];
    renderer.setModels(materials.map((material) => model([material])));
    const draws = renderer._draws;
    assert.deepEqual(
      f.calls
        .filter((call) => call[0] === "texture" && call.at(-1)?.bitmap)
        .slice(0, 6)
        .map((call) => call.at(-1).bitmap),
      Object.values(maps),
    );
    assert.deepEqual(
      draws.map((draw) => draw.transparent),
      [true, false, false, true, false],
    );
    f.flush();
    const state = f.calls.filter((call) => call[0] === "mapState");
    const first = state.find((call) => call[1] === draws[0].vao);
    assert.deepEqual(Object.fromEntries(first[2]), {
      0: draws[0].texture,
      1: draws[0].transmapTexture,
      2: draws[0].nightmapTexture,
      3: draws[0].lightmapTexture,
      4: draws[0].bumpmapTexture,
      5: draws[0].envmapTexture,
    });
    assert.deepEqual(
      [
        first[3].useTransmap,
        first[3].useNightmap,
        first[3].useLightmap,
        first[3].nightmapStrength,
        first[3].lightmapStrength,
      ],
      [1, 1, 1, 0, 1],
    );
    const absent = state.find((call) => call[1] === draws[4].vao);
    assert.deepEqual(
      [absent[3].useTransmap, absent[3].useNightmap, absent[3].useLightmap],
      [0, 0, 0],
    );
    assert.deepEqual(
      [
        first[3].useBumpmap,
        first[3].useEnvmap,
        first[3].bumpmapStrength,
        first[3].envmapStrength,
      ],
      [1, 1, -2, 0.75],
    );
    assert.deepEqual(
      [
        absent[3].useBumpmap,
        absent[3].useEnvmap,
        absent[3].bumpmapStrength,
        absent[3].envmapStrength,
      ],
      [0, 0, 0, 0],
    );
    assert.deepEqual(
      f.calls
        .filter((call) => call[0] === "drawState")
        .map((call) => {
          const index = draws.findIndex((draw) => draw.vao === call[1]);
          return [index, ...call.slice(3, 7)];
        }),
      [
        [1, f.gl.LEQUAL, true, false, 0],
        [2, f.gl.LEQUAL, false, false, 1],
        [4, f.gl.LEQUAL, true, false, 0],
        [0, f.gl.LEQUAL, false, true, 0],
        [3, f.gl.ALWAYS, true, true, 0],
      ],
    );
    const fragment = f.calls.find(
      (call) => call[0] === "shader" && call[1].includes("fragmentColor"),
    )[1];
    assert.match(
      fragment,
      /albedo\.a = texture\(transmapTexture, texCoord\)\.r/,
    );
    assert.ok(
      fragment.indexOf("albedo.a = texture(transmapTexture") <
        fragment.indexOf("if (cutout"),
    );
    assert.match(
      fragment,
      /color \+= texture\(nightmapTexture, texCoord\)\.rgb \* nightmapStrength/,
    );
    assert.match(
      fragment,
      /color \+= texture\(lightmapTexture, texCoord\)\.rgb \* lightmapStrength/,
    );
    const vertex = f.calls.find(
      (call) => call[0] === "shader" && call[1].includes("gl_Position"),
    )[1];
    assert.match(vertex, /cross\(normal, vec3\(0\.0, 1\.0, 0\.0\)\)/);
    assert.match(
      fragment,
      /vec2\(bump00 - bump01, bump10 - bump11\) \* bumpmapStrength/,
    );
    assert.match(
      fragment,
      /tangent \* nt\.x \+ binormal \* nt\.y \+ worldNormal \* nt\.z/,
    );
    assert.match(fragment, /clamp\(\(-view \+ n\)\.xy \* 0\.5 \+ 0\.5/);
    assert.match(fragment, /clamp\(albedo\.a \* envmapStrength, 0\.0, 1\.0\)/);
    assert.ok(
      fragment.indexOf("color = mix(color, env") <
        fragment.indexOf("color += emission"),
    );
    renderer.setModelVisible(0, false);
    renderer.setWireframe(true);
    f.calls.length = 0;
    f.flush();
    assert.equal(f.calls.filter((call) => call[0] === "drawState").length, 4);
    assert.ok(
      f.calls
        .filter((call) => call[0] === "drawState")
        .every((call) => !call[5] && call[7] === f.gl.LINES),
    );
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("map updates replace atomically, validate inputs, and release all owned textures", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const maps = {
      texture: new Bitmap(),
      transmap: new Bitmap(),
      nightmap: new Bitmap(),
      lightmap: new Bitmap(),
      bumpmap: new Bitmap(),
      envmap: new Bitmap(),
    };
    renderer.setModels([model([maps])]);
    const draw = renderer._draws[0],
      oldMaterial = draw.material,
      oldResources = renderer._resources.slice();
    const oldTextures = [
      draw.texture,
      draw.transmapTexture,
      draw.nightmapTexture,
      draw.lightmapTexture,
      draw.bumpmapTexture,
      draw.envmapTexture,
    ];
    for (const name of [
      "texture",
      "transmap",
      "nightmap",
      "lightmap",
      "bumpmap",
      "envmap",
    ]) {
      for (const value of [{}, new Bitmap(0, 1)]) {
        assert.throws(
          () => renderer.updateMaterial(0, 0, { [name]: value }),
          new RegExp(name),
        );
        assert.throws(
          () => renderer.setModels([model([{ [name]: value }])]),
          new RegExp(name),
        );
      }
      for (const name of ["bumpmapStrength", "envmapStrength"]) {
        for (const value of [NaN, Infinity, -Infinity, 1e100, null, "1"]) {
          assert.throws(
            () => renderer.updateMaterial(0, 0, { [name]: value }),
            new RegExp(name),
          );
          assert.throws(
            () => renderer.setModels([model([{ [name]: value }])]),
            new RegExp(name),
          );
        }
      }
    }
    for (const name of ["nightmapStrength", "lightmapStrength"]) {
      for (const value of [-1, NaN, Infinity, null, "1"]) {
        assert.throws(
          () => renderer.updateMaterial(0, 0, { [name]: value }),
          new RegExp(name),
        );
        assert.throws(
          () => renderer.setModels([model([{ [name]: value }])]),
          new RegExp(name),
        );
      }
    }
    const upload = f.gl.texImage2D;
    const changedMaps = {
      ...maps,
      bumpmap: new Bitmap(),
      envmap: new Bitmap(),
    };
    let uploads = 0;
    f.gl.texImage2D = (...args) => {
      if (++uploads === 6) throw new Error("upload failed");
      upload(...args);
    };
    assert.throws(
      () => renderer.updateMaterial(0, 0, changedMaps),
      /upload failed/,
    );
    f.gl.texImage2D = upload;
    assert.equal(draw.material, oldMaterial);
    assert.deepEqual(renderer._resources, oldResources);
    assert.ok(oldTextures.every((texture) => !f.deleted.includes(texture)));
    assert.equal(f.deleted.length, 6);
    renderer.updateMaterial(0, 0, {
      ...changedMaps,
      nightmapStrength: 0.75,
      lightmapStrength: 1.5,
      bumpmapStrength: -1,
      envmapStrength: -2,
    });
    assert.ok(oldTextures.every((texture) => f.deleted.includes(texture)));
    f.calls.length = 0;
    f.flush();
    const uniforms = f.calls.find((call) => call[0] === "mapState")[3];
    assert.deepEqual(
      [uniforms.nightmapStrength, uniforms.lightmapStrength],
      [0.75, 1.5],
    );
    assert.deepEqual(
      [uniforms.bumpmapStrength, uniforms.envmapStrength],
      [-1, -2],
    );
    const replacements = [
      draw.texture,
      draw.transmapTexture,
      draw.nightmapTexture,
      draw.lightmapTexture,
      draw.bumpmapTexture,
      draw.envmapTexture,
    ];
    renderer.updateMaterial(0, 0, {
      ...changedMaps,
      bumpmapStrength: 3,
      envmapStrength: 4,
    });
    assert.deepEqual(
      [
        draw.texture,
        draw.transmapTexture,
        draw.nightmapTexture,
        draw.lightmapTexture,
        draw.bumpmapTexture,
        draw.envmapTexture,
      ],
      replacements,
    );
    assert.ok(replacements.every((texture) => !f.deleted.includes(texture)));
    renderer.updateMaterial(0, 0, {
      transmap: null,
      nightmap: undefined,
      lightmap: null,
    });
    assert.ok(replacements.every((texture) => f.deleted.includes(texture)));
    assert.deepEqual(
      [
        draw.texture,
        draw.transmapTexture,
        draw.nightmapTexture,
        draw.lightmapTexture,
        draw.bumpmapTexture,
        draw.envmapTexture,
      ],
      Array(6).fill(renderer._white),
    );
    assert.deepEqual(
      [
        draw.material.nightmapStrength,
        draw.material.lightmapStrength,
        draw.transparent,
      ],
      [0, 1, false],
    );
    renderer.setModels([model([maps])]);
    const lastTextures = [
      renderer._draws[0].texture,
      renderer._draws[0].transmapTexture,
      renderer._draws[0].nightmapTexture,
      renderer._draws[0].lightmapTexture,
      renderer._draws[0].bumpmapTexture,
      renderer._draws[0].envmapTexture,
    ];
    f.gl.isContextLost = () => true;
    assert.throws(() => renderer.updateMaterial(0, 0, maps), /context lost/);
    renderer.destroy();
    assert.ok(lastTextures.every((texture) => f.deleted.includes(texture)));
    assert.throws(() => renderer.updateMaterial(0, 0, maps), /destroyed/);
  } finally {
    f.cleanup();
  }
});

test("draws opaque first and transparent back-to-front with depth writes disabled", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const near = model([{ diffuse: [1, 1, 1, 0.5] }]);
    const far = model([{ texture: new Bitmap() }]);
    for (let i = 2; i < far.vertices.length; i += 8) far.vertices[i] = -4;
    renderer.setModels([near, model(), far]);
    f.flush();
    const draws = f.calls.filter((call) => call[0] === "draw");
    assert.deepEqual(
      draws.map((call) => call[1]),
      [renderer._draws[1].vao, renderer._draws[2].vao, renderer._draws[0].vao],
    );
    assert.deepEqual(
      draws.map((call) => call.slice(3, 5)),
      [
        [true, false],
        [false, true],
        [false, true],
      ],
    );
    assert.ok(
      f.calls.some((call) => call[0] === "matrix" && call[1].length === 16),
    );
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("coplanar materials use LEQUAL and restore it after noZCheck draws", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    renderer.setModels([
      model([{ alphaMode: 0 }]),
      model([{ alphaMode: 1, noZCheck: true }]),
      model([{ alphaMode: 0 }]),
      model([{ alphaMode: 2 }]),
    ]);
    f.flush();
    assert.deepEqual(
      f.calls
        .filter((call) => call[0] === "drawState")
        .map((call) => call.slice(2, 4)),
      [
        [true, f.gl.LEQUAL],
        [true, f.gl.ALWAYS],
        [true, f.gl.LEQUAL],
        [true, f.gl.LEQUAL],
      ],
    );
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("CFG alpha and depth flags independently control each filled draw", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const materials = [];
    for (const alphaMode of [0, 1, 2]) {
      for (const noZCheck of [false, true])
        for (const noZWrite of [false, true]) {
          materials.push({
            alphaMode,
            noZCheck,
            noZWrite,
            texture: new Bitmap(),
          });
        }
    }
    renderer.setModels(materials.map((material) => model([material])));
    f.flush();
    const states = f.calls.filter((call) => call[0] === "drawState");
    assert.equal(states.length, materials.length);
    for (const [index, material] of materials.entries()) {
      const state = states.find(
        (call) => call[1] === renderer._draws[index].vao,
      );
      assert.deepEqual(state.slice(2), [
        true,
        material.noZCheck ? f.gl.ALWAYS : f.gl.LEQUAL,
        !material.noZWrite,
        material.alphaMode === 2,
        material.alphaMode === 1 ? 1 : 0,
        f.gl.TRIANGLES,
      ]);
    }
    assert.deepEqual(
      states.map(
        (call) =>
          renderer._draws.find((draw) => draw.vao === call[1]).material
            .alphaMode,
      ),
      [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
    );
    assert.ok(
      f.calls.some(
        (call) =>
          call[0] === "blendFunc" &&
          call
            .slice(1)
            .every(
              (value, i) =>
                value ===
                [
                  f.gl.SRC_ALPHA,
                  f.gl.ONE_MINUS_SRC_ALPHA,
                  f.gl.ONE,
                  f.gl.ONE_MINUS_SRC_ALPHA,
                ][i],
            ),
      ),
    );
    const fragment = f.calls.find(
      (call) => call[0] === "shader" && call[1].includes("fragmentColor"),
    )[1];
    assert.match(fragment, /if \(cutout && albedo\.a < 0\.5\) discard;/);
    assert.ok(
      fragment.indexOf("if (cutout") < fragment.indexOf("if (wireframe)"),
    );
    assert.match(fragment, /fragmentColor = vec4\(albedo\.rgb, 1\.0\);/);
    renderer.setWireframe(true);
    f.calls.length = 0;
    f.flush();
    const lines = f.calls.filter((call) => call[0] === "drawState");
    for (const [index, material] of materials.entries()) {
      const state = lines.find(
        (call) => call[1] === renderer._draws[index].vao,
      );
      assert.deepEqual(state.slice(2), [
        true,
        material.noZCheck ? f.gl.ALWAYS : f.gl.LEQUAL,
        !material.noZWrite,
        false,
        material.alphaMode === 1 ? 1 : 0,
        f.gl.LINES,
      ]);
    }
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("explicit blend writes depth by default while inferred blend retains legacy behavior", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const near = model([{ alphaMode: 2, diffuse: [1, 1, 1, 1] }]);
    const far = model([{ diffuse: [1, 1, 1, 0.3] }]);
    for (let i = 2; i < far.vertices.length; i += 8) far.vertices[i] = -4;
    const opaqueTexture = model([
      {
        texture: new Bitmap(),
        textureTransparent: false,
        diffuse: [1, 1, 1, 0.2],
      },
    ]);
    const transparentTexture = model([{ texture: new Bitmap() }]);
    renderer.setModels([near, far, opaqueTexture, transparentTexture]);
    f.flush();
    const states = f.calls.filter((call) => call[0] === "drawState");
    assert.deepEqual(
      states.map((call) => call[1]),
      [
        renderer._draws[2].vao,
        renderer._draws[1].vao,
        renderer._draws[0].vao,
        renderer._draws[3].vao,
      ],
    );
    assert.deepEqual(
      states.map((call) => call.slice(4, 7)),
      [
        [true, false, 0],
        [false, true, 0],
        [true, true, 0],
        [false, true, 0],
      ],
    );
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("depth flags also apply to inferred materials without changing legacy wireframe alpha behavior", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const materials = [];
    for (const alpha of [1, 0.3])
      for (const noZCheck of [false, true])
        for (const noZWrite of [false, true]) {
          materials.push({ diffuse: [1, 1, 1, alpha], noZCheck, noZWrite });
        }
    renderer.setModels(materials.map((material) => model([material])));
    for (const wireframe of [false, true]) {
      renderer.setWireframe(wireframe);
      f.calls.length = 0;
      f.flush();
      const states = f.calls.filter((call) => call[0] === "drawState");
      for (const [index, material] of materials.entries()) {
        const state = states.find(
          (call) => call[1] === renderer._draws[index].vao,
        );
        assert.deepEqual(state.slice(2), [
          true,
          material.noZCheck ? f.gl.ALWAYS : f.gl.LEQUAL,
          !material.noZWrite && (wireframe || material.diffuse[3] === 1),
          !wireframe && material.diffuse[3] < 1,
          0,
          wireframe ? f.gl.LINES : f.gl.TRIANGLES,
        ]);
      }
    }
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("material updates replace CFG flags atomically and wireframe respects cutout and depth flags", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    renderer.setModels([
      model([
        {
          alphaMode: 1,
          noZCheck: true,
          noZWrite: true,
          diffuse: [1, 1, 1, 0.1],
        },
      ]),
    ]);
    const draw = renderer._draws[0];
    f.flush();
    renderer.setWireframe(true);
    f.calls.length = 0;
    f.flush();
    assert.deepEqual(f.calls.find((call) => call[0] === "drawState").slice(2), [
      true,
      f.gl.ALWAYS,
      false,
      false,
      1,
      f.gl.LINES,
    ]);
    renderer.updateMaterial(0, 0, {
      alphaMode: 2,
      noZCheck: true,
      noZWrite: false,
    });
    assert.deepEqual(
      [draw.material.alphaMode, draw.material.noZCheck, draw.material.noZWrite],
      [2, true, false],
    );
    renderer.setWireframe(false);
    f.calls.length = 0;
    f.flush();
    assert.deepEqual(f.calls.find((call) => call[0] === "drawState").slice(2), [
      true,
      f.gl.ALWAYS,
      true,
      true,
      0,
      f.gl.TRIANGLES,
    ]);
    assert.deepEqual(
      f.calls.find((call) => call[0] === "clear"),
      ["clear", true],
    );
    renderer.updateMaterial(0, 0, { diffuse: [1, 1, 1, 0.2] });
    assert.deepEqual(
      [draw.material.alphaMode, draw.material.noZCheck, draw.material.noZWrite],
      [undefined, false, false],
    );
    f.calls.length = 0;
    f.flush();
    assert.deepEqual(f.calls.find((call) => call[0] === "drawState").slice(2), [
      true,
      f.gl.LEQUAL,
      false,
      true,
      0,
      f.gl.TRIANGLES,
    ]);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("rejects invalid CFG flags during scene creation and material updates", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    renderer.setModels([model([{ alphaMode: 1, noZCheck: true }])]);
    const draw = renderer._draws[0],
      original = draw.material,
      oldDraws = renderer._draws;
    for (const [flag, values] of [
      ["alphaMode", [-1, 3, 0.5, "2", null, NaN, Infinity, true]],
      ["noZCheck", [0, 1, "true", null]],
      ["noZWrite", [0, 1, "false", null]],
    ])
      for (const value of values) {
        assert.throws(
          () => renderer.updateMaterial(0, 0, { [flag]: value }),
          new RegExp(flag),
        );
        assert.equal(draw.material, original);
        assert.throws(
          () => renderer.setModels([model([{ [flag]: value }])]),
          new RegExp(flag),
        );
        assert.equal(renderer._draws, oldDraws);
      }
    const empty = {
      vertices: new Float32Array(),
      triangles: new Uint32Array(),
      materials: [{ alphaMode: 9 }],
    };
    assert.throws(() => renderer.setModels([empty]), /alphaMode/);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("wireframe draws opaque unlit triangle edges and restores filled materials and visibility", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const source = model([{}, { diffuse: [0.2, 0.3, 0.4, 0.5] }]);
    source.triangles = new Uint32Array([0, 1, 2, 0, 0, 2, 1, 1]);
    renderer.setModels([source, model()]);
    const draws = renderer._draws,
      resources = renderer._resources;
    const uploads = f.calls.filter(
      (call) => call[0] === "buffer" && call[1] === f.gl.ELEMENT_ARRAY_BUFFER,
    );
    assert.deepEqual(Array.from(uploads[1][2]), [2, 1, 1, 0, 0, 2]);
    assert.deepEqual(Array.from(uploads[3][2]), [1, 2, 2, 0, 0, 1]);
    f.flush();
    renderer.setModelVisible(1, false);
    renderer._distance = 42;
    renderer.setWireframe(true);
    renderer.setWireframe(true);
    assert.equal(f.frames.size, 1);
    f.calls.length = 0;
    f.flush();
    const lines = f.calls.filter((call) => call[0] === "draw");
    assert.deepEqual(
      lines.map((call) => call.slice(1)),
      draws
        .slice(0, 2)
        .map((draw) => [draw.vao, 6, true, false, f.gl.LINES, draw.edgeBuffer]),
    );
    assert.ok(
      f.calls.some(
        (call) =>
          call[0] === "uniform1i" && call[1] === "wireframe" && call[2] === 1,
      ),
    );
    renderer.updateMaterial(0, 1, { diffuse: [0.7, 0.6, 0.5, 0.3] });
    renderer.setWireframe(false);
    f.calls.length = 0;
    f.flush();
    const fills = f.calls.filter((call) => call[0] === "draw");
    assert.deepEqual(
      fills.map((call) => call.slice(1)),
      [
        [draws[0].vao, 3, true, false, f.gl.TRIANGLES, draws[0].indexBuffer],
        [draws[1].vao, 3, false, true, f.gl.TRIANGLES, draws[1].indexBuffer],
      ],
    );
    assert.ok(
      f.calls.some(
        (call) =>
          call[0] === "uniform1i" && call[1] === "wireframe" && call[2] === 0,
      ),
    );
    assert.deepEqual(draws[1].material.diffuse, [0.7, 0.6, 0.5, 0.3]);
    assert.equal(renderer._resources, resources);
    assert.equal(renderer._draws, draws);
    assert.equal(renderer._distance, 42);
    assert.deepEqual(renderer._modelVisibility, [true, false]);
    assert.throws(() => renderer.setWireframe(1), TypeError);
    renderer.setWireframe(true);
    renderer.setModels([source]);
    assert.ok(draws.every((draw) => f.deleted.includes(draw.edgeBuffer)));
    assert.equal(renderer._wireframe, true);
    f.gl.isContextLost = () => true;
    assert.throws(() => renderer.setWireframe(false), /context lost/);
    renderer.destroy();
    assert.throws(() => renderer.setWireframe(false), /destroyed/);
  } finally {
    f.cleanup();
  }
});

test("model visibility filters all material draws while preserving geometry and camera", async () => {
  const f = fixture();
  try {
    const renderer = await WebGLRenderer.create(f.canvas);
    const source = model([{}, { diffuse: [1, 1, 1, 0.5] }]);
    source.triangles = new Uint32Array([0, 1, 2, 0, 0, 1, 2, 1]);
    const other = model([{ diffuse: [1, 1, 1, 0.5] }]);
    const empty = {
      vertices: new Float32Array(),
      triangles: new Uint32Array(),
      materials: [],
    };
    const vertices = source.vertices.slice(),
      triangles = source.triangles.slice();
    renderer.setModels([source, other, empty]);
    const draws = renderer._draws,
      resources = renderer._resources;
    const vaos = draws.map((draw) => draw.vao);
    const render = () => {
      f.calls.length = 0;
      f.flush();
      return f.calls
        .filter((call) => call[0] === "draw")
        .map((call) => call[1]);
    };
    assert.deepEqual(render(), vaos);
    renderer._distance = 42;
    renderer._yaw = 0.4;
    renderer._pitch = -0.3;
    const camera = [
      renderer._target,
      renderer._radius,
      renderer._distance,
      renderer._yaw,
      renderer._pitch,
    ];
    renderer.setModelVisible(0, false);
    assert.equal(f.frames.size, 1);
    assert.deepEqual(render(), [vaos[2]]);
    renderer.setModelVisible(0, false);
    assert.equal(f.frames.size, 0);
    renderer.setModelVisible(1, false);
    assert.deepEqual(render(), []);
    renderer.setModelVisible(1, true);
    renderer.updateMaterial(0, 0, { diffuse: [1, 1, 1, 0.5] });
    assert.deepEqual(render(), [vaos[2]]);
    renderer.setModelVisible(2, false);
    renderer.setModelVisible(0, true);
    assert.deepEqual(render(), vaos);
    assert.equal(renderer._draws, draws);
    assert.equal(renderer._resources, resources);
    assert.equal(f.deleted.length, 0);
    assert.deepEqual(
      [
        renderer._target,
        renderer._radius,
        renderer._distance,
        renderer._yaw,
        renderer._pitch,
      ],
      camera,
    );
    assert.deepEqual(source.vertices, vertices);
    assert.deepEqual(source.triangles, triangles);
    for (const index of [-1, 3, 0.5, "0", NaN])
      assert.throws(() => renderer.setModelVisible(index, false), RangeError);
    assert.throws(() => renderer.setModelVisible(0, 0), TypeError);
    renderer.setModelVisible(0, false);
    const bad = model();
    bad.triangles[0] = 100;
    assert.throws(() => renderer.setModels([bad]), /invalid vertex/);
    assert.deepEqual(render(), [vaos[2]]);
    renderer.setModels([source, other, empty]);
    assert.deepEqual(renderer._modelVisibility, [true, true, true]);
    assert.equal(render().length, 3);
    renderer.setModels([]);
    assert.deepEqual(render(), []);
    assert.throws(() => renderer.setModelVisible(0, true), RangeError);
    f.gl.isContextLost = () => true;
    assert.throws(() => renderer.setModelVisible(0, false), /context lost/);
    renderer.destroy();
    assert.throws(() => renderer.setModelVisible(0, false), /destroyed/);
  } finally {
    f.cleanup();
  }
});

test("orbit, zoom, resize, render errors and context loss are handled", async () => {
  const f = fixture();
  try {
    const errors = [];
    f.canvas.addEventListener("renderererror", (event) =>
      errors.push(event.detail),
    );
    const renderer = await WebGLRenderer.create(f.canvas);
    f.flush();
    f.listeners.get("pointerdown")({
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
    });
    f.listeners.get("pointermove")({
      pointerId: 1,
      clientX: 100,
      clientY: 10000,
    });
    assert.equal(renderer._yaw, Math.PI / 2 + 0.5);
    assert.equal(renderer._pitch, Math.PI / 2 - 0.001);
    const distance = renderer._distance;
    f.listeners.get("wheel")({ deltaY: 1, deltaMode: 1, preventDefault() {} });
    assert.ok(renderer._distance > distance);
    f.canvas.clientWidth = 200;
    f.flush();
    assert.deepEqual(f.calls.filter((call) => call[0] === "viewport").at(-1), [
      "viewport",
      0,
      0,
      200,
      100,
    ]);
    renderer._requestFrame();
    f.error(1282);
    f.flush();
    assert.match(errors[0].message, /render failed/);
    renderer._requestFrame();
    let prevented = false;
    f.listeners.get("webglcontextlost")({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, false);
    assert.equal(f.frames.size, 0);
    assert.match(errors[1].message, /context lost/);
    assert.throws(() => renderer.resetCamera(), /context lost/);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});

test("reports context loss discovered before the browser event only once", async () => {
  const f = fixture();
  try {
    const errors = [];
    f.canvas.addEventListener("renderererror", (event) =>
      errors.push(event.detail),
    );
    const renderer = await WebGLRenderer.create(f.canvas);
    f.gl.isContextLost = () => true;
    f.flush();
    assert.equal(renderer.lost, true);
    assert.equal(errors.length, 1);
    f.listeners.get("webglcontextlost")({});
    assert.equal(errors.length, 1);
    assert.throws(() => renderer.setModels([]), /context lost/);
    renderer.destroy();
  } finally {
    f.cleanup();
  }
});
