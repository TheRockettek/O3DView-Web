import { isModelVisible } from "./scene-visibility.js";

export function replaceSceneGeometry(
  renderer,
  models,
  modelIndex,
  base,
  triangles,
  translation,
  manual,
  config,
  viewpoint,
  selected,
) {
  const model = models[modelIndex];
  if (!model || !Number.isInteger(modelIndex))
    throw new RangeError("Invalid model index");
  if (
    !Array.isArray(translation) ||
    translation.length !== 3 ||
    !translation.every(
      (value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)),
    )
  ) {
    throw new TypeError("Translation must contain three finite 32-bit numbers");
  }
  if (
    !(base instanceof Float32Array) ||
    base.length % 8 ||
    !(triangles instanceof Uint32Array) ||
    triangles.length % 4
  )
    throw new TypeError("Invalid model geometry");
  const vertices = base.slice();
  for (let i = 0; i < vertices.length; i += 8) {
    vertices[i] = base[i] - translation[0];
    vertices[i + 1] = base[i + 1] + translation[1];
    vertices[i + 2] = base[i + 2] + translation[2];
  }
  if (!vertices.every(Number.isFinite))
    throw new RangeError("Translated vertices exceed 32-bit float range");
  const previous = model.vertices,
    previousTriangles = model.triangles;
  const camera = {
    target: [...renderer._target],
    distance: renderer._distance,
    yaw: renderer._yaw,
    pitch: renderer._pitch,
    viewRadius: renderer._viewRadius,
  };
  const restoreCamera = () => {
    renderer._target = [...camera.target];
    renderer._distance = camera.distance;
    renderer._yaw = camera.yaw;
    renderer._pitch = camera.pitch;
    renderer._viewRadius = camera.viewRadius;
    renderer._requestFrame();
  };
  const rebuild = () => {
    renderer.setModels(models);
    for (const [index, item] of models.entries()) {
      renderer.setModelVisible(
        index,
        isModelVisible(item, manual[index], config[index], viewpoint),
      );
    }
    renderer.setSelectedModel(selected);
    restoreCamera();
  };
  model.vertices = vertices;
  model.triangles = triangles;
  try {
    rebuild();
  } catch (error) {
    model.vertices = previous;
    model.triangles = previousTriangles;
    try {
      rebuild();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Model translation failed and renderer rollback was incomplete",
      );
    }
    throw error;
  }
  model.translationBase = base;
}

export function translateSceneModel(
  renderer,
  models,
  modelIndex,
  translation,
  manual,
  config,
  viewpoint,
  selected,
) {
  const model = models[modelIndex];
  if (!model || !Number.isInteger(modelIndex))
    throw new RangeError("Invalid model index");
  replaceSceneGeometry(
    renderer,
    models,
    modelIndex,
    model.translationBase ?? model.vertices,
    model.triangles,
    translation,
    manual,
    config,
    viewpoint,
    selected,
  );
  model.worldTranslation = [...translation];
}

function sceneTransformPivot(model) {
  const position = model.mapPlacement?.position;
  if (!position) return [0, 0, 0];
  const pivot = [-position.x, position.y, position.z];
  if (!pivot.every(Number.isFinite))
    throw new TypeError("Model placement must contain finite coordinates");
  return pivot;
}

function transformVertices(base, rotation, scale, pivot) {
  if (!(base instanceof Float32Array) || base.length % 8)
    throw new TypeError("Invalid model geometry");
  if (
    !Array.isArray(rotation) ||
    rotation.length !== 3 ||
    !rotation.every(
      (value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)),
    )
  )
    throw new TypeError("Rotation must contain three finite 32-bit numbers");
  if (
    !Array.isArray(scale) ||
    scale.length !== 3 ||
    !scale.every(
      (value) =>
        Number.isFinite(value) &&
        Number.isFinite(Math.fround(value)) &&
        value > 0,
    )
  )
    throw new TypeError(
      "Scale must contain three positive finite 32-bit numbers",
    );
  const [rx, ry, rz] = rotation.map((value) => (value * Math.PI) / 180);
  const [sx, sy, sz] = scale;
  const cx = Math.cos(rx),
    xsin = Math.sin(rx),
    cy = Math.cos(ry),
    ysin = Math.sin(ry),
    cz = Math.cos(rz),
    zsin = Math.sin(rz);
  const output = base.slice();
  const rotate = (x, y, z) => {
    const x1 = x,
      y1 = y * cx - z * xsin,
      z1 = y * xsin + z * cx,
      x2 = x1 * cy + z1 * ysin,
      y2 = y1,
      z2 = -x1 * ysin + z1 * cy;
    return [x2 * cz - y2 * zsin, x2 * zsin + y2 * cz, z2];
  };
  for (let i = 0; i < output.length; i += 8) {
    const worldPosition = [-base[i], base[i + 1], base[i + 2]];
    const transformed = rotate(
      (worldPosition[0] - pivot[0]) * sx,
      (worldPosition[1] - pivot[1]) * sy,
      (worldPosition[2] - pivot[2]) * sz,
    );
    output[i] = -(pivot[0] + transformed[0]);
    output[i + 1] = pivot[1] + transformed[1];
    output[i + 2] = pivot[2] + transformed[2];

    const worldNormal = [-base[i + 3] / sx, base[i + 4] / sy, base[i + 5] / sz];
    const rotatedNormal = rotate(...worldNormal);
    const magnitude = Math.hypot(...rotatedNormal);
    output[i + 3] =
      magnitude > 0 ? -rotatedNormal[0] / magnitude : rotatedNormal[0];
    output[i + 4] =
      magnitude > 0 ? rotatedNormal[1] / magnitude : rotatedNormal[1];
    output[i + 5] =
      magnitude > 0 ? rotatedNormal[2] / magnitude : rotatedNormal[2];
  }
  if (!output.every(Number.isFinite))
    throw new RangeError("Transformed geometry exceeds 32-bit float range");
  return output;
}

export function transformSceneModel(
  renderer,
  models,
  modelIndex,
  rotation,
  scale,
  manual,
  config,
  viewpoint,
  selected,
) {
  const model = models[modelIndex];
  if (!model || !Number.isInteger(modelIndex))
    throw new RangeError("Invalid model index");
  const pivot = model.sceneTransform?.pivot ?? sceneTransformPivot(model);
  const base =
    model.sceneTransformBase ?? model.translationBase ?? model.vertices;
  const vertices = transformVertices(base, rotation, scale, pivot);
  replaceSceneGeometry(
    renderer,
    models,
    modelIndex,
    vertices,
    model.triangles,
    model.worldTranslation ?? [0, 0, 0],
    manual,
    config,
    viewpoint,
    selected,
  );
  model.sceneTransformBase ??= base;
  model.sceneTransform = {
    rotation: [...rotation],
    scale: [...scale],
    pivot: [...pivot],
  };
}
