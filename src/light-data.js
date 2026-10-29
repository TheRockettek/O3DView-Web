// The desktop viewer defaults to 16 lights, including its sun.
export const MAX_INTERIOR_LIGHTS = 15;

export function duplicateLight(source, lights) {
  if (!source || typeof source !== "object" || !Array.isArray(lights))
    throw new TypeError("Invalid light duplication request");
  if (!Array.isArray(source.position) || !Array.isArray(source.color))
    throw new TypeError("Invalid source light");
  const base = `${source.name || source.variable || "Light"} copy`;
  let name = base;
  for (let suffix = 2; lights.some((light) => light?.name === name); suffix++)
    name = `${base} ${suffix}`;
  return {
    name,
    created: true,
    mode: source.mode ?? "point",
    position: [...source.position],
    direction: [...(source.direction ?? [0, -1, 0])],
    color: [...source.color],
    ambient: [...(source.ambient ?? [0, 0, 0])],
    range: source.range,
    intensity: source.intensity ?? 1,
    on: source.on,
  };
}

export function encodeInteriorLights(lights) {
  if (!Array.isArray(lights)) throw new TypeError("Lights must be an array");
  const positions = new Float32Array(MAX_INTERIOR_LIGHTS * 4);
  const colors = new Float32Array(MAX_INTERIOR_LIGHTS * 4);
  const ambients = new Float32Array(MAX_INTERIOR_LIGHTS * 4);
  for (const [i, light] of lights.entries()) {
    const intensity = light?.intensity === undefined ? 1 : light.intensity;
    const mode = light?.mode ?? "point";
    const ambient = light?.ambient ?? [0, 0, 0];
    const usesDirection = mode === "directional" || mode === "spot";
    if (
      !light ||
      !Array.isArray(light.position) ||
      light.position.length !== 3 ||
      !Array.isArray(light.color) ||
      light.color.length !== 3 ||
      typeof light.on !== "boolean" ||
      !["point", "directional", "ambient", "spot"].includes(mode) ||
      !Array.isArray(ambient) ||
      ambient.length !== 3 ||
      (usesDirection &&
        (!Array.isArray(light.direction) || light.direction.length !== 3)) ||
      ![
        ...light.position,
        ...light.color,
        ...ambient,
        light.range,
        intensity,
        ...(usesDirection ? light.direction : []),
        ...light.color.map((component) => component * intensity),
        ...ambient.map((component) => component * intensity),
      ].every(
        (value) =>
          Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      )
    ) {
      throw new TypeError(`Invalid interior light at index ${i}`);
    }
    const direction = usesDirection ? light.direction.map(Math.fround) : null;
    const length = direction && Math.hypot(...direction);
    if (direction && !length)
      throw new TypeError(`Invalid direction for light at index ${i}`);
    if (i < MAX_INTERIOR_LIGHTS) {
      positions.set(
        [
          ...(direction
            ? direction.map((component) => component / length)
            : light.position),
          light.range,
        ],
        i * 4,
      );
      const type = { point: 1, directional: 2, ambient: 3, spot: 4 }[mode];
      colors.set(
        [
          ...light.color.map((component) => component * intensity),
          light.on ? type : 0,
        ],
        i * 4,
      );
      ambients.set(
        [...ambient.map((component) => component * intensity), 0],
        i * 4,
      );
    }
  }
  return { positions, colors, ambients };
}
