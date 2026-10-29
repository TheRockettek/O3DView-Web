import { isModelVisible } from "./scene-visibility.js";

export function replaceSceneGeometry(renderer, models, modelIndex, base, triangles, translation, manual, config, viewpoint, selected) {
    const model = models[modelIndex];
    if (!model || !Number.isInteger(modelIndex)) throw new RangeError("Invalid model index");
    if (!Array.isArray(translation) || translation.length !== 3 ||
        !translation.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
        throw new TypeError("Translation must contain three finite 32-bit numbers");
    }
    if (!(base instanceof Float32Array) || base.length % 8 ||
        !(triangles instanceof Uint32Array) || triangles.length % 4) throw new TypeError("Invalid model geometry");
    const vertices = base.slice();
    for (let i = 0; i < vertices.length; i += 8) {
        vertices[i] = base[i] - translation[0];
        vertices[i + 1] = base[i + 1] + translation[1];
        vertices[i + 2] = base[i + 2] + translation[2];
    }
    if (!vertices.every(Number.isFinite)) throw new RangeError("Translated vertices exceed 32-bit float range");
    const previous = model.vertices, previousTriangles = model.triangles;
    const camera = { target: [...renderer._target], distance: renderer._distance, yaw: renderer._yaw,
        pitch: renderer._pitch, viewRadius: renderer._viewRadius };
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
            renderer.setModelVisible(index, isModelVisible(item, manual[index], config[index], viewpoint));
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
        try { rebuild(); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "Model translation failed and renderer rollback was incomplete"); }
        throw error;
    }
    model.translationBase = base;
}

export function translateSceneModel(renderer, models, modelIndex, translation, manual, config, viewpoint, selected) {
    const model = models[modelIndex];
    if (!model || !Number.isInteger(modelIndex)) throw new RangeError("Invalid model index");
    replaceSceneGeometry(renderer, models, modelIndex, model.translationBase ?? model.vertices,
        model.triangles, translation, manual, config, viewpoint, selected);
    model.worldTranslation = [...translation];
}
