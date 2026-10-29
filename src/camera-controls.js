const FOV = Math.PI / 3;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function boundsForVertices(arrays) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const vertices of arrays) {
    if (!(vertices instanceof Float32Array) || vertices.length % 8)
      throw new TypeError("Invalid model vertices");
    for (let i = 0; i < vertices.length; i += 8) {
      const position = [-vertices[i], vertices[i + 1], vertices[i + 2]];
      if (!position.every(Number.isFinite))
        throw new TypeError("Invalid model position");
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], position[k]);
        max[k] = Math.max(max[k], position[k]);
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  return {
    center: min.map((v, i) => (v + max[i]) / 2),
    radius: Math.max(Math.hypot(...min.map((v, i) => (max[i] - v) / 2)), 0.001),
  };
}

export function modelBounds(vertices) {
  return boundsForVertices([vertices]);
}

export function focusModel(renderer, modelIndex) {
  renderer._assertUsable();
  if (
    !Number.isInteger(modelIndex) ||
    modelIndex < 0 ||
    modelIndex >= renderer._modelBounds.length
  ) {
    throw new RangeError("Invalid model index");
  }
  const bounds = renderer._modelBounds[modelIndex];
  if (!bounds) throw new Error("Cannot focus a model without vertices");
  renderer._target = [...bounds.center];
  renderer._viewRadius = bounds.radius;
  renderer._distance = bounds.radius * 2;
  renderer._requestFrame();
}

export function focusPosition(renderer, position) {
  renderer._assertUsable();
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(Number.isFinite)
  ) {
    throw new TypeError("Invalid focus position");
  }
  renderer._target = [...position];
  renderer._requestFrame();
}

export function focusModels(renderer, models) {
  renderer._assertUsable();
  if (!Array.isArray(models)) throw new TypeError("Invalid models");
  const bounds = boundsForVertices(models.map((model) => model?.vertices));
  if (!bounds) throw new Error("Cannot focus a group without vertices");
  renderer._target = bounds.center;
  renderer._viewRadius = bounds.radius;
  renderer._distance = bounds.radius * 2;
  renderer._requestFrame();
}

export function selectionPulse() {
  return (
    Math.sin(((globalThis.performance.now() / 1000) % 2000) * 3.14) * 0.5 + 0.5
  );
}

export function animateSelection(renderer) {
  return (
    renderer._selectionHighlight &&
    renderer._selectedModel !== null &&
    renderer._modelVisibility[renderer._selectedModel] &&
    renderer._draws.some(
      (draw) => draw.modelIndex === renderer._selectedModel,
    ) &&
    renderer.canvas.clientWidth > 0 &&
    renderer.canvas.clientHeight > 0
  );
}

export function pointerControls(renderer) {
  const down = (event) => {
    if (![0, 1, 2].includes(event.button) || renderer._pointer) return;
    renderer._pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan: event.button !== 0,
    };
    renderer.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const move = (event) => {
    const pointer = renderer._pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x,
      dy = event.clientY - pointer.y;
    if (pointer.pan) {
      const { _yaw: yaw, _pitch: pitch, _distance: distance } = renderer;
      const scale =
        (2 * distance * Math.tan(FOV / 2)) /
        (renderer.canvas.clientHeight || renderer.canvas.height || 1);
      const right = [Math.sin(yaw), 0, -Math.cos(yaw)];
      const up = [
        -Math.sin(pitch) * Math.cos(yaw),
        Math.cos(pitch),
        -Math.sin(pitch) * Math.sin(yaw),
      ];
      renderer._target = renderer._target.map(
        (value, i) => value + (-dx * right[i] + dy * up[i]) * scale,
      );
    } else {
      renderer._yaw += dx * 0.005;
      renderer._pitch = clamp(
        renderer._pitch + dy * 0.005,
        -Math.PI / 2 + 0.001,
        Math.PI / 2 - 0.001,
      );
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    renderer._requestFrame();
  };
  const up = (event) => {
    if (renderer._pointer?.id !== event.pointerId) return;
    renderer._pointer = null;
    if (renderer.canvas.hasPointerCapture?.(event.pointerId))
      renderer.canvas.releasePointerCapture(event.pointerId);
  };
  return { down, move, up, contextMenu: (event) => event.preventDefault() };
}
