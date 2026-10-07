import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Personal training output takes precedence over the portable release examples.
export async function readModelArtifact(root, name) {
  const examples = {
    'human-model.json': 'example-model.json',
    'training-report.json': 'example-training-report.json',
    'evaluation-report.json': 'example-evaluation.json',
  };
  try {
    return await readFile(path.join(root, 'models', name));
  } catch (error) {
    if (error.code !== 'ENOENT' || !examples[name]) throw error;
    return readFile(path.join(root, 'models', examples[name]));
  }
}
