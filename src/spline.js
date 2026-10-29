/*
 * OMSI spline profiles and tessellation based on O3DParse/OmsiStructs/
 * OmsiSpline.cs and O3DParse/SplineMeshGenerator.cs (GPL-3.0).
 */
const TAG = /^\s*\[([^\[\]]+)\]\s*$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const MAX_SAMPLES = 100000;
const MAX_VERTICES = 1000000;

export function parseSplineProfile(text) {
  if (typeof text !== "string")
    throw new TypeError("Expected spline profile text");
  const lines = text.split(/\r\n|\n|\r/);
  const textures = [],
    profiles = [],
    warnings = [];
  let active = null,
    disabled = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("-<DISABLED>-")) {
      disabled = true;
      active = null;
      continue;
    }
    if (line.startsWith("-<ENABLED>-")) {
      disabled = false;
      continue;
    }
    if (disabled) continue;
    const match = TAG.exec(line);
    if (!match) continue;
    const tag = match[1].trim().toLowerCase();
    if (!["texture", "profile", "profilepnt"].includes(tag)) continue;
    const count = tag === "profilepnt" ? 4 : 1;
    const values = lines
      .slice(i + 1, i + 1 + count)
      .map((value) => value.trim());
    const lineNumber = i + 1;
    if (
      values.length !== count ||
      values.some(
        (value) =>
          !value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value),
      )
    ) {
      warnings.push(`line ${lineNumber}: [${tag}] has missing fields`);
      if (tag === "profile") active = null;
      continue;
    }
    i += count;
    if (tag === "texture") {
      textures.push(values[0]);
    } else if (tag === "profile") {
      if (!/^\+?\d+$/.test(values[0]) || Number(values[0]) > 65535) {
        warnings.push(
          `line ${lineNumber}: invalid profile texture index "${values[0]}"`,
        );
        active = null;
        continue;
      }
      active = {
        line: lineNumber,
        textureIndex: Number(values[0]),
        points: [],
      };
      profiles.push(active);
    } else if (!active) {
      warnings.push(
        `line ${lineNumber}: [profilepnt] has no preceding profile`,
      );
    } else {
      const numbers = values.map((value) =>
        NUMBER.test(value) ? Math.fround(Number(value)) : NaN,
      );
      if (!numbers.every(Number.isFinite)) {
        warnings.push(`line ${lineNumber}: invalid profile point`);
        continue;
      }
      active.points.push({
        x: numbers[0],
        height: numbers[1],
        u: numbers[2],
        v: numbers[3],
      });
    }
  }
  if (!profiles.length) throw new Error("Spline has no profiles");
  const usable = [];
  for (const profile of profiles) {
    if (profile.textureIndex >= textures.length) {
      warnings.push(
        `line ${profile.line}: profile references missing texture ${profile.textureIndex}; skipped`,
      );
    } else if (profile.points.length < 2) {
      warnings.push(
        `line ${profile.line}: profile needs at least two points; skipped`,
      );
    } else {
      usable.push(profile);
    }
  }
  if (!usable.length)
    throw new Error(`Spline has no usable profiles: ${warnings.join("; ")}`);
  return { textures, profiles: usable, warnings };
}

export function parseScoPaths(text) {
  if (typeof text !== "string") throw new TypeError("Expected SCO text");
  const lines = text.split(/\r\n|\n|\r/),
    paths = [],
    warnings = [];
  let disabled = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("-<DISABLED>-")) {
      disabled = true;
      continue;
    }
    if (line.startsWith("-<ENABLED>-")) {
      disabled = false;
      continue;
    }
    if (disabled) continue;
    const tag = TAG.exec(line)?.[1].trim().toLowerCase();
    if (tag !== "path" && tag !== "path_2") continue;
    const lineNumber = i + 1,
      count = tag === "path_2" ? 14 : 12;
    const values = lines
      .slice(i + 1, i + 1 + count)
      .map((value) => value.trim());
    if (
      values.length !== count ||
      values.some(
        (value) =>
          !value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value),
      )
    ) {
      warnings.push(`line ${lineNumber}: [${tag}] has missing fields`);
      continue;
    }
    i += count;
    const numbers = values.map((value) =>
      NUMBER.test(value) ? Math.fround(Number(value)) : NaN,
    );
    if (
      !numbers.every(Number.isFinite) ||
      ![0, 1, 2].includes(numbers[8]) ||
      ![0, 1, 2].includes(numbers[10]) ||
      ![0, 1, 2, 3].includes(numbers[11])
    ) {
      warnings.push(`line ${lineNumber}: [${tag}] has invalid numeric fields`);
      continue;
    }
    paths.push({
      line: lineNumber,
      position: { x: numbers[0], y: numbers[2], z: numbers[1] },
      heading: numbers[3],
      radius: numbers[4],
      length: numbers[5],
      gradStart: numbers[6],
      gradEnd: numbers[7],
      type: numbers[8],
      width: numbers[9] / 3,
      direction: numbers[10],
      blinker: numbers[11],
      cantStart: numbers[12] ?? 0,
      cantEnd: numbers[13] ?? 0,
      skewStart: 0,
      skewEnd: 0,
      useDeltaHeight: false,
      deltaHeight: 0,
      mirror: false,
    });
  }
  return { paths, warnings };
}

function gradient(spline) {
  const length = spline.length,
    b = spline.gradStart / 100;
  if (!spline.useDeltaHeight)
    return [(spline.gradEnd - spline.gradStart) / 100 / (2 * length), b, 0];
  const grad = ((spline.gradEnd - spline.gradStart) / 100) * length;
  const x = spline.deltaHeight - b * length;
  return [
    (-grad + 3 * x) / (length * length),
    b,
    (grad - 2 * x) / (length * length * length),
  ];
}

function tessellation(spline, tessDist, curveSag) {
  const samples = [],
    length = spline.length,
    radius = Math.abs(spline.radius);
  let gradientSamples = 0;
  if (spline.gradStart !== spline.gradEnd || spline.useDeltaHeight) {
    const [a, b, c] = gradient(spline);
    if (a !== 0 || c !== 0) {
      for (let z = 0; z <= Math.PI / 2; z += curveSag * 10) {
        const candidates = [];
        if (spline.useDeltaHeight && c !== 0) {
          const threeC = 3 * c,
            base = a * a - threeC * b,
            tangent = threeC * Math.tan(z);
          for (const square of [base + tangent, base - tangent]) {
            if (square < 0) continue;
            const root = Math.sqrt(square);
            candidates.push((-a + root) / threeC, (-a - root) / threeC);
          }
        } else if (!spline.useDeltaHeight && a !== 0) {
          const base = -b / (2 * a),
            offset = Math.tan(z) / (2 * a);
          candidates.push(base + offset, base - offset);
        }
        for (const point of candidates)
          if (point >= 0 && point <= length) samples.push(point);
      }
    }
    gradientSamples = samples.length;
  }
  let dr = Infinity,
    segments,
    step;
  if (radius > 0) {
    const revs = Math.min(length / radius, Math.PI * 2);
    dr = Math.min(
      tessDist / radius,
      2 * Math.acos(1 - Math.min(0.294, Math.max(0.001, curveSag / radius))),
    );
    segments = Math.max(Math.ceil(revs / dr), 1);
    dr = revs / segments;
    step = dr * radius;
  } else {
    segments = Math.max(Math.ceil(length / tessDist), 1);
    step = length / segments;
  }
  if (
    !Number.isSafeInteger(segments) ||
    segments + samples.length > MAX_SAMPLES
  )
    throw new RangeError("Spline requires too many tessellation samples");
  for (let i = 0; i <= segments; i++) samples.push(i * step);
  samples.sort((a, b) => a - b);
  const mergeDist = Math.min(
    length / Math.max(gradientSamples, 0.1) / 3,
    tessDist,
    (dr * Math.max(radius, 0.01)) / 2,
    length * 0.9,
  );
  const welded = [{ x: samples[0], n: 1 }];
  for (let i = 1; i < samples.length - 1; i++) {
    const last = welded[welded.length - 1];
    if (samples[i] - last.x < mergeDist) {
      last.x = (last.x * last.n + samples[i]) / (last.n + 1);
      last.n++;
    } else welded.push({ x: samples[i], n: 1 });
  }
  welded.push({ x: samples[samples.length - 1], n: 1 });
  welded[0].x = 0;
  welded[welded.length - 1].x = length;
  return welded.map((sample) => sample.x);
}

export function generateSplineMesh(
  spline,
  profile,
  tessDist = 1,
  curveSag = 0.005,
) {
  const fields = [
    spline.length,
    spline.radius,
    spline.gradStart,
    spline.gradEnd,
    spline.width ?? 1,
    spline.cantStart ?? 0,
    spline.cantEnd ?? 0,
    spline.skewStart ?? 0,
    spline.skewEnd ?? 0,
    spline.deltaHeight ?? 0,
  ];
  if (!fields.every(Number.isFinite) || spline.length < 0)
    throw new RangeError("Invalid spline geometry");
  if (
    !(tessDist > 0) ||
    !(curveSag > 0) ||
    !Number.isFinite(tessDist) ||
    !Number.isFinite(curveSag) ||
    Math.PI / 2 / curveSag > 10000
  )
    throw new RangeError("Invalid spline tessellation settings");
  if (
    !profile ||
    !Array.isArray(profile.profiles) ||
    !Array.isArray(profile.textures)
  )
    throw new TypeError("Invalid spline profile");
  if (spline.length === 0)
    return { vertices: new Float32Array(), triangles: new Uint32Array() };
  const samples = tessellation(spline, tessDist, curveSag);
  const vertexCount =
    samples.length *
    profile.profiles.reduce((sum, part) => sum + part.points.length, 0);
  if (vertexCount > MAX_VERTICES)
    throw new RangeError("Spline requires too many vertices");
  const vertices = [],
    triangles = [];
  const [a, b, c] = gradient(spline);
  for (const part of profile.profiles) {
    const start = vertices.length / 8,
      count = part.points.length;
    for (const y of samples) {
      let skew =
        (spline.skewStart ?? 0) * (1 - y / spline.length) +
        ((spline.skewEnd ?? 0) * y) / spline.length;
      if (spline.mirror) skew = -skew;
      const cant =
        ((spline.cantStart ?? 0) +
          (y * ((spline.cantEnd ?? 0) - (spline.cantStart ?? 0))) /
            spline.length) /
        100;
      const ry = Math.atan(cant),
        rz = spline.radius ? -y / spline.radius : 0;
      const sb = Math.sin(ry),
        cb = Math.cos(ry),
        sc = Math.sin(rz),
        cc = Math.cos(rz);
      const px = spline.radius
        ? spline.radius * (1 - Math.cos(y / spline.radius))
        : 0;
      const pz = spline.radius
        ? spline.radius * Math.sin(y / spline.radius)
        : y;
      const py = y * y * y * c + y * y * a + y * b;
      for (const point of part.points) {
        const x = (spline.mirror ? -point.x : point.x) * (spline.width ?? 1),
          forward = skew * point.x,
          h = point.height;
        vertices.push(
          px + x * cb * cc + forward * cc * sb - h * sc,
          py - x * sb + forward * cb,
          pz + x * cb * sc + forward * sb * sc + h * cc,
          0,
          1,
          0,
          point.u,
          point.v * (y + skew * point.x),
        );
      }
    }
    for (let s = 0; s < samples.length - 1; s++) {
      for (let p = 0; p < count - 1; p++) {
        const v = start + s * count + p,
          next = v + count,
          mat = part.textureIndex;
        if (spline.mirror)
          triangles.push(v + 1, next + 1, v, mat, next + 1, next, v, mat);
        else triangles.push(v, next + 1, v + 1, mat, v, next, next + 1, mat);
      }
    }
  }
  const output = new Float32Array(vertices);
  if (!output.every(Number.isFinite))
    throw new RangeError("Spline geometry exceeds 32-bit float range");
  return { vertices: output, triangles: new Uint32Array(triangles) };
}
