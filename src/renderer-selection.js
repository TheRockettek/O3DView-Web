import { Renderer } from './renderer.js';
import { WebGLRenderer } from './webgl-renderer.js';

/**
 * WebGPU can claim a canvas before failing, so a failed attempt needs a
 * fresh canvas for WebGL. The replacement preserves its attributes.
 */
export async function createRenderer(canvas, backends = { webgpu: Renderer, webgl: WebGLRenderer }) {
  let webgpuError;
  try {
    const renderer = await backends.webgpu.create(canvas);
    if (renderer.error || renderer.lost) {
      const error = renderer.error || new Error('WebGPU device was lost during initialization');
      renderer.destroy();
      throw error;
    }
    return { renderer, canvas, backend: 'WebGPU' };
  } catch (error) {
    webgpuError = error;
  }

  const replacement = canvas.cloneNode(false);
  canvas.replaceWith(replacement);
  try {
    const renderer = await backends.webgl.create(replacement);
    if (renderer.error || renderer.lost) {
      const error = renderer.error || new Error('WebGL context was lost during initialization');
      renderer.destroy();
      throw error;
    }
    return { renderer, canvas: replacement, backend: 'WebGL 2', webgpuError };
  } catch (webglError) {
    throw new AggregateError([webgpuError, webglError],
      `WebGPU: ${webgpuError.message}; WebGL 2: ${webglError.message}`);
  }
}
