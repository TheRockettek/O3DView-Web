import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../src/renderer-selection.js';

function canvas() {
  const replacement = {};
  return {
    replacement,
    cloneNode: () => replacement,
    replaceWith(value) { this.replacedWith = value; }
  };
}

test('prefers WebGPU without acquiring WebGL', async () => {
  const original = canvas();
  const gpu = {};
  const result = await createRenderer(original, {
    webgpu: { create: async input => { assert.equal(input, original); return gpu; } },
    webgl: { create: () => assert.fail('WebGL should not be initialized') }
  });
  assert.equal(result.backend, 'WebGPU');
  assert.equal(result.renderer, gpu);
  assert.equal(result.canvas, original);
  assert.equal(original.replacedWith, undefined);
});

test('uses a fresh canvas for WebGL after WebGPU initialization fails', async () => {
  const original = canvas();
  const failure = new Error('device unavailable');
  const gl = {};
  const result = await createRenderer(original, {
    webgpu: { create: async () => { throw failure; } },
    webgl: { create: async input => { assert.equal(input, original.replacement); return gl; } }
  });
  assert.equal(original.replacedWith, original.replacement);
  assert.equal(result.canvas, original.replacement);
  assert.equal(result.backend, 'WebGL 2');
  assert.equal(result.renderer, gl);
  assert.equal(result.webgpuError, failure);
});

test('lost renderer during startup is destroyed before fallback', async () => {
  const original = canvas();
  let destroyed = false;
  const result = await createRenderer(original, {
    webgpu: { create: async () => ({ lost: true, destroy() { destroyed = true; } }) },
    webgl: { create: async () => ({}) }
  });
  assert.ok(destroyed);
  assert.equal(result.backend, 'WebGL 2');
});

test('reports both failures when no renderer is available', async () => {
  const original = canvas();
  await assert.rejects(createRenderer(original, {
    webgpu: { create: async () => { throw new Error('no GPU'); } },
    webgl: { create: async () => { throw new Error('no GL'); } }
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /WebGPU: no GPU; WebGL 2: no GL/);
    assert.equal(error.errors.length, 2);
    return true;
  });
});
