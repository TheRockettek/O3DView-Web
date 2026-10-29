const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function triangleDistance(origin, direction, vertices, a, b, c, cullBackfaces) {
  const point = (index) => [
    -vertices[index * 8],
    vertices[index * 8 + 1],
    vertices[index * 8 + 2],
  ];
  const v0 = point(a),
    edge1 = subtract(point(b), v0),
    edge2 = subtract(point(c), v0);
  const p = cross(direction, edge2),
    determinant = dot(edge1, p);
  if (cullBackfaces ? determinant >= -1e-12 : Math.abs(determinant) < 1e-12)
    return null;
  const inverse = 1 / determinant,
    t = subtract(origin, v0),
    u = dot(t, p) * inverse;
  if (u < 0 || u > 1) return null;
  const q = cross(t, edge1),
    v = dot(direction, q) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * inverse;
  return distance > 0 ? distance : null;
}

export function pickModel(
  renderer,
  models,
  clientX,
  clientY,
  afterIndex = null,
) {
  return (
    pickModelHit(renderer, models, clientX, clientY, afterIndex)?.index ?? null
  );
}

export function pickModelHit(
  renderer,
  models,
  clientX,
  clientY,
  afterIndex = null,
) {
  renderer._assertUsable();
  const rect = renderer.canvas.getBoundingClientRect();
  if (
    !(rect.width > 0 && rect.height > 0) ||
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  )
    return null;
  const {
    _target: target,
    _distance: distance,
    _yaw: yaw,
    _pitch: pitch,
  } = renderer;
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch),
    cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const back = [cy * cp, sp, sy * cp],
    right = [sy, 0, -cy],
    up = [-sp * cy, cp, -sp * sy];
  const eye = target.map((value, i) => value + distance * back[i]);
  const aspect =
    renderer.canvas.width > 0 && renderer.canvas.height > 0
      ? renderer.canvas.width / renderer.canvas.height
      : rect.width / rect.height;
  const x =
    ((2 * (clientX - rect.left)) / rect.width - 1) *
    aspect *
    Math.tan(Math.PI / 6);
  const y =
    (1 - (2 * (clientY - rect.top)) / rect.height) * Math.tan(Math.PI / 6);
  const direction = back.map((value, i) => -value + x * right[i] + y * up[i]);
  const magnitude = Math.hypot(...direction);
  for (let i = 0; i < 3; i++) direction[i] /= magnitude;
  const sceneDistance = Math.hypot(...subtract(eye, renderer._sceneCenter));
  const near = Math.max(
    renderer._viewRadius * 0.0001,
    sceneDistance - renderer._radius * 1.5,
  );
  const far = Math.max(
    near + renderer._viewRadius,
    sceneDistance + renderer._radius * 2,
  );
  const depthFactor = -dot(direction, back);
  const hits = [];
  for (const [index, model] of models.entries()) {
    const bounds = renderer._modelBounds[index];
    if (!renderer._modelVisibility[index] || !bounds) continue;
    const offset = subtract(eye, bounds.center),
      along = dot(offset, direction);
    const offsetSquared = dot(offset, offset),
      radiusSquared = bounds.radius * bounds.radius;
    if (
      (along > 0 && offsetSquared > radiusSquared) ||
      offsetSquared - along * along > radiusSquared
    )
      continue;
    let closest = Infinity,
      closestTriangleIndex = -1;
    for (let i = 0; i < model.triangles.length; i += 4) {
      const hit = triangleDistance(
        eye,
        direction,
        model.vertices,
        model.triangles[i],
        model.triangles[i + 1],
        model.triangles[i + 2],
        renderer._cullBackfaces && !renderer._wireframe,
      );
      if (
        hit !== null &&
        hit < closest &&
        hit * depthFactor >= near &&
        hit * depthFactor <= far
      ) {
        closest = hit;
        closestTriangleIndex = i / 4;
      }
    }
    if (closest < Infinity)
      hits.push({
        index,
        distance: closest,
        triangleIndex: closestTriangleIndex,
      });
  }
  const previous = hits.find((hit) => hit.index === afterIndex);
  const minimum = previous?.distance ?? 0;
  let selected = null,
    closest = Infinity;
  for (const hit of hits) {
    if (hit.distance > minimum && hit.distance < closest) {
      closest = hit.distance;
      selected = hit;
    }
  }
  return selected
    ? { index: selected.index, triangleIndex: selected.triangleIndex }
    : null;
}

export function projectWorldPosition(renderer, position) {
  renderer._assertUsable();
  if (
    !Array.isArray(position) ||
    position.length < 3 ||
    !position.slice(0, 3).every(Number.isFinite)
  )
    return null;
  const rect = renderer.canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const {
    _target: target,
    _distance: distance,
    _yaw: yaw,
    _pitch: pitch,
  } = renderer;
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch),
    cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const back = [cy * cp, sp, sy * cp],
    right = [sy, 0, -cy],
    up = [-sp * cy, cp, -sp * sy];
  const eye = target.map((value, i) => value + distance * back[i]);
  const offset = subtract(position.slice(0, 3), eye);
  const depth = -dot(offset, back);
  if (!(depth > 0)) return null;
  const aspect =
    renderer.canvas.width > 0 && renderer.canvas.height > 0
      ? renderer.canvas.width / renderer.canvas.height
      : rect.width / rect.height;
  const scale = depth * Math.tan(Math.PI / 6);
  const x = dot(offset, right) / (scale * aspect);
  const y = dot(offset, up) / scale;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > 1 ||
    Math.abs(y) > 1
  )
    return null;
  return {
    x: ((x + 1) / 2) * rect.width,
    y: ((1 - y) / 2) * rect.height,
  };
}
