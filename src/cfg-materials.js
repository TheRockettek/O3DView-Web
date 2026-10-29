/*
 * Partial OMSI material command reader. Reference: O3DView/O3DParse/
 * OmsiStructs/OmsiCFGFile.cs and O3DView/O3DView/GL/Material.cs
 * (GPL-3.0; see O3DView/LICENSE.txt).
 */

const tagPattern = /^\s*\[([^\[\]]+)\]\s*$/;
const numberPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;
const materialChildren = new Set([
  "alphascale",
  "matl_bumpmap",
  "matl_envmap",
  "matl_envmap_mask",
  "matl_freetex",
  "matl_lightmap",
  "matl_nightmap",
  "matl_raindropmap",
  "matl_texadress_border",
  "matl_texadress_clamp",
  "matl_texadress_mirror",
  "matl_texadress_mirroronce",
  "matl_transmap",
  "texcoordtransx",
  "texcoordtransy",
  "usescripttexture",
  "usetexttexture",
]);

/**
 * Parse mesh visibility and material metadata without loading geometry.
 *
 * @param {string|string[]} input Decoded config text or its lines.
 * @returns {{meshes: Array, warnings: string[]}} Line numbers are one-based.
 *
 * Integration: call once per decoded CFG/SCO and append warnings to the
 * scene's warnings, prefixed with the config path. Associate each returned
 * mesh by `line` with the [mesh] reference at that line, not by path: paths
 * may repeat, including in different LODs. Preserve existing LOD selection.
 * For each loaded O3D material in file order, count occurrences of its
 * textureName case-insensitively starting at zero, separately per mesh.
 * Select the first mesh.materials entry whose textureName matches ignoring
 * case and whose index equals that occurrence. Unmatched materials retain
 * their O3D settings. Do not apply [matl_change]/[matl_item] as static data.
 *
 * An entry contains textureName, index, line, and only successfully parsed
 * overrides: alphaMode (0 opaque, 1 cutout, 2 blend), noZCheck/noZWrite
 * (true), allcolor {diffuse:[r,g,b,a], ambient, specular, emission,
 * specPower}, and texAddress {clamp, mirror, mirrorOnce, border}, with
 * present flags true and border containing four byte values in BGRA order.
 * transmap, nightmap, lightmap, bumpmap and envmap are trimmed texture path
 * strings. Bump and environment maps have corresponding finite
 * bumpmapStrength and envmapStrength values. An
 * optional lightmapVar is the trimmed lightmap strength variable name. A later
 * valid lightmap replaces both the path and any earlier lightmapVar.
 * Multiple address commands are preserved independently; no precedence or
 * default address mode is inferred. alphaScaleVar is the unmodified (apart
 * from trimming) variable name, not a numeric alpha override.
 * As in Material.UpdateFromCfgMatl, allcolor replaces diffuse
 * and specular, sets roughness to 1/(specPower+1), and sets emission to
 * emission + ambient. An integration must translate these values to its own
 * renderer state, implement alpha/depth behavior and report any renderer
 * limitations; this module does not change rendering, sampler state, evaluate
 * variables, or resolve textures. Desktop Material.UpdateFromCfgMatl does
 * not apply the address commands either.
 * Duplicate matching [matl] commands are retained with a warning; select the
 * first as O3DView does.
 */
export function parseCfgMaterials(input) {
  if (
    typeof input !== "string" &&
    (!Array.isArray(input) || input.some((line) => typeof line !== "string"))
  ) {
    throw new TypeError("Expected config text or an array of lines");
  }
  const lines = typeof input === "string" ? input.split(/\r\n|\n|\r/) : input;
  const meshes = [];
  const warnings = [];
  let mesh = null;
  let material = null;
  let disabled = false;

  function warn(line, message) {
    warnings.push(`line ${line + 1}: ${message}`);
  }

  function parameters(line, count, tag) {
    const values = [];
    for (let j = 1; j <= count; j++) {
      const value = lines[line + j]?.trim();
      if (
        !value ||
        tagPattern.test(value) ||
        /^-<(?:ENABLED|DISABLED)>-/.test(value)
      ) {
        warn(
          line,
          `[${tag}] requires ${count} parameter${count === 1 ? "" : "s"}`,
        );
        return null;
      }
      values.push(value);
    }
    return values;
  }

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
    const match = tagPattern.exec(line);
    if (!match) continue;
    const tag = match[1].trim().toLowerCase();

    if (tag === "mesh") {
      mesh = null;
      material = null;
      const values = parameters(i, 1, tag);
      if (values) {
        mesh = { path: values[0], line: i + 1, materials: [] };
        meshes.push(mesh);
      }
    } else if (tag === "lod" || tag === "model") {
      mesh = null;
      material = null;
    } else if (tag === "visible") {
      material = null;
      if (!mesh) {
        warn(i, "[visible] has no preceding [mesh] in this scope");
        continue;
      }
      const values = parameters(i, 2, tag);
      if (!values) continue;
      const expected = numberPattern.test(values[1])
        ? Math.fround(Number(values[1]))
        : NaN;
      if (!Number.isFinite(expected)) {
        warn(i, `[visible] has an invalid finite float value "${values[1]}"`);
        continue;
      }
      (mesh.visibles ??= []).push({ variable: values[0], value: expected });
    } else if (tag === "viewpoint") {
      material = null;
      if (!mesh) {
        warn(i, "[viewpoint] has no preceding [mesh] in this scope");
        continue;
      }
      const values = parameters(i, 1, tag);
      if (!values) continue;
      if (!/^\+?\d+$/.test(values[0]) || Number(values[0]) > 7) {
        warn(
          i,
          `[viewpoint] has an invalid flag value "${values[0]}" (expected 0-7)`,
        );
        continue;
      }
      mesh.viewpoint = Number(values[0]);
    } else if (tag === "matl") {
      material = null;
      const values = parameters(i, 2, tag);
      if (!values) continue;
      if (!/^\+?\d+$/.test(values[1]) || Number(values[1]) > 4294967295) {
        warn(i, `[matl] has an invalid occurrence index "${values[1]}"`);
        continue;
      }
      if (!mesh) {
        warn(i, "[matl] has no preceding [mesh] in this scope");
        continue;
      }
      const index = Number(values[1]);
      if (
        mesh.materials.some(
          (entry) =>
            entry.index === index &&
            entry.textureName.toLowerCase() === values[0].toLowerCase(),
        )
      ) {
        warn(
          i,
          `duplicate [matl] for "${values[0]}" occurrence ${index}; use the first`,
        );
      }
      material = { textureName: values[0], index, line: i + 1 };
      mesh.materials.push(material);
    } else if (tag === "matl_bumpmap" || tag === "matl_envmap") {
      if (!material) {
        warn(i, `[${tag}] has no active [matl]`);
        continue;
      }
      const values = parameters(i, 2, tag);
      if (!values) continue;
      const strength = numberPattern.test(values[1])
        ? Math.fround(Number(values[1]))
        : NaN;
      if (!Number.isFinite(strength)) {
        warn(i, `[${tag}] requires a finite 32-bit strength`);
        continue;
      }
      const name = tag.slice(5);
      material[name] = values[0];
      material[`${name}Strength`] = strength;
    } else if (
      tag === "matl_transmap" ||
      tag === "matl_nightmap" ||
      tag === "matl_lightmap"
    ) {
      if (!material) {
        warn(i, `[${tag}] has no active [matl]`);
        continue;
      }
      const values = parameters(i, 1, tag);
      if (!values) continue;
      material[tag.slice(5)] = values[0];
      if (tag === "matl_lightmap") {
        delete material.lightmapVar;
        const variable = lines[i + 2]?.trim();
        if (
          variable &&
          !tagPattern.test(variable) &&
          !/^-<(?:ENABLED|DISABLED)>-/.test(variable)
        ) {
          material.lightmapVar = variable;
        }
      }
    } else if (
      tag === "alphascale" ||
      tag === "matl_texadress_clamp" ||
      tag === "matl_texadress_mirror" ||
      tag === "matl_texadress_mirroronce" ||
      tag === "matl_texadress_border"
    ) {
      if (!material) {
        if (tag === "alphascale")
          warn(i, "unsupported/ignored dynamic tag [alphascale]");
        warn(i, `[${tag}] has no active [matl]`);
        continue;
      }
      if (tag === "alphascale") {
        const values = parameters(i, 1, tag);
        if (!values) continue;
        material.alphaScaleVar = values[0];
      } else if (tag === "matl_texadress_border") {
        const values = parameters(i, 4, tag);
        if (!values) continue;
        if (
          values.some((value) => !/^\+?\d+$/.test(value) || Number(value) > 255)
        ) {
          warn(i, `[${tag}] requires four BGRA byte values (0-255)`);
          continue;
        }
        (material.texAddress ??= {}).border = values.map(Number);
      } else {
        const key =
          tag === "matl_texadress_clamp"
            ? "clamp"
            : tag === "matl_texadress_mirror"
              ? "mirror"
              : "mirrorOnce";
        (material.texAddress ??= {})[key] = true;
      }
    } else if (
      tag === "matl_alpha" ||
      tag === "matl_nozcheck" ||
      tag === "matl_nozwrite" ||
      tag === "allcolor" ||
      tag === "matl_allcolor"
    ) {
      if (!material) {
        warn(i, `[${tag}] has no active [matl]`);
        continue;
      }
      if (tag === "matl_nozcheck" || tag === "matl_nozwrite") {
        material[tag === "matl_nozcheck" ? "noZCheck" : "noZWrite"] = true;
      } else if (tag === "matl_alpha") {
        const values = parameters(i, 1, tag);
        if (!values) continue;
        if (!/^[012]$/.test(values[0])) {
          warn(i, `[${tag}] has invalid alpha mode "${values[0]}"`);
          continue;
        }
        material.alphaMode = Number(values[0]);
      } else {
        const values = parameters(i, 14, tag);
        if (!values) continue;
        const numbers = values.map((value) =>
          numberPattern.test(value) ? Number(value) : NaN,
        );
        if (numbers.some((value) => !Number.isFinite(value))) {
          warn(i, `[${tag}] requires 14 finite numeric values`);
          continue;
        }
        material.allcolor = {
          diffuse: numbers.slice(0, 4),
          ambient: numbers.slice(4, 7),
          specular: numbers.slice(7, 10),
          emission: numbers.slice(10, 13),
          specPower: numbers[13],
        };
      }
    } else {
      warn(i, `unsupported/ignored tag [${tag}]`);
      if (!materialChildren.has(tag)) material = null;
    }
  }
  if (disabled) warnings.push("Unterminated -<DISABLED>- section");
  return { meshes, warnings };
}
