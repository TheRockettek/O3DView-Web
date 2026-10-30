/*
 * OMSI cabin paths, based on O3DParse/OmsiStructs/OmsiPaths.cs and
 * O3DView/Gizmos/CabinPathGizmo.cs (GPL-3.0).
 */
import { placeMapVertices } from "./map-transform.js";
import { replaceSceneGeometry } from "./scene-transforms.js";

const TAG = /^\s*\[([^\[\]]+)\]\s*$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const INTEGER = /^[+-]?\d+$/;

export function cabinPathPointWorldPosition(position, placement) {
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(
      (value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)),
    )
  ) {
    throw new TypeError("Invalid cabin path point position");
  }
  const vertices = new Float32Array(8);
  vertices.set([position[0], position[2], position[1]]);
  const world = placement ? placeMapVertices(vertices, placement) : vertices;
  const result = [...world.slice(0, 3)];
  if (!result.every(Number.isFinite))
    throw new RangeError("Cabin path point exceeds 32-bit float range");
  return result;
}

export function parseCabinPaths(text) {
  if (typeof text !== "string") throw new TypeError("Expected cabin path text");
  const lines = text.split(/\r\n|\n|\r/),
    points = [],
    pointLines = [],
    links = [],
    warnings = [];
  let disabled = false,
    roomHeight = 0,
    stepSound = 0;
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
    if (
      ![
        "pathpnt",
        "pathlink",
        "pathlink_oneway",
        "next_roomheight",
        "next_stepsound",
      ].includes(tag)
    )
      continue;
    const lineNumber = i + 1;
    if (tag === "pathpnt") pointLines.push(lineNumber);
    const count = tag === "pathpnt" ? 3 : tag.startsWith("pathlink") ? 2 : 1;
    const fields = lines
      .slice(i + 1, i + 1 + count)
      .map((value) => value.trim());
    if (
      fields.length !== count ||
      fields.some(
        (value) =>
          !value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value),
      )
    ) {
      warnings.push(`line ${lineNumber}: [${tag}] has missing fields`);
      if (tag === "pathpnt") points.push(null);
      continue;
    }
    i += count;
    const integer = tag.startsWith("pathlink") || tag === "next_stepsound";
    const values = fields.map((value) =>
      (integer ? INTEGER : NUMBER).test(value) ? Number(value) : NaN,
    );
    if (
      !values.every(
        (value) =>
          Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      ) ||
      (integer && !values.every(Number.isSafeInteger))
    ) {
      warnings.push(`line ${lineNumber}: [${tag}] has invalid numeric fields`);
      if (tag === "pathpnt") points.push(null);
      continue;
    }
    if (tag === "pathpnt") points.push(values.map(Math.fround));
    else if (tag.startsWith("pathlink"))
      links.push({
        a: values[0],
        b: values[1],
        oneWay: tag.endsWith("_oneway"),
        roomHeight,
        stepSound,
        line: lineNumber,
      });
    else if (tag === "next_roomheight") roomHeight = Math.fround(values[0]);
    else stepSound = values[0];
  }
  return { points, pointLines, links, warnings };
}

export function parsePassengerCabin(text) {
  if (typeof text !== "string")
    throw new TypeError("Expected passenger cabin text");
  const lines = text.split(/\r\n|\n|\r/),
    items = [],
    warnings = [];
  const counts = { entry: 0, exit: 0, seat: 0 };
  let disabled = false;
  const tags = {
    entry: ["Entry", 1, "index"],
    exit: ["Exit", 1, "index"],
    linktonextveh: ["Link To Next Veh", 1, "index"],
    linktoprevveh: ["Link To Prev Veh", 1, "index"],
    passpos: ["Seat", 5, "seat"],
    drivpos: ["Seat", 5, "seat"],
    stamper: ["Stamper", 4, "indexedPosition"],
    ticket_sale: ["Ticket Sale Point", 4, "indexedPosition"],
    ticket_sale_money_point: ["Ticket Money Point", 5, "point"],
    ticket_sale_money_point_2: ["Ticket Money Point", 6, "point"],
    ticket_sale_change_point: ["Ticket Change Point", 5, "point"],
    ticket_sale_change_point_2: ["Ticket Change Point", 6, "point"],
  };
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
    const tag = TAG.exec(line)?.[1].trim().toLowerCase(),
      definition = tags[tag];
    if (!definition) continue;
    const [label, count, kind] = definition,
      lineNumber = i + 1;
    const fields = lines
      .slice(i + 1, i + 1 + count)
      .map((value) => value.trim());
    if (
      fields.length !== count ||
      fields.some(
        (value) =>
          !value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value),
      )
    ) {
      warnings.push(`line ${lineNumber}: [${tag}] has missing fields`);
      continue;
    }
    i += count;
    const numeric = fields.slice(0, tag.endsWith("_2") ? -1 : undefined);
    const values = numeric.map((value) =>
      NUMBER.test(value) ? Number(value) : NaN,
    );
    if (
      !values.every(
        (value) =>
          Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      ) ||
      (["index", "indexedPosition"].includes(kind) &&
        (!INTEGER.test(numeric[0]) || !Number.isSafeInteger(values[0])))
    ) {
      warnings.push(`line ${lineNumber}: [${tag}] has invalid numeric fields`);
      continue;
    }
    const key = kind === "seat" ? "seat" : tag;
    const name = key in counts ? `${label} ${counts[key]++}` : label;
    const item = { name, kind: tag, line: lineNumber };
    if (kind === "index" || kind === "indexedPosition")
      item.pathPoint = values[0];
    if (kind === "seat") {
      Object.assign(item, {
        position: values.slice(0, 3),
        height: values[3],
        rotation: values[4],
      });
      if (lines[i + 1]?.trim().toLowerCase() === "[illumination_interior]") {
        const referenceLine = i + 2;
        const referenceFields = lines
          .slice(referenceLine, referenceLine + 4)
          .map((value) => value.trim());
        const references = referenceFields.map((value) => Number(value));
        if (
          referenceFields.length !== 4 ||
          !referenceFields.every(
            (value, index) =>
              INTEGER.test(value) &&
              Number.isSafeInteger(references[index]) &&
              references[index] >= -1,
          )
        ) {
          warnings.push(
            `line ${i + 2}: [illumination_interior] has invalid light indices`,
          );
          i++;
        } else {
          item.illuminationInterior = references;
          i += 5;
        }
      }
    }
    if (kind === "indexedPosition") item.position = values.slice(1, 4);
    if (kind === "point") {
      item.position = values.slice(0, 3);
      item.variation = values.slice(3, 5);
      if (tag.endsWith("_2")) item.parent = fields[5];
    }
    if (tag === "entry") {
      let optionIndex = i + 1;
      while (optionIndex < lines.length) {
        const option = lines[optionIndex].trim().toLowerCase();
        if (option === "{noticketsale}") item.noTicketSale = true;
        else if (option === "{withbutton}") item.withButton = true;
        else break;
        optionIndex++;
      }
      i = optionIndex - 1;
    }
    items.push(item);
  }
  return { items, warnings };
}

const CABIN_MARKER_RADIUS = 0.075;
const CABIN_MARKER_DIRECTIONS = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 0, -1],
  [0, -1, 0],
];
const CABIN_SEAT_MARKER_POSITIONS = [
  [0, 0.06, 0],
  [0.12, 0, -0.04],
  [0, 0, 0.28],
  [-0.12, 0, -0.04],
  [0, 0, -0.18],
  [0, -0.03, 0],
];
const CABIN_MARKER_FACES = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 4],
  [0, 4, 1],
  [5, 2, 1],
  [5, 3, 2],
  [5, 4, 3],
  [5, 1, 4],
];
export const CABIN_MARKER_TRIANGLE_COUNT = CABIN_MARKER_FACES.length;
export const CABIN_PATH_LINK_TRIANGLE_COUNT = 2;
export const CABIN_MARKER_COLORS = [
  [0.2, 0.75, 1, 1],
  [1, 0.75, 0.2, 1],
  [1, 0.5, 0.15, 1],
  [0.2, 0.85, 0.55, 1],
  [0.9, 0.35, 0.85, 1],
  [0.25, 0.9, 0.35, 1],
  [0.95, 0.25, 0.25, 1],
];

export function cabinMarkerIcon(kind) {
  if (typeof kind !== "string") return null;
  if (kind === "passpos" || kind === "drivpos") return "gizmo_seat.png";
  if (kind === "entry") return "gizmo_entry.png";
  if (kind === "exit") return "gizmo_exit.png";
  if (kind === "linktonextveh") return "gizmo_link_next.png";
  if (kind === "linktoprevveh") return "gizmo_link_prev.png";
  if (kind === "stamper") return "gizmo_stamper.png";
  if (kind === "ticket_sale") return "gizmo_ticket_sale.png";
  if (kind.startsWith("ticket_sale_money_point"))
    return "gizmo_ticket_money.png";
  if (kind.startsWith("ticket_sale_change_point"))
    return "gizmo_ticket_change.png";
  return null;
}

function cabinMarkerMaterialIndex(kind) {
  if (typeof kind !== "string") return 0;
  if (kind === "stamper") return 1;
  if (kind === "ticket_sale") return 2;
  if (kind.startsWith("ticket_sale_money_point")) return 3;
  if (kind.startsWith("ticket_sale_change_point")) return 4;
  if (kind === "entry") return 5;
  if (kind === "exit") return 6;
  return 0;
}

function appendCabinMarkers(vertices, triangles, items) {
  if (items.length > 166666)
    throw new RangeError("Cabin has too many positioned records");
  for (const item of items) {
    if (item === null) continue;
    const position = Array.isArray(item) ? item : item?.position;
    if (
      !Array.isArray(position) ||
      position.length !== 3 ||
      !position.every(
        (value) =>
          Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      )
    ) {
      throw new TypeError("Invalid cabin marker position");
    }
    const center = [position[0], position[2], position[1]];
    const isSeat = ["passpos", "drivpos"].includes(item?.kind);
    const seatRotation = item?.rotation ?? 0;
    if (
      isSeat &&
      (!Number.isFinite(seatRotation) ||
        !Number.isFinite(Math.fround(seatRotation)))
    ) {
      throw new TypeError("Invalid cabin seat rotation");
    }
    const rotation = isSeat ? (seatRotation * Math.PI) / 180 : 0;
    if (!Number.isFinite(rotation))
      throw new TypeError("Invalid cabin seat rotation");
    const cos = Math.cos(rotation),
      sin = Math.sin(rotation);
    const rotate = ([x, y, z]) => [x * cos + z * sin, y, -x * sin + z * cos];
    const markerPositions = isSeat
      ? CABIN_SEAT_MARKER_POSITIONS.map(rotate)
      : CABIN_MARKER_DIRECTIONS.map((direction) =>
          direction.map((value) => value * CABIN_MARKER_RADIUS),
        );
    const markerNormals = isSeat
      ? CABIN_MARKER_DIRECTIONS.map(rotate)
      : CABIN_MARKER_DIRECTIONS;
    const base = vertices.length / 8;
    for (const [index, offset] of markerPositions.entries()) {
      const normal = markerNormals[index];
      vertices.push(
        center[0] + offset[0],
        center[1] + offset[1],
        center[2] + offset[2],
        ...normal,
        0,
        0,
      );
    }
    for (const face of CABIN_MARKER_FACES) {
      let [a, b, c] = face;
      const first = markerPositions[b].map(
        (value, axis) => value - markerPositions[a][axis],
      );
      const second = markerPositions[c].map(
        (value, axis) => value - markerPositions[a][axis],
      );
      const normal = [
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
      ];
      const outward = normal.reduce(
        (sum, value, axis) =>
          sum +
          value *
            (markerPositions[a][axis] +
              markerPositions[b][axis] +
              markerPositions[c][axis]),
        0,
      );
      if (outward < 0) [b, c] = [c, b];
      triangles.push(
        base + a,
        base + b,
        base + c,
        cabinMarkerMaterialIndex(item?.kind),
      );
    }
  }
}

export function generateCabinMarkerMesh(items, placement, preview = null) {
  if (!Array.isArray(items))
    throw new TypeError("Cabin marker positions must be an array");
  const vertices = [],
    triangles = [];
  appendCabinMarkers(vertices, triangles, items);
  const previewGeometry = appendCabinSeatPreview(
    vertices,
    triangles,
    items,
    preview,
  );
  const packed = new Float32Array(vertices);
  const world = placement ? placeMapVertices(packed, placement) : packed;
  if (!world.every(Number.isFinite))
    throw new RangeError("Cabin marker exceeds 32-bit float range");
  return {
    vertices: world,
    triangles: new Uint32Array(triangles),
    previewTriangleStart: previewGeometry?.triangleStart ?? null,
    previewVertexStart: previewGeometry?.vertexStart ?? null,
  };
}

function appendCabinSeatPreview(vertices, triangles, items, preview) {
  if (!preview) return null;
  const { item, models, materialIndices } = preview;
  if (
    !items.includes(item) ||
    !["passpos", "drivpos"].includes(item?.kind) ||
    !Array.isArray(item.position)
  ) {
    throw new TypeError("Invalid cabin seat preview item");
  }
  const standing = item.height === 0;
  const model = standing ? models?.standing : models?.sitting;
  const materialIndex = standing
    ? materialIndices?.standing
    : materialIndices?.sitting;
  if (
    !(model?.vertices instanceof Float32Array) ||
    model.vertices.length % 8 ||
    !(model.triangles instanceof Uint32Array) ||
    model.triangles.length % 4 ||
    !Array.isArray(model.materials) ||
    !Number.isInteger(materialIndex) ||
    materialIndex < 0
  ) {
    throw new TypeError("Invalid cabin seat preview geometry");
  }
  const rotation = (item.rotation * Math.PI) / 180;
  if (!Number.isFinite(rotation))
    throw new TypeError("Invalid cabin seat preview rotation");
  const cos = Math.cos(rotation),
    sin = Math.sin(rotation);
  const center = [item.position[0], item.position[2], item.position[1]];
  const vertexOffset = vertices.length / 8;
  const triangleStart = triangles.length / 4;
  for (let i = 0; i < model.vertices.length; i += 8) {
    const [x, y, z, nx, ny, nz, u, v] = model.vertices.subarray(i, i + 8);
    vertices.push(
      center[0] + x * cos + z * sin,
      center[1] + y,
      center[2] - x * sin + z * cos,
      nx * cos + nz * sin,
      ny,
      -nx * sin + nz * cos,
      u,
      v,
    );
  }
  for (let i = 0; i < model.triangles.length; i += 4) {
    const [a, b, c, material] = model.triangles.subarray(i, i + 4);
    if (
      a >= model.vertices.length / 8 ||
      b >= model.vertices.length / 8 ||
      c >= model.vertices.length / 8 ||
      material >= model.materials.length
    ) {
      throw new RangeError("Cabin seat preview references invalid geometry");
    }
    triangles.push(
      vertexOffset + a,
      vertexOffset + b,
      vertexOffset + c,
      materialIndex + material,
    );
  }
  return {
    triangleStart,
    vertexStart: vertexOffset,
  };
}

function updateCabinMarkerValues(
  markerModel,
  item,
  changes,
  renderer,
  models,
  manual,
  config,
  viewpoint,
  selected,
) {
  const modelIndex = models.indexOf(markerModel);
  if (
    modelIndex < 0 ||
    !Array.isArray(markerModel.cabinMarkerItems) ||
    !markerModel.cabinMarkerItems.includes(item)
  ) {
    throw new RangeError("Cabin marker item is missing");
  }
  const previous = Object.fromEntries(
    Object.keys(changes).map((key) => [key, item[key]]),
  );
  Object.assign(item, changes);
  try {
    const geometry = generateCabinMarkerMesh(
      markerModel.cabinMarkerItems,
      markerModel.mapPlacement,
      markerModel.cabinSeatPreview,
    );
    replaceSceneGeometry(
      renderer,
      models,
      modelIndex,
      geometry.vertices,
      geometry.triangles,
      markerModel.worldTranslation ?? [0, 0, 0],
      manual,
      config,
      viewpoint,
      selected,
    );
    markerModel.cabinSeatPreviewTriangleStart = geometry.previewTriangleStart;
    markerModel.cabinSeatPreviewVertexStart = geometry.previewVertexStart;
  } catch (error) {
    Object.assign(item, previous);
    throw error;
  }
}

export function updateCabinSeatPreview(
  markerModel,
  item,
  models,
  renderer,
  sceneModels,
  manual,
  config,
  viewpoint,
  selected,
) {
  const nextPreview = item ? { item, models, materialIndices: null } : null;
  const modelIndex = sceneModels.indexOf(markerModel);
  if (
    modelIndex < 0 ||
    !Array.isArray(markerModel.cabinMarkerItems) ||
    (item &&
      (!markerModel.cabinMarkerItems.includes(item) ||
        !["passpos", "drivpos"].includes(item.kind))) ||
    (item &&
      (!models?.standing?.materials?.length ||
        !models?.sitting?.materials?.length))
  ) {
    throw new RangeError("Cabin seat preview data is missing");
  }
  const previous = markerModel.cabinSeatPreview;
  const previousMaterialLength = markerModel.materials.length;
  const previousMaterialStart = markerModel.cabinSeatPreviewMaterialStart;
  const previousMaterialIndices = markerModel.cabinSeatPreviewMaterialIndices;
  if (!item && !previous) return;
  if (nextPreview) {
    if (!markerModel.cabinSeatPreviewMaterialIndices) {
      const base = markerModel.materials.length;
      markerModel.cabinSeatPreviewMaterialStart = base;
      markerModel.materials.push(
        ...models.standing.materials,
        ...models.sitting.materials,
      );
      markerModel.cabinSeatPreviewMaterialIndices = {
        standing: base,
        sitting: base + models.standing.materials.length,
      };
    }
    nextPreview.materialIndices = markerModel.cabinSeatPreviewMaterialIndices;
  }
  markerModel.cabinSeatPreview = nextPreview;
  try {
    updateCabinMarkerValues(
      markerModel,
      item ?? previous?.item,
      {},
      renderer,
      sceneModels,
      manual,
      config,
      viewpoint,
      selected,
    );
  } catch (error) {
    markerModel.cabinSeatPreview = previous;
    markerModel.materials.length = previousMaterialLength;
    markerModel.cabinSeatPreviewMaterialStart = previousMaterialStart;
    markerModel.cabinSeatPreviewMaterialIndices = previousMaterialIndices;
    throw error;
  }
}

export function cabinMarkerExportModel(model) {
  const materialStart = model?.cabinSeatPreviewMaterialStart;
  if (!Number.isInteger(materialStart)) return model;
  if (
    !(model.vertices instanceof Float32Array) ||
    model.vertices.length % 8 ||
    !(model.triangles instanceof Uint32Array) ||
    model.triangles.length % 4 ||
    !Array.isArray(model.materials)
  ) {
    throw new TypeError("Invalid cabin marker model");
  }
  const vertexStart = Number.isInteger(model.cabinSeatPreviewVertexStart)
      ? model.cabinSeatPreviewVertexStart
      : model.vertices.length / 8,
    triangleStart = Number.isInteger(model.cabinSeatPreviewTriangleStart)
      ? model.cabinSeatPreviewTriangleStart
      : model.triangles.length / 4;
  if (
    vertexStart < 0 ||
    vertexStart > model.vertices.length / 8 ||
    triangleStart < 0 ||
    triangleStart > model.triangles.length / 4 ||
    materialStart < 0 ||
    materialStart > model.materials.length
  ) {
    throw new RangeError("Invalid cabin seat preview bounds");
  }
  return {
    ...model,
    vertices: model.vertices.slice(0, vertexStart * 8),
    triangles: model.triangles.slice(0, triangleStart * 4),
    materials: model.materials.slice(0, materialStart),
  };
}

export function updateCabinMarkerPosition(
  markerModel,
  item,
  position,
  renderer,
  models,
  manual,
  config,
  viewpoint,
  selected,
) {
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(
      (value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)),
    )
  ) {
    throw new TypeError("Position must contain three finite 32-bit numbers");
  }
  updateCabinMarkerValues(
    markerModel,
    item,
    { position: position.map(Math.fround) },
    renderer,
    models,
    manual,
    config,
    viewpoint,
    selected,
  );
}

export function updateCabinSeatProperties(
  markerModel,
  item,
  height,
  rotation,
  renderer,
  models,
  manual,
  config,
  viewpoint,
  selected,
) {
  if (!["passpos", "drivpos"].includes(item?.kind))
    throw new TypeError("Cabin item is not a seat");
  if (
    !Number.isFinite(height) ||
    !Number.isFinite(Math.fround(height)) ||
    !Number.isFinite(rotation) ||
    !Number.isFinite(Math.fround(rotation))
  ) {
    throw new TypeError(
      "Seat height and rotation must be finite 32-bit numbers",
    );
  }
  updateCabinMarkerValues(
    markerModel,
    item,
    { height: Math.fround(height), rotation: Math.fround(rotation) },
    renderer,
    models,
    manual,
    config,
    viewpoint,
    selected,
  );
}

export function generateCabinPathMesh(paths, specialMarkerItems = []) {
  if (!Array.isArray(specialMarkerItems))
    throw new TypeError("Cabin path markers must be an array");
  if (paths.links.length > 166666)
    throw new RangeError("Cabin path has too many links");
  if (paths.points.length > 166666)
    throw new RangeError("Cabin path has too many points");
  const vertices = [],
    triangles = [],
    warnings = [],
    linkIndices = [];
  for (let linkIndex = 0; linkIndex < paths.links.length; linkIndex++) {
    const link = paths.links[linkIndex];
    const a = paths.points[link.a],
      b = paths.points[link.b];
    if (!a || !b) {
      warnings.push(
        `line ${link.line}: path link references a missing point; skipped`,
      );
      continue;
    }

    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 1e-12) {
      warnings.push(
        `line ${link.line}: path link has no horizontal length; skipped`,
      );
      continue;
    }
    const leftX = (dz / length) * 0.1,
      leftZ = (-dx / length) * 0.1;
    const left = (point) => [point[0] + leftX, point[2], point[1] + leftZ];
    const right = (point) => [point[0] - leftX, point[2], point[1] - leftZ];
    const base = vertices.length / 8;
    for (const position of [
      right(a),
      left(a),
      left(b),
      right(a),
      left(b),
      right(b),
    ]) {
      vertices.push(...position, 0, 1, 0, 0, 0);
    }
    triangles.push(
      base + 2,
      base + 1,
      base,
      0,
      base + 5,
      base + 4,
      base + 3,
      0,
    );
    linkIndices.push(linkIndex);
  }
  const pointMarkerTriangleStart = triangles.length / 4;
  appendCabinMarkers(vertices, triangles, paths.points);
  const specialMarkerTriangleStart = triangles.length / 4;
  appendCabinMarkers(
    vertices,
    triangles,
    specialMarkerItems.map((item) => {
      const position = paths.points[item?.pathPoint];
      if (!Number.isInteger(item?.pathPoint) || !position) return item;
      const offset =
        item.kind === "entry" ? -0.12 : item.kind === "exit" ? 0.12 : 0;
      return {
        ...item,
        position: [position[0] + offset, position[1], position[2]],
      };
    }),
  );
  const packed = new Float32Array(vertices);
  if (!packed.every(Number.isFinite))
    throw new RangeError("Cabin path exceeds 32-bit float range");
  return {
    vertices: packed,
    triangles: new Uint32Array(triangles),
    warnings,
    linkIndices,
    pointMarkerTriangleStart,
    specialMarkerTriangleStart,
  };
}

function rebuildCabinPaths(
  state,
  paths,
  renderer,
  models,
  manual,
  config,
  viewpoint,
  selected,
) {
  const geometry = generateCabinPathMesh(paths, state.specialMarkerItems ?? []);
  if (state.modelIndex === null) {
    if (geometry.triangles.length)
      throw new Error(
        "Creating a previously absent cabin path mesh is not supported",
      );
  } else {
    const model = models[state.modelIndex];
    if (!model) throw new RangeError("Cabin path model is missing");
    const vertices = state.placement
      ? placeMapVertices(geometry.vertices, state.placement)
      : geometry.vertices;
    replaceSceneGeometry(
      renderer,
      models,
      state.modelIndex,
      vertices,
      geometry.triangles,
      model.worldTranslation ?? [0, 0, 0],
      manual,
      config,
      viewpoint,
      selected,
    );
    model.cabinPathLinkItems = geometry.linkIndices.map(
      (index) => model.cabinPathAllLinkItems[index],
    );
    model.cabinPathPointMarkerTriangleStart = geometry.pointMarkerTriangleStart;
    model.cabinPathSpecialMarkerTriangleStart =
      geometry.specialMarkerTriangleStart;
  }
  return geometry.warnings;
}

export function updateCabinPathPoint(
  state,
  index,
  position,
  renderer,
  models,
  manual,
  config,
  viewpoint,
  selected,
) {
  if (!state?.paths?.points[index] || !Number.isInteger(index))
    throw new RangeError("Invalid cabin path point");
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(
      (value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)),
    )
  ) {
    throw new TypeError("Position must contain three finite 32-bit numbers");
  }
  const points = state.paths.points.slice();
  points[index] = position.map(Math.fround);
  const warnings = rebuildCabinPaths(
    state,
    { ...state.paths, points },
    renderer,
    models,
    manual,
    config,
    viewpoint,
    selected,
  );
  state.paths.points[index].splice(0, 3, ...points[index]);
  return warnings;
}

export function updateCabinPathReference(
  state,
  item,
  pathPoint,
  renderer,
  models,
  manual,
  config,
  viewpoint,
  selected,
) {
  if (!Number.isSafeInteger(pathPoint) || !state?.paths?.points[pathPoint]) {
    throw new RangeError("Path reference must target an existing cabin point");
  }
  if (!Number.isSafeInteger(item?.pathPoint))
    throw new TypeError("Cabin item has no valid path reference");
  const previous = {
    pathPoint: item.pathPoint,
    position: item.position,
  };
  item.pathPoint = pathPoint;
  if (["entry", "exit", "linktonextveh", "linktoprevveh"].includes(item.kind))
    item.position = state.paths.points[pathPoint];
  try {
    if (!state.specialMarkerItems?.includes(item)) return [];
    return rebuildCabinPaths(
      state,
      state.paths,
      renderer,
      models,
      manual,
      config,
      viewpoint,
      selected,
    );
  } catch (error) {
    item.pathPoint = previous.pathPoint;
    item.position = previous.position;
    throw error;
  }
}

export function updateCabinPathLink(
  state,
  index,
  changes,
  renderer,
  models,
  manual,
  config,
  viewpoint,
  selected,
) {
  if (!Number.isInteger(index) || !state?.paths?.links[index])
    throw new RangeError("Invalid cabin path link");
  const { a, b, oneWay, roomHeight, stepSound } = changes;
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    !state.paths.points[a] ||
    !state.paths.points[b]
  ) {
    throw new RangeError(
      "Both endpoints must reference existing cabin path points",
    );
  }
  if (
    typeof oneWay !== "boolean" ||
    !Number.isFinite(roomHeight) ||
    !Number.isFinite(Math.fround(roomHeight)) ||
    !Number.isSafeInteger(stepSound)
  )
    throw new TypeError("Invalid cabin path link properties");
  const link = {
    ...state.paths.links[index],
    a,
    b,
    oneWay,
    roomHeight: Math.fround(roomHeight),
    stepSound,
  };
  const links = state.paths.links.slice();
  links[index] = link;
  const warnings = rebuildCabinPaths(
    state,
    { ...state.paths, links },
    renderer,
    models,
    manual,
    config,
    viewpoint,
    selected,
  );
  Object.assign(state.paths.links[index], link);
  return warnings;
}
