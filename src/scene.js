/*
 * Partial OMSI scene reader. Reference: O3DView/O3DParse/OmsiStructs
 * and O3DView/O3DView/FileLoader.cs (GPL-3.0; see O3DView/LICENSE.txt).
 * This is not a full OMSI configuration, animation, or material parser.
 */
import { parseO3D } from "./o3d.js";
import { decodeDDS } from "./dds.js";
import { decodeTGA } from "./tga.js";
import { parseOBJ, parseMTL } from "./obj.js";
import { decodeConfiguration } from "./config-inspector.js";
import { parseCfgMaterials } from "./cfg-materials.js";
import { parseInteriorLights } from "./interior-lights.js";
import { parseMapTile } from "./map-tile.js";
import { placeMapVertices, placeMapLight } from "./map-transform.js";
import { parseCTC, parseCTI } from "./repaints.js";
import { parseSplineProfile, parseScoPaths, generateSplineMesh } from "./spline.js";
import { parseCabinPaths, parsePassengerCabin, generateCabinPathMesh } from "./cabin-path.js";

const MODEL_EXTENSIONS = new Set(["o3d", "rdy", "obj"]);
const CONFIG_EXTENSIONS = new Set(["cfg", "sco", "bus", "ovh"]);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function normalize(path) {
    const parts = [];
    for (const part of path.replaceAll("\\", "/").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (!parts.length) return null;
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return parts.join("/");
}

function extension(path) {
    return path.split("/").pop().split(".").pop().toLowerCase();
}

function directory(path) {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
}

export function textureFormat(path, buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 4 && bytes[0] === 0x44 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x20) return "dds";
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" || String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a")) return "image/gif";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
    if (extension(path) === "tga") return "tga";
    throw new Error(`Unsupported or invalid texture data in ${path}`);
}

function containsTransparency(data) {
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
    }
    return false;
}

async function decodeTexture(record, buffer) {
    if (typeof createImageBitmap !== "function") throw new Error("Image decoding is unavailable in this browser");
    const type = textureFormat(record.path, buffer);
    if (type === "dds" || type === "tga") {
        const { width, height, data } = type === "dds" ? decodeDDS(buffer) : decodeTGA(buffer);
        const hasAlpha = containsTransparency(data);
        return { bitmap: await createImageBitmap(new ImageData(data, width, height)), hasAlpha };
    }
    const bitmap = await createImageBitmap(new Blob([buffer], { type }));
    try {
        const canvas = typeof OffscreenCanvas === "function"
            ? new OffscreenCanvas(bitmap.width, bitmap.height)
            : document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Unable to inspect image transparency");
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const hasAlpha = containsTransparency(data);
        return { bitmap, hasAlpha };
    } catch (error) {
        bitmap.close();
        throw error;
    }
}

/**
 * Load chosen files and their supported references from the supplied file set.
 * Paths are relative to the selected directory, not the host filesystem.
 * Meshes before any [LOD] and meshes in every [LOD] are loaded.
 * Unsupported commands are reported, not interpreted.
 * @param {File[]} files
 * @param {string[]} entryPaths
 * @returns {Promise<{models: Array, lods: Array, warnings: string[]}>}
 */
export async function loadScene(files, entryPaths, options = {}) {
    const models = [];
    const lods = [];
    const lights = [];
    const hierarchy = [];
    const warnings = [];
    const repaintGroups = [];
    const byPath = new Map();
    const folded = new Map();
    const cache = new Map();
    const textureCache = new Map();
    const active = new Set();
    const ctiCache = new Map();
    const splineCache = new Map();

    for (const file of files) {
        const path = normalize(file.webkitRelativePath || file.name);
        if (!path) {
            warnings.push(`Invalid file path: ${file.webkitRelativePath || file.name}`);
            continue;
        }
        if (byPath.has(path)) {
            warnings.push(`Duplicate file path: ${path}; using the first file`);
            continue;
        }
        const record = { path, file };
        byPath.set(path, record);
        const key = path.toLowerCase();
        if (folded.has(key)) {
            warnings.push(`Ambiguous case-insensitive path: ${path}; using ${folded.get(key).path} for non-exact references`);
        } else {
            folded.set(key, record);
        }
    }

    function find(path) {
        return byPath.get(path) || folded.get(path.toLowerCase());
    }

    function findMapObject(source, value, kind = "object") {
        if (/^(?:[a-z]:|[/\\])/i.test(value)) {
            warnings.push(`Unsupported absolute map ${kind} reference "${value}" in ${source}`);
            return null;
        }
        let base = directory(source);
        while (true) {
            const path = normalize(`${base}/${value}`);
            const record = path && find(path);
            if (record) return record;
            if (!base) break;
            base = directory(base);
        }
        warnings.push(`Missing map ${kind} "${value}" referenced by ${source}; select an OMSI parent folder`);
        return null;
    }

    function findRepaintFiles(source, value) {
        if (/^(?:[a-z]:|[/\\])/i.test(value)) {
            warnings.push(`Unsupported absolute repaint directory "${value}" in ${source}`);
            return [];
        }
        let base = directory(source);
        while (true) {
            const path = normalize(`${base}/${value}`);
            if (path) {
                const prefix = `${path.toLowerCase()}/`;
                const matches = [...byPath.values()].filter(record =>
                    extension(record.path) === "cti" && record.path.toLowerCase().startsWith(prefix));
                if (matches.length) return matches.sort((a, b) => a.path.localeCompare(b.path));
            }
            if (!base) break;
            base = directory(base);
        }
        warnings.push(`${source}: no CTI files found in repaint directory "${value}" among selected files`);
        return [];
    }

    function read(record) {
        if (!cache.has(record)) cache.set(record, record.file.arrayBuffer());
        return cache.get(record);
    }

    function reference(base, value, source) {
        if (/^(?:[a-z]:|[/\\])/i.test(value)) {
            warnings.push(`Unsupported absolute reference "${value}" in ${source}`);
            return null;
        }
        const path = normalize(`${base}/${value}`);
        if (!path) {
            warnings.push(`Invalid reference "${value}" in ${source}`);
            return null;
        }
        const record = find(path);
        if (!record) warnings.push(`Missing file "${value}" referenced by ${source} (resolved: ${path})`);
        return record;
    }

    function findTexture(source, name) {
        if (/^(?:[a-z]:|[/\\])/i.test(name)) return null;
        const ddsName = name.replace(/\.[^./\\]+$/, "") + ".dds";
        let base = directory(source);
        while (true) {
            for (const candidate of [ddsName, `texture/${ddsName}`, name, `texture/${name}`]) {
                const path = normalize(`${base}/${candidate}`);
                if (path) {
                    const record = find(path);
                    if (record) return record;
                }
            }
            if (!base) return null;
            base = directory(base);
        }
    }

    async function applyTextures(materials, source, materialSources = [], cfgSource = source) {
        for (const [index, material] of materials.entries()) {
            for (const [property, name, textureSource] of [
                ["texture", material.textureName, materialSources[index] || source],
                ["transmap", material.transmapName, cfgSource],
                ["nightmap", material.nightmapName, cfgSource],
                ["lightmap", material.lightmapName, cfgSource],
                ["bumpmap", material.bumpmapName, cfgSource],
                ["envmap", material.envmapName, cfgSource],
            ]) {
                if (!name) continue;
                const record = findTexture(textureSource, name);
                if (!record) {
                    warnings.push(`${textureSource}: ${property === "texture" ? "texture" : property} "${name}" not found in selected files`);
                    continue;
                }
                if (!textureCache.has(record)) {
                    textureCache.set(record, read(record).then(buffer => (options.decodeTexture || decodeTexture)(record, buffer)));
                }
                try {
                    const texture = await textureCache.get(record);
                    material[property] = texture.bitmap;
                    if (property === "texture") material.textureTransparent = texture.hasAlpha;
                } catch (error) {
                    warnings.push(`${textureSource}: could not decode ${property === "texture" ? "texture" : property} ${record.path}: ${error.message}`);
                }
            }
        }
    }

    async function addSpline(child, spline, placement = null, pathSource = null, parent = hierarchy, order = 0) {
        if (!splineCache.has(child)) splineCache.set(child, read(child).then(buffer =>
            parseSplineProfile(decodeConfiguration(buffer))));
        const profile = await splineCache.get(child);
        warnings.push(...profile.warnings.map(warning => `${child.path}: ${warning}`));
        const geometry = generateSplineMesh(spline, profile);
        let vertices = placeMapVertices(geometry.vertices, spline);
        if (placement) vertices = placeMapVertices(vertices, placement);
        if (!vertices.every(Number.isFinite)) throw new RangeError("Spline placement exceeds 32-bit float range");
        const materials = profile.textures.map(textureName => ({
            diffuse: [1, 1, 1, 1], spec: [0, 0, 0], emission: [0, 0, 0], specPower: 1, textureName,
        }));
        await applyTextures(materials, child.path);
        models.push({
            name: child.path, vertices, triangles: geometry.triangles, materials,
            transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            gizmoVisible: true,
            ...(pathSource ? { pathPlacement: spline, pathSource, ...(placement ? { mapPlacement: placement } : {}) }
                : { splinePlacement: spline }),
        });
        parent.push({ type: pathSource ? "path" : "spline", name: child.path,
            modelIndex: models.length - 1, order, children: [] });
    }

    async function visit(record, cfgMesh = null, cfgSource = record.path, placement = null, lod = null, parent = hierarchy, order = 0) {
        if (active.has(record)) {
            warnings.push(`Cyclic reference to ${record.path}`);
            return;
        }
        const ext = extension(record.path);
        if (MODEL_EXTENSIONS.has(ext)) {
            try {
                let parsed;
                let materialSources = [];
                if (ext === "obj") {
                    const text = decodeConfiguration(await read(record));
                    const preview = parseOBJ(text);
                    const materialMap = new Map(), sourceMap = new Map();
                    for (const path of preview.materialLibraries) {
                        const library = reference(directory(record.path), path, record.path);
                        if (!library) continue;
                        try {
                            const definitions = parseMTL(decodeConfiguration(await read(library)));
                            warnings.push(...definitions.warnings.map(warning => `${library.path}: ${warning}`));
                            for (const [name, material] of definitions) {
                                if (materialMap.has(name)) {
                                    warnings.push(`${library.path}: duplicate material "${name}"; using the first definition`);
                                } else {
                                    materialMap.set(name, material);
                                    sourceMap.set(name, library.path);
                                }
                            }
                        } catch (error) {
                            warnings.push(`Could not load ${library.path}: ${error.message}`);
                        }
                    }
                    parsed = parseOBJ(text, { materials: materialMap });
                    warnings.push(...parsed.warnings.map(warning => `${record.path}: ${warning}`));
                    materialSources = parsed.materialNames.map(name => sourceMap.get(name));
                    parsed.materials.forEach((material, index) => { material.name = parsed.materialNames[index]; });
                } else {
                    parsed = parseO3D(await read(record));
                }
                if (parsed.bones?.length) {
                    warnings.push(`${record.path}: skeletal animation and bone weights are not supported`);
                }
                if (cfgMesh) {
                    const occurrences = new Map();
                    for (const material of parsed.materials) {
                        const name = material.textureName.toLowerCase();
                        const index = occurrences.get(name) || 0;
                        occurrences.set(name, index + 1);
                        const override = cfgMesh.materials.find(candidate =>
                            candidate.textureName.toLowerCase() === name && candidate.index === index);
                        if (override) {
                            material.alphaMode = override.alphaMode ?? 0;
                            if (override.noZCheck) material.noZCheck = true;
                            if (override.noZWrite) material.noZWrite = true;
                            for (const map of ["transmap", "nightmap", "lightmap", "bumpmap", "envmap"]) {
                                if (override[map]) {
                                    material[`${map}Name`] = override[map];
                                    if (override[`${map}Strength`] !== undefined) {
                                        material[`${map}Strength`] = override[`${map}Strength`];
                                    }
                                }
                            }
                            if (override.alphaScaleVar) material.alphaScaleVar = override.alphaScaleVar;
                            if (override.lightmapVar) material.lightmapVar = override.lightmapVar;
                        }
                        if (override?.allcolor) {
                            material.diffuse = [...override.allcolor.diffuse];
                            material.spec = [...override.allcolor.specular];
                            material.emission = override.allcolor.emission.map((value, i) => value + override.allcolor.ambient[i]);
                            material.specPower = override.allcolor.specPower;
                        }
                    }
                }
                await applyTextures(parsed.materials, record.path, materialSources, cfgSource);
                models.push({
                    name: record.path,
                    vertices: placement ? placeMapVertices(parsed.vertices, placement) : parsed.vertices,
                    triangles: parsed.triangles,
                    materials: parsed.materials,
                    transform: parsed.transform,
                    ...(placement ? { mapPlacement: placement } : {}),
                    ...(lod ? { lod } : {}),
                    ...(ext !== "obj" ? {
                        o3dMetadata: {
                            version: parsed.version,
                            extendedOptions: parsed.extendedOptions,
                            bones: parsed.bones,
                        },
                    } : {}),
                    ...(cfgMesh?.viewpoint !== undefined ? { viewpoint: cfgMesh.viewpoint } : {}),
                    ...(cfgMesh?.visibles ? { visibles: cfgMesh.visibles.map(condition => ({ ...condition })) } : {}),
                });
                parent.push({ type: "model", name: record.path, modelIndex: models.length - 1, order, children: [] });
            } catch (error) {
                warnings.push(`Could not load ${record.path}: ${error.message}`);
            }
            return;
        }
        if (ext === "map") {
            active.add(record);
            try {
                const tile = parseMapTile(decodeConfiguration(await read(record)));
                const node = { type: "map", name: record.path, order, children: [] };
                parent.push(node);
                warnings.push(...tile.warnings.map(warning => `${record.path}: ${warning}`));
                if (tile.attachObjects.length || tile.splineAttachments.length) {
                    warnings.push(`${record.path}: map object attachments are not yet rendered`);
                }
                for (const object of tile.sceneObjects) {
                    const child = findMapObject(record.path, object.path);
                    if (child) await visit(child, null, child.path, object, null, node.children);
                }
                for (const spline of tile.splines) {
                    const child = findMapObject(record.path, spline.path, "spline");
                    if (!child) continue;
                    try {
                        await addSpline(child, spline, null, null, node.children);
                    } catch (error) {
                        warnings.push(`Could not load spline ${spline.idCode} from ${child.path}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Could not load ${record.path}: ${error.message}`);
            } finally {
                active.delete(record);
            }
            return;
        }
        if (!CONFIG_EXTENSIONS.has(ext)) {
            warnings.push(`Unsupported file type: ${record.path}`);
            return;
        }

        active.add(record);
        try {
            const firstModel = models.length;
            const text = decodeConfiguration(await read(record));
            const node = { type: "configuration", name: record.path, order, children: [],
                ...(placement ? { mapPlacement: placement } : {}) };
            parent.push(node);
            const lines = text.split(/\r\n|\n|\r/);
            const parsedMaterials = parseCfgMaterials(lines);
            const parsedLights = parseInteriorLights(lines);
            const parsedRepaint = parseCTC(lines);
            const parsedPaths = ext === "sco" ? parseScoPaths(text) : { paths: [], warnings: [] };
            warnings.push(...parsedPaths.warnings.map(warning => `${record.path}: ${warning}`));
            warnings.push(...parsedRepaint.warnings.map(warning => `${record.path}: ${warning}`));
            const firstLight = lights.length;
            lights.push(...parsedLights.lights.map(light => ({
                ...(placement ? placeMapLight(light, placement) : light), source: record.path,
                ...(placement ? { mapPlacement: placement } : {}),
            })));
            if (parsedLights.lights.length) {
                node.children.push({ type: "lights", name: "Interior lights", order: Number.MAX_SAFE_INTEGER,
                    children: parsedLights.lights.map((light, index) => ({
                        type: "light", name: light.variable, lightIndex: firstLight + index, order: light.line, children: [],
                    })) });
            }
            warnings.push(...parsedLights.warnings.map(warning => `${record.path}: ${warning}`));
            const meshesByLine = new Map(parsedMaterials.meshes.map(mesh => [mesh.line, mesh]));
            warnings.push(...parsedMaterials.warnings
                .filter(warning => !warning.includes("unsupported/ignored tag"))
                .map(warning => `${record.path}: ${warning}`));
            const unsupported = new Set();
            const refs = [];
            let cabinPath = null;
            let cabinFile = null;
            let lod = null;
            let lodNode = null;
            let disabled = false;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith("-<DISABLED>-")) { disabled = true; continue; }
                if (lines[i].trim().startsWith("-<ENABLED>-")) { disabled = false; continue; }
                if (disabled) continue;
                const match = /^\s*\[([^\[\]]+)\]\s*$/.exec(lines[i]);
                if (!match) continue;
                const tag = match[1].trim().toLowerCase();
                if (tag === "lod") {
                    const value = (lines[i + 1] || "").trim();
                    const radius = NUMBER.test(value) ? Math.fround(Number(value)) : NaN;
                    if (!Number.isFinite(radius)) {
                        warnings.push(`${record.path}: invalid [LOD] view radius at line ${i + 1}`);
                    }
                    lod = { source: record.path, line: i + 1, viewRadius: Number.isFinite(radius) ? radius : null, radiusText: value,
                        visible: true, ...(placement ? { mapPlacement: placement } : {}) };
                    lods.push(lod);
                    lodNode = { type: "lod", name: `LOD ${value}`, lod, order: i + 1, children: [] };
                    node.children.push(lodNode);
                } else if (tag === "paths" && ext === "bus") {
                    const value = (lines[i + 1] || "").trim();
                    if (!value || /^\[.*\]$/.test(value)) warnings.push(`${record.path}: missing path after [paths] at line ${i + 1}`);
                    else if (cabinPath) warnings.push(`${record.path}: duplicate [paths] at line ${i + 1}; using the first`);
                    else cabinPath = { value, line: i + 1 };
                } else if (tag === "passengercabin" && ext === "bus") {
                    const value = (lines[i + 1] || "").trim();
                    if (!value || /^\[.*\]$/.test(value)) warnings.push(`${record.path}: missing path after [passengercabin] at line ${i + 1}`);
                    else if (cabinFile) warnings.push(`${record.path}: duplicate [passengercabin] at line ${i + 1}; using the first`);
                    else cabinFile = { value, line: i + 1 };
                } else if (tag === "mesh" || tag === "model") {
                    const value = (lines[i + 1] || "").trim();
                    if (!value || /^\[.*\]$/.test(value)) {
                        warnings.push(`${record.path}: missing path after [${tag}] at line ${i + 1}`);
                        continue;
                    }
                    const line = i + 1;
                    i++;
                    const base = tag === "mesh" && ext !== "cfg"
                        ? `${directory(record.path)}/model`
                        : directory(record.path);
                    refs.push({ base, value, cfgMesh: tag === "mesh" ? meshesByLine.get(line) : null,
                        lod: tag === "mesh" ? lod : null, parent: tag === "mesh" && lodNode ? lodNode.children : node.children, line });
                } else if (!["matl", "allcolor", "matl_allcolor", "matl_alpha", "matl_nozcheck", "matl_nozwrite",
                    "matl_transmap", "matl_nightmap", "matl_lightmap", "matl_bumpmap", "matl_envmap",
                    "alphascale", "viewpoint", "visible", "interiorlight", "ctc", "ctctexture"].includes(tag) &&
                    !(ext === "sco" && ["path", "path_2"].includes(tag))) {
                    unsupported.add(tag);
                }
            }
            if (unsupported.size) {
                warnings.push(`${record.path}: unsupported/ignored tags: ${[...unsupported].map(tag => `[${tag}]`).join(", ")}`);
            }
            for (const { base, value, cfgMesh, lod, parent: children, line } of refs) {
                const child = reference(base, value, record.path);
                if (child) await visit(child, cfgMesh, record.path, placement, lod, children, line);
            }
            let cabinPaths = null;
            if (cabinPath) {
                const child = reference(directory(record.path), cabinPath.value, record.path);
                if (child) {
                    try {
                        const paths = parseCabinPaths(decodeConfiguration(await read(child)));
                        cabinPaths = paths;
                        const pathState = { paths, placement, modelIndex: null };
                        const geometry = generateCabinPathMesh(paths);
                        warnings.push(...[...paths.warnings, ...geometry.warnings].map(warning => `${child.path}: ${warning}`));
                        const points = paths.points.flatMap((position, index) => position ? [{
                            type: "cabin-item", name: `Path point ${index}`, children: [],
                            info: { kind: "path point", source: child.path, line: paths.pointLines[index], index, position, pathState },
                        }] : []);
                        if (points.length) node.children.push({ type: "cabin-points", name: "Cabin path points",
                            order: cabinPath.line, children: points });
                        const links = paths.links.map((link, index) => ({
                            type: "cabin-item", name: `Path link ${index}`, children: [],
                            info: { kind: "path link", source: child.path, line: link.line, index, link, pathState },
                        }));
                        if (links.length) node.children.push({ type: "cabin-links", name: "Cabin path links",
                            order: cabinPath.line, children: links });
                        if (geometry.triangles.length) {
                            const vertices = placement ? placeMapVertices(geometry.vertices, placement) : geometry.vertices;
                            if (!vertices.every(Number.isFinite)) throw new RangeError("Cabin path placement exceeds 32-bit float range");
                            models.push({
                                name: "Cabin Paths", cabinPathSource: child.path,
                                vertices,
                                triangles: geometry.triangles, gizmoVisible: true,
                                materials: [{ diffuse: [1, 0.4, 0.1, 1], spec: [0, 0, 0], emission: [0, 0, 0], specPower: 0, textureName: "" }],
                                transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                                ...(placement ? { mapPlacement: placement } : {}),
                            });
                            pathState.modelIndex = models.length - 1;
                            node.children.push({ type: "cabin-path", name: child.path, modelIndex: models.length - 1, order: cabinPath.line, children: [] });
                        }
                    } catch (error) {
                        warnings.push(`Could not load cabin paths ${child.path}: ${error.message}`);
                    }
                }
            }
            if (cabinFile) {
                const child = reference(directory(record.path), cabinFile.value, record.path);
                if (child) {
                    try {
                        const cabin = parsePassengerCabin(decodeConfiguration(await read(child)));
                        warnings.push(...cabin.warnings.map(warning => `${child.path}: ${warning}`));
                        const items = cabin.items.map(item => {
                            const point = item.pathPoint === undefined ? null : cabinPaths?.points[item.pathPoint];
                            if (item.pathPoint !== undefined && !point) warnings.push(`${child.path}:${item.line}: ${item.name} references a missing cabin path point ${item.pathPoint}`);
                            return { type: "cabin-item", name: item.name, children: [],
                                info: { ...item, source: child.path, ...(point && !item.position ? { position: point } : {}) } };
                        });
                        if (items.length) node.children.push({ type: "cabin", name: "Passenger Cabin",
                            order: cabinFile.line, children: items });
                    } catch (error) {
                        warnings.push(`Could not load passenger cabin ${child.path}: ${error.message}`);
                    }
                }
            }
            for (const path of parsedPaths.paths) {
                const name = path.type === 1 ? "invis_sidewalk.sli" : "invis_street.sli";
                const child = findMapObject(record.path, `Splines/${name}`, "path profile");
                if (!child) continue;
                try {
                    await addSpline(child, path, placement, record.path, node.children, path.line);
                } catch (error) {
                    warnings.push(`Could not load path at ${record.path}:${path.line}: ${error.message}`);
                }
            }
            if (parsedRepaint.ctc) {
                const ctis = [];
                for (const cti of findRepaintFiles(record.path, parsedRepaint.ctc.path)) {
                    if (!ctiCache.has(cti)) {
                        ctiCache.set(cti, read(cti).then(buffer => {
                            const parsed = parseCTI(decodeConfiguration(buffer));
                            warnings.push(...parsed.warnings.map(warning => `${cti.path}: ${warning}`));
                            return { source: cti.path, items: parsed.items };
                        }));
                    }
                    try {
                        ctis.push(await ctiCache.get(cti));
                    } catch (error) {
                        warnings.push(`Could not load ${cti.path}: ${error.message}`);
                    }
                }
                repaintGroups.push({
                    source: record.path,
                    ctc: parsedRepaint.ctc,
                    ctis,
                    modelIndices: Array.from({ length: models.length - firstModel }, (_, i) => firstModel + i),
                });
            }
            node.children.sort((a, b) => a.order - b.order);
            for (const child of node.children) if (child.type === "lod") child.children.sort((a, b) => a.order - b.order);
        } catch (error) {
            warnings.push(`Could not load ${record.path}: ${error.message}`);
        } finally {
            active.delete(record);
        }
    }

    for (const entry of entryPaths) {
        const path = normalize(entry);
        // Entries are chosen paths, not fuzzy basenames or case-folded lookups.
        const record = path && byPath.get(path);
        if (!record) warnings.push(`Missing entry file: ${entry}`);
        else await visit(record);
    }
    const repaintCache = new Map(), repaintBitmaps = new Set();
    let repaintDisposed = false;
    const repaintTextures = {
        async importFiles(files, isCurrent = () => true) {
            if (repaintDisposed) throw new Error("The repaint scene has been closed");
            const records = [], keys = new Set();
            for (const file of files) {
                const path = normalize(file.webkitRelativePath || file.name);
                if (!path) throw new Error(`Invalid repaint file path: ${file.webkitRelativePath || file.name}`);
                if (!["cti", "dds", "tga", "png", "jpg", "jpeg", "bmp", "gif", "webp"].includes(extension(path))) continue;
                const key = path.toLowerCase();
                if (folded.has(key) || keys.has(key)) throw new Error(`Repaint file path already exists: ${path}`);
                keys.add(key);
                records.push({ path, file });
            }
            const ctiRecords = records.filter(record => extension(record.path) === "cti");
            if (!records.length) throw new Error("Select CTI files or supported textures");
            const importedWarnings = [];
            const ctis = await Promise.all(ctiRecords.map(async record => {
                const parsed = parseCTI(decodeConfiguration(await record.file.arrayBuffer()));
                importedWarnings.push(...parsed.warnings.map(warning => `${record.path}: ${warning}`));
                return { source: record.path, items: parsed.items };
            }));
            if (repaintDisposed || !isCurrent()) throw new Error("The repaint import was superseded");
            for (const record of records) {
                if (folded.has(record.path.toLowerCase())) throw new Error(`Repaint file path already exists: ${record.path}`);
            }
            for (const record of records) {
                byPath.set(record.path, record);
                folded.set(record.path.toLowerCase(), record);
            }
            return { ctis, warnings: importedWarnings };
        },
        async load(source, name) {
            if (repaintDisposed) throw new Error("The repaint scene has been closed");
            const record = findTexture(source, name);
            if (!record) throw new Error(`${source}: repaint texture "${name}" not found in selected files`);
            if (!repaintCache.has(record)) {
                repaintCache.set(record, read(record).then(buffer =>
                    (options.decodeTexture || decodeTexture)(record, buffer)).then(texture => {
                    if (repaintDisposed) {
                        texture.bitmap.close();
                        throw new Error("The repaint scene has been closed");
                    }
                    repaintBitmaps.add(texture.bitmap);
                    return texture;
                }));
            }
            return repaintCache.get(record);
        },
        dispose() {
            if (repaintDisposed) return;
            repaintDisposed = true;
            for (const bitmap of repaintBitmaps) bitmap.close();
            repaintBitmaps.clear();
        },
    };
    return { models, lights, lods, hierarchy, warnings, repaintGroups, repaintTextures };
}
