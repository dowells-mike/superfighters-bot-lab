import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, 'local-game/source/scripts');
const patches = path.join(root, 'local-game/patches');
const ffdec = process.env.SF_FFDEC ?? path.join(root, 'tools/ffdec/ffdec.jar');
await access(ffdec).catch(() => { throw new Error('JPEXS was not found. Set SF_FFDEC to ffdec.jar; see docs/setup.md.'); });
await access(path.join(source, 'Code/Main.as')).catch(() => { throw new Error('Export the local game scripts first with npm run prepare:game; see docs/setup.md.'); });
async function patch(relative, transform) {
  const filename = path.join(patches, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, transform(await readFile(path.join(source, relative), 'utf8')));
}
function methods(text, code) {
  const index = text.lastIndexOf('   }');
  return text.slice(0, index) + code + '\n' + text.slice(index);
}

await patch('Code/Main.as', text => {
  text = text.replace('   import flash.display.MovieClip;', `   import flash.display.MovieClip;
   import flash.external.ExternalInterface;
   import flash.events.KeyboardEvent;
   import flash.events.Event;
   import flash.utils.getTimer;`);
  text = text.replace('      public function Main(', `      private var _bridgeHeld:Array = [];
      private var _bridgeLastInput:int = 0;

      public function Main(`);
  text = text.replace('         _Handler_Output.Trace("Game Started Successfully");', `         if(ExternalInterface.available)
         {
            ExternalInterface.addCallback("sfState",BridgeState);
            ExternalInterface.addCallback("sfKeys",BridgeKeys);
            ExternalInterface.addCallback("sfConfigure",BridgeConfigure);
            ExternalInterface.addCallback("sfDuel",BridgeDuel);
            ExternalInterface.addCallback("sfRestart",BridgeRestart);
            ExternalInterface.addCallback("sfWorld",BridgeWorld);
            ExternalInterface.addCallback("sfTrace",BridgeTrace);
         }
         _stage.addEventListener(Event.ENTER_FRAME,BridgeWatchdog);
         _Handler_Output.Trace("Game Started Successfully");`);
  return methods(text, `
      public function BridgeState() : Object
      {
         var result:Object = _Handler_GameMain.BridgeState();
         result.keys = _Handler_Options.GetPlayerKeys();
         result.inputHeld = _bridgeHeld.concat();
         result.bridgeVersion = 4;
         return result;
      }

      public function BridgeConfigure(csv:String) : Array
      {
         var values:Array = csv.split(",");
         var keys:Array = _Handler_Options.GetPlayerKeys();
         var i:int = 0;
         if(values.length != 11) throw new Error("Expected 11 key codes");
         while(i < 11)
         {
            keys[0][i] = int(values[i]);
            i++;
         }
         _Handler_Options.PlayerKeys = keys;
         _Handler_Options.SaveData();
         return keys;
      }

      public function BridgeKeys(csv:String) : Boolean
      {
         var next:Array = [];
         var values:Array = csv == "" ? [] : csv.split(",");
         var value:*;
         var key:int;
         for each(value in values)
         {
            key = int(value);
            if(key > 0 && key < 256 && next.indexOf(key) < 0) next.push(key);
         }
         for each(value in _bridgeHeld)
         {
            if(next.indexOf(value) < 0) _stage.dispatchEvent(new KeyboardEvent(KeyboardEvent.KEY_UP,true,false,0,int(value)));
         }
         for each(value in next)
         {
            if(_bridgeHeld.indexOf(value) < 0) _stage.dispatchEvent(new KeyboardEvent(KeyboardEvent.KEY_DOWN,true,false,0,int(value)));
         }
         _bridgeHeld = next;
         _bridgeLastInput = getTimer();
         return true;
      }

      private function BridgeWatchdog(event:Event) : void
      {
         if(_bridgeHeld.length > 0 && getTimer() - _bridgeLastInput > 700) BridgeKeys("");
      }

      public function BridgeDuel(map:int = 2, difficulty:int = 3, mode:int = 1) : Boolean
      {
         BridgeKeys("");
         _Handler_MenuMain.BridgeDuel(map,difficulty,mode);
         return true;
      }

      public function BridgeRestart() : Boolean
      {
         BridgeKeys("");
         _Handler_GameMain.BridgeRestart();
         return true;
      }

      public function BridgeWorld() : Object
      {
         return _Handler_GameMain.BridgeWorld();
      }

      public function BridgeTrace(x0:Number,y0:Number,x1:Number,y1:Number,ignoreID:int=-1,cloud:Boolean=false) : Object
      {
         return _Handler_GameMain.BridgeTrace(x0,y0,x1,y1,ignoreID,cloud);
      }
`);
});

await patch('Code/Handler/MenuMain.as', text => methods(text, `
      public function BridgeDuel(map:int, difficulty:int, mode:int) : void
      {
         var setup:PlayerSetupData = new PlayerSetupData();
         var data:NewGameData = new NewGameData();
         if(map < 2 || map > 7) throw new Error("Choose map 2 through 7");
         if(difficulty < 1 || difficulty > 3) throw new Error("Choose difficulty 1 through 3");
         if(mode != 1 && mode != 2) throw new Error("Choose solo mode 1 or team mode 2");
         if(_menu_overlay.parent != null) _menu_overlay.parent.removeChild(_menu_overlay);
         if(_Handler_Keyboard != null) _Handler_Keyboard.Deconstruct();
         _Handler_GameMain.Stop();
         setup.ot = _Handler_Output;
         setup.keys = _Handler_Options.GetPlayerKeys();
         setup.totalPlayers = 2;
         setup.ai = [1,0];
         setup.characters = [1,2];
         setup.teams = [0,0];
         setup.aiDifficulty = [0,difficulty];
         data.lvl = map;
         data.pSetupData = setup;
         data.gameScale = 1.05;
         data.gamePosX = 0;
         data.gamePosY = 37.5;
         data.challengeNr = -1;
         data.isMenuDemo = false;
         data.isTutorial = false;
         data.isSurvival = false;
         data.showTips = false;
         data.newScore = true;
         data.gameMode = mode;
         _Handler_GameMain.StartNewGame(data);
      }
`));

await patch('Code/Handler/GameMain.as', text => {
  text = text.replace('      public static var DEBUG_MODE:Boolean = false;', '      public static var DEBUG_MODE:Boolean = false;\n      private var _bridgeRoundId:int = 0;');
  text = text.replace('         _prevGameData = gameData;', '         _prevGameData = gameData;\n         _bridgeRoundId++;');
  text = text.replace('   import flash.net.SharedObject;', '   import flash.net.SharedObject;\n   import flash.utils.getTimer;\n   import flash.utils.getQualifiedClassName;');
  return methods(text, `
      public function BridgeState() : Object
      {
         var result:Object = {};
         var players:Array = [];
         var player:Player;
         var state:PlayerState;
         var item:Object;
         var other:Player;
         var visible:Array;
         var key:*;
         var pressed:Array = [];
         var weapons:Array = [];
         var body:b2Body;
         var weaponData:*;
         result.timeMs = getTimer();
         result.roundId = _bridgeRoundId;
         result.mode = _prevGameData == null ? 0 : _prevGameData.gameMode;
         result.difficulties = _prevGameData == null ? [] : _prevGameData.pSetupData.aiDifficulty;
         for each(key in _Handler_Options.GetPlayerKeys()[0])
         {
            if(_Handler_Keyboard != null && int(key) > 0 && _Handler_Keyboard.KeyIsDown(int(key)) && pressed.indexOf(int(key)) < 0) pressed.push(int(key));
         }
         result.playerInput = pressed;
         result.roundOver = _roundOver;
         result.ready = _countdownOver && _round_initialized <= 0 && _tipsOver;
         result.map = _prevGameData == null ? 0 : _prevGameData.lvl;
         result.menuDemo = _prevGameData == null ? true : _prevGameData.isMenuDemo;
         result.soloWinner = _Handler_Players == null ? -1 : _Handler_Players.GetPlayerNrWinner();
         if(_Handler_Players != null)
         {
            for each(player in _Handler_Players.Players)
            {
               state = player.State;
               item = {};
               item.id = player.PlayerNr;
               item.bot = player.Bot;
               item.team = player.Team;
               item.x = player.PosX();
               item.y = player.PosY();
               item.midX = player.MidPosX();
               item.midY = player.MidPosY();
               item.hp = state.HP;
               item.gone = state.Gone;
               item.vx = state.AirVelocityX;
               item.vy = state.AirVelocityY;
               item.facing = state.LastDirX;
               item.onGround = state.OnGround;
               item.aiming = state.Aiming;
               item.aimTurnDelay = state.AimTurningAroundDelay;
               item.weaponCooldown = state.CurrentWeaponCooldown;
               item.aimPitch = state.CurrentAimPitch;
               item.aimMode = state.AimMode;
               item.aimUpper = state.UpperAimPitch;
               item.aimLower = state.LowerAimPitch;
               item.aimX = state.CharAnimWpnX;
               item.aimY = state.CharAnimWpnY;
               item.kneeling = state.Kneeling;
               item.knockedDown = state.Knockdowned;
               item.climbing = state.Climbing;
               item.stamina = state.SprintEnergy;
               item.burn = state.BurnState;
               item.weapon = state.CurrentRangeWeapon == null ? null : state.CurrentRangeWeapon.Properties.WeaponType;
               item.ammo = state.RangeWeaponTotalAmmo;
               item.range = state.RangeWeaponRange;
               item.meleeRange = state.MeleeWeaponRange;
               item.canGrab = state.CanGrabWeapon;
               item.grenades = state.CurrentThrowableWeapon == null ? 0 : state.CurrentThrowableWeapon.Ammo;
               item.throwTimer = state.ThrowTimer;
               item.immune = state.IsImmune;
               item.immunityFrames = state.ImmunityTimer;
               item.rolling = state.Rolling;
               item.diving = state.Diving;
               item.jumping = state.Jumping;
               item.sprinting = state.Sprinting;
               item.punching = state.Punching;
               item.staggering = state.Staggering;
               item.controllable = state.ControllAble;
               item.canRoll = state.CanRoll;
               item.canDive = state.CanDive;
               item.coverID = state.CoverObjectID;
               item.pitchSpeed = state.CurrentChangePitchSpeed;
               item.bulletSpeed = state.CurrentRangeWeapon == null || state.CurrentRangeWeapon.Properties.Projectile == null ? 0 : state.CurrentRangeWeapon.Properties.Projectile.Properties.Speed;
               item.damage = state.CurrentRangeWeapon == null || state.CurrentRangeWeapon.Properties.Projectile == null ? 0 : state.CurrentRangeWeapon.Properties.Projectile.Properties.Damage;
               if(!player.Bot && _Handler_ProjectilesUpdater != null)
               {
                  item.bulletThreat = _Handler_ProjectilesUpdater.BulletImpactFrameTime(player,0,7);
                  item.rocketThreat = _Handler_ProjectilesUpdater.RocketImpactFrameTime(player,0,9);
                  item.fireHere = _Handler_Fires.PlayerPosInFire(player.MidPosX(),player.MidPosY()+4);
               }
               if(!player.Bot && state.HP > 0 && !state.Gone && !_roundOver)
                  item.terrain = {leftDrop:BridgeDrop(player.PosX()-12,player.PosY()),rightDrop:BridgeDrop(player.PosX()+12,player.PosY()),leftLanding:BridgeDrop(player.PosX()-60,player.PosY()),rightLanding:BridgeDrop(player.PosX()+60,player.PosY()),leftWall:_static_world_hitbox_mc.hitTestPoint(player.PosX()-10,player.PosY()-10,true),rightWall:_static_world_hitbox_mc.hitTestPoint(player.PosX()+10,player.PosY()-10,true),fireLeft:_Handler_Fires.PlayerPosInFire(player.PosX()-24,player.PosY()-4),fireRight:_Handler_Fires.PlayerPosInFire(player.PosX()+24,player.PosY()-4)};
               visible = [];
               for each(other in _Handler_Players.Players)
               {
                  if(other != player && !other.State.Gone && other.State.HP > 0)
                     visible.push({id:other.PlayerNr,aimAlignment:player.PlayerInSightPercentage(other),clearShot:player.BotPositionShootableFrom(other.MidPosX(),other.MidPosY(),player.PosX() - state.LastDirX * 4,player.PosY() - 14),directShot:player.Bot ? false : BridgeTrace(player.PosX()-state.LastDirX*4,player.PosY()-14,other.MidPosX(),other.MidPosY(),int(state.CoverObjectID),!state.RangeWeaponCanShootDown).clear});
               }
               item.sight = visible;
               players.push(item);
            }
         }
         result.players = players;
         if(m_world != null)
         {
            for each(body in m_world.WeaponList)
            {
               weaponData = body.GetUserData().weaponData;
               if(weaponData != null && weaponData.Properties != null)
                  weapons.push({id:body.GetUserData().IDNumber,x:body.GetPosition().x*30,y:body.GetPosition().y*30,type:weaponData.Properties.WeaponType,ammo:weaponData.Ammo,pickupRadius:weaponData.Properties.PickupRadius,ranged:body.GetUserData().isRanged==true});
            }
         }
         result.weapons = weapons;
         return result;
      }

      private function BridgeDrop(x:Number, y:Number) : Number
      {
         var d:int = 0;
         while(d <= 80)
         {
            if((_static_world_hitbox_mc != null && _static_world_hitbox_mc.hitTestPoint(x,y+d,true)) || (_static_world_cloud_hitbox_mc != null && _static_world_cloud_hitbox_mc.hitTestPoint(x,y+d,true))) return d;
            d += 2;
         }
         return 1000;
      }

      public function BridgeTrace(x0:Number,y0:Number,x1:Number,y1:Number,ignoreID:int=-1,cloud:Boolean=false) : Object
      {
         var distance:Number = Math.sqrt((x1-x0)*(x1-x0)+(y1-y0)*(y1-y0));
         var steps:int = Math.max(1,Math.ceil(distance/2));
         var i:int = 1;
         var x:Number;
         var y:Number;
         var body:b2Body;
         while(i < steps)
         {
            x = x0+(x1-x0)*i/steps;
            y = y0+(y1-y0)*i/steps;
            body = m_world == null ? null : m_world.GetBulletSolidAt(x,y);
            if(body != null && int(body.GetUserData().IDNumber) != ignoreID)
               return {clear:false,blocker:BridgeBody(body),x:x,y:y};
            if(body == null && _static_world_hitbox_mc != null && _static_world_hitbox_mc.hitTestPoint(x,y,true) && !_static_objects_hitbox_mc.hitTestPoint(x,y,true))
               return {clear:false,blocker:null,x:x,y:y};
            if(cloud && y1>y0 && _static_world_cloud_hitbox_mc != null && _static_world_cloud_hitbox_mc.hitTestPoint(x,y,true))
               return {clear:false,blocker:null,x:x,y:y};
            i++;
         }
         return {clear:true,blocker:null};
      }

      private function BridgeBody(body:b2Body) : Object
      {
         var data:* = body.GetUserData();
         var bd:BodyData = data.objectData;
         return {id:data.IDNumber,type:getQualifiedClassName(data),x:body.GetPosition().x*30,y:body.GetPosition().y*30,width:data.width,height:data.height,hp:bd.HP,bulletHazard:bd.IsBulletHazard,burning:bd.ObjectOnFire,explosive:bd.IsExplosionHazard,active:bd.IsActiveHazard,bulletTransparent:bd.BulletTransparent,indestructible:bd.Indestructible};
      }

      public function BridgeWorld() : Object
      {
         var nodes:Array = [];
         var edges:Array = [];
         var objects:Array = [];
         var traps:Array = [];
         var grid:PathGrid = _Handler_Maps.GetPathGrid();
         var node:PathNode;
         var bind:PathBind;
         var body:b2Body;
         var data:*;
         var item:Object;
         var linked:b2JointEdge;
         if(grid != null)
         {
            for each(node in grid.Nodes)
               nodes.push({id:node.ListIndex,x:node.PosX,y:node.PosY,locked:node.Locked,fire:node.InFire,hazard:node.IsHazard,blocked:grid.NodeBlocked(node)});
            for each(bind in grid.Binds)
               edges.push({from:bind.SourceNode.ListIndex,to:bind.TargetNode.ListIndex,type:bind.MovementType,cost:bind.Distance,blocked:bind.Blocked});
         }
         if(m_world != null)
         {
            body = m_world.GetBodyList();
            while(body != null)
            {
               data = body.GetUserData();
               if(data != null && data.objectData != null && data.destroyed != true && data.objectData.HP > 0)
               {
                  item = BridgeBody(body);
                  objects.push(item);
                  if(item.type.indexOf("crate_hanging_holder") >= 0)
                  {
                     linked = body.m_jointList;
                     while(linked != null)
                     {
                        if(linked.other.GetUserData() != null && getQualifiedClassName(linked.other.GetUserData()).indexOf("crate_hanging") >= 0)
                        {
                           item.platform = BridgeBody(linked.other);
                           traps.push(item);
                           linked = null;
                        }
                        else linked = linked.next;
                     }
                  }
               }
               body = body.GetNext();
            }
         }
         return {roundId:_bridgeRoundId,map:_prevGameData == null ? 0 : _prevGameData.lvl,nodes:nodes,edges:edges,objects:objects,traps:traps};
      }

      public function BridgeRestart() : void
      {
         if(_prevGameData != null) Restart();
      }
`);
});

await mkdir(path.join(root,'tools/settings'),{recursive:true});
const result = spawnSync('java', ['-jar', ffdec,
  '-onerror', 'abort', '-importScript', path.join(root, 'local-game/superfighters-original.swf'),
  path.join(root, 'local-game/superfighters-bridge.pending.swf'), patches],
  { cwd: root, env:{...process.env,APPDATA:path.join(root,'tools/settings')}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
await writeFile(path.join(root, 'local-game/build.log'), (result.stdout ?? '') + (result.stderr ?? ''));
console.log((result.stdout ?? '').slice(-3500));
if (result.error || result.status !== 0) {
  if (result.error) console.error(result.error.message);
  console.error((result.stderr ?? '').slice(-5000));
  process.exitCode = result.status ?? 1;
} else await rename(path.join(root,'local-game/superfighters-bridge.pending.swf'),path.join(root,'local-game/superfighters-bridge.swf'));
