/*
 * OMSI repaint commands, informed by O3DView/O3DParse/OmsiStructs.
 * Distributed under GPL-3.0; see O3DView/LICENSE.txt.
 */
const TAG = /^\s*\[([^\[\]]+)\]\s*$/;
const FLOAT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function readLines(input) {
  if (typeof input === "string") return input.split(/\r\n|\n|\r/);
  if (Array.isArray(input) && input.every((line) => typeof line === "string"))
    return input;
  throw new TypeError("Expected configuration text or an array of lines");
}

function parameters(lines, index, count, tag, warnings) {
  const values = [];
  for (let j = 1; j <= count; j++) {
    const value = lines[index + j]?.trim();
    if (!value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value)) {
      warnings.push(`line ${index + 1}: [${tag}] requires ${count} parameters`);
      return null;
    }
    values.push(value);
  }
  return values;
}

export function parseCTC(input) {
  const lines = readLines(input),
    warnings = [];
  let ctc = null,
    active = false,
    disabled = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text.startsWith("-<DISABLED>-")) {
      disabled = true;
      continue;
    }
    if (text.startsWith("-<ENABLED>-")) {
      disabled = false;
      continue;
    }
    if (disabled) continue;
    const tag = TAG.exec(text)?.[1].trim().toLowerCase();
    if (!tag) continue;
    if (tag === "ctc") {
      active = false;
      const values = parameters(lines, i, 3, tag, warnings);
      if (!values) continue;
      if (ctc) {
        warnings.push(`line ${i + 1}: duplicate [CTC]; using the first`);
        continue;
      }
      ctc = {
        variable: values[0],
        path: values[1],
        unknown: values[2],
        textures: [],
      };
      active = true;
      i += 3;
    } else if (tag === "ctctexture") {
      const values = parameters(lines, i, 2, tag, warnings);
      if (!values) continue;
      if (!active)
        warnings.push(`line ${i + 1}: [CTCTexture] has no active [CTC]`);
      else if (
        ctc.textures.some(
          (item) => item.name.toLowerCase() === values[0].toLowerCase(),
        )
      ) {
        warnings.push(
          `line ${i + 1}: duplicate [CTCTexture] "${values[0]}"; using the first`,
        );
      } else ctc.textures.push({ name: values[0], path: values[1] });
      i += 2;
    } else active = false;
  }
  return { ctc, warnings };
}

export function parseCTI(input) {
  const lines = readLines(input),
    items = [],
    warnings = [];
  let current = null,
    disabled = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text.startsWith("-<DISABLED>-")) {
      disabled = true;
      continue;
    }
    if (text.startsWith("-<ENABLED>-")) {
      disabled = false;
      continue;
    }
    if (disabled) continue;
    const tag = TAG.exec(text)?.[1].trim().toLowerCase();
    if (!tag) continue;
    if (tag === "item") {
      current = null;
      const values = parameters(lines, i, 3, tag, warnings);
      if (!values) continue;
      current = {
        name: values[0],
        slot: values[1],
        path: values[2],
        setvars: [],
        line: i + 1,
      };
      items.push(current);
      i += 3;
    } else if (tag === "setvar") {
      const values = parameters(lines, i, 2, tag, warnings);
      if (!values) continue;
      const value = FLOAT.test(values[1])
        ? Math.fround(Number(values[1]))
        : NaN;
      if (!current)
        warnings.push(`line ${i + 1}: [setvar] has no active [item]`);
      else if (!Number.isFinite(value))
        warnings.push(`line ${i + 1}: [setvar] requires a finite 32-bit value`);
      else current.setvars.push({ name: values[0], value });
      i += 2;
    } else current = null;
  }
  return { items, warnings };
}
