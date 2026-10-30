import test from "node:test";
import assert from "node:assert/strict";
import { Renderer } from "../src/renderer.js";

test("WebGPU defaults to desktop back-face culling", () => {
  const renderer = new Renderer({}, { queue: { writeBuffer() {} } });
  assert.equal(renderer._cullBackfaces, true);
});

test("updating a material changes the matching GPU uniform without resetting the camera", () => {
  const writes = [];
  const renderer = new Renderer(
    {},
    { queue: { writeBuffer: (...args) => writes.push(args) } },
  );
  const buffer = {};
  renderer._draws = [
    {
      modelIndex: 0,
      materialIndex: 1,
      materialBuffer: buffer,
      transparent: false,
    },
    { modelIndex: 1, materialIndex: 1, materialBuffer: {}, transparent: false },
  ];
  let frames = 0;
  renderer._requestFrame = () => {
    frames++;
  };
  renderer._distance = 42;
  renderer.updateMaterial(0, 1, {
    diffuse: [0.2, 0.3, 0.4, 0.5],
    spec: [1, 2, 3],
    emission: [4, 5, 6],
    specPower: 9,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], buffer);
  assert.deepEqual(
    Array.from(writes[0][2]).map((n) => Math.round(n * 10) / 10),
    [
      0.2, 0.3, 0.4, 0.5, 1, 2, 3, 9, 4, 5, 6, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
      0, 0,
    ],
  );
  assert.equal(renderer._draws[0].transparent, true);
  assert.equal(renderer._draws[1].transparent, false);
  assert.equal(renderer._distance, 42);
  assert.equal(frames, 1);
  renderer.updateMaterial(0, 1, {
    diffuse: [1, 1, 1, 1],
    spec: [0, 0, 0],
    emission: [0, 0, 0],
    specPower: 1,
    textureTransparent: false,
  });
  assert.equal(renderer._draws[0].transparent, false);
});

test("invalid material values do not update GPU state", () => {
  const renderer = new Renderer(
    {},
    { queue: { writeBuffer: () => assert.fail("unexpected write") } },
  );
  renderer._draws = [{ modelIndex: 0, materialIndex: 0 }];
  assert.throws(
    () =>
      renderer.updateMaterial(0, 0, {
        diffuse: [NaN, 1, 1, 1],
        spec: [0, 0, 0],
        emission: [0, 0, 0],
        specPower: 1,
      }),
    /finite/,
  );
});

test("WebGPU alpha scale updates the uniform and automatic blending", () => {
  const writes = [];
  const renderer = new Renderer(
    {},
    { queue: { writeBuffer: (...args) => writes.push(args) } },
  );
  renderer._draws = [{ modelIndex: 0, materialIndex: 0, materialBuffer: {} }];
  renderer._requestFrame = () => {};
  renderer.updateMaterial(0, 0, { alphaScale: 0.25 });
  assert.equal(writes[0][2][18], 0.25);
  assert.equal(renderer._draws[0].transparent, true);
  renderer.updateMaterial(0, 0, { alphaScale: 0.25, alphaMode: 1 });
  assert.equal(renderer._draws[0].transparent, false);
  assert.throws(
    () => renderer.updateMaterial(0, 0, { alphaScale: -0.1 }),
    /alphaScale/,
  );
  assert.throws(
    () => renderer.updateMaterial(0, 0, { alphaScale: 1.1 }),
    /alphaScale/,
  );
});

test("model visibility filters opaque and transparent draws without rebuilding or moving the camera", () => {
  const savedUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { COPY_DST: 1, VERTEX: 2, UNIFORM: 4, INDEX: 8 };
  const rendered = [],
    deleted = [];
  let indexBuffer;
  const pass = {
    setBindGroup() {},
    setPipeline() {},
    setVertexBuffer() {},
    setIndexBuffer(value) {
      indexBuffer = value;
    },
    drawIndexed() {
      rendered.push(indexBuffer);
    },
    end() {},
  };
  const device = {
    limits: { maxTextureDimension2D: 4096 },
    queue: { writeBuffer() {}, submit() {} },
    createBuffer: () => ({
      destroy() {
        deleted.push(this);
      },
    }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
    destroy() {},
  };
  const canvas = {
    width: 100,
    height: 100,
    clientWidth: 100,
    clientHeight: 100,
  };
  const renderer = new Renderer(canvas, device);
  renderer._white = { createView: () => ({}), destroy() {} };
  renderer._depth = { createView: () => ({}), destroy() {} };
  renderer.context = {
    getCurrentTexture: () => ({ createView: () => ({}) }),
    unconfigure() {},
  };
  let frames = 0;
  renderer._requestFrame = () => {
    frames++;
  };
  const model = (materials) => ({
    vertices: new Float32Array([
      1, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0, 0, 1, 2, 1]),
    materials,
  });

  const source = model([{}, { diffuse: [1, 1, 1, 0.5] }]);
  const other = model([{}, { diffuse: [1, 1, 1, 0.5] }]);
  const empty = {
    vertices: new Float32Array(),
    triangles: new Uint32Array(),
    materials: [],
  };
  const originalVertices = source.vertices.slice(),
    originalTriangles = source.triangles.slice();
  const render = () => {
    rendered.length = 0;
    renderer._render();
    return [...rendered];
  };
  try {
    renderer.setModels([source, other, empty]);
    assert.deepEqual(renderer._modelBounds[0].center, [-1.5, 0.5, 0]);
    assert.equal(renderer._modelBounds[2], null);
    const center = [...renderer._target];
    renderer._target = [100, 100, 100];
    renderer.resetCamera();
    assert.deepEqual(renderer._target, center);
    const draws = renderer._draws,
      resources = renderer._resources;
    const buffers = draws.map((draw) => draw.indexBuffer);
    assert.deepEqual(render(), [
      buffers[0],
      buffers[2],
      buffers[1],
      buffers[3],
    ]);
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
    const frameCount = frames;
    renderer.setModelVisible(0, false);
    assert.equal(frames, frameCount + 1);
    assert.deepEqual(render(), [buffers[2], buffers[3]]);
    renderer.setModelVisible(0, false);
    assert.equal(frames, frameCount + 1);
    renderer.setModelVisible(1, false);
    assert.deepEqual(render(), []);
    renderer.setModelVisible(1, true);
    renderer.updateMaterial(0, 0, { diffuse: [1, 1, 1, 0.5] });
    assert.deepEqual(render(), [buffers[2], buffers[3]]);
    renderer.setModelVisible(2, false);
    renderer.setModelVisible(0, true);
    assert.deepEqual(render(), [
      buffers[2],
      buffers[0],
      buffers[1],
      buffers[3],
    ]);
    assert.equal(renderer._draws, draws);
    assert.equal(renderer._resources, resources);
    assert.equal(deleted.length, 0);
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
    assert.deepEqual(source.vertices, originalVertices);
    assert.deepEqual(source.triangles, originalTriangles);
    for (const index of [-1, 3, 0.5, "0", NaN])
      assert.throws(() => renderer.setModelVisible(index, false), RangeError);
    assert.throws(() => renderer.setModelVisible(0, 0), TypeError);
    renderer.setModelVisible(0, false);
    const bad = model([{}, {}]);
    bad.triangles[0] = 100;
    assert.throws(() => renderer.setModels([bad]), /invalid vertex/);
    assert.deepEqual(renderer._modelBounds[0].center, [-1.5, 0.5, 0]);
    assert.deepEqual(render(), [buffers[2], buffers[3]]);
    renderer.setModels([source, other, empty]);
    assert.deepEqual(renderer._modelVisibility, [true, true, true]);
    assert.equal(render().length, 4);
    renderer.setModels([]);
    assert.deepEqual(render(), []);
    assert.throws(() => renderer.setModelVisible(0, true), RangeError);
    renderer.lost = true;
    assert.throws(() => renderer.setModelVisible(0, false), /lost/);
    renderer.lost = false;
    renderer.destroy();
    assert.throws(() => renderer.setModelVisible(0, false), /destroyed/);
  } finally {
    globalThis.GPUBufferUsage = savedUsage;
  }
});

test("WebGPU uploads interior lights in the camera uniform", () => {
  const writes = [];
  const pass = { setBindGroup() {}, end() {} };
  const device = {
    limits: { maxTextureDimension2D: 4096 },
    queue: { writeBuffer: (...args) => writes.push(args), submit() {} },
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
  };
  const renderer = new Renderer(
    { width: 100, height: 100, clientWidth: 100, clientHeight: 100 },
    device,
  );
  renderer._depth = { createView: () => ({}) };
  renderer.context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
  renderer._requestFrame = () => {};
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
  ]);
  renderer._render();
  const data = writes[0][2];
  assert.equal(data.length, 228);
  assert.deepEqual([...data.slice(20, 24)], [1, 2, 3, 4]);
  assert.deepEqual([...data.slice(24, 28)], [0, -1, 0, 4]);
  assert.deepEqual([...data.slice(84, 92)], [0.5, 1, 2, 1, 1, 1, 1, 2]);
  assert.ok([...data.slice(92, 148)].every((value) => value === 0));
  assert.deepEqual([...data.slice(148, 152)], [0.5, 1, 2, 0]);
  assert.ok([...data.slice(156, 212)].every((value) => value === 0));
  assert.ok(data[212] >= 0 && data[212] <= 1);
  assert.equal(data[213], 0);
  assert.ok([...data.slice(216)].every((value) => value === 0));
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
  renderer._render();
  const sun = writes.at(-1)[2];
  assert.equal(sun[213], 1);
  assert.deepEqual([...sun.slice(216, 220)], [0, -1, 0, 1000]);
  assert.deepEqual([...sun.slice(220, 224)], [2, 1, 0, 2]);
  assert.deepEqual([...sun.slice(224, 228)], [0.5, 0, 0, 0]);
});

test("WebGPU selection updates per-model uniforms and rolls back failed writes", () => {
  const writes = [],
    buffers = [{}, {}];
  let fail = false,
    frames = 0;
  const renderer = new Renderer(
    {},
    {
      queue: {
        writeBuffer(buffer, offset, data) {
          writes.push([buffers.indexOf(buffer), offset, data[0]]);
          if (fail && buffer === buffers[1] && data[0] === 1)
            throw new Error("upload failed");
        },
      },
    },
  );
  renderer._modelVisibility = [true, true];
  renderer._objectBuffers = buffers;
  renderer._requestFrame = () => {
    frames++;
  };
  renderer.setSelectedModel(0);
  assert.deepEqual(writes.splice(0), [[0, 128, 1]]);
  fail = true;
  assert.throws(() => renderer.setSelectedModel(1), /upload failed/);
  assert.equal(renderer._selectedModel, 0);
  assert.deepEqual(writes.splice(0), [
    [0, 128, 0],
    [1, 128, 1],
    [1, 128, 0],
    [0, 128, 1],
  ]);
  fail = false;
  renderer.setSelectionHighlight(false);
  assert.deepEqual(writes.splice(0), [[0, 128, 0]]);
  renderer.setSelectedModel(1);
  assert.deepEqual(writes.splice(0), [
    [0, 128, 0],
    [1, 128, 0],
  ]);
  renderer.setSelectionHighlight(true);
  assert.deepEqual(writes.splice(0), [[1, 128, 1]]);
  assert.equal(frames, 4);
  assert.throws(() => renderer.setSelectedModel(2), RangeError);
  assert.throws(() => renderer.setSelectionHighlight("yes"), TypeError);
});

test("WebGPU fullbright uses the camera uniform and preserves its setting across renders", () => {
  const writes = [];
  const pass = { setBindGroup() {}, end() {} };
  const device = {
    limits: { maxTextureDimension2D: 4096 },
    queue: { writeBuffer: (...args) => writes.push(args), submit() {} },
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
  };
  const renderer = new Renderer(
    { width: 100, height: 100, clientWidth: 100, clientHeight: 100 },
    device,
  );
  renderer._depth = { createView: () => ({}) };
  renderer.context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
  let frames = 0;
  renderer._requestFrame = () => {
    frames++;
  };
  renderer.setFullbright(true);
  renderer.setFullbright(true);
  assert.equal(frames, 1);
  renderer._render();
  assert.equal(writes.at(-1)[2][19], 1);
  renderer.setFullbright(false);
  renderer._render();
  assert.equal(writes.at(-1)[2][19], 0);
  assert.throws(() => renderer.setFullbright(1), TypeError);
});

test("wireframe uses line indices and an opaque pipeline while preserving materials and visibility", () => {
  const savedUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { COPY_DST: 1, VERTEX: 2, UNIFORM: 4, INDEX: 8 };
  const uploads = [],
    rendered = [],
    deleted = [];
  let pipeline, indexBuffer;
  const pass = {
    setBindGroup() {},
    setVertexBuffer() {},
    setPipeline(value) {
      pipeline = value;
    },
    setIndexBuffer(value) {
      indexBuffer = value;
    },
    drawIndexed(count) {
      rendered.push({ pipeline, indexBuffer, count });
    },
    end() {},
  };
  const device = {
    limits: { maxTextureDimension2D: 4096 },
    queue: {
      writeBuffer(buffer, offset, data) {
        uploads.push({ buffer, data: data.slice() });
      },
      submit() {},
    },
    createBuffer: () => ({
      destroy() {
        deleted.push(this);
      },
    }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
    destroy() {},
  };
  const renderer = new Renderer(
    { width: 100, height: 100, clientWidth: 100, clientHeight: 100 },
    device,
  );
  renderer._white = { createView: () => ({}), destroy() {} };
  renderer._depth = { createView: () => ({}), destroy() {} };
  renderer.context = {
    getCurrentTexture: () => ({ createView: () => ({}) }),
    unconfigure() {},
  };
  ((renderer._opaquePipeline = {}),
    (renderer._transparentPipeline = {}),
    (renderer._wireframePipeline = {}));
  let frames = 0;
  renderer._requestFrame = () => {
    frames++;
  };
  const source = {
    vertices: new Float32Array([
      1, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0, 0, 2, 1, 1]),
    materials: [{}, { diffuse: [0.2, 0.3, 0.4, 0.5] }],
  };
  const render = () => {
    rendered.length = 0;
    renderer._render();
    return [...rendered];
  };
  try {
    renderer.setModels([source, source]);
    const draws = renderer._draws,
      resources = renderer._resources;
    const edgeData = draws.map(
      (draw) =>
        uploads.find((upload) => upload.buffer === draw.edgeBuffer).data,
    );
    assert.deepEqual(Array.from(edgeData[0]), [2, 1, 1, 0, 0, 2]);
    assert.deepEqual(Array.from(edgeData[1]), [1, 2, 2, 0, 0, 1]);
    renderer.setModelVisible(1, false);
    renderer._distance = 42;
    const count = frames;
    renderer.setWireframe(true);
    renderer.setWireframe(true);
    assert.equal(frames, count + 1);
    assert.deepEqual(
      render(),
      draws.slice(0, 2).map((draw) => ({
        pipeline: renderer._wireframePipeline,
        indexBuffer: draw.edgeBuffer,
        count: 6,
      })),
    );
    renderer.updateMaterial(0, 1, { diffuse: [0.7, 0.6, 0.5, 0.3] });
    renderer.setWireframe(false);
    assert.deepEqual(render(), [
      {
        pipeline: renderer._opaquePipeline,
        indexBuffer: draws[0].indexBuffer,
        count: 3,
      },
      {
        pipeline: renderer._transparentPipeline,
        indexBuffer: draws[1].indexBuffer,
        count: 3,
      },
    ]);
    assert.equal(draws[1].transparent, true);
    assert.equal(renderer._draws, draws);
    assert.equal(renderer._resources, resources);
    assert.equal(deleted.length, 0);
    assert.equal(renderer._distance, 42);
    assert.deepEqual(renderer._modelVisibility, [true, false]);
    assert.throws(() => renderer.setWireframe(1), TypeError);
    renderer.setWireframe(true);
    renderer.setModels([source]);
    assert.ok(draws.every((draw) => deleted.includes(draw.edgeBuffer)));
    assert.equal(renderer._wireframe, true);
    renderer.lost = true;
    assert.throws(() => renderer.setWireframe(false), /lost/);
    renderer.lost = false;
    renderer.destroy();
    assert.throws(() => renderer.setWireframe(false), /destroyed/);
  } finally {
    globalThis.GPUBufferUsage = savedUsage;
  }
});

test("WebGPU creates a line-list pipeline without polygon-mode features", async () => {
  const saved = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    GPUShaderStage: globalThis.GPUShaderStage,
    GPUBufferUsage: globalThis.GPUBufferUsage,
    GPUTextureUsage: globalThis.GPUTextureUsage,
  };
  const pipelines = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "rgba8unorm" } },
  });
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
  const device = {
    addEventListener() {},
    lost: new Promise(() => {}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: (descriptor) => descriptor,
    createRenderPipelineAsync: async (descriptor) => {
      pipelines.push(descriptor);
      return descriptor;
    },
    createBuffer: () => ({}),
    createBindGroup: () => ({}),
    createSampler: () => ({}),
    createTexture: () => ({}),
    queue: { writeTexture() {} },
  };
  const renderer = new Renderer(
    { getContext: () => ({ configure() {} }) },
    device,
  );
  renderer._installEvents = () => {};
  renderer._requestFrame = () => {};
  try {
    await renderer._initialize();
    assert.equal(pipelines.length, 20);
    for (const [key, pipeline] of renderer._pipelines) {
      const noZCheck = key.split(":")[2] === "true";
      assert.equal(
        pipeline.depthStencil.depthCompare,
        noZCheck ? "always" : "less-equal",
      );
      if (pipeline.primitive.topology === "triangle-list") {
        assert.equal(
          pipeline.primitive.cullMode,
          key.endsWith(":cull") ? "back" : "none",
        );
      }
    }
    const wire = pipelines.filter((p) => p.primitive.topology === "line-list");
    assert.equal(wire.length, 4);
    for (const pipeline of wire) {
      assert.equal(pipeline.fragment.entryPoint, "wireframeFragment");
      assert.equal(pipeline.fragment.targets[0].blend, undefined);
      assert.match(
        pipeline.fragment.module.code,
        /return vec4<f32>\(albedo\.rgb, 1\.0\)/,
      );
    }
  } finally {
    if (saved.navigator)
      Object.defineProperty(globalThis, "navigator", saved.navigator);
    else delete globalThis.navigator;
    Object.assign(globalThis, {
      GPUShaderStage: saved.GPUShaderStage,
      GPUBufferUsage: saved.GPUBufferUsage,
      GPUTextureUsage: saved.GPUTextureUsage,
    });
  }
});

test("CFG alpha and depth combinations select pipelines, queues, and cutout uniforms", async () => {
  const saved = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    GPUShaderStage: globalThis.GPUShaderStage,
    GPUBufferUsage: globalThis.GPUBufferUsage,
    GPUTextureUsage: globalThis.GPUTextureUsage,
    ImageBitmap: globalThis.ImageBitmap,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "rgba8unorm" } },
  });
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
  globalThis.GPUBufferUsage = { COPY_DST: 1, VERTEX: 2, UNIFORM: 4, INDEX: 8 };
  globalThis.GPUTextureUsage = {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
  };
  globalThis.ImageBitmap = class ImageBitmap {
    width = 1;
    height = 1;
  };
  const uploads = [],
    rendered = [],
    deleted = [];
  let pipeline, indexBuffer;
  const pass = {
    setBindGroup() {},
    setVertexBuffer() {},
    setPipeline(value) {
      pipeline = value;
    },
    setIndexBuffer(value) {
      indexBuffer = value;
    },
    drawIndexed(count) {
      rendered.push({ pipeline, indexBuffer, count });
    },
    end() {},
  };
  const resource = () => ({
    destroy() {
      deleted.push(this);
    },
    createView: () => ({}),
  });
  const device = {
    limits: { maxTextureDimension2D: 4096 },
    lost: new Promise(() => {}),
    addEventListener() {},
    removeEventListener() {},
    destroy() {},
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: (x) => x,
    createRenderPipelineAsync: async (descriptor) => descriptor,
    createBuffer: resource,
    createBindGroup: () => ({}),
    createSampler: () => ({}),
    createTexture: resource,
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(buffer, offset, data) {
        uploads.push({ buffer, data: data.slice() });
      },
      writeTexture() {},
      copyExternalImageToTexture() {},
      submit() {},
    },
  };
  const canvas = {
    width: 100,
    height: 100,
    clientWidth: 100,
    clientHeight: 100,
    getContext: () => ({
      configure() {},
      unconfigure() {},
      getCurrentTexture: () => resource(),
    }),
  };
  const renderer = new Renderer(canvas, device);
  renderer._installEvents = () => {};
  renderer._requestFrame = () => {};
  const model = (materials) => ({
    vertices: new Float32Array([
      0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1,
    ]),
    triangles: new Uint32Array(materials.flatMap((_, i) => [0, 1, 2, i])),
    materials,
  });

  const render = () => {
    rendered.length = 0;
    renderer._render();
    return [...rendered];
  };
  try {
    await renderer._initialize();
    const materials = [];
    for (const alphaMode of [undefined, 0, 1, 2]) {
      for (const noZCheck of [false, true]) {
        for (const noZWrite of [false, true]) {
          materials.push({
            alphaMode,
            noZCheck,
            noZWrite,
            diffuse: [1, 1, 1, 0.3],
          });
        }
      }
    }
    renderer.setModels([model(materials)]);
    for (const [i, draw] of renderer._draws.entries()) {
      const material = materials[i];
      const transparent =
        material.alphaMode === undefined || material.alphaMode === 2;
      assert.equal(draw.transparent, transparent);
      assert.equal(
        draw.depthWrite,
        !material.noZWrite && material.alphaMode !== undefined,
      );
      assert.equal(draw.noZCheck, material.noZCheck);
      assert.equal(draw.noZWrite, material.noZWrite);
      assert.equal(
        uploads.find((x) => x.buffer === draw.materialBuffer).data[12],
        material.alphaMode === 1 ? 1 : 0,
      );
    }
    const draws = renderer._draws;
    const result = render();
    assert.deepEqual(
      result.map((x) =>
        draws.findIndex((d) => d.indexBuffer === x.indexBuffer),
      ),
      [4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 12, 13, 14, 15],
    );
    for (const item of result) {
      const draw = draws.find((d) => d.indexBuffer === item.indexBuffer);
      assert.equal(
        item.pipeline.depthStencil.depthCompare,
        draw.noZCheck ? "always" : "less-equal",
      );
      assert.equal(
        item.pipeline.depthStencil.depthWriteEnabled,
        draw.depthWrite,
      );
      assert.equal(!!item.pipeline.fragment.targets[0].blend, draw.transparent);
      if (draw.transparent)
        assert.deepEqual(item.pipeline.fragment.targets[0].blend, {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        });
    }
    draws[0].center = [0, 0, 2];
    draws[12].center = [0, 0, -2];
    const sorted = render().map((x) =>
      draws.findIndex((d) => d.indexBuffer === x.indexBuffer),
    );
    assert.ok(
      sorted.indexOf(12) < sorted.indexOf(0),
      "transparent draws are sorted back-to-front",
    );
    draws[0].center = draws[12].center = [0, 0, 0];
    const shader = result[0].pipeline.fragment.module.code;
    assert.equal(
      (shader.match(/material\.options\.x > 0\.5 && albedo\.a < 0\.5/g) || [])
        .length,
      2,
    );
    assert.equal((shader.match(/discard;/g) || []).length, 2);
    renderer.setBackfaceCulling(true);
    for (const item of render())
      assert.equal(item.pipeline.primitive.cullMode, "back");
    renderer.setWireframe(true);
    for (const item of render()) {
      const draw = draws.find((d) => d.edgeBuffer === item.indexBuffer);
      assert.equal(item.count, draw.count * 2);
      assert.equal(item.pipeline.primitive.topology, "line-list");
      assert.equal(
        item.pipeline.depthStencil.depthCompare,
        draw.noZCheck ? "always" : "less-equal",
      );
      assert.equal(
        item.pipeline.depthStencil.depthWriteEnabled,
        !draw.noZWrite,
      );
      assert.equal(item.pipeline.fragment.targets[0].blend, undefined);
    }
    renderer.setWireframe(false);
    for (const item of render())
      assert.equal(item.pipeline.primitive.cullMode, "back");
    renderer.setBackfaceCulling(false);
    for (const item of render())
      assert.equal(item.pipeline.primitive.cullMode, "none");
    const texture = new ImageBitmap();
    for (const [material, transparent, depthWrite] of [
      [{ texture, textureTransparent: false }, false, true],
      [{ texture, textureTransparent: true }, true, false],
      [{ texture }, true, false],
      [{ texture, alphaMode: 0 }, false, true],
      [{ texture, alphaMode: 1, noZWrite: true }, false, false],
      [{ texture, alphaMode: 2, noZCheck: true }, true, true],
      [{ texture: null, diffuse: [1, 1, 1, 1] }, false, true],
    ]) {
      renderer.updateMaterial(0, 0, material);
      const draw = draws[0];
      assert.equal(draw.transparent, transparent);
      assert.equal(draw.depthWrite, depthWrite);
      assert.equal(draw.noZCheck, material.noZCheck === true);
      assert.equal(draw.noZWrite, material.noZWrite === true);
      const item = render().find((x) => x.indexBuffer === draw.indexBuffer);
      assert.equal(item.pipeline.depthStencil.depthWriteEnabled, depthWrite);
      assert.equal(
        item.pipeline.depthStencil.depthCompare,
        material.noZCheck ? "always" : "less-equal",
      );
      assert.equal(!!item.pipeline.fragment.targets[0].blend, transparent);
    }
    const writes = uploads.length,
      oldDraws = renderer._draws,
      oldResources = renderer._resources,
      oldDeleted = deleted.length;
    for (const bad of [
      { alphaMode: null },
      { alphaMode: -1 },
      { alphaMode: 3 },
      { alphaMode: 1.5 },
      { alphaMode: "1" },
      { alphaMode: NaN },
      { alphaMode: Infinity },
      { alphaMode: true },
      { noZCheck: null },
      { noZCheck: 1 },
      { noZWrite: "false" },
      { noZWrite: null },
    ]) {
      assert.throws(() => renderer.updateMaterial(0, 0, bad), TypeError);
      assert.throws(() => renderer.setModels([model([bad])]), TypeError);
      const unused = model([{}, bad]);
      unused.triangles = new Uint32Array([0, 1, 2, 0]);
      assert.throws(() => renderer.setModels([unused]), TypeError);
    }
    assert.equal(uploads.length, writes);
    assert.equal(renderer._draws, oldDraws);
    assert.equal(renderer._resources, oldResources);
    assert.equal(deleted.length, oldDeleted);
    assert.throws(
      () => renderer.setModels([model([{}]), model([{ alphaMode: 3 }])]),
      TypeError,
    );
    assert.equal(renderer._draws, oldDraws);
    assert.equal(renderer._resources, oldResources);
    assert.ok(deleted.length > oldDeleted);
    assert.ok(oldResources.every((resource) => !deleted.includes(resource)));
    renderer.setModels([
      model([
        { texture, textureTransparent: false },
        { texture, alphaMode: 1, noZCheck: true, noZWrite: true },
        { texture, alphaMode: 2 },
      ]),
    ]);
    assert.deepEqual(
      renderer._draws.map((draw) => [
        draw.transparent,
        draw.noZCheck,
        draw.depthWrite,
      ]),
      [
        [false, false, true],
        [false, true, false],
        [true, false, true],
      ],
    );
    renderer.destroy();
  } finally {
    if (saved.navigator)
      Object.defineProperty(globalThis, "navigator", saved.navigator);
    else delete globalThis.navigator;
    Object.assign(globalThis, {
      GPUShaderStage: saved.GPUShaderStage,
      GPUBufferUsage: saved.GPUBufferUsage,
      GPUTextureUsage: saved.GPUTextureUsage,
      ImageBitmap: saved.ImageBitmap,
    });
  }
});

test("static maps bind, classify, update transactionally, and clean up", async () => {
  const saved = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    GPUShaderStage: globalThis.GPUShaderStage,
    GPUBufferUsage: globalThis.GPUBufferUsage,
    GPUTextureUsage: globalThis.GPUTextureUsage,
    ImageBitmap: globalThis.ImageBitmap,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "rgba8unorm" } },
  });
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
  globalThis.GPUBufferUsage = { COPY_DST: 1, VERTEX: 2, UNIFORM: 4, INDEX: 8 };
  globalThis.GPUTextureUsage = {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
  };
  globalThis.ImageBitmap = class ImageBitmap {
    width = 2;
    height = 2;
  };
  const deleted = [],
    uploads = [],
    copies = [],
    groups = [],
    pipelines = [];
  let failCopy = false,
    boundGroup,
    indexBuffer,
    pipeline;
  const rendered = [];
  const resource = () => ({
    destroy() {
      deleted.push(this);
    },
    createView() {
      return { texture: this };
    },
  });
  const pass = {
    setBindGroup(index, group) {
      if (index === 2) boundGroup = group;
    },
    setVertexBuffer() {},
    setIndexBuffer(value) {
      indexBuffer = value;
    },
    setPipeline(value) {
      pipeline = value;
    },
    drawIndexed() {
      rendered.push({ indexBuffer, pipeline, boundGroup });
    },
    end() {},
  };
  const device = {
    limits: { maxTextureDimension2D: 4096 },
    lost: new Promise(() => {}),
    addEventListener() {},
    removeEventListener() {},
    destroy() {},
    createBindGroupLayout: (x) => x,
    createPipelineLayout: (x) => x,
    createShaderModule: (x) => x,
    createRenderPipelineAsync: async (descriptor) => {
      pipelines.push(descriptor);
      return descriptor;
    },
    createBuffer: resource,
    createBindGroup: (descriptor) => {
      groups.push(descriptor);
      return descriptor;
    },
    createSampler: () => ({}),
    createTexture: resource,
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(buffer, offset, data) {
        uploads.push({ buffer, data: data.slice() });
      },
      writeTexture() {},
      submit() {},
      copyExternalImageToTexture(source, destination) {
        if (failCopy) throw new Error("upload failed");
        copies.push({ source: source.source, texture: destination.texture });
      },
    },
  };
  const canvas = {
    width: 100,
    height: 100,
    clientWidth: 100,
    clientHeight: 100,
    getContext: () => ({
      configure() {},
      unconfigure() {},
      getCurrentTexture: resource,
    }),
  };
  const renderer = new Renderer(canvas, device);
  renderer._installEvents = () => {};
  renderer._requestFrame = () => {};
  const model = (materials) => ({
    vertices: new Float32Array([
      0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1,
    ]),
    triangles: new Uint32Array(materials.flatMap((_, i) => [0, 1, 2, i])),
    materials,
  });
  const render = () => {
    rendered.length = 0;
    renderer._render();
    return [...rendered];
  };
  try {
    await renderer._initialize();
    const [base, trans, night, light, bump, env] = Array.from(
      { length: 6 },
      () => new ImageBitmap(),
    );
    renderer.setModels([
      model([
        {
          texture: base,
          textureTransparent: false,
          transmap: trans,
          nightmap: night,
          lightmap: light,
          bumpmap: bump,
          envmap: env,
          bumpmapStrength: -2,
          envmapStrength: 0.75,
        },
        { transmap: trans, alphaMode: 1, noZCheck: true, noZWrite: true },
        { transmap: trans, alphaMode: 0 },
        { transmap: trans, alphaMode: 2 },
        { nightmap: night, lightmap: light },
      ]),
    ]);
    const draws = renderer._draws;
    assert.deepEqual(
      draws.map((d) => [d.transparent, d.depthWrite]),
      [
        [true, false],
        [false, false],
        [false, true],
        [true, true],
        [false, true],
      ],
    );
    assert.deepEqual(
      draws[0].maps.map((m) => m.bitmap),
      [base, trans, night, light, bump, env],
    );
    assert.deepEqual(
      copies.slice(0, 6).map((c) => c.source),
      [base, trans, night, light, bump, env],
    );
    assert.deepEqual(
      draws[0].materialGroup.entries.slice(2).map((e) => e.binding),
      [2, 3, 4, 5, 6, 7],
    );
    assert.deepEqual(
      Array.from(
        uploads
          .find((u) => u.buffer === draws[0].materialBuffer)
          .data.slice(11),
      ),
      [1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, -2, 0.75],
    );
    const shader = pipelines[0].fragment.module.code;
    assert.equal(
      (
        shader.match(
          /albedo\.a = select\(albedo\.a, textureSample\(transTexture/g,
        ) || []
      ).length,
      2,
    );
    assert.equal(
      (
        shader.match(
          /night \* material\.options\.z \* material\.mapStrengths\.x/g,
        ) || []
      ).length,
      1,
    );
    assert.equal(
      (
        shader.match(
          /lightmap \* material\.options\.w \* material\.mapStrengths\.y/g,
        ) || []
      ).length,
      1,
    );
    assert.ok(shader.indexOf("albedo.a = select") < shader.indexOf("discard;"));
    assert.ok(
      shader.indexOf("discard;") <
        shader.indexOf("albedo.a * material.mapStrengths.z"),
    );
    assert.match(shader, /cross\(out\.normal, vec3<f32>\(0\.0, 1\.0, 0\.0\)\)/);
    assert.match(
      shader,
      /vec2<f32>\(bump00 - bump01, bump10 - bump11\) \* material\.effectMaps\.z/,
    );
    assert.match(
      shader,
      /input\.tangent \* nt\.x \+ input\.binormal \* nt\.y \+ input\.normal \* nt\.z/,
    );
    assert.match(
      shader,
      /clamp\(\(-view \+ normal\)\.xy \* 0\.5 \+ vec2<f32>\(0\.5\)/,
    );
    assert.match(
      shader,
      /clamp\(albedo\.a \* material\.effectMaps\.w, 0\.0, 1\.0\)/,
    );
    assert.ok(
      shader.indexOf("color = mix(color, env") <
        shader.indexOf("color += material.emission"),
    );
    assert.equal(render().length, 5);
    renderer.setModelVisible(0, false);
    assert.equal(render().length, 0);
    renderer.setModelVisible(0, true);
    renderer.setWireframe(true);
    assert.ok(
      render().every(
        (item) =>
          item.pipeline.primitive.topology === "line-list" &&
          !item.pipeline.fragment.targets[0].blend,
      ),
    );
    renderer.setWireframe(false);

    const oldGroup = draws[0].materialGroup,
      oldMaps = draws[0].maps;
    const oldCopyCount = copies.length;
    base.width = 0;
    renderer.updateMaterial(0, 0, {
      nightmapStrength: 0.75,
      lightmapStrength: 2,
      bumpmapStrength: -0.5,
      envmapStrength: 2,
    });
    assert.equal(draws[0].materialGroup, oldGroup);
    assert.equal(draws[0].maps, oldMaps);
    assert.equal(copies.length, oldCopyCount);
    assert.equal(draws[0].transparent, true);
    assert.deepEqual(Array.from(uploads.at(-1).data.slice(16, 18)), [0.75, 2]);
    assert.deepEqual(
      Array.from(uploads.at(-1).data.slice(20)),
      [1, 1, -0.5, 2],
    );
    renderer.updateMaterial(0, 0, { transmap: null });
    assert.equal(draws[0].transparent, false);
    assert.equal(draws[0].depthWrite, true);
    assert.equal(draws[0].maps[1].texture, renderer._white);
    assert.deepEqual(
      draws[0].maps.map((m) => m.bitmap),
      [base, null, night, light, bump, env],
    );
    assert.ok(deleted.includes(oldMaps[1].texture));
    assert.ok(!deleted.includes(oldMaps[0].texture));
    assert.equal(uploads.at(-1).data[13], 0);

    const replacement = new ImageBitmap();
    renderer.updateMaterial(0, 0, {
      bumpmap: replacement,
      envmap: null,
      bumpmapStrength: -1,
      envmapStrength: -3,
    });
    assert.equal(draws[0].maps[4].bitmap, replacement);
    assert.equal(draws[0].maps[5].texture, renderer._white);
    assert.ok(deleted.includes(oldMaps[4].texture));
    assert.ok(deleted.includes(oldMaps[5].texture));
    assert.deepEqual(Array.from(uploads.at(-1).data.slice(20)), [1, 0, -1, -3]);
    assert.ok(!deleted.includes(oldMaps[2].texture));
    const stableGroup = draws[0].materialGroup,
      stableMaps = draws[0].maps,
      stableResources = [...renderer._resources];
    const writes = uploads.length;
    for (const name of [
      "texture",
      "transmap",
      "nightmap",
      "lightmap",
      "bumpmap",
      "envmap",
    ]) {
      assert.throws(
        () => renderer.updateMaterial(0, 0, { [name]: {} }),
        /ImageBitmap/,
      );
      assert.throws(
        () => renderer.setModels([model([{ [name]: {} }])]),
        /ImageBitmap/,
      );
      const empty = new ImageBitmap();
      empty.width = 0;
      assert.throws(
        () => renderer.updateMaterial(0, 0, { [name]: empty }),
        /ImageBitmap/,
      );
      assert.throws(
        () => renderer.setModels([model([{ [name]: empty }])]),
        /ImageBitmap/,
      );
    }
    for (const name of ["bumpmapStrength", "envmapStrength"]) {
      for (const value of [NaN, Infinity, -Infinity, 1e100, null, "1"]) {
        assert.throws(
          () => renderer.updateMaterial(0, 0, { [name]: value }),
          TypeError,
        );
        assert.throws(
          () => renderer.setModels([model([{ [name]: value }])]),
          TypeError,
        );
      }
    }
    for (const name of ["nightmapStrength", "lightmapStrength"]) {
      for (const value of [-1, NaN, Infinity, null, "1"]) {
        assert.throws(
          () => renderer.updateMaterial(0, 0, { [name]: value }),
          TypeError,
        );
        assert.throws(
          () => renderer.setModels([model([{ [name]: value }])]),
          TypeError,
        );
      }
    }
    failCopy = true;
    const deletedBeforeFailure = deleted.length;
    assert.throws(
      () => renderer.updateMaterial(0, 0, { envmap: new ImageBitmap() }),
      /upload failed/,
    );
    failCopy = false;
    assert.equal(deleted.length, deletedBeforeFailure + 1);
    assert.equal(draws[0].materialGroup, stableGroup);
    assert.equal(draws[0].maps, stableMaps);
    assert.deepEqual(renderer._resources, stableResources);
    assert.equal(uploads.length, writes);
    assert.ok(stableResources.every((r) => !deleted.includes(r)));
    renderer.lost = true;
    assert.throws(
      () => renderer.updateMaterial(0, 0, { transmap: null }),
      /lost/,
    );
    renderer.lost = false;
    renderer.setModels([]);
    assert.ok(stableResources.every((r) => deleted.includes(r)));
    renderer.destroy();
    assert.throws(() => renderer.updateMaterial(0, 0, {}), /destroyed/);
  } finally {
    if (saved.navigator)
      Object.defineProperty(globalThis, "navigator", saved.navigator);
    else delete globalThis.navigator;
    Object.assign(globalThis, {
      GPUShaderStage: saved.GPUShaderStage,
      GPUBufferUsage: saved.GPUBufferUsage,
      GPUTextureUsage: saved.GPUTextureUsage,
      ImageBitmap: saved.ImageBitmap,
    });
  }
});
