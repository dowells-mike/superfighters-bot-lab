import { serveLocal, workspaceId } from './local-server.mjs';

export async function startOrReuse(port, options = {}) {
  try {
    return { ...await serveLocal(port, options), existing: false };
  } catch (error) {
    if (error.code !== 'EADDRINUSE' || !port) throw error;
    const url = `http://127.0.0.1:${port}`;
    try {
      const status = await fetch(`${url}/__lab/status`, { signal: AbortSignal.timeout(2000) });
      if (status.ok) {
        const data = await status.json();
        if (data.application === 'superfighters-bot-lab' && data.workspaceId === workspaceId) {
          const activate = await fetch(`${url}/__lab/activate`, {
            method: 'POST', headers: { 'x-lab-token': data.token }, signal: AbortSignal.timeout(5000)
          });
          return { existing: true, activated: activate.ok, url };
        }
      } else if (status.status === 404) {
        // Recognize the earlier launcher, which does not yet have activation support.
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        const html = await response.text();
        if (response.ok && html.includes('<title>Superfighters Bot Lab</title>') && html.includes('src="/lab.mjs"'))
          return { existing: true, activated: false, legacy: true, url };
      }
    } catch { /* Give the user the useful port-conflict explanation below. */ }
    throw new Error(`Another application is using the game's local address (port ${port}). The game could not start.`);
  }
}
