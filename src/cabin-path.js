/*
 * OMSI cabin paths, based on O3DParse/OmsiStructs/OmsiPaths.cs and
 * O3DView/Gizmos/CabinPathGizmo.cs (GPL-3.0).
 */
import { placeMapVertices } from "./map-transform.js";
import { replaceSceneGeometry } from "./scene-transforms.js";

const TAG = /^\s*\[([^\[\]]+)\]\s*$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const INTEGER = /^[+-]?\d+$/;

export function parseCabinPaths(text) {
    if (typeof text !== "string") throw new TypeError("Expected cabin path text");
    const lines = text.split(/\r\n|\n|\r/), points = [], pointLines = [], links = [], warnings = [];
    let disabled = false, roomHeight = 0, stepSound = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("-<DISABLED>-")) { disabled = true; continue; }
        if (line.startsWith("-<ENABLED>-")) { disabled = false; continue; }
        if (disabled) continue;
        const tag = TAG.exec(line)?.[1].trim().toLowerCase();
        if (!["pathpnt", "pathlink", "pathlink_oneway", "next_roomheight", "next_stepsound"].includes(tag)) continue;
        const lineNumber = i + 1;
        if (tag === "pathpnt") pointLines.push(lineNumber);
        const count = tag === "pathpnt" ? 3 : tag.startsWith("pathlink") ? 2 : 1;
        const fields = lines.slice(i + 1, i + 1 + count).map(value => value.trim());
        if (fields.length !== count || fields.some(value => !value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value))) {
            warnings.push(`line ${lineNumber}: [${tag}] has missing fields`);
            if (tag === "pathpnt") points.push(null);
            continue;
        }
        i += count;
        const integer = tag.startsWith("pathlink") || tag === "next_stepsound";
        const values = fields.map(value => (integer ? INTEGER : NUMBER).test(value) ? Number(value) : NaN);
        if (!values.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))) ||
            (integer && !values.every(Number.isSafeInteger))) {
            warnings.push(`line ${lineNumber}: [${tag}] has invalid numeric fields`);
            if (tag === "pathpnt") points.push(null);
            continue;
        }
        if (tag === "pathpnt") points.push(values.map(Math.fround));
        else if (tag.startsWith("pathlink")) links.push({ a: values[0], b: values[1], oneWay: tag.endsWith("_oneway"), roomHeight, stepSound, line: lineNumber });
        else if (tag === "next_roomheight") roomHeight = Math.fround(values[0]);
        else stepSound = values[0];
    }
    return { points, pointLines, links, warnings };
}

export function parsePassengerCabin(text) {
    if (typeof text !== "string") throw new TypeError("Expected passenger cabin text");
    const lines = text.split(/\r\n|\n|\r/), items = [], warnings = [];
    const counts = { entry: 0, exit: 0, seat: 0 };
    let disabled = false;
    const tags = {
        entry: ["Entry", 1, "index"], exit: ["Exit", 1, "index"],
        linktonextveh: ["Link To Next Veh", 1, "index"], linktoprevveh: ["Link To Prev Veh", 1, "index"],
        passpos: ["Seat", 5, "seat"], drivpos: ["Seat", 5, "seat"],
        stamper: ["Stamper", 4, "indexedPosition"], ticket_sale: ["Ticket Sale Point", 4, "indexedPosition"],
        ticket_sale_money_point: ["Ticket Money Point", 5, "point"],
        ticket_sale_money_point_2: ["Ticket Money Point", 6, "point"],
        ticket_sale_change_point: ["Ticket Change Point", 5, "point"],
        ticket_sale_change_point_2: ["Ticket Change Point", 6, "point"],
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("-<DISABLED>-")) { disabled = true; continue; }
        if (line.startsWith("-<ENABLED>-")) { disabled = false; continue; }
        if (disabled) continue;
        const tag = TAG.exec(line)?.[1].trim().toLowerCase(), definition = tags[tag];
        if (!definition) continue;
        const [label, count, kind] = definition, lineNumber = i + 1;
        const fields = lines.slice(i + 1, i + 1 + count).map(value => value.trim());
        if (fields.length !== count || fields.some(value => !value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value))) {
            warnings.push(`line ${lineNumber}: [${tag}] has missing fields`);
            continue;
        }
        i += count;
        const numeric = fields.slice(0, tag.endsWith("_2") ? -1 : undefined);
        const values = numeric.map(value => NUMBER.test(value) ? Number(value) : NaN);
        if (!values.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))) ||
            (["index", "indexedPosition"].includes(kind) && (!INTEGER.test(numeric[0]) || !Number.isSafeInteger(values[0])))) {
            warnings.push(`line ${lineNumber}: [${tag}] has invalid numeric fields`);
            continue;
        }
        const key = kind === "seat" ? "seat" : tag;
        const name = key in counts ? `${label} ${counts[key]++}` : label;
        const item = { name, kind: tag, line: lineNumber };
        if (kind === "index" || kind === "indexedPosition") item.pathPoint = values[0];
        if (kind === "seat") Object.assign(item, { position: values.slice(0, 3), height: values[3], rotation: values[4] });
        if (kind === "indexedPosition") item.position = values.slice(1, 4);
        if (kind === "point") {
            item.position = values.slice(0, 3);
            item.variation = values.slice(3, 5);
            if (tag.endsWith("_2")) item.parent = fields[5];
        }
        items.push(item);
    }
    return { items, warnings };
}

export function generateCabinPathMesh(paths) {
    if (paths.links.length > 166666) throw new RangeError("Cabin path has too many links");
    const vertices = [], triangles = [], warnings = [];
    for (const link of paths.links) {
        const a = paths.points[link.a], b = paths.points[link.b];
        if (!a || !b) {
            warnings.push(`line ${link.line}: path link references a missing point; skipped`);
            continue;
        }

        const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
        if (!Number.isFinite(length) || length < 1e-12) {
            warnings.push(`line ${link.line}: path link has no horizontal length; skipped`);
            continue;
        }
        const leftX = dz / length * 0.1, leftZ = -dx / length * 0.1;
        const left = point => [point[0] + leftX, point[2], point[1] + leftZ];
        const right = point => [point[0] - leftX, point[2], point[1] - leftZ];
        const base = vertices.length / 8;
        for (const position of [right(a), left(a), left(b), right(a), left(b), right(b)]) {
            vertices.push(...position, 0, 1, 0, 0, 0);
        }
        triangles.push(base + 2, base + 1, base, 0, base + 5, base + 4, base + 3, 0);
    }
    const packed = new Float32Array(vertices);
    if (!packed.every(Number.isFinite)) throw new RangeError("Cabin path exceeds 32-bit float range");
    return { vertices: packed, triangles: new Uint32Array(triangles), warnings };
}

function rebuildCabinPaths(state, paths, renderer, models, manual, config, viewpoint, selected) {
    const geometry = generateCabinPathMesh(paths);
    if (state.modelIndex === null) {
        if (geometry.triangles.length) throw new Error("Creating a previously absent cabin path mesh is not supported");
    } else {
        const model = models[state.modelIndex];
        if (!model) throw new RangeError("Cabin path model is missing");
        const vertices = state.placement ? placeMapVertices(geometry.vertices, state.placement) : geometry.vertices;
        replaceSceneGeometry(renderer, models, state.modelIndex, vertices, geometry.triangles,
            model.worldTranslation ?? [0, 0, 0], manual, config, viewpoint, selected);
    }
    return geometry.warnings;
}

export function updateCabinPathPoint(state, index, position, renderer, models, manual, config, viewpoint, selected) {
    if (!state?.paths?.points[index] || !Number.isInteger(index)) throw new RangeError("Invalid cabin path point");
    if (!Array.isArray(position) || position.length !== 3 ||
        !position.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
        throw new TypeError("Position must contain three finite 32-bit numbers");
    }
    const points = state.paths.points.slice();
    points[index] = position.map(Math.fround);
    const warnings = rebuildCabinPaths(state, { ...state.paths, points }, renderer, models, manual, config, viewpoint, selected);
    state.paths.points[index].splice(0, 3, ...points[index]);
    return warnings;
}

export function updateCabinPathLink(state, index, changes, renderer, models, manual, config, viewpoint, selected) {
    if (!Number.isInteger(index) || !state?.paths?.links[index]) throw new RangeError("Invalid cabin path link");
    const { a, b, oneWay, roomHeight, stepSound } = changes;
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !state.paths.points[a] || !state.paths.points[b]) {
        throw new RangeError("Both endpoints must reference existing cabin path points");
    }
    if (typeof oneWay !== "boolean" || !Number.isFinite(roomHeight) || !Number.isFinite(Math.fround(roomHeight)) ||
        !Number.isSafeInteger(stepSound)) throw new TypeError("Invalid cabin path link properties");
    const link = { ...state.paths.links[index], a, b, oneWay, roomHeight: Math.fround(roomHeight), stepSound };
    const links = state.paths.links.slice();
    links[index] = link;
    const warnings = rebuildCabinPaths(state, { ...state.paths, links }, renderer, models, manual, config, viewpoint, selected);
    Object.assign(state.paths.links[index], link);
    return warnings;
}
