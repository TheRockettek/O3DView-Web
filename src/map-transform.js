/*
 * Map placement follows O3DView/O3DView/FileLoader.cs (GPL-3.0).
 * FileLoader places objects at (-x, y, z) with a negative Y heading.
 */
export function placeMapVertices(vertices, placement) {
    if (!(vertices instanceof Float32Array) || vertices.length % 8) throw new TypeError("Invalid vertex array");
    const { x, y, z } = placement.position;
    const angle = placement.heading * Math.PI / 180;
    if (![x, y, z, angle].every(Number.isFinite)) throw new TypeError("Invalid map placement");
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const output = vertices.slice();
    for (let i = 0; i < output.length; i += 8) {
        const px = vertices[i], pz = vertices[i + 2], nx = vertices[i + 3], nz = vertices[i + 5];
        output[i] = x + px * cos + pz * sin;
        output[i + 1] = y + vertices[i + 1];
        output[i + 2] = z - px * sin + pz * cos;
        output[i + 3] = nx * cos + nz * sin;
        output[i + 5] = -nx * sin + nz * cos;
    }
    return output;
}

export function placeMapLight(light, placement) {
    const { x, y, z } = placement.position;
    const angle = placement.heading * Math.PI / 180;
    if (![x, y, z, angle, ...light.position].every(Number.isFinite)) throw new TypeError("Invalid map light placement");
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const [lx, ly, lz] = light.position;
    return { ...light, position: [-x + lx * cos - lz * sin, y + ly, z + lx * sin + lz * cos] };
}
