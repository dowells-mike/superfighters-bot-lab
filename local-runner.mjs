import { chromium } from 'playwright';
import { startOrReuse } from './local-launch.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const check=process.argv.includes('--check');
let context, page, server;
const diagnostics=[];
try {
  const launch=await startOrReuse(check?0:8765,{recordingDirectory:check?path.join(root,'local-game/verification/recordings'):undefined,onActivate:async()=>{
    if(!context) throw new Error('The game window is still starting.');
    const existingPage=context.pages().find(tab=>tab.url()===launch.url || tab.url()===`${launch.url}/`);
    if(existingPage) await existingPage.bringToFront();
    else {
      page=await context.newPage();
      await page.goto(launch.url);
      await page.bringToFront();
    }
  }});
  const {url}=launch;
  server=launch.server;
  if(launch.existing) {
    console.log(launch.activated ? 'Your existing Superfighters game window has been reopened.' : 'Superfighters is already running. Return to its open Edge window.');
    if(launch.legacy) console.log('After you close that game window, the updated launcher will handle repeat launches automatically.');
  } else {
  context=check
    ? await (await chromium.launch({channel:'msedge',headless:true})).newContext({viewport:{width:1200,height:900}})
    : await chromium.launchPersistentContext(path.join(root,'.browser-profile'),{channel:'msedge',headless:false,viewport:{width:1200,height:900},acceptDownloads:true});
  page=await context.newPage();
  page.on('console',message=>{ if(diagnostics.length<120) diagnostics.push(message.text()); });
  page.on('pageerror',error=>console.error('Page error:',error.message));
  await page.goto(url);
  if(check) {
    async function boot() {
      await page.locator('ruffle-player').waitFor();
      await page.waitForTimeout(7000);
      const box=await page.locator('ruffle-player').boundingBox();
      await page.mouse.click(box.x+box.width*.5,box.y+box.height*.875);
      await page.waitForFunction(()=>window.sfLab?.state()?.bridgeVersion>=1,{},{timeout:30000});
    }
    await boot();
    await page.locator('#difficulty').selectOption('1');
    await page.locator('#duel').click();
    await page.waitForFunction(()=>{const state=window.sfLab?.call('sfState');return state?.ready&&!state.menuDemo;},{},{timeout:15000});
    const before=await page.evaluate(()=>window.sfLab.call('sfState'));
    assert.equal(before.players.length,2);
    assert.equal(before.players.filter(p=>!p.bot).length,1);
    const me=before.players.find(p=>!p.bot);
    await page.evaluate(()=>window.sfLab.call('sfKeys','71'));
    await page.waitForTimeout(450);
    await page.evaluate(()=>window.sfLab.call('sfKeys',''));
    const after=await page.evaluate(()=>window.sfLab.call('sfState'));
    assert.notEqual(after.players.find(p=>!p.bot).x,me.x,'Normal right-key input must move Player 1');
    assert.equal(after.bridgeVersion,4);
    assert.equal(typeof after.players[0].immune,'boolean');
    const world=await page.evaluate(()=>window.sfLab.call('sfWorld'));
    assert.ok(world.nodes.length>10&&world.edges.length>10);
    assert.ok(Array.isArray(world.objects)&&Array.isArray(world.traps));
    await writeFile(path.join(root,'local-game/verification/world.json'),JSON.stringify(world,null,2));
    assert.ok(after.players.find(p=>!p.bot).terrain,'Read terrain to prevent blind movement into pits');
    assert.ok(Array.isArray(after.weapons),'Read weapon positions for normal pickups');
    assert.ok(Number.isSafeInteger(after.roundId));
    await page.locator('#export').click();
    await page.waitForFunction(()=>document.getElementById('snapshot-status').textContent.includes('Snapshot saved'));
    await page.evaluate(()=>window.sfLab.call('sfKeys','71'));
    assert.ok((await page.evaluate(()=>window.sfLab.call('sfState'))).playerInput.includes(71),'Record the actual game input for human/bot demonstrations');
    await page.waitForTimeout(1000);
    assert.equal((await page.evaluate(()=>window.sfLab.call('sfState'))).inputHeld.length,0,'Input watchdog must release stale bot keys');
    await page.evaluate(()=>window.sfLab.call('sfRestart'));
    await page.waitForFunction(()=>{const state=window.sfLab?.call('sfState');return state?.ready&&!state.menuDemo;},{},{timeout:15000});
    await page.evaluate(()=>window.sfLab.call('sfKeys','65'));
    await page.waitForTimeout(150);
    const aiming=await page.evaluate(()=>window.sfLab.call('sfState'));
    assert.ok(aiming.players.find(p=>!p.bot).aiming,'Holding shoot must enter aiming');
    await page.evaluate(()=>window.sfLab.call('sfKeys','65,83'));
    await page.waitForTimeout(80);
    await page.evaluate(()=>window.sfLab.call('sfKeys',''));
    const cancelled=await page.evaluate(()=>window.sfLab.call('sfState'));
    assert.equal(cancelled.players.find(p=>!p.bot).ammo,aiming.players.find(p=>!p.bot).ammo,'Melee must cancel held aim before trigger release without wasting ammo');
    await page.evaluate(()=>window.sfLab.call('sfKeys','65'));
    await page.waitForTimeout(350);
    await page.evaluate(()=>window.sfLab.call('sfKeys',''));
    await page.waitForTimeout(300);
    const shot=await page.evaluate(()=>window.sfLab.call('sfState'));
    assert.ok(shot.players.find(p=>!p.bot).ammo<12,'Normal shoot key must consume ammo on release');
    await page.evaluate(()=>window.sfLab.call('sfDuel',2,1,1));
    await page.waitForFunction(()=>{const state=window.sfLab?.call('sfState');return state?.ready&&!state.menuDemo;},{},{timeout:15000});
    await page.locator('#bot').click();
    await page.waitForTimeout(4000);
    assert.notEqual(await page.locator('#decision').textContent(),'Bot stopped. Manual play is available.');
    await page.locator('#stop').click();
    assert.equal((await page.evaluate(()=>window.sfLab.call('sfState'))).inputHeld.length,0);
    await mkdir(path.join(root,'local-game/verification'),{recursive:true});
    await writeFile(path.join(root,'local-game/verification/state.json'),JSON.stringify(after,null,2));
    await page.screenshot({path:path.join(root,'local-game/verification/practice.png')});
    await page.evaluate(()=>window.sfLab.call('sfConfigure','82,70,68,72,83,65,81,87,82,70,90'));
    await page.reload();
    await boot();
    assert.equal((await page.evaluate(()=>window.sfLab.call('sfState'))).keys[0][3],72,'Saved game controls must survive a reload without being overwritten');
    await page.evaluate(()=>window.sfLab.call('sfConfigure','82,70,68,71,83,65,81,87,82,70,90'));
    console.log('Verified: live state, practice matches, movement, shooting, input watchdog, starter-bot loop, and saved controls across a reload.');
  } else {
    console.log('Local Superfighters is ready. Click PLAY, then Start practice match.');
    console.log('F8 or Stop bot releases bot input. Close the browser to finish.');
    await new Promise(resolve=>context.once('close',resolve));
  }
  }
} catch(error) {
  if(page&&!page.isClosed()) {
    await mkdir(path.join(root,'local-game/verification'),{recursive:true});
    await page.screenshot({path:path.join(root,'local-game/verification/failure.png')});
    diagnostics.push(JSON.stringify(await page.evaluate(()=>({status:document.getElementById('status')?.textContent,lab:Boolean(window.sfLab),metadata:document.querySelector('ruffle-player')?.ruffle?.().metadata})),null,2));
    await writeFile(path.join(root,'local-game/verification/diagnostics.txt'),diagnostics.join('\n'));
  }
  if(check) throw error;
  console.error(`Could not open Superfighters: ${error.message}`);
  process.exitCode=1;
} finally {
  const browser=context?.browser();
  await context?.close();
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
}
