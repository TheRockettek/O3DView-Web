import {
  pointerControls,
  modelBounds,
  focusModel,
  selectionPulse,
  animateSelection,
  wheelZoom,
} from "./camera-controls.js";
import { encodeInteriorLights, MAX_INTERIOR_LIGHTS } from "./light-data.js";

// As in O3DView, O3D positions/normals are reflected on X and triangle order is reversed.
// The O3D file's model.transform is ignored; the desktop viewer does not render with it.
const SHADER = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
  eye: vec4<f32>,
  lightPositions: array<vec4<f32>, 16>,
  lightColors: array<vec4<f32>, 16>,
  lightAmbients: array<vec4<f32>, 16>,
  selection: vec4<f32>,
  sunPosition: vec4<f32>,
  sunColor: vec4<f32>,
  sunAmbient: vec4<f32>,
};
struct ObjectData {
  model: mat4x4<f32>,
  normal: mat4x4<f32>,
  selection: vec4<f32>,
};
struct Material {
  diffuse: vec4<f32>,
  specularPower: vec4<f32>,
  emission: vec4<f32>,
  options: vec4<f32>,
  mapStrengths: vec4<f32>,
  effectMaps: vec4<f32>,
};
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> object: ObjectData;
@group(2) @binding(0) var<uniform> material: Material;
@group(2) @binding(1) var materialSampler: sampler;
@group(2) @binding(2) var materialTexture: texture_2d<f32>;
@group(2) @binding(3) var transTexture: texture_2d<f32>;
@group(2) @binding(4) var nightTexture: texture_2d<f32>;
@group(2) @binding(5) var lightTexture: texture_2d<f32>;
@group(2) @binding(6) var bumpTexture: texture_2d<f32>;
@group(2) @binding(7) var envTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) tangent: vec3<f32>,
  @location(4) binormal: vec3<f32>,
};
@vertex fn vertexMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>
) -> VertexOut {
  var out: VertexOut;
  let world = object.model * vec4<f32>(position, 1.0);
  out.position = camera.viewProjection * world;
  out.world = world.xyz;
  out.normal = (object.normal * vec4<f32>(normal, 0.0)).xyz;
  let tangent = cross(out.normal, vec3<f32>(0.0, 1.0, 0.0));
  out.tangent = tangent * inverseSqrt(max(dot(tangent, tangent), 0.00000001));
  out.binormal = cross(out.normal, out.tangent);
  out.uv = uv;
  return out;
}
fn safeNormal(v: vec3<f32>) -> vec3<f32> {
  return v * inverseSqrt(max(dot(v, v), 0.00000001));
}
@fragment fn fragmentMain(input: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let texel = textureSample(materialTexture, materialSampler, input.uv);
  let night = textureSample(nightTexture, materialSampler, input.uv).rgb;
  let lightmap = textureSample(lightTexture, materialSampler, input.uv).rgb;
  var albedo = select(material.diffuse, texel, material.emission.w > 0.5);
  albedo.a = select(albedo.a, textureSample(transTexture, materialSampler, input.uv).r, material.options.y > 0.5);
  if (material.options.x > 0.5 && albedo.a < 0.5) { discard; }
  var normal = safeNormal(input.normal);
  let bump00 = textureSampleLevel(bumpTexture, materialSampler, input.uv + vec2<f32>(-0.02, 0.0), 0.0).r;
  let bump01 = textureSampleLevel(bumpTexture, materialSampler, input.uv + vec2<f32>(0.0, -0.02), 0.0).r;
  let bump10 = textureSampleLevel(bumpTexture, materialSampler, input.uv + vec2<f32>(0.02, 0.0), 0.0).r;
  let bump11 = textureSampleLevel(bumpTexture, materialSampler, input.uv + vec2<f32>(0.0, 0.02), 0.0).r;
  if (material.effectMaps.x > 0.5) {
    let db = vec2<f32>(bump00 - bump01, bump10 - bump11) * material.effectMaps.z;
    let nt = vec3<f32>(db, 1.0 - length(db));
    normal = input.tangent * nt.x + input.binormal * nt.y + input.normal * nt.z;
  }
  if (!front) { normal = -normal; }
  let light = safeNormal(vec3<f32>(0.5, 0.8, 0.6));
  let view = safeNormal(camera.eye.xyz - input.world);
  let halfVector = safeNormal(light + view);
  let diffuseLight = max(dot(normal, light), 0.0);
  let specular = pow(max(dot(normal, halfVector), 0.0), max(material.specularPower.w, 1.0)) *
    select(0.0, 1.0, diffuseLight > 0.0);
  var color = albedo.rgb;
  if (camera.eye.w < 0.5) {
    color = select(albedo.rgb * (0.25 + 0.75 * diffuseLight) +
      material.specularPower.rgb * specular * 0.5, vec3<f32>(0.0), camera.selection.y > 0.5);
  for (var i = 0u; i < 17u; i++) {
    var position: vec4<f32>;
    var pointColor: vec4<f32>;
    var ambient: vec3<f32>;
    if (i == 16u) {
      position = camera.sunPosition;
      pointColor = camera.sunColor;
      ambient = camera.sunAmbient.rgb;
    } else {
      position = camera.lightPositions[i];
      pointColor = camera.lightColors[i];
      ambient = camera.lightAmbients[i].rgb;
    }
    let delta = position.xyz - input.world;
    let distanceSquared = dot(delta, delta);
    if (pointColor.w > 2.5 && pointColor.w < 3.5) {
      color += albedo.rgb * ambient;
    } else if (pointColor.w > 1.5 && pointColor.w < 2.5) {
      let direction = safeNormal(-position.xyz);
      let ndotl = dot(direction, normal);
      let halfDir = safeNormal(direction + view);
      let directionalSpec = pow(max(dot(halfDir, normal), 0.000001), max(material.specularPower.w, 0.0));
      color += albedo.rgb * (ambient + (ndotl * 0.5 + 0.5) * pointColor.rgb) +
        material.specularPower.rgb * directionalSpec * pointColor.rgb;
    } else if (pointColor.w > 0.5 && pointColor.w < 1.5 && position.w > 0.0 && distanceSquared <= position.w * position.w * 100.0) {
      let direction = safeNormal(delta);
      let ndotl = dot(direction, normal);
      let pointHalf = safeNormal(direction + view);
      let pointSpec = pow(max(dot(pointHalf, normal) * ndotl, 0.000001), max(material.specularPower.w, 0.0));
      let attenuation = position.w / (distanceSquared + 1.0);
      color += (albedo.rgb * (ambient + max(ndotl, 0.0) * pointColor.rgb) + material.specularPower.rgb * pointSpec * pointColor.rgb) * attenuation;
    }
    }
  }
  let envUv = clamp((-view + normal).xy * 0.5 + vec2<f32>(0.5), vec2<f32>(0.01), vec2<f32>(0.99));
  let env = textureSampleLevel(envTexture, materialSampler, envUv, 0.0).rgb;
  if (material.effectMaps.y > 0.5 && material.effectMaps.w > 0.0) {
    color = mix(color, env, clamp(albedo.a * material.effectMaps.w, 0.0, 1.0));
  }
  color += material.emission.rgb * texel.rgb +
    night * material.options.z * material.mapStrengths.x +
    lightmap * material.options.w * material.mapStrengths.y;
  color += vec3<f32>(0.8, 0.8, 0.3) * camera.selection.x * object.selection.x;
  return vec4<f32>(color, albedo.a * material.mapStrengths.z);
}
@fragment fn wireframeFragment(input: VertexOut) -> @location(0) vec4<f32> {
  let texel = textureSample(materialTexture, materialSampler, input.uv);
  var albedo = select(material.diffuse, texel, material.emission.w > 0.5);
  albedo.a = select(albedo.a, textureSample(transTexture, materialSampler, input.uv).r, material.options.y > 0.5);
  if (material.options.x > 0.5 && albedo.a < 0.5) { discard; }
  if (object.selection.x > 0.5) {
    return vec4<f32>(albedo.rgb + vec3<f32>(0.8, 0.8, 0.3) * camera.selection.x, 1.0);
  }
  return vec4<f32>(albedo.rgb, 1.0);
}
`;

const IDENTITY = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);
const FOV = Math.PI / 3;
const MAP_NAMES = [
  "texture",
  "transmap",
  "nightmap",
  "lightmap",
  "bumpmap",
  "envmap",
];
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v) => {
  const len = Math.hypot(...v);
  return len ? v.map((x) => x / len) : [0, 0, 0];
};

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function viewProjection(eye, target, aspect, near, far) {
  const z = normalize(eye.map((v, i) => v - target[i]));
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  const view = new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
  const f = 1 / Math.tan(FOV / 2);
  const projection = new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    far / (near - far),
    -1,
    0,
    0,
    (near * far) / (near - far),
    0,
  ]);
  return multiply(projection, view);
}

function color(value, length, fallback) {
  const result = Array.from({ length }, (_, i) => value?.[i] ?? fallback[i]);
  if (!result.every(Number.isFinite))
    throw new TypeError("Material values must be finite numbers");
  return result;
}

function materialData(material, validateMaps = true) {
  for (const name of validateMaps ? MAP_NAMES : []) {
    const bitmap = material[name];
    if (
      bitmap != null &&
      (typeof ImageBitmap === "undefined" ||
        !(bitmap instanceof ImageBitmap) ||
        !bitmap.width ||
        !bitmap.height)
    ) {
      throw new TypeError(`material.${name} must be a non-empty ImageBitmap`);
    }
  }
  if (
    material.alphaMode !== undefined &&
    ![0, 1, 2].includes(material.alphaMode)
  ) {
    throw new TypeError("alphaMode must be 0, 1, or 2");
  }
  for (const flag of ["noZCheck", "noZWrite"]) {
    if (material[flag] !== undefined && typeof material[flag] !== "boolean") {
      throw new TypeError(`${flag} must be a boolean`);
    }
  }
  for (const name of ["nightmapStrength", "lightmapStrength"]) {
    if (
      material[name] !== undefined &&
      (!Number.isFinite(material[name]) || material[name] < 0)
    ) {
      throw new TypeError(`${name} must be a non-negative finite number`);
    }
    for (const name of ["bumpmapStrength", "envmapStrength"]) {
      if (
        material[name] !== undefined &&
        (!Number.isFinite(material[name]) ||
          !Number.isFinite(Math.fround(material[name])))
      ) {
        throw new TypeError(`${name} must be a finite f32 number`);
      }
    }
    if (
      material.alphaScale !== undefined &&
      (!Number.isFinite(material.alphaScale) ||
        material.alphaScale < 0 ||
        material.alphaScale > 1)
    ) {
      throw new TypeError("alphaScale must be a finite number between 0 and 1");
    }
  }
  const diffuse = color(material.diffuse, 4, [1, 1, 1, 1]);
  const spec = color(material.spec, 3, [0, 0, 0]);
  const emission = color(material.emission, 3, [0, 0, 0]);
  const power = material.specPower ?? 1;
  if (!Number.isFinite(power)) throw new TypeError("specPower must be finite");
  const transparent =
    material.alphaMode === undefined
      ? (material.alphaScale ?? 1) < 1 ||
        material.transmap != null ||
        (material.texture != null
          ? material.textureTransparent !== false
          : diffuse[3] < 1)
      : material.alphaMode === 2;
  return {
    data: new Float32Array([
      ...diffuse,
      ...spec,
      power,
      ...emission,
      material.texture != null ? 1 : 0,
      material.alphaMode === 1 ? 1 : 0,
      material.transmap != null ? 1 : 0,
      material.nightmap != null ? 1 : 0,
      material.lightmap != null ? 1 : 0,
      material.nightmapStrength ?? 0,
      material.lightmapStrength ?? 1,
      material.alphaScale ?? 1,
      0,
      material.bumpmap != null ? 1 : 0,
      material.envmap != null ? 1 : 0,
      material.bumpmapStrength ?? 0,
      material.envmapStrength ?? 0,
    ]),
    transparent,
    textureTransparent: material.textureTransparent,
    noZCheck: material.noZCheck === true,
    noZWrite: material.noZWrite === true,
    depthWrite:
      material.noZWrite !== true &&
      (material.alphaMode !== undefined || !transparent),
  };
}

export class Renderer {
  static async create(canvas) {
    if (!canvas || typeof canvas.getContext !== "function")
      throw new TypeError("A canvas is required");
    if (!globalThis.navigator?.gpu)
      throw new Error("WebGPU is unavailable in this browser or context");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU could not find a compatible adapter");
    const device = await adapter.requestDevice();
    const renderer = new Renderer(canvas, device);
    try {
      await renderer._initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  constructor(canvas, device) {
    this.canvas = canvas;
    this.device = device;
    this.error = null;
    this.lost = false;
    this.destroyed = false;
    this._resources = [];
    this._draws = [];
    this._modelVisibility = [];
    this._wireframe = false;
    this._cullBackfaces = true;
    this._fullbright = false;
    this._modelBounds = [];
    this._objectBuffers = [];
    this._selectedModel = null;
    this._selectionHighlight = true;
    this._lights = encodeInteriorLights([]);
    this._sun = null;
    this._frame = null;
    this._target = [0, 0, 0];
    this._sceneCenter = [0, 0, 0];
    this._radius = 1;
    this._viewRadius = 1;
    this._distance = 3;
    this._yaw = Math.PI / 2;
    this._pitch = 0;
  }

  async _initialize() {
    const device = this.device;
    this.context = this.canvas.getContext("webgpu");
    if (!this.context)
      throw new Error("Could not create a WebGPU canvas context");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format: this.format,
      alphaMode: "opaque",
    });

    this._onGpuError = (event) => {
      event.preventDefault?.();
      this._reportError(event.error || new Error("WebGPU error"));
    };
    device.addEventListener("uncapturederror", this._onGpuError);
    device.lost.then((info) => {
      if (this.destroyed) return;
      this.lost = true;
      if (this._frame !== null) cancelAnimationFrame(this._frame);
      this._frame = null;
      this._reportError(
        new Error(
          `WebGPU device lost (${info.reason || "unknown"}): ${info.message || "no details"}`,
        ),
      );
    });

    const cameraLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    const objectLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    const materialLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      ],
    });
    this._objectLayout = objectLayout;
    this._materialLayout = materialLayout;
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [cameraLayout, objectLayout, materialLayout],
    });
    const module = device.createShaderModule({ code: SHADER });
    const base = {
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 32,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
              { shaderLocation: 2, offset: 24, format: "float32x2" },
            ],
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
    };
    const blend = {
      color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    this._pipelines = new Map();
    const pipelines = [];
    for (const wireframe of [false, true]) {
      for (const transparent of wireframe ? [false] : [false, true]) {
        for (const noZCheck of [false, true]) {
          for (const depthWrite of [false, true]) {
            for (const cull of wireframe ? [false] : [false, true]) {
              const key = `${wireframe}:${transparent}:${noZCheck}:${depthWrite}${cull ? ":cull" : ""}`;
              const descriptor = {
                ...base,
                primitive: wireframe
                  ? { topology: "line-list" }
                  : { ...base.primitive, cullMode: cull ? "back" : "none" },
                fragment: {
                  module,
                  entryPoint: wireframe ? "wireframeFragment" : "fragmentMain",
                  targets: [
                    { format: this.format, ...(transparent ? { blend } : {}) },
                  ],
                },
                depthStencil: {
                  format: "depth24plus",
                  depthWriteEnabled: depthWrite,
                  depthCompare: noZCheck ? "always" : "less-equal",
                },
              };
              pipelines.push(
                device
                  .createRenderPipelineAsync(descriptor)
                  .then((pipeline) => this._pipelines.set(key, pipeline)),
              );
            }
          }
        }
      }
    }
    await Promise.all(pipelines);
    this._opaquePipeline = this._pipelines.get("false:false:false:true");
    this._transparentPipeline = this._pipelines.get("false:true:false:false");
    this._wireframePipeline = this._pipelines.get("true:false:false:true");
    if (this.lost) throw this.error;
    this._cameraBuffer = device.createBuffer({
      size: 144 + MAX_INTERIOR_LIGHTS * 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._cameraGroup = device.createBindGroup({
      layout: cameraLayout,
      entries: [{ binding: 0, resource: { buffer: this._cameraBuffer } }],
    });
    this._sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });
    this._white = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this._white },
      new Uint8Array([255, 255, 255, 255]),
      {},
      [1, 1],
    );
    this._installEvents();
    this._requestFrame();
  }

  _reportError(error) {
    this.error = error;
    if (typeof CustomEvent !== "undefined") {
      this.canvas.dispatchEvent(
        new CustomEvent("renderererror", { detail: error }),
      );
    }
  }

  _installEvents() {
    const controls = pointerControls(this);
    this._pointerDown = controls.down;
    this._pointerMove = controls.move;
    this._pointerUp = controls.up;
    this._keyDown = controls.keyDown;
    this._keyUp = controls.keyUp;
    this._blur = controls.blur;
    this._disposeControls = controls.dispose;
    this._contextMenu = controls.contextMenu;
    this._wheel = (event) => {
      event.preventDefault();
      wheelZoom(this, event);
    };
    this._resize = () => this._requestFrame();
    this.canvas.addEventListener("pointerdown", this._pointerDown);
    this.canvas.addEventListener("pointermove", this._pointerMove);
    this.canvas.addEventListener("pointerup", this._pointerUp);
    this.canvas.addEventListener("pointercancel", this._pointerUp);
    this.canvas.addEventListener("lostpointercapture", this._pointerUp);
    this.canvas.addEventListener("keydown", this._keyDown);
    this.canvas.addEventListener("contextmenu", this._contextMenu);
    this.canvas.addEventListener("wheel", this._wheel, { passive: false });
    if (typeof ResizeObserver !== "undefined") {
      this._observer = new ResizeObserver(this._resize);
      this._observer.observe(this.canvas);
    }

    globalThis.addEventListener?.("resize", this._resize);
  }

  _createMaterialMaps(material, previous, resources) {
    return MAP_NAMES.map((name, i) => {
      const bitmap = material[name] ?? null;
      if (previous?.[i].bitmap === bitmap) return previous[i];
      if (!bitmap) return { bitmap: null, texture: this._white };
      const texture = this.device.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      resources.push(texture);
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [bitmap.width, bitmap.height],
      );
      return { bitmap, texture };
    });
  }

  _createMaterialGroup(buffer, maps) {
    return this.device.createBindGroup({
      layout: this._materialLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this._sampler },
        ...maps.map((map, i) => ({
          binding: i + 2,
          resource: map.texture.createView(),
        })),
      ],
    });
  }

  setModels(models) {
    this._assertUsable();
    if (!Array.isArray(models)) throw new TypeError("models must be an array");
    const resources = [],
      draws = [],
      bounds = [],
      objectBuffers = Array(models.length).fill(null);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    const buffer = (data, usage) => {
      const result = this.device.createBuffer({
        size: Math.max(4, data.byteLength),
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      resources.push(result);
      if (data.byteLength) this.device.queue.writeBuffer(result, 0, data);
      return result;
    };
    try {
      for (const [modelIndex, model] of models.entries()) {
        if (
          !(model.vertices instanceof Float32Array) ||
          model.vertices.length % 8 ||
          !(model.triangles instanceof Uint32Array) ||
          model.triangles.length % 4 ||
          !Array.isArray(model.materials)
        )
          throw new TypeError("Invalid O3D model arrays");
        const verts = new Float32Array(model.vertices);
        for (let i = 0; i < verts.length; i += 8) {
          for (let j = 0; j < 8; j++)
            if (!Number.isFinite(verts[i + j]))
              throw new TypeError("Vertex values must be finite");
          verts[i] = -verts[i];
          verts[i + 3] = -verts[i + 3];
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], verts[i + k]);
            max[k] = Math.max(max[k], verts[i + k]);
          }
        }
        bounds.push(modelBounds(model.vertices));
        const materialStates = model.materials.map((material) =>
          materialData(material || {}),
        );
        const groups = model.materials.map(() => []);
        for (let i = 0; i < model.triangles.length; i += 4) {
          const [a, b, c, material] = model.triangles.subarray(i, i + 4);
          if (
            a >= verts.length / 8 ||
            b >= verts.length / 8 ||
            c >= verts.length / 8 ||
            material >= groups.length
          ) {
            throw new RangeError(
              "Triangle references an invalid vertex or material",
            );
          }
          groups[material].push(c, b, a);
        }
        if (!groups.some((group) => group.length)) continue;
        const vertexBuffer = buffer(verts, GPUBufferUsage.VERTEX);
        const objectData = new Float32Array(36);
        objectData.set(IDENTITY);
        objectData.set(IDENTITY, 16);
        const objectBuffer = buffer(objectData, GPUBufferUsage.UNIFORM);
        objectBuffers[modelIndex] = objectBuffer;
        const objectGroup = this.device.createBindGroup({
          layout: this._objectLayout,
          entries: [{ binding: 0, resource: { buffer: objectBuffer } }],
        });
        for (let i = 0; i < groups.length; i++) {
          if (!groups[i].length) continue;
          const material = model.materials[i] || {};
          const { data, ...state } = materialStates[i];
          const materialBuffer = buffer(data, GPUBufferUsage.UNIFORM);
          const maps = this._createMaterialMaps(material, null, resources);
          const materialGroup = this._createMaterialGroup(materialBuffer, maps);
          const indices = new Uint32Array(groups[i]);
          const indexBuffer = buffer(indices, GPUBufferUsage.INDEX);
          const edges = new Uint32Array(indices.length * 2);
          for (let j = 0; j < indices.length; j += 3) {
            const [a, b, c] = indices.subarray(j, j + 3);
            edges.set([a, b, b, c, c, a], j * 2);
          }
          const edgeBuffer = buffer(edges, GPUBufferUsage.INDEX);
          const center = [0, 0, 0];
          for (const index of indices) {
            for (let k = 0; k < 3; k++)
              center[k] += verts[index * 8 + k] / indices.length;
          }
          draws.push({
            vertexBuffer,
            indexBuffer,
            edgeBuffer,
            count: indices.length,
            objectGroup,
            materialGroup,
            materialBuffer,
            maps,
            modelIndex,
            materialIndex: i,
            center,
            ...state,
          });
        }
      }
    } catch (error) {
      for (const resource of resources) resource.destroy();
      throw error;
    }
    for (const resource of this._resources) resource.destroy();
    this._resources = resources;
    this._draws = draws;
    this._modelVisibility = Array(models.length).fill(true);
    this._modelBounds = bounds;
    this._objectBuffers = objectBuffers;
    this._selectedModel = null;
    if (Number.isFinite(min[0])) {
      this._sceneCenter = min.map((v, i) => (v + max[i]) / 2);
      this._radius = Math.max(
        Math.hypot(...min.map((v, i) => (max[i] - v) / 2)),
        0.001,
      );
    } else {
      this._sceneCenter = [0, 0, 0];
      this._radius = 1;
    }
    this.resetCamera();
  }

  setModelVisible(modelIndex, visible) {
    this._assertUsable();
    if (
      !Number.isInteger(modelIndex) ||
      modelIndex < 0 ||
      modelIndex >= this._modelVisibility.length
    ) {
      throw new RangeError("Invalid model index");
    }

    if (typeof visible !== "boolean")
      throw new TypeError("visible must be a boolean");
    if (this._modelVisibility[modelIndex] === visible) return;
    this._modelVisibility[modelIndex] = visible;
    this._requestFrame();
  }

  setLights(lights, limit = MAX_INTERIOR_LIGHTS) {
    this._assertUsable();
    this._lights = encodeInteriorLights(lights, limit);
    this._requestFrame();
  }

  setSun(light) {
    this._assertUsable();
    this._sun = light === null ? null : encodeInteriorLights([light]);
    this._requestFrame();
  }

  setBackfaceCulling(enabled) {
    this._assertUsable();
    if (typeof enabled !== "boolean")
      throw new TypeError("enabled must be a boolean");
    if (this._cullBackfaces === enabled) return;
    this._cullBackfaces = enabled;
    this._requestFrame();
  }

  setWireframe(enabled) {
    this._assertUsable();
    if (typeof enabled !== "boolean")
      throw new TypeError("enabled must be a boolean");
    if (this._wireframe === enabled) return;
    this._wireframe = enabled;
    this._requestFrame();
  }

  setFullbright(enabled) {
    this._assertUsable();
    if (typeof enabled !== "boolean")
      throw new TypeError("enabled must be a boolean");
    if (this._fullbright === enabled) return;
    this._fullbright = enabled;
    this._requestFrame();
  }

  focusModel(modelIndex) {
    focusModel(this, modelIndex);
  }

  _updateSelection(selected, enabled) {
    const indices = new Set([this._selectedModel, selected]);
    const attempted = [];
    try {
      for (const index of indices) {
        const buffer = this._objectBuffers[index];
        if (!buffer) continue;
        const previous =
          this._selectionHighlight && this._selectedModel === index;
        attempted.push({ buffer, previous });
        this.device.queue.writeBuffer(
          buffer,
          128,
          new Float32Array([enabled && selected === index ? 1 : 0, 0, 0, 0]),
        );
      }
    } catch (error) {
      const errors = [error];
      for (const { buffer, previous } of attempted.reverse()) {
        try {
          this.device.queue.writeBuffer(
            buffer,
            128,
            new Float32Array([previous ? 1 : 0, 0, 0, 0]),
          );
        } catch (rollbackError) {
          errors.push(rollbackError);
        }
      }
      if (errors.length > 1)
        throw new AggregateError(
          errors,
          "Selection update failed and renderer rollback was incomplete",
        );
      throw error;
    }
    this._selectedModel = selected;
    this._selectionHighlight = enabled;
    this._requestFrame();
  }

  setSelectedModel(index) {
    this._assertUsable();
    if (
      index !== null &&
      (!Number.isInteger(index) ||
        index < 0 ||
        index >= this._modelVisibility.length)
    ) {
      throw new RangeError("Invalid selected model index");
    }
    if (index !== this._selectedModel)
      this._updateSelection(index, this._selectionHighlight);
  }

  setSelectionHighlight(enabled) {
    this._assertUsable();
    if (typeof enabled !== "boolean")
      throw new TypeError("enabled must be a boolean");
    if (enabled !== this._selectionHighlight)
      this._updateSelection(this._selectedModel, enabled);
  }

  updateMaterial(modelIndex, materialIndex, material) {
    this._assertUsable();
    // Omitted maps retain their uploaded textures; null explicitly clears a map.
    const matching = this._draws.filter(
      (draw) =>
        draw.modelIndex === modelIndex && draw.materialIndex === materialIndex,
    );
    materialData(material);
    const resources = [],
      updates = [];
    try {
      for (const draw of matching) {
        const effective = { ...material };
        for (const [i, name] of MAP_NAMES.entries()) {
          if (effective[name] === undefined)
            effective[name] = draw.maps?.[i].bitmap ?? null;
        }
        if (
          material.texture === undefined &&
          material.textureTransparent === undefined
        ) {
          effective.textureTransparent = draw.textureTransparent;
        }
        const { data, ...state } = materialData(effective, false);
        const changed = MAP_NAMES.some(
          (name, i) =>
            (effective[name] ?? null) !== (draw.maps?.[i].bitmap ?? null),
        );
        const maps = changed
          ? this._createMaterialMaps(effective, draw.maps, resources)
          : draw.maps;
        const group = changed
          ? this._createMaterialGroup(draw.materialBuffer, maps)
          : draw.materialGroup;
        updates.push({ draw, data, state, maps, group, changed });
      }
    } catch (error) {
      for (const resource of resources) resource.destroy();
      throw error;
    }
    for (const { draw, data, state, maps, group, changed } of updates) {
      this.device.queue.writeBuffer(draw.materialBuffer, 0, data);
      if (changed) {
        for (const old of draw.maps || []) {
          if (
            old.texture !== this._white &&
            !maps.some((map) => map.texture === old.texture)
          ) {
            const index = this._resources.indexOf(old.texture);
            if (index !== -1) this._resources.splice(index, 1);
            old.texture.destroy();
          }
        }
        draw.maps = maps;
        draw.materialGroup = group;
      }
      Object.assign(draw, state);
    }
    this._resources.push(...resources);
    this._requestFrame();
  }

  resetCamera() {
    this._assertUsable();
    this._target = [...this._sceneCenter];
    this._viewRadius = this._radius;
    this._yaw = Math.PI / 2;
    this._pitch = 0;
    const aspect =
      (this.canvas.clientWidth || this.canvas.width || 1) /
      (this.canvas.clientHeight || this.canvas.height || 1);
    const halfAngle = Math.atan(Math.tan(FOV / 2) * Math.min(aspect, 1));
    this._distance = (this._radius / Math.sin(halfAngle)) * 1.1;
    this._requestFrame();
  }

  _assertUsable() {
    if (this.destroyed) throw new Error("Renderer has been destroyed");
    if (this.lost) throw this.error || new Error("WebGPU device has been lost");
  }

  _requestFrame() {
    if (this.destroyed || this.lost || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      try {
        this._render();
        if (animateSelection(this)) this._requestFrame();
      } catch (error) {
        this._reportError(error);
      }
    });
  }

  _render() {
    if (this.destroyed || this.lost) return;
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const limit = this.device.limits.maxTextureDimension2D;
    const scale = Math.min(ratio, limit / width, limit / height);
    let w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    if (!this._depth || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      // An intrinsically sized canvas changes its CSS size when its attributes change.
      // Avoid feeding device-pixel scaling back into its layout on every resize.
      if (
        this.canvas.clientWidth !== width ||
        this.canvas.clientHeight !== height
      ) {
        w = Math.min(limit, Math.max(1, Math.round(width)));
        h = Math.min(limit, Math.max(1, Math.round(height)));
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this._depth?.destroy();
      this._depth = this.device.createTexture({
        size: [w, h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const cp = Math.cos(this._pitch);
    const eye = [
      this._target[0] + this._distance * Math.cos(this._yaw) * cp,
      this._target[1] + this._distance * Math.sin(this._pitch),
      this._target[2] + this._distance * Math.sin(this._yaw) * cp,
    ];
    const sceneDistance = Math.hypot(
      ...eye.map((value, i) => value - this._sceneCenter[i]),
    );
    const near = Math.max(
      this._viewRadius * 0.0001,
      sceneDistance - this._radius * 1.5,
    );
    const far = Math.max(
      near + this._viewRadius,
      sceneDistance + this._radius * 2,
    );
    const camera = new Float32Array(36 + MAX_INTERIOR_LIGHTS * 12);
    camera.set(viewProjection(eye, this._target, w / h, near, far));
    camera.set(eye, 16);
    camera[19] = this._fullbright ? 1 : 0;
    camera.set(this._lights.positions, 20);
    camera.set(this._lights.colors, 20 + MAX_INTERIOR_LIGHTS * 4);
    camera.set(this._lights.ambients, 20 + MAX_INTERIOR_LIGHTS * 8);
    camera[20 + MAX_INTERIOR_LIGHTS * 12] = selectionPulse();
    camera[21 + MAX_INTERIOR_LIGHTS * 12] = this._sun ? 1 : 0;
    if (this._sun) {
      const offset = 24 + MAX_INTERIOR_LIGHTS * 12;
      camera.set(this._sun.positions.subarray(0, 4), offset);
      camera.set(this._sun.colors.subarray(0, 4), offset + 4);
      camera.set(this._sun.ambients.subarray(0, 4), offset + 8);
    }
    this.device.queue.writeBuffer(this._cameraBuffer, 0, camera);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.12, g: 0.14, b: 0.17, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this._depth.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setBindGroup(0, this._cameraGroup);
    const opaque = this._draws.filter(
      (draw) => this._modelVisibility[draw.modelIndex] && !draw.transparent,
    );
    const transparent = this._draws.filter(
      (draw) => this._modelVisibility[draw.modelIndex] && draw.transparent,
    );
    const cameraBack = normalize(
      eye.map((value, i) => value - this._target[i]),
    );
    transparent.sort((a, b) => {
      const distance = (p) =>
        -dot(
          p.map((value, i) => value - eye[i]),
          cameraBack,
        );
      return distance(b.center) - distance(a.center);
    });
    for (const draw of [...opaque, ...transparent]) {
      const depthWrite = this._wireframe ? !draw.noZWrite : draw.depthWrite;
      const key =
        `${this._wireframe}:${this._wireframe ? false : draw.transparent}:${!!draw.noZCheck}:${depthWrite}` +
        (this._cullBackfaces && !this._wireframe ? ":cull" : "");
      const pipeline =
        this._pipelines?.get(key) ??
        (this._wireframe
          ? this._wireframePipeline
          : draw.transparent
            ? this._transparentPipeline
            : this._opaquePipeline);
      pass.setPipeline(pipeline);
      pass.setBindGroup(1, draw.objectGroup);
      pass.setBindGroup(2, draw.materialGroup);
      pass.setVertexBuffer(0, draw.vertexBuffer);
      pass.setIndexBuffer(
        this._wireframe ? draw.edgeBuffer : draw.indexBuffer,
        "uint32",
      );
      pass.drawIndexed(this._wireframe ? draw.count * 2 : draw.count);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._disposeControls?.();
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._observer?.disconnect();
    globalThis.removeEventListener?.("resize", this._resize);
    if (this._pointer && this.canvas.hasPointerCapture?.(this._pointer.id))
      this.canvas.releasePointerCapture(this._pointer.id);
    for (const [name, handler] of [
      ["pointerdown", this._pointerDown],
      ["pointermove", this._pointerMove],
      ["pointerup", this._pointerUp],
      ["pointercancel", this._pointerUp],
      ["lostpointercapture", this._pointerUp],
      ["keydown", this._keyDown],
      ["wheel", this._wheel],
      ["contextmenu", this._contextMenu],
    ])
      if (handler) this.canvas.removeEventListener(name, handler);
    if (this._onGpuError)
      this.device.removeEventListener("uncapturederror", this._onGpuError);
    for (const resource of this._resources) resource.destroy();
    this._resources = [];
    this._draws = [];
    this._modelVisibility = [];
    this._depth?.destroy();
    this._white?.destroy();
    this._cameraBuffer?.destroy();
    this.context?.unconfigure();
    this.device.destroy();
  }
}
