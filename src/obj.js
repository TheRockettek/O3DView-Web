/*
 * Wavefront OBJ/MTL reader, informed by O3DView's WavefrontOBJIO.cs.
 * The original project is licensed under GPL-3.0; this derivative is
 * distributed under the same license. See O3DView/LICENSE.txt.
 */

const defaultMaterial = () => ({
    diffuse: [1, 1, 1, 1], spec: [0, 0, 0], emission: [0, 0, 0],
    specPower: 8, textureName: "",
});

function lines(text, format) {
    if (typeof text !== "string") throw new TypeError(`${format}: expected a string`);
    return text.split(/\r\n|\n|\r/).map((line, i) => ({
        line: line.replace(/#.*/, "").trim(), number: i + 1,
    }));
}

function fail(format, line, message) {
    throw new Error(`${format}: line ${line}: ${message}`);
}

function number(value, format, line) {
    // Number("") is zero and Number("0x10") is accepted; neither is an OBJ float.
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value ?? "")) {
        fail(format, line, `invalid number '${value ?? ""}'`);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isFinite(Math.fround(n))) {
        fail(format, line, `number out of range '${value}'`);
    }
    return n;
}

function components(args, count, format, line, exact = false) {
    if (args.length < count || (exact && args.length !== count)) {
        fail(format, line, `expected ${count} numeric components`);
    }
    return args.slice(0, count).map(value => number(value, format, line));
}

function warnOnce(warnings, seen, key, message) {
    if (!seen.has(key)) {
        seen.add(key);
        warnings.push(message);
    }
}

/**
 * Parse MTL text into a Map from material names to O3D material objects.
 * The Map has a `warnings` array. map_Kd paths are preserved verbatim; texture
 * loading and map options are not supported. Unknown directives are ignored.
 * Invalid supported records and duplicate names throw with line numbers.
 */
export function parseMTL(text) {
    const materials = new Map();
    const warnings = [];
    materials.warnings = warnings;
    const seen = new Set();
    let current = null;
    for (const { line, number: lineNo } of lines(text, "MTL")) {
        if (!line) continue;
        const [command, ...args] = line.split(/\s+/);
        const rest = line.slice(command.length).trim();
        if (command === "newmtl") {
            if (!rest) fail("MTL", lineNo, "missing material name");
            if (materials.has(rest)) fail("MTL", lineNo, `duplicate material '${rest}'`);
            current = defaultMaterial();
            materials.set(rest, current);
        } else if (["Kd", "Ks", "Ke", "Ns", "d", "Tr", "map_Kd"].includes(command)) {
            if (!current) fail("MTL", lineNo, `${command} before newmtl`);
            if (command === "Kd") {
                const rgb = components(args, 3, "MTL", lineNo, true);
                current.diffuse.splice(0, 3, ...rgb);
            } else if (command === "Ks" || command === "Ke") {
                current[command === "Ks" ? "spec" : "emission"] = components(args, 3, "MTL", lineNo, true);
            } else if (command === "map_Kd") {
                if (!rest) fail("MTL", lineNo, "missing texture name");
                if (rest.startsWith("-")) {
                    current.textureName = "";
                    warnOnce(warnings, seen, "map-options", `MTL: line ${lineNo}: map_Kd options are unsupported; texture ignored`);
                } else current.textureName = rest;
            } else {
                const [value] = components(args, 1, "MTL", lineNo, true);
                if (command === "Ns") current.specPower = value;
                else current.diffuse[3] = command === "Tr" ? 1 - value : value;
            }
        } else {
            warnOnce(warnings, seen, command, `MTL: line ${lineNo}: unsupported '${command}' ignored`);
        }
    }
    return materials;
}

function index(value, length, kind, line) {
    if (!/^[+-]?\d+$/.test(value ?? "")) fail("OBJ", line, `invalid ${kind} index '${value ?? ""}'`);
    const n = Number(value);
    const result = n > 0 ? n - 1 : length + n;
    if (!Number.isSafeInteger(n) || n === 0 || result < 0 || result >= length) {
        fail("OBJ", line, `${kind} index '${value}' out of range`);
    }
    return result;
}

// Project a polygon onto its dominant plane and ear-clip it, preserving winding.
function triangulate(points, line) {
    const normal = [0, 0, 0];
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
        normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
        normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const length = Math.hypot(...normal);
    if (!Number.isFinite(length) || length === 0) fail("OBJ", line, "degenerate face");
    const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    const projected = points.map(p => axis === 0 ? [p[1], p[2]] : axis === 1 ? [p[0], p[2]] : [p[0], p[1]]);
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const onSegment = (a, b, p) => cross(a, b, p) === 0 &&
        p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
        p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
    for (let i = 0; i < projected.length; i++) {
        const a = projected[i], b = projected[(i + 1) % projected.length];
        if (a[0] === b[0] && a[1] === b[1]) fail("OBJ", line, "degenerate face edge");
        for (let j = i + 1; j < projected.length; j++) {
            if (j === i + 1 || (i === 0 && j === projected.length - 1)) continue;
            const c = projected[j], d = projected[(j + 1) % projected.length];
            const abC = cross(a, b, c), abD = cross(a, b, d);
            const cdA = cross(c, d, a), cdB = cross(c, d, b);
            if ((Math.sign(abC) * Math.sign(abD) < 0 && Math.sign(cdA) * Math.sign(cdB) < 0) ||
                onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) {
                fail("OBJ", line, "non-simple face");
            }
        }
    }
    let area = 0;
    for (let i = 1; i + 1 < projected.length; i++) area += cross(projected[0], projected[i], projected[i + 1]);
    const sign = Math.sign(area);
    if (!sign) fail("OBJ", line, "degenerate face");
    const remaining = points.map((_, i) => i), result = [];
    while (remaining.length > 3) {
        let found = false;
        for (let i = 0; i < remaining.length; i++) {
            const a = remaining[(i + remaining.length - 1) % remaining.length];
            const b = remaining[i], c = remaining[(i + 1) % remaining.length];
            if (cross(projected[a], projected[b], projected[c]) * sign <= 0) continue;
            if (remaining.some(p => p !== a && p !== b && p !== c &&
                cross(projected[a], projected[b], projected[p]) * sign >= 0 &&
                cross(projected[b], projected[c], projected[p]) * sign >= 0 &&
                cross(projected[c], projected[a], projected[p]) * sign >= 0)) continue;
            result.push([a, b, c]);
            remaining.splice(i, 1);
            found = true;
            break;
        }
        if (!found) fail("OBJ", line, "cannot triangulate face (degenerate or non-simple polygon)");
    }
    if (cross(...remaining.map(i => projected[i])) * sign <= 0) fail("OBJ", line, "degenerate face");
    result.push(remaining);
    return { triangles: result, normal: normal.map(n => -n / length) };
}

/**
 * Parse OBJ text into renderer-compatible O3D arrays. Optionally pass
 * { materials: parseMTL(mtlText) } to resolve usemtl names; merge Maps first
 * when using multiple libraries. No files are read. The result also contains
 * materialNames (parallel to materials), materialLibraries and warnings.
 * Unresolved materials use white defaults. Missing normals are flat per face;
 * smoothing groups and unsupported geometry/directives are ignored with warnings.
 * Only simple, planar polygons are supported. Extra v/vt components, object and
 * group names are ignored. Invalid supported records, references and
 * untriangulable polygons throw.
 */
export function parseOBJ(text, options = {}) {
    const sourceLines = lines(text, "OBJ");
    if (options === null || typeof options !== "object" ||
        (options.materials !== undefined && !(options.materials instanceof Map))) {
        throw new TypeError("OBJ: options.materials must be a Map");
    }
    const positions = [], uvs = [], normals = [], vertices = [], triangles = [];
    const materials = [], materialNames = [], materialLibraries = [], warnings = [];
    const seen = new Set(), materialIndices = new Map(), vertexIndices = new Map();
    let currentMaterial = null, faceId = 0;
    function material(name, lineNo) {
        if (materialIndices.has(name)) return materialIndices.get(name);
        const source = name === null ? undefined : options.materials?.get(name);
        if (name !== null && !source) warnOnce(warnings, seen, `material:${name}`,
            `OBJ: line ${lineNo}: material '${name}' not provided; using defaults`);
        const value = source ? {
            diffuse: [...source.diffuse], spec: [...source.spec], emission: [...source.emission],
            specPower: source.specPower, textureName: source.textureName,
        } : defaultMaterial();
        const i = materials.length;
        materials.push(value);
        materialNames.push(name);
        materialIndices.set(name, i);
        return i;
    }
    for (const { line, number: lineNo } of sourceLines) {
        if (!line) continue;
        const [command, ...args] = line.split(/\s+/);
        const rest = line.slice(command.length).trim();
        if (command === "v" || command === "vn") {
            const p = components(args, 3, "OBJ", lineNo, command === "vn");
            p[0] = -p[0];
            (command === "v" ? positions : normals).push(p);
        } else if (command === "vt") {
            const uv = components(args, 2, "OBJ", lineNo);
            uvs.push([uv[0], 1 - uv[1]]);
        } else if (command === "mtllib") {
            if (!args.length) fail("OBJ", lineNo, "missing material library name");
            materialLibraries.push(...args);
        } else if (command === "usemtl") {
            if (!rest) fail("OBJ", lineNo, "missing material name");
            currentMaterial = rest;
        } else if (command === "f") {
            if (args.length < 3) fail("OBJ", lineNo, "face needs at least three vertices");
            const corners = args.map(part => {
                const fields = part.split("/");
                if (fields.length > 3 || !fields[0] ||
                    (fields.length === 2 && !fields[1]) ||
                    (fields.length === 3 && !fields[2])) fail("OBJ", lineNo, `invalid face vertex '${part}'`);
                return {
                    p: index(fields[0], positions.length, "position", lineNo),
                    t: fields[1] ? index(fields[1], uvs.length, "UV", lineNo) : -1,
                    n: fields[2] ? index(fields[2], normals.length, "normal", lineNo) : -1,
                };
            });
            const { triangles: faceTriangles, normal } = triangulate(corners.map(c => positions[c.p]), lineNo);
            const ids = corners.map(c => {
                const key = `${c.p}/${c.t}/${c.n < 0 ? `face${faceId}` : c.n}`;
                if (!vertexIndices.has(key)) {
                    vertexIndices.set(key, vertices.length / 8);
                    vertices.push(...positions[c.p], ...(c.n < 0 ? normal : normals[c.n]), ...(c.t < 0 ? [0, 0] : uvs[c.t]));
                }
                return vertexIndices.get(key);
            });
            const mat = material(currentMaterial, lineNo);
            for (const [a, b, c] of faceTriangles) triangles.push(ids[c], ids[b], ids[a], mat);
            faceId++;
        } else if (command === "s") {
            if (rest && rest !== "off" && rest !== "0") warnOnce(warnings, seen, "smoothing",
                `OBJ: line ${lineNo}: smoothing groups are unsupported; missing normals are flat`);
        } else if (command !== "o" && command !== "g") {
            warnOnce(warnings, seen, command, `OBJ: line ${lineNo}: unsupported '${command}' ignored`);
        }
    }
    if (!materials.length) material(null, 0);
    return {
        vertices: new Float32Array(vertices), triangles: new Uint32Array(triangles), materials,
        transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        materialNames, materialLibraries, warnings,
    };
}
