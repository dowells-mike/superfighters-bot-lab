import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readModelArtifact } from './model-store.mjs';

test('a fresh checkout uses the example model and personal training takes precedence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sf-model-test-'));
  try {
    await mkdir(path.join(root, 'models'));
    await writeFile(path.join(root, 'models/example-model.json'), '{"version":"example"}');
    assert.equal(JSON.parse(await readModelArtifact(root, 'human-model.json')).version, 'example');
    await writeFile(path.join(root, 'models/human-model.json'), '{"version":"personal"}');
    assert.equal(JSON.parse(await readModelArtifact(root, 'human-model.json')).version, 'personal');
    await writeFile(path.join(root, 'models/human-model.json'), '{broken');
    const broken = await readModelArtifact(root, 'human-model.json');
    assert.throws(() => JSON.parse(broken), SyntaxError);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('sf-model-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
