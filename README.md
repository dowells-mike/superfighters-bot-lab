# Superfighters Bot Lab

I wanted a Superfighters bot that would keep fighting, aim well, and stop wasting its ammo on walls. This project combines a model trained on my games with tactics for shooting, weapon pickups, and moving around the arenas.

It runs locally in Microsoft Edge through Ruffle. The bot reads the game state through a small ActionScript bridge and plays through the normal keyboard controls. Health, damage, ammunition, physics, and the CPU's behavior are unchanged.

## Getting started

The supported setup is **Windows, Node.js 22 or newer, and Microsoft Edge**. Building the bridge also needs Java and JPEXS. Training is optional and needs Python.

```powershell
git clone https://github.com/dowells-mike/superfighters-bot-lab.git
cd superfighters-bot-lab
npm.cmd ci
```

The Superfighters movie is not included. Supply your own local **Superfighters v1.3 SWF**, then follow [the setup guide](docs/setup.md) to build the bridge. The guide covers the external tools and where to put the game file.

Once prepared, double-click **Start Local Game.cmd**, click **PLAY**, choose an arena, and click **Start practice match**. Select **Learned bot · aggressive shooting** and click **Start learned bot**. Use **Stop bot** or **F8** to release its controls.

The included example model is ready to use. You do not need to train a model before trying it. Launching again reopens the existing game window; it does not start a second server on the same port.

## How it plays

- Takes clear gun shots before making weapon detours or winding up a melee combo.
- Tracks the opponent during the weapon's cooldown and fires when the weapon is ready.
- Checks obstructions before releasing the trigger and waits through opponent immunity, rolls, and dives.
- Looks for reachable weapon upgrades and refills when it cannot take a useful shot.
- Uses arena connections for jumps, ladders, portals, drops, and close-range attacks.
- Avoids active fire and imminent explosions. It can shoot a hanging connector when the CPU is underneath and the bot is outside the falling crate's path.

Automatic projectile dodges, defensive rolls, and grenades are currently disabled. They were interrupting gun pressure and producing worse fights. Offensive dives, jump kicks, and movement needed to traverse the map remain available. Native knockdowns still happen when the bot is hit.

The controller has limitations: routing can get awkward around platforms, pickups are inconsistent, and environmental attacks need a clear angle. It is a work in progress, not an unbeatable player.

## Results

The current aggressive controller was tested against Hard CPU in three matches per arena, across all six arenas:

| Controller | Wins | Average damage dealt minus taken | Ammunition spent |
| --- | ---: | ---: | ---: |
| Aggressive learned bot | 14 / 18 | +28.8 HP | 124 |
| Previous learned bot | 13 / 18 | +25.7 HP | 232 |

The starts were independently randomized, rather than identical seeded matches. This is a small comparison, not a reliable estimate of the long-run win rate. The aggressive bot used no grenades and made no reactive dodge decisions in these matches. See [the full report](models/example-evaluation.json) for individual rounds, settings, and source fingerprints.

The panel shows evaluation results only when the tested model and controller match the installed versions. **Previous learned bot (comparison)** and **Starter bot (comparison)** remain available.

## Recording and learning

Manual practice matches record automatically. The panel shows **Recording** during play and **Match saved** when the data reaches disk. These are game-state and input logs sampled roughly every 80 milliseconds, not video recordings. A completed round and an interrupted round are saved separately.

1. Play practice matches manually, preferably across all arenas.
2. Double-click **Train Bot.cmd** after the recordings are saved.
3. Reload the game page to load your model.
4. Use **Evaluate Bot.cmd** to compare it against Hard CPU in separate browser sessions.

The example model uses **58 training matches and 16 whole matches held out for validation**, covering all six arenas. Training uses a compact Extra Trees ensemble and excludes bot-controlled samples. Successful demonstrations receive more weight. The model predicts inputs; tactical code corrects things such as careless firing.

This is imitation learning with tactical rules. It does not learn during a match or use reinforcement learning. Action-prediction scores and match results measure different things. When retraining an existing personal model, a candidate is promoted only if its prediction score is at least as good on the same held-out matches.

Personal models override the included example model. Raw recordings, model backups, generated game files, and the browser profile stay local and are ignored by Git.

## Controls

| Action | Key |
| --- | --- |
| Up / aim up / jump | R |
| Down / aim down / crouch | F |
| Left / right | D / G |
| Shoot / melee | A / S |
| Grenade / power-up | Q / W |
| Sprint | Z |

These are the initial bindings in `controls.json`. You can change them through the game's Setup menu; the bot reads the actual bindings. Preferences are stored in a dedicated project browser profile. Editing `controls.json` intentionally reapplies its bindings on the next launch.

## Development

```powershell
npm.cmd test                  # Portable regression tests; no game needed
npm.cmd run check:local       # Game loading, controls, bridge, and watchdog
npm.cmd run check:tactics-native
npm.cmd run check:learning-ui
npm.cmd run train
npm.cmd run evaluate
```

Live checks need the locally prepared game. Evaluation uses independent headless browsers and does not interrupt the main game or add bot matches to human training data. See [the setup guide](docs/setup.md) for training dependencies and [CONTRIBUTING.md](CONTRIBUTING.md) for useful changes and checks.

The main pieces are:

| File | Purpose |
| --- | --- |
| `build-bridge.mjs` | Adds observation and normal-input callbacks to a local movie |
| `lab.mjs`, `local.html` | Browser interface and controller loop |
| `local-runner.mjs`, `local-server.mjs` | Dedicated browser profile and localhost server |
| `match-recorder.mjs`, `recording-store.mjs` | Recording, buffered saves, and retry handling |
| `learning-features.mjs`, `learned-policy.mjs` | Shared features and browser inference |
| `export-training.mjs`, `train-learning.py` | Human demonstrations and model training |
| `combat-tactics.mjs`, `navigation.mjs` | Combat choices, routes, and movement guards |
| `evaluate-bots.mjs` | Live match comparisons |

## Credits and license

Created and play-tested by [dowells-mike](https://github.com/dowells-mike). **OpenAI Codex assisted with implementation, debugging, testing, and documentation**. The gameplay feedback and demonstrations guided the bot's behavior.

[Superfighters](https://mythologicinteractive.com/Superfighters) is by MythoLogic Interactive. [Ruffle](https://ruffle.rs/) runs the Flash movie, and [JPEXS](https://github.com/jindrapetrik/jpexs-decompiler) is used to build the local bridge. This is an independent fan project.

The project's original code, example model, and numeric fixtures are available under the [MIT license](LICENSE). Superfighters, its assets and extracted scripts, and external tools are not part of that license and are not redistributed here. See [THIRD_PARTY.md](THIRD_PARTY.md).
