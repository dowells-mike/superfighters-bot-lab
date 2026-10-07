import { copyFile, mkdir, access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const original = path.join(root, 'local-game/superfighters-original.swf');
const ffdec = process.env.SF_FFDEC ?? path.join(root, 'tools/ffdec/ffdec.jar');
const supplied = process.argv[2] && path.resolve(process.argv[2]);
try {
  await access(ffdec);
  await mkdir(path.dirname(original), { recursive: true });
  if (supplied && supplied !== original) {
    // Never replace a local game silently when preparing a different movie.
    await copyFile(supplied, original, constants.COPYFILE_EXCL);
  }
  const game = await readFile(original);
  if (!['FWS', 'CWS', 'ZWS'].includes(game.subarray(0, 3).toString())) {
    throw new Error('The supplied file is not a Flash SWF movie.');
  }
  console.log(`Local game SHA-256: ${createHash('sha256').update(game).digest('hex')}`);
  await mkdir(path.join(root, 'tools/settings'), { recursive: true });
  const exported = spawnSync('java', ['-jar', ffdec, '-onerror', 'abort', '-export', 'script',
    path.join(root, 'local-game/source'), original], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, APPDATA: path.join(root, 'tools/settings') },
  });
  if (exported.error) throw exported.error;
  if (exported.status !== 0) throw new Error('JPEXS could not export the game scripts.');
  const built = spawnSync(process.execPath, ['build-bridge.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (built.error) throw built.error;
  if (built.status !== 0) throw new Error('The game bridge could not be built.');
  console.log('Game prepared. Run npm run local to play.');
} catch (error) {
  console.error(`Game setup failed: ${error.message}`);
  console.error('See docs/setup.md for the required local SWF, Java, and JPEXS installation.');
  process.exitCode = 1;
}
