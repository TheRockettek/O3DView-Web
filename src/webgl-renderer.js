import {
  pointerControls,
  modelBounds,
  focusModel,
  selectionPulse,
  animateSelection,
  wheelZoom,
} from "./camera-controls.js";
import { encodeInteriorLights, MAX_INTERIOR_LIGHTS } from "./light-data.js";

// O3D coordinates are reflected on X and triangle winding is reversed, as in renderer.js.
const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
uniform mat4 viewProjection;
out vec3 worldPosition;
out vec3 worldNormal;
out vec2 texCoord;
out vec3 tangent;
out vec3 binormal;
void main() {
  worldPosition = position;
  worldNormal = normal;
  vec3 t = cross(normal, vec3(0.0, 1.0, 0.0));
  tangent = t * inversesqrt(max(dot(t, t), 0.00000001));
  binormal = cross(normal, tangent);
  texCoord = uv;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 worldPosition;
in vec3 worldNormal;
in vec2 texCoord;
in vec3 tangent;
in vec3 binormal;
uniform vec3 eye;
uniform vec4 diffuse;
uniform vec4 specularPower;
uniform vec4 emission;
uniform sampler2D materialTexture;
uniform sampler2D transmapTexture;
uniform sampler2D nightmapTexture;
uniform sampler2D lightmapTexture;
uniform sampler2D bumpmapTexture;
uniform sampler2D envmapTexture;
uniform bool useTransmap;
uniform bool useNightmap;
uniform bool useLightmap;
uniform bool useBumpmap;
uniform bool useEnvmap;
uniform float nightmapStrength;
uniform float lightmapStrength;
uniform float bumpmapStrength;
uniform float envmapStrength;
uniform float alphaScale;
uniform bool wireframe;
uniform bool fullbright;
uniform bool selected;
uniform float selectionPulse;
uniform bool cutout;
uniform vec4 pointPositions[16];
uniform vec4 pointColors[16];
uniform vec4 pointAmbients[16];
uniform bool useDesktopSun;
uniform vec4 sunPosition;
uniform vec4 sunColor;
uniform vec4 sunAmbient;
out vec4 fragmentColor;
vec3 safeNormal(vec3 v) {
  return v * inversesqrt(max(dot(v, v), 0.00000001));
}
void main() {
  vec4 texel = texture(materialTexture, texCoord);
  vec4 albedo = emission.w > 0.5 ? texel : diffuse;
  if (useTransmap) albedo.a = texture(transmapTexture, texCoord).r;
  if (cutout && albedo.a < 0.5) discard;
  if (wireframe) {
    if (selected) fragmentColor = vec4(albedo.rgb + vec3(0.8, 0.8, 0.3) * selectionPulse, 1.0);
    else fragmentColor = vec4(albedo.rgb, 1.0);
    return;
  }
  vec3 n = safeNormal(worldNormal);
  if (useBumpmap) {
    float bump00 = textureLod(bumpmapTexture, texCoord + vec2(-0.02, 0.0), 0.0).r;
    float bump01 = textureLod(bumpmapTexture, texCoord + vec2(0.0, -0.02), 0.0).r;
    float bump10 = textureLod(bumpmapTexture, texCoord + vec2(0.02, 0.0), 0.0).r;
    float bump11 = textureLod(bumpmapTexture, texCoord + vec2(0.0, 0.02), 0.0).r;
    vec2 db = vec2(bump00 - bump01, bump10 - bump11) * bumpmapStrength;
    vec3 nt = vec3(db, 1.0 - length(db));
    n = tangent * nt.x + binormal * nt.y + worldNormal * nt.z;
  }
  if (!gl_FrontFacing) n = -n;
  vec3 light = safeNormal(vec3(0.5, 0.8, 0.6));
  vec3 view = safeNormal(eye - worldPosition);
  vec3 halfVector = safeNormal(light + view);
  float diffuseLight = max(dot(n, light), 0.0);
  float specular = pow(max(dot(n, halfVector), 0.0), max(specularPower.w, 1.0)) *
    (diffuseLight > 0.0 ? 1.0 : 0.0);
  vec3 color = albedo.rgb;
  if (!fullbright) {
    color = useDesktopSun ? vec3(0.0) : albedo.rgb * (0.25 + 0.75 * diffuseLight) +
      specularPower.rgb * specular * 0.5;
  for (int i = 0; i < 17; i++) {
    vec4 position = i == 16 ? sunPosition : pointPositions[i];
    vec4 pointColor = i == 16 ? sunColor : pointColors[i];
    vec3 ambient = i == 16 ? sunAmbient.rgb : pointAmbients[i].rgb;
    vec3 delta = position.xyz - worldPosition;
    float distanceSquared = dot(delta, delta);
    if (pointColor.w > 2.5 && pointColor.w < 3.5) {
      color += albedo.rgb * ambient;
    } else if (pointColor.w > 1.5 && pointColor.w < 2.5) {
      vec3 direction = safeNormal(-position.xyz);
      float ndotl = dot(direction, n);
      vec3 halfDir = safeNormal(direction + view);
      float directionalSpec = pow(max(dot(halfDir, n), 0.000001), max(specularPower.w, 0.0));
      color += albedo.rgb * (ambient + (ndotl * 0.5 + 0.5) * pointColor.rgb) +
        specularPower.rgb * directionalSpec * pointColor.rgb;
    } else if (pointColor.w > 0.5 && pointColor.w < 1.5 && position.w > 0.0 && distanceSquared <= position.w * position.w * 100.0) {
      vec3 direction = safeNormal(delta);
      float ndotl = dot(direction, n);
      vec3 pointHalf = safeNormal(direction + view);
      float pointSpec = pow(max(dot(pointHalf, n) * ndotl, 0.000001), max(specularPower.w, 0.0));
      float attenuation = position.w / (distanceSquared + 1.0);
      color += (albedo.rgb * (ambient + max(ndotl, 0.0) * pointColor.rgb) + specularPower.rgb * pointSpec * pointColor.rgb) * attenuation;
    }
    }
  }
  if (useEnvmap && envmapStrength > 0.0) {
    vec2 envUv = clamp((-view + n).xy * 0.5 + 0.5, 0.01, 0.99);
    vec3 env = textureLod(envmapTexture, envUv, 0.0).rgb;
    color = mix(color, env, clamp(albedo.a * envmapStrength, 0.0, 1.0));
  }
  color += emission.rgb * texel.rgb;
  if (useNightmap) color += texture(nightmapTexture, texCoord).rgb * nightmapStrength;
  if (useLightmap) color += texture(lightmapTexture, texCoord).rgb * lightmapStrength;
  if (selected) color += vec3(0.8, 0.8, 0.3) * selectionPulse;
  fragmentColor = vec4(color, albedo.a * alphaScale);
}`;

const FOV = Math.PI / 3;
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

function viewProjection(eye, target, aspect, near, far) {
  const z = normalize(eye.map((v, i) => v - target[i]));
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  const view = [
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
  ];
  const f = 1 / Math.tan(FOV / 2);
  // WebGL uses a -1..1 clip-space depth range, unlike WebGPU.
  const projection = [
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
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * near * far) / (near - far),
    0,
  ];
  const result = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      result[c * 4 + r] =
        projection[r] * view[c * 4] +
        projection[4 + r] * view[c * 4 + 1] +
        projection[8 + r] * view[c * 4 + 2] +
        projection[12 + r] * view[c * 4 + 3];
    }
  return result;
}

function materialData(material) {
  material ||= {};
  const color = (value, fallback) => {
    const result = fallback.map((v, i) => value?.[i] ?? v);
    if (!result.every(Number.isFinite))
      throw new TypeError("Material values must be finite numbers");
    return result;
  };
  const diffuse = color(material.diffuse, [1, 1, 1, 1]);
  const spec = color(material.spec, [0, 0, 0]);
  const emission = color(material.emission, [0, 0, 0]);
  const power = material.specPower ?? 1;
  if (!Number.isFinite(power)) throw new TypeError("specPower must be finite");
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
    if (
      material.alphaScale !== undefined &&
      (!Number.isFinite(material.alphaScale) ||
        material.alphaScale < 0 ||
        material.alphaScale > 1)
    ) {
      throw new TypeError("alphaScale must be a finite number between 0 and 1");
    }
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
  for (const name of [
    "texture",
    "transmap",
    "nightmap",
    "lightmap",
    "bumpmap",
    "envmap",
  ]) {
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
  return {
    diffuse,
    specularPower: [...spec, power],
    emission: [...emission, material.texture != null ? 1 : 0],
    bitmap: material.texture ?? null,
    transmap: material.transmap ?? null,
    nightmap: material.nightmap ?? null,
    lightmap: material.lightmap ?? null,
    bumpmap: material.bumpmap ?? null,
    envmap: material.envmap ?? null,
    nightmapStrength: material.nightmapStrength ?? 0,
    lightmapStrength: material.lightmapStrength ?? 1,
    bumpmapStrength: material.bumpmapStrength ?? 0,
    envmapStrength: material.envmapStrength ?? 0,
    alphaScale: material.alphaScale ?? 1,
    alphaMode: material.alphaMode,
    noZCheck: material.noZCheck === true,
    noZWrite: material.noZWrite === true,
    transparent:
      material.alphaMode === undefined
        ? (material.alphaScale ?? 1) < 1 ||
          material.transmap != null ||
          (material.texture != null
            ? material.textureTransparent !== false
            : diffuse[3] < 1)
        : material.alphaMode === 2,
  };
}

export class WebGLRenderer {
  static async create(canvas) {
    if (!canvas || typeof canvas.getContext !== "function")
      throw new TypeError("A canvas is required");
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      depth: true,
      antialias: false,
    });
    if (!gl)
      throw new Error("WebGL 2 is unavailable in this browser or context");
    const renderer = new WebGLRenderer(canvas, gl);
    try {
      renderer._initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
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

  _initialize() {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Could not create WebGL shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`WebGL shader compilation failed: ${message}`);
      }
      return shader;
    };
    let vertex, fragment;
    try {
      vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      this._program = gl.createProgram();
      if (!this._program) throw new Error("Could not create WebGL program");
      gl.attachShader(this._program, vertex);
      gl.attachShader(this._program, fragment);
      gl.linkProgram(this._program);
      if (!gl.getProgramParameter(this._program, gl.LINK_STATUS)) {
        throw new Error(
          `WebGL program linking failed: ${gl.getProgramInfoLog(this._program)}`,
        );
      }
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
    this._uniforms = Object.fromEntries(
      [
        "viewProjection",
        "eye",
        "diffuse",
        "specularPower",
        "emission",
        "materialTexture",
        "transmapTexture",
        "nightmapTexture",
        "lightmapTexture",
        "useTransmap",
        "useNightmap",
        "useLightmap",
        "bumpmapTexture",
        "envmapTexture",
        "useBumpmap",
        "useEnvmap",
        "nightmapStrength",
        "lightmapStrength",
        "bumpmapStrength",
        "envmapStrength",
        "alphaScale",
        "wireframe",
        "fullbright",
        "selected",
        "selectionPulse",
        "cutout",
        "pointPositions[0]",
        "pointColors[0]",
        "pointAmbients[0]",
        "useDesktopSun",
        "sunPosition",
        "sunColor",
        "sunAmbient",
      ].map((name) => [name, gl.getUniformLocation(this._program, name)]),
    );
    this._white = this._createTexture(null, this._resources);
    this._installEvents();
    this._requestFrame();
  }

  _checkGL(operation) {
    const code = this.gl.getError();
    if (code !== this.gl.NO_ERROR)
      throw new Error(`WebGL ${operation} failed (0x${code.toString(16)})`);
  }

  _createTexture(bitmap, resources) {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Could not create WebGL texture");
    resources.push({ type: "texture", value: texture });
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (bitmap) {
      // ImageBitmap ignores WebGL's unpack alpha setting; a canvas source lets WebGL
      // upload straight alpha, matching WebGPU's default external-image copy.
      const source =
        typeof OffscreenCanvas === "function"
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : document.createElement("canvas");
      source.width = bitmap.width;
      source.height = bitmap.height;
      const context = source.getContext("2d");
      if (!context) throw new Error("Could not prepare WebGL texture");
      context.drawImage(bitmap, 0, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
    } else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255]),
      );
    this._checkGL("texture upload");
    return texture;
  }

  _dispose(resources) {
    for (const resource of resources) {
      if (resource.type === "buffer") this.gl.deleteBuffer(resource.value);
      else if (resource.type === "texture")
        this.gl.deleteTexture(resource.value);
      else if (resource.type === "vao")
        this.gl.deleteVertexArray(resource.value);
    }
  }

  _createMaterialTextures(material, resources) {
    return Object.fromEntries(
      [
        ["texture", material.bitmap],
        ["transmapTexture", material.transmap],
        ["nightmapTexture", material.nightmap],
        ["lightmapTexture", material.lightmap],
        ["bumpmapTexture", material.bumpmap],
        ["envmapTexture", material.envmap],
      ].map(([name, bitmap]) => [
        name,
        bitmap ? this._createTexture(bitmap, resources) : this._white,
      ]),
    );
  }

  _reportError(error) {
    this.error = error;
    if (typeof CustomEvent !== "undefined")
      this.canvas.dispatchEvent(
        new CustomEvent("renderererror", { detail: error }),
      );
  }

  _markLost() {
    if (this.destroyed || this.lost) return;
    this.lost = true;
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._reportError(new Error("WebGL 2 context lost; reload to continue"));
  }

  _installEvents() {
    this._contextLost = () => this._markLost();
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
    for (const [name, handler] of this._eventHandlers())
      this.canvas.addEventListener(
        name,
        handler,
        name === "wheel" ? { passive: false } : undefined,
      );
    if (typeof ResizeObserver !== "undefined") {
      this._observer = new ResizeObserver(this._resize);
      this._observer.observe(this.canvas);
    }
    globalThis.addEventListener?.("resize", this._resize);
  }

  _eventHandlers() {
    return [
      ["webglcontextlost", this._contextLost],
      ["pointerdown", this._pointerDown],
      ["pointermove", this._pointerMove],
      ["pointerup", this._pointerUp],
      ["pointercancel", this._pointerUp],
      ["lostpointercapture", this._pointerUp],
      ["keydown", this._keyDown],
      ["wheel", this._wheel],
      ["contextmenu", this._contextMenu],
    ];
  }

  setModels(models) {
    this._assertUsable();
    if (!Array.isArray(models)) throw new TypeError("models must be an array");
    const gl = this.gl,
      resources = [],
      draws = [],
      bounds = [];
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    const buffer = (target, data) => {
      const value = gl.createBuffer();
      if (!value) throw new Error("Could not create WebGL buffer");
      resources.push({ type: "buffer", value });
      gl.bindBuffer(target, value);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      this._checkGL("buffer upload");
      return value;
    };
    try {
      for (const [modelIndex, model] of models.entries()) {
        if (
          !model ||
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
        const materials = model.materials.map(materialData);
        const groups = materials.map(() => []);
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
        const vertexBuffer = buffer(gl.ARRAY_BUFFER, verts);
        for (let i = 0; i < groups.length; i++) {
          if (!groups[i].length) continue;
          const material = materials[i];
          const textures = this._createMaterialTextures(material, resources);
          const vao = gl.createVertexArray();
          if (!vao) throw new Error("Could not create WebGL vertex array");
          resources.push({ type: "vao", value: vao });
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
          for (const [location, size, offset] of [
            [0, 3, 0],
            [1, 3, 12],
            [2, 2, 24],
          ]) {
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
          }
          const indices = new Uint32Array(groups[i]);
          const indexBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, indices);
          const edges = new Uint32Array(indices.length * 2);
          for (let j = 0; j < indices.length; j += 3) {
            const [a, b, c] = indices.subarray(j, j + 3);
            edges.set([a, b, b, c, c, a], j * 2);
          }
          const edgeBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, edges);
          const center = [0, 0, 0];
          for (const index of indices)
            for (let k = 0; k < 3; k++)
              center[k] += verts[index * 8 + k] / indices.length;
          draws.push({
            vao,
            indexBuffer,
            edgeBuffer,
            ...textures,
            material,
            transparent: material.transparent,
            count: indices.length,
            modelIndex,
            materialIndex: i,
            center,
          });
        }
      }
      gl.bindVertexArray(null);
    } catch (error) {
      gl.bindVertexArray(null);
      this._dispose(resources);
      throw error;
    }
    this._dispose(
      this._resources.filter((resource) => resource.value !== this._white),
    );
    this._resources = [
      this._resources.find((resource) => resource.value === this._white),
      ...resources,
    ];
    this._draws = draws;
    this._modelVisibility = Array(models.length).fill(true);
    this._modelBounds = bounds;
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
    if (this._selectedModel === index) return;
    this._selectedModel = index;
    this._requestFrame();
  }

  setSelectionHighlight(enabled) {
    this._assertUsable();
    if (typeof enabled !== "boolean")
      throw new TypeError("enabled must be a boolean");
    if (this._selectionHighlight === enabled) return;
    this._selectionHighlight = enabled;
    this._requestFrame();
  }

  updateMaterial(modelIndex, materialIndex, value) {
    this._assertUsable();
    const material = materialData(value);
    const matching = this._draws.filter(
      (draw) =>
        draw.modelIndex === modelIndex && draw.materialIndex === materialIndex,
    );
    if (matching.length) {
      if (
        matching.every((draw) =>
          [
            "bitmap",
            "transmap",
            "nightmap",
            "lightmap",
            "bumpmap",
            "envmap",
          ].every((name) => draw.material[name] === material[name]),
        )
      ) {
        for (const draw of matching) {
          draw.material = material;
          draw.transparent = material.transparent;
        }
        this._requestFrame();
        return;
      }
      const resources = [];
      let textures;
      try {
        textures = this._createMaterialTextures(material, resources);
      } catch (error) {
        this._dispose(resources);
        throw error;
      }
      for (const draw of matching) {
        for (const name of [
          "texture",
          "transmapTexture",
          "nightmapTexture",
          "lightmapTexture",
          "bumpmapTexture",
          "envmapTexture",
        ]) {
          if (draw[name] === this._white) continue;
          const index = this._resources.findIndex(
            (resource) => resource.value === draw[name],
          );
          if (index >= 0) this._dispose(this._resources.splice(index, 1));
        }
        draw.material = material;
        Object.assign(draw, textures);
        draw.transparent = material.transparent;
      }
      this._resources.push(...resources);
    }
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
    if (!this.lost && this.gl.isContextLost()) this._markLost();
    if (this.lost)
      throw this.error || new Error("WebGL 2 context has been lost");
  }

  _requestFrame() {
    if (this.destroyed || this.lost || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      try {
        this._render();
        if (animateSelection(this)) this._requestFrame();
      } catch (error) {
        if (this.gl.isContextLost()) this._markLost();
        else this._reportError(error);
      }
    });
  }

  _render() {
    if (this.destroyed || this.lost) return;
    if (this.gl.isContextLost()) {
      this._markLost();
      return;
    }
    const gl = this.gl,
      width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    const viewportLimit = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const scale = Math.min(
      globalThis.devicePixelRatio || 1,
      limit / width,
      limit / height,
      viewportLimit[0] / width,
      viewportLimit[1] / height,
    );
    let w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (
        this.canvas.clientWidth !== width ||
        this.canvas.clientHeight !== height
      ) {
        w = Math.max(1, Math.min(limit, viewportLimit[0], Math.round(width)));
        h = Math.max(1, Math.min(limit, viewportLimit[1], Math.round(height)));
        this.canvas.width = w;
        this.canvas.height = h;
      }
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
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.12, 0.14, 0.17, 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    if (this._cullBackfaces && !this._wireframe) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.useProgram(this._program);
    gl.uniformMatrix4fv(
      this._uniforms.viewProjection,
      false,
      viewProjection(eye, this._target, w / h, near, far),
    );
    gl.uniform3fv(this._uniforms.eye, eye);
    gl.uniform4fv(this._uniforms["pointPositions[0]"], this._lights.positions);
    gl.uniform4fv(this._uniforms["pointColors[0]"], this._lights.colors);
    gl.uniform4fv(this._uniforms["pointAmbients[0]"], this._lights.ambients);
    gl.uniform1i(this._uniforms.useDesktopSun, this._sun ? 1 : 0);
    gl.uniform4fv(
      this._uniforms.sunPosition,
      this._sun ? this._sun.positions.subarray(0, 4) : [0, 0, 0, 0],
    );
    gl.uniform4fv(
      this._uniforms.sunColor,
      this._sun ? this._sun.colors.subarray(0, 4) : [0, 0, 0, 0],
    );
    gl.uniform4fv(
      this._uniforms.sunAmbient,
      this._sun ? this._sun.ambients.subarray(0, 4) : [0, 0, 0, 0],
    );
    for (const [unit, name] of [
      "materialTexture",
      "transmapTexture",
      "nightmapTexture",
      "lightmapTexture",
      "bumpmapTexture",
      "envmapTexture",
    ].entries()) {
      gl.uniform1i(this._uniforms[name], unit);
    }
    gl.uniform1i(this._uniforms.wireframe, this._wireframe ? 1 : 0);
    gl.uniform1i(this._uniforms.fullbright, this._fullbright ? 1 : 0);
    gl.uniform1f(this._uniforms.selectionPulse, selectionPulse());
    const opaque = this._draws.filter(
      (draw) => this._modelVisibility[draw.modelIndex] && !draw.transparent,
    );
    const transparent = this._draws.filter(
      (draw) => this._modelVisibility[draw.modelIndex] && draw.transparent,
    );
    const cameraBack = normalize(
      eye.map((value, i) => value - this._target[i]),
    );
    const distance = (p) =>
      -dot(
        p.map((value, i) => value - eye[i]),
        cameraBack,
      );
    transparent.sort((a, b) => distance(b.center) - distance(a.center));
    for (const draw of [...opaque, ...transparent]) {
      gl.uniform1i(
        this._uniforms.selected,
        this._selectionHighlight && this._selectedModel === draw.modelIndex
          ? 1
          : 0,
      );
      gl.depthFunc(draw.material.noZCheck ? gl.ALWAYS : gl.LEQUAL);
      if (draw.transparent && !this._wireframe) {
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(
          gl.SRC_ALPHA,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        );
      } else {
        gl.disable(gl.BLEND);
      }
      gl.depthMask(
        !draw.material.noZWrite &&
          (this._wireframe ||
            draw.material.alphaMode !== undefined ||
            !draw.transparent),
      );
      gl.uniform1i(
        this._uniforms.cutout,
        draw.material.alphaMode === 1 ? 1 : 0,
      );
      gl.uniform4fv(this._uniforms.diffuse, draw.material.diffuse);
      gl.uniform4fv(this._uniforms.specularPower, draw.material.specularPower);
      gl.uniform4fv(this._uniforms.emission, draw.material.emission);
      gl.uniform1f(
        this._uniforms.nightmapStrength,
        draw.material.nightmapStrength,
      );
      gl.uniform1f(
        this._uniforms.lightmapStrength,
        draw.material.lightmapStrength,
      );
      gl.uniform1f(
        this._uniforms.bumpmapStrength,
        draw.material.bumpmapStrength,
      );
      gl.uniform1f(this._uniforms.envmapStrength, draw.material.envmapStrength);
      gl.uniform1f(this._uniforms.alphaScale, draw.material.alphaScale);
      for (const [unit, name] of [
        "texture",
        "transmapTexture",
        "nightmapTexture",
        "lightmapTexture",
        "bumpmapTexture",
        "envmapTexture",
      ].entries()) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, draw[name]);
      }
      for (const name of [
        "transmap",
        "nightmap",
        "lightmap",
        "bumpmap",
        "envmap",
      ]) {
        const uniform = `use${name[0].toUpperCase()}${name.slice(1)}`;
        gl.uniform1i(this._uniforms[uniform], draw.material[name] ? 1 : 0);
      }
      gl.bindVertexArray(draw.vao);
      gl.bindBuffer(
        gl.ELEMENT_ARRAY_BUFFER,
        this._wireframe ? draw.edgeBuffer : draw.indexBuffer,
      );
      gl.drawElements(
        this._wireframe ? gl.LINES : gl.TRIANGLES,
        this._wireframe ? draw.count * 2 : draw.count,
        gl.UNSIGNED_INT,
        0,
      );
    }
    gl.bindVertexArray(null);
    this._checkGL("render");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._disposeControls?.();
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._observer?.disconnect();
    globalThis.removeEventListener?.("resize", this._resize);
    if (this._pointer && this.canvas.hasPointerCapture?.(this._pointer.id))
      this.canvas.releasePointerCapture(this._pointer.id);
    for (const [name, handler] of this._eventHandlers())
      if (handler) this.canvas.removeEventListener(name, handler);
    this._dispose(this._resources);
    this._resources = [];
    this._draws = [];
    this._modelVisibility = [];
    if (this._program) this.gl.deleteProgram(this._program);
  }
}
