/*
 * Partial OMSI map tile reader, based on O3DView/O3DParse/OmsiStructs/
 * OmsiMapTile.cs and O3DView/O3DView/FileLoader.cs (GPL-3.0).
 */

const tagPattern = /^\s*\[([^\[\]]+)\]\s*$/;
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Parse decoded map text (or an array of lines). Decode UTF-16LE BOM files
 * before calling. Returns {version, terrain, variableTerrainLightmap,
 * variableTerrain, sceneObjects, splines, attachObjects, splineAttachments,
 * warnings}; all arrays retain file order and records have one-based `line`.
 *
 * Positions are untransformed file coordinates: object positions are
 * {x, z, y} in file order; spline positions are {x, y, z}. Angles are degrees
 * and paths are unchanged except surrounding whitespace. Object parameters
 * are strings. Indices/IDs are retained verbatim, not resolved.
 * The sceneObjects fields are complexity, path, idCode, position, heading,
 * pitch, bank, parameters and optional varparentIdCode/terrainAlignment.
 * Spline fields additionally include prevIDCode, nextIDCode, length, radius,
 * gradStart/gradEnd, useDeltaHeight/deltaHeight, cantStart/cantEnd,
 * skewStart/skewEnd, startZ, mirror and optional terrainAlignment. Fields
 * absent in older layouts are null, except parameters [] and mirror false.
 * Attachment fields follow the desktop struct names; `type` is the lowercased
 * command name. Terrain entries are {line, payload: string[]}.
 *
 * Only versions 2–14 are recognized; spline layouts below version 6 are
 * intentionally unsupported because the desktop reader documents unresolved
 * version-specific ID logic. Older spline predecessor values may be indices,
 * not IDs. Attachment layouts before version 12 are not
 * inferred. Terrain commands retain their uninterpreted payload; neither
 * terrain geometry nor water, rules, links, or assets are loaded. Unrecognized
 * commands and invalid records produce warnings, and invalid records are
 * omitted. Unknown commands end child association. Missing version defaults
 * to the desktop's modern layout (14).
 */
export function parseMapTile(input) {
  if (
    typeof input !== "string" &&
    (!Array.isArray(input) || input.some((line) => typeof line !== "string"))
  ) {
    throw new TypeError("Expected map text or an array of lines");
  }
  const lines =
    typeof input === "string" ? input.split(/\r\n|\n|\r/) : input.slice();
  if (lines.length) lines[0] = lines[0].replace(/^\uFEFF/, "");
  const result = {
    version: null,
    terrain: null,
    variableTerrainLightmap: null,
    variableTerrain: null,
    sceneObjects: [],
    splines: [],
    attachObjects: [],
    splineAttachments: [],
    warnings: [],
  };
  const warn = (line, message) =>
    result.warnings.push(`line ${line}: ${message}`);
  let active = null;
  let disabled = false;
  let version = 14;
  let versionSeen = false;
  let warnedVersionOrder = false;
  let warnedSplineLinks = false;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text.startsWith("-<DISABLED>-")) {
      disabled = true;
      active = null;
      continue;
    }
    if (text.startsWith("-<ENABLED>-")) {
      disabled = false;
      continue;
    }
    if (disabled) continue;
    const match = tagPattern.exec(text);
    if (!match) continue;
    const tag = match[1].trim().toLowerCase();
    const line = i + 1;
    if (
      !versionSeen &&
      !warnedVersionOrder &&
      [
        "object",
        "scenobj",
        "spline",
        "spline_h",
        "splineabschnitt",
        "attachobject",
        "splineattachement",
        "splineattachement_repeater",
      ].includes(tag)
    ) {
      warn(
        line,
        "placement before [version]; assuming version 14 for preceding records",
      );
      warnedVersionOrder = true;
    }
    let cursor = i + 1;
    let failed = false;

    function read(name, type = "number", allowEmpty = false) {
      const value = lines[cursor]?.trim();
      if (
        value === undefined ||
        tagPattern.test(value) ||
        /^-<(?:ENABLED|DISABLED)>-/.test(value) ||
        (!allowEmpty && !value)
      ) {
        if (!failed)
          warn(line, `[${tag}] missing ${name} at line ${cursor + 1}`);
        failed = true;
        return null;
      }
      cursor++;
      if (type === "string") return value;
      if (type === "mirror") {
        if (value === "mirror") return true;
        if (value === "" || value === "false") return false;
      } else if (numberPattern.test(value)) {
        const n = Number(value);
        if (
          Number.isFinite(n) &&
          ((type !== "int" && type !== "byte") ||
            (Number.isInteger(n) &&
              n >= 0x80000000 * -1 &&
              n <= 0x7fffffff &&
              (type !== "byte" || (n >= 0 && n <= 255))))
        )
          return n;
      }
      if (!failed)
        warn(cursor, `[${tag}] invalid ${name}: ${JSON.stringify(value)}`);
      failed = true;
      return null;
    }
    const integer = (name) => read(name, "int");
    const byte = (name) => read(name, "byte");
    const str = (name) => read(name, "string");
    function parameters() {
      const count = integer("parameter count");
      if (failed) return [];
      if (count < 0 || count > lines.length - cursor) {
        warn(cursor, `[${tag}] invalid parameter count ${count}`);
        failed = true;
        return [];
      }
      const values = [];
      for (let n = 0; n < count && !failed; n++)
        values.push(read(`parameter ${n}`, "string", true));
      return values;
    }
    const position = () => ({
      x: read("position x"),
      y: read("position y"),
      z: read("position z"),
    });
    const supported = () => version >= 2 && version <= 14;

    if (tag === "version") {
      const value = integer("version");
      if (!failed) {
        if (versionSeen) warn(line, "duplicate [version] ignored");
        else {
          versionSeen = true;
          result.version = value;
          version = value;
          if (!supported())
            warn(
              line,
              `unsupported map version ${value}; placement records omitted`,
            );
        }
      }
      active = null;
    } else if (
      ["terrain", "variable_terrain", "variable_terrainlightmap"].includes(tag)
    ) {
      const key = {
        terrain: "terrain",
        variable_terrain: "variableTerrain",
        variable_terrainlightmap: "variableTerrainLightmap",
      }[tag];
      const payload = [];
      while (
        cursor < lines.length &&
        !tagPattern.test(lines[cursor]) &&
        !/^\s*-<(?:ENABLED|DISABLED)>-/.test(lines[cursor])
      )
        payload.push(lines[cursor++]);
      if (result[key])
        warn(line, `duplicate [${tag}]; last occurrence retained`);
      result[key] = { line, payload };
      if (payload.some((value) => value.trim()))
        warn(line, `[${tag}] payload is not interpreted`);
      active = null;
    } else if (tag === "object" || tag === "scenobj") {
      active = null;
      if (!supported()) {
        warn(line, `[${tag}] unsupported for version ${version}`);
        continue;
      }
      const record = {
        line,
        type: tag,
        complexity: version >= 9 ? byte("complexity") : null,
        path: str("path"),
        idCode: version >= 6 ? integer("idCode") : null,
      };
      record.position = {
        x: read("position x"),
        z: read("position z"),
        y: read("position y"),
      };
      record.heading = read("heading");
      record.pitch = version >= 12 ? read("pitch") : null;
      record.bank = version >= 12 ? read("bank") : null;
      record.parameters = version > 3 ? parameters() : [];
      if (!failed) {
        result.sceneObjects.push(record);
        active = { kind: "object", record };
      }
    } else if (
      tag === "spline" ||
      tag === "spline_h" ||
      tag === "splineabschnitt"
    ) {
      active = null;
      if (!supported() || version < 6) {
        warn(line, `[${tag}] unsupported for version ${version}`);
        continue;
      }
      if (version <= 12 && !warnedSplineLinks) {
        warn(
          line,
          "older spline predecessor may be an index rather than an ID; preserved without resolution",
        );
        warnedSplineLinks = true;
      }
      const record = {
        line,
        type: tag,
        complexity: version >= 9 ? byte("complexity") : null,
        path: str("path"),
        idCode: integer("idCode"),
        prevIDCode: integer("prevIDCode"),
        nextIDCode: version >= 11 ? integer("nextIDCode") : null,
        position: position(),
        heading: read("heading"),
        length: read("length"),
        radius: read("radius"),
        gradStart: read("gradStart"),
        gradEnd: read("gradEnd"),
        useDeltaHeight: tag === "spline_h",
      };
      record.deltaHeight = record.useDeltaHeight ? read("deltaHeight") : null;
      record.cantStart = version >= 5 ? read("cantStart") : null;
      record.cantEnd = version >= 5 ? read("cantEnd") : null;
      record.skewStart = version >= 14 ? read("skewStart") : null;
      record.skewEnd = version >= 14 ? read("skewEnd") : null;
      record.startZ = version >= 11 ? read("startZ") : null;
      record.mirror = version >= 7 ? read("mirror", "mirror", true) : false;
      if (!failed) {
        result.splines.push(record);
        active = { kind: "spline", record };
      }
    } else if (
      tag === "attachobject" ||
      tag === "splineattachement" ||
      tag === "splineattachement_repeater"
    ) {
      active = null;
      if (!supported() || version < 12) {
        warn(line, `[${tag}] unsupported for version ${version}`);
        continue;
      }
      const record = { line, type: tag, complexity: byte("complexity") };
      if (tag === "splineattachement_repeater") {
        record.tile = integer("tile");
        record.repeaterOffset = integer("repeaterOffset");
      }
      record.path = str("path");
      record.idCode = integer("idCode");
      if (tag === "attachobject") {
        record.attachObjId = integer("attachObjId");
        record.attachedInstances = integer("attachedInstances");
        record.attachPoint = integer("attachPoint");
      } else {
        record.splineId = integer("splineId");
        record.position = position();
      }
      record.heading = read("heading");
      record.pitch = read("pitch");
      record.bank = read("bank");
      if (tag !== "attachobject") {
        record.spacing = read("spacing");
        record.distance = read("distance");
        const tangential = integer("tangential");
        record.tangential = tangential === null ? null : tangential !== 0;
      }
      record.parameters = parameters();
      if (!failed) {
        if (tag === "attachobject") {
          result.attachObjects.push(record);
          active = { kind: "object", record };
          if (record.attachedInstances !== 0)
            warn(
              line,
              "[attachobject] nonzero attachedInstances is unsupported",
            );
        } else result.splineAttachments.push(record);
      }
    } else if (
      tag === "varparent" ||
      tag === "spline_terrain_align" ||
      tag === "spline_terrain_align_2"
    ) {
      const wanted = tag === "spline_terrain_align_2" ? "spline" : "object";
      const value =
        tag === "varparent"
          ? integer("idCode")
          : tag === "spline_terrain_align_2"
            ? byte("alignTerrain")
            : true;
      if (!active || active.kind !== wanted)
        warn(line, `[${tag}] has no preceding ${wanted}`);
      else if (!failed) {
        const key =
          tag === "varparent" ? "varparentIdCode" : "terrainAlignment";
        if (key in active.record)
          warn(line, `duplicate [${tag}]; last occurrence retained`);
        active.record[key] = value;
      }
    } else {
      warn(line, `unsupported command [${match[1].trim()}]`);
      active = null;
    }
    i = cursor - 1;
  }
  if (!versionSeen) warn(1, "missing [version]; assuming version 14");
  return result;
}
