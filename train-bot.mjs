import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const root=path.dirname(fileURLToPath(import.meta.url));
const candidates=process.env.SF_PYTHON?[process.env.SF_PYTHON]:[
  path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),
  path.join(process.env.USERPROFILE??'','.cache','codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),
  'python',
];
const python=candidates.find(candidate=>(!candidate.includes(path.sep)||existsSync(candidate))&&spawnSync(candidate,['--version'],{windowsHide:true}).status===0);
if(!python)throw new Error('Python was not found. Create a .venv or set SF_PYTHON; see docs/setup.md.');
console.log('Preparing your human-play recordings. Bot-play recordings are excluded.');
let result=spawnSync(process.execPath,['export-training.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.status!==0)process.exit(result.status??1);
console.log('Training the bot. Entire matches are reserved for testing.');
result=spawnSync(python,['train-learning.py'],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.status!==0)process.exit(result.status??1);
console.log('Training finished. Reload the game page to use the new model.');
console.log('You can run Evaluate Bot.cmd to check its match results against Hard CPU.');
