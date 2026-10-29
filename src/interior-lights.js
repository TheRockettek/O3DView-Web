/*
 * Interior lights follow O3DView's OmsiCFGFile and FileLoader.
 * Distributed under GPL-3.0; see O3DView/LICENSE.txt.
 */
const TAG = /^\s*\[([^\[\]]+)\]\s*$/;
const FLOAT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseInteriorLights(input) {
    if (typeof input !== "string" && (!Array.isArray(input) || input.some(line => typeof line !== "string"))) {
        throw new TypeError("Expected config text or an array of lines");
    }
    const lines = typeof input === "string" ? input.split(/\r\n|\n|\r/) : input;
    const lights = [], warnings = [];
    let disabled = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("-<DISABLED>-")) { disabled = true; continue; }
        if (line.startsWith("-<ENABLED>-")) { disabled = false; continue; }
        if (disabled || TAG.exec(line)?.[1].trim().toLowerCase() !== "interiorlight") continue;
        const values = [];
        for (let j = 1; j <= 8; j++) {
            const value = lines[i + j]?.trim();
            if (!value || TAG.test(value) || /^-<(?:ENABLED|DISABLED)>-/.test(value)) break;
            values.push(value);
        }
        if (values.length !== 8) {
            warnings.push(`line ${i + 1}: [interiorlight] requires 8 parameters`);
            continue;
        }
        const floats = [values[1], ...values.slice(5)].map(value =>
            FLOAT.test(value) ? Math.fround(Number(value)) : NaN);
        const rgb = values.slice(2, 5).map(value => /^\+?\d+$/.test(value) ? Number(value) : NaN);
        if (!floats.every(Number.isFinite) || !rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
            warnings.push(`line ${i + 1}: [interiorlight] has invalid range, color, or position`);
            continue;
        }
        lights.push({
            variable: values[0], range: floats[0], color: rgb.map(value => value / 255),
            position: [floats[1], floats[3], floats[2]], on: true, line: i + 1,
        });
        i += 8;
    }
    return { lights, warnings };
}
