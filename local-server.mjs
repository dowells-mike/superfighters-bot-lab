import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRecordingStore } from './recording-store.mjs';
import { readModelArtifact } from './model-store.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const workspaceId = createHash('sha256').update(root.toLowerCase()).digest('hex');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.swf': 'application/x-shockwave-flash', '.json': 'application/json' };

export async function serveLocal(port = 0, { onActivate, recordingDirectory = path.join(root,'recordings') } = {}) {
  const token = randomUUID();
  const saveRecording=createRecordingStore(recordingDirectory);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__lab/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ application: 'superfighters-bot-lab', workspaceId, token }));
        return;
      }
      if (url.pathname === '/__lab/activate' && req.method === 'POST') {
        if (req.headers['x-lab-token'] !== token) { res.writeHead(403); res.end('Forbidden'); return; }
        if (!onActivate) { res.writeHead(503); res.end('Game window is starting.'); return; }
        await onActivate();
        res.writeHead(200); res.end('Game window reopened.'); return;
      }
      if(url.pathname==='/__lab/record' && req.method==='POST') {
        if(req.headers['x-lab-token']!==token) {res.writeHead(403);res.end('Forbidden');return;}
        let body='';
        for await(const chunk of req) {
          body+=chunk.toString();
          if(Buffer.byteLength(body)>180000) {res.writeHead(413);res.end('Recording batch too large');return;}
        }
        const saved=await saveRecording(JSON.parse(body));
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify(saved));return;
      }
      let filename;
      if (url.pathname === '/') filename = 'local.html';
      else if (url.pathname === '/lab.mjs') filename = 'lab.mjs';
      else if (url.pathname === '/policy.mjs') filename = 'policy.mjs';
      else if (url.pathname === '/learned-policy.mjs') filename = 'learned-policy.mjs';
      else if (url.pathname === '/previous-policy.mjs') filename = 'previous-policy.mjs';
      else if (url.pathname === '/navigation.mjs') filename = 'navigation.mjs';
      else if (url.pathname === '/combat-tactics.mjs') filename = 'combat-tactics.mjs';
      else if (url.pathname === '/learning-features.mjs') filename = 'learning-features.mjs';
      else if (url.pathname === '/models/human-model.json') filename = 'models/human-model.json';
      else if (url.pathname === '/models/training-report.json') filename = 'models/training-report.json';
      else if (url.pathname === '/models/evaluation-report.json') filename = 'models/evaluation-report.json';
      else if (url.pathname === '/match-recorder.mjs') filename = 'match-recorder.mjs';
      else if (url.pathname === '/controls.json') filename = 'controls.json';
      else if (url.pathname === '/game.swf') filename = 'local-game/superfighters-bridge.swf';
      else if (/^\/ruffle\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) filename = 'node_modules/@ruffle-rs' + url.pathname;
      else { res.writeHead(404); res.end('Not found'); return; }
      const contents = filename.startsWith('models/')
        ? await readModelArtifact(root, path.basename(filename))
        : await readFile(path.join(root, filename));
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(contents);
    } catch (error) {
      if(!res.headersSent) res.writeHead(500);
      res.end('The local file operation could not complete.');
    }
  });
  await new Promise((resolve, reject) => {
    const failed = error => { server.close(); reject(error); };
    server.once('error', failed);
    server.listen(port, '127.0.0.1', () => { server.off('error', failed); resolve(); });
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
