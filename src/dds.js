// Decode the first mip level of a legacy, two-dimensional DDS texture to RGBA.
const HEADER_SIZE = 128;
const MAX_PIXELS = 64 * 1024 * 1024;
const DDSD_PITCH = 0x8;
const DDSD_LINEARSIZE = 0x80000;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_ALPHA = 0x2;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;

function channel(mask, bits, name) {
    if (!mask) throw new Error(`Invalid DDS ${name} mask`);
    const shift = 31 - Math.clz32((mask & -mask) >>> 0);
    const max = mask >>> shift;
    if ((max & (max + 1)) !== 0 || (bits < 32 && mask >= 2 ** bits)) {
        throw new Error(`Invalid DDS ${name} mask`);
    }
    return { mask, shift, max };
}

function expand(value, component) {
    return Math.round(((value & component.mask) >>> component.shift) * 255 / component.max);
}

function rgb565(value) {
    const r = (value >>> 11) & 31;
    const g = (value >>> 5) & 63;
    const b = value & 31;
    return [(r << 3) | (r >>> 2), (g << 2) | (g >>> 4), (b << 3) | (b >>> 2), 255];
}

function decodeBlocks(view, data, width, height, format) {
    const blockSize = format === "DXT1" ? 8 : 16;
    const explicitAlpha = format === "DXT2" || format === "DXT3";
    const interpolatedAlpha = format === "DXT4" || format === "DXT5";
    const premultiplied = format === "DXT2" || format === "DXT4";
    let offset = HEADER_SIZE;
    for (let by = 0; by < Math.ceil(height / 4); by++) {
        for (let bx = 0; bx < Math.ceil(width / 4); bx++, offset += blockSize) {
            const colorOffset = offset + (format === "DXT1" ? 0 : 8);
            const c0 = view.getUint16(colorOffset, true);
            const c1 = view.getUint16(colorOffset + 2, true);
            const colors = [rgb565(c0), rgb565(c1)];
            if (format !== "DXT1" || c0 > c1) {
                colors.push([0, 1, 2].map(i => Math.floor((2 * colors[0][i] + colors[1][i]) / 3)).concat(255));
                colors.push([0, 1, 2].map(i => Math.floor((colors[0][i] + 2 * colors[1][i]) / 3)).concat(255));
            } else {
                colors.push([0, 1, 2].map(i => Math.floor((colors[0][i] + colors[1][i]) / 2)).concat(255));
                colors.push([0, 0, 0, 0]);
            }
            const colorIndices = view.getUint32(colorOffset + 4, true);
            let alphaIndices = 0n;
            let alphas;
            if (explicitAlpha) {
                for (let i = 0; i < 8; i++) alphaIndices |= BigInt(view.getUint8(offset + i)) << BigInt(8 * i);
            } else if (interpolatedAlpha) {
                const a0 = view.getUint8(offset), a1 = view.getUint8(offset + 1);
                alphas = [a0, a1];
                if (a0 > a1) {
                    for (let i = 1; i <= 6; i++) alphas.push(Math.floor(((7 - i) * a0 + i * a1) / 7));
                } else {
                    for (let i = 1; i <= 4; i++) alphas.push(Math.floor(((5 - i) * a0 + i * a1) / 5));
                    alphas.push(0, 255);
                }
                for (let i = 0; i < 6; i++) alphaIndices |= BigInt(view.getUint8(offset + 2 + i)) << BigInt(8 * i);
            }
            for (let i = 0; i < 16; i++) {
                const x = bx * 4 + i % 4, y = by * 4 + Math.floor(i / 4);
                if (x >= width || y >= height) continue;
                const color = colors[(colorIndices >>> (2 * i)) & 3];
                const dst = (y * width + x) * 4;
                const alpha = explicitAlpha
                    ? Number((alphaIndices >> BigInt(4 * i)) & 15n) * 17
                    : interpolatedAlpha
                        ? alphas[Number((alphaIndices >> BigInt(3 * i)) & 7n)]
                        : color[3];
                for (let c = 0; c < 3; c++) {
                    data[dst + c] = premultiplied
                        ? (alpha ? Math.min(255, Math.round(color[c] * 255 / alpha)) : 0)
                        : color[c];
                }
                data[dst + 3] = alpha;
            }
        }
    }
}

/**
 * Decode a legacy 2D DDS ArrayBuffer into top-down, straight-alpha RGBA pixels.
 * Only the first mip level is read. Cubemaps, volumes, DX10 and other formats
 * are deliberately rejected; lower mip levels, if present, are not validated.
 * A zero compressed linear size is treated as unspecified, as in some OMSI
 * textures; the actual top-level payload is still checked before decoding.
 * A8 uses black RGB, matching the desktop reader's GL_ALPHA8 texture mapping.
 * DXT2 and DXT4 colors are converted from premultiplied to straight alpha.
 */
export function decodeDDS(buffer) {
    if (!(buffer instanceof ArrayBuffer)) throw new TypeError("DDS input must be an ArrayBuffer");
    if (buffer.byteLength < HEADER_SIZE) throw new Error("Truncated DDS header");
    const view = new DataView(buffer);
    const u32 = offset => view.getUint32(offset, true);
    if (u32(0) !== 0x20534444) throw new Error("Invalid DDS magic");
    if (u32(4) !== 124 || u32(76) !== 32) throw new Error("Invalid DDS header size");
    const flags = u32(8), height = u32(12), width = u32(16);
    if ((flags & 0x1007) !== 0x1007 || !(u32(108) & 0x1000)) {
        throw new Error("Invalid DDS required header flags or caps");
    }
    if (!width || !height || width * height > MAX_PIXELS) throw new Error("Invalid or excessive DDS dimensions");
    if ((u32(112) & 0x20fe00) || (flags & 0x800000) || u32(24) > 1) {
        throw new Error("Unsupported DDS cubemap or volume texture");
    }
    const pixelFlags = u32(80);
    if ((pixelFlags & 0xa0220) ||
        ((pixelFlags & DDPF_FOURCC) && (pixelFlags & DDPF_RGB)) ||
        ((pixelFlags & DDPF_ALPHA) && (pixelFlags & (DDPF_FOURCC | DDPF_RGB)))) {
        throw new Error("Unsupported or contradictory DDS pixel format flags");
    }
    let format, stride, components, bytesPerPixel, required, alphaOnly = false;
    if (pixelFlags & DDPF_FOURCC) {
        const fourCC = u32(84);
        format = String.fromCharCode(fourCC & 255, (fourCC >>> 8) & 255, (fourCC >>> 16) & 255, fourCC >>> 24);
        if (!["DXT1", "DXT2", "DXT3", "DXT4", "DXT5"].includes(format)) {
            throw new Error(`Unsupported DDS FourCC ${JSON.stringify(format)}`);
        }
        required = Math.ceil(width / 4) * Math.ceil(height / 4) * (format === "DXT1" ? 8 : 16);
        if ((flags & DDSD_LINEARSIZE) && u32(20) !== 0 && u32(20) < required) {
            throw new Error("Invalid DDS linear size");
        }
    } else if (pixelFlags & DDPF_RGB) {
        const bits = u32(88);
        if (![8, 16, 24, 32].includes(bits)) throw new Error(`Unsupported DDS RGB bit count ${bits}`);
        bytesPerPixel = bits / 8;
        const masks = [u32(92), u32(96), u32(100), u32(104)];
        components = masks.slice(0, 3).map((mask, i) => channel(mask, bits, "RGB"[i]));
        if (pixelFlags & DDPF_ALPHAPIXELS) components.push(channel(masks[3], bits, "alpha"));
        let used = 0;
        for (const component of components) {
            if (used & component.mask) throw new Error("Invalid DDS overlapping channel masks");
            used = (used | component.mask) >>> 0;
        }
        const rowBytes = width * bytesPerPixel;
        stride = flags & DDSD_PITCH ? u32(20) : rowBytes;
        if (stride < rowBytes) throw new Error("Invalid DDS pitch");
        required = stride * height;
    } else if (pixelFlags & (DDPF_ALPHA | DDPF_ALPHAPIXELS)) {
        if (u32(88) !== 8) throw new Error(`Unsupported DDS alpha bit count ${u32(88)}`);
        if (u32(92) || u32(96) || u32(100) || u32(104) !== 0xff) {
            throw new Error("Invalid DDS alpha-only masks");
        }
        alphaOnly = true;
        bytesPerPixel = 1;
        stride = flags & DDSD_PITCH ? u32(20) : width;
        if (stride < width) throw new Error("Invalid DDS pitch");
        required = stride * height;
    } else {
        throw new Error("Unsupported DDS pixel format");
    }
    if (required > buffer.byteLength - HEADER_SIZE) throw new Error("Truncated DDS pixel data");
    const data = new Uint8ClampedArray(width * height * 4);
    if (format) {
        decodeBlocks(view, data, width, height, format);
    } else {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = HEADER_SIZE + y * stride + x * bytesPerPixel;
                let value = 0;
                for (let i = 0; i < bytesPerPixel; i++) value += view.getUint8(offset + i) * 2 ** (i * 8);
                const dst = (y * width + x) * 4;
                if (alphaOnly) {
                    data[dst + 3] = value;
                } else {
                    for (let i = 0; i < 3; i++) data[dst + i] = expand(value, components[i]);
                    data[dst + 3] = components[3] ? expand(value, components[3]) : 255;
                }
            }
        }
    }
    return { width, height, data };
}
