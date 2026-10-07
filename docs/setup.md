# Setup

Windows with Microsoft Edge is the supported environment. The pure JavaScript tests also run on Linux, but the game launcher currently selects the installed Edge browser.

## Dependencies

- Install [Node.js](https://nodejs.org/) 22 or newer, then run `npm.cmd ci` in the project folder.
- Install Microsoft Edge if it is not already available.
- Install a Java runtime; the bridge was built with Java 17.
- Download the portable ZIP of [JPEXS Free Flash Decompiler](https://github.com/jindrapetrik/jpexs-decompiler/releases). The tested version is 26.3.0. Extract it into `tools/ffdec`, with `ffdec.jar` directly inside that folder. Alternatively, set `SF_FFDEC` to the absolute path of your `ffdec.jar`.

## Prepare the game

Supply a local **Superfighters v1.3 SWF**. The game itself is not included or downloaded by the setup command. This bridge targets the original web game, rather than Superfighters Deluxe.

```powershell
npm.cmd run prepare:game -- "C:\path\to\superfighters.swf"
```

This copies the movie to `local-game/superfighters-original.swf`, exports ActionScript into `local-game/source`, and builds `local-game/superfighters-bridge.swf`. The original is kept unchanged. All of those files are ignored by Git. The command refuses to overwrite an existing original movie with a different supplied path.

If the original is already in place, use:

```powershell
npm.cmd run prepare:game
```

For later bridge-only changes, run `npm.cmd run build:bridge`. If a different game version fails to compile, use the supported v1.3 movie. The setup logs print the local movie's SHA-256 so you can compare versions without sharing the movie.

## Play

Double-click **Start Local Game.cmd**, or run `npm.cmd run local`. The launcher uses a dedicated browser profile and listens on `127.0.0.1:8765`. Click **PLAY** in the game, then **Start practice match** in the panel. Start the learned bot from the controller selector.

**F8** or **Stop bot** releases automated input. Close the game browser to finish. If it is already running, launching again reopens its window. If another program uses port 8765, the launcher reports the conflict and leaves that program alone.

The included model is used when no personal model exists. You can play manually and record matches before installing Python.

## Optional training

Install [Python](https://www.python.org/downloads/). Python 3.12 is the tested runtime. Create a project virtual environment and install the pinned libraries:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r learning-requirements.txt
```

The launcher finds `.venv` automatically. `SF_PYTHON` can select another Python executable. [Python's venv documentation](https://docs.python.org/3/library/venv.html) describes virtual environments.

Play several manual practice matches, wait for **Match saved**, then double-click **Train Bot.cmd**. More varied demonstrations across all six arenas are better than repeated snapshots. Bot-controlled frames are excluded from training.

Training writes private artifacts into `models` and `tools/training`. Personal models take precedence over the included example; the example is not overwritten. Reload the page after training.

## Testing and evaluation

`npm.cmd test` runs without Java, Python, or a game movie. Live checks require the prepared game:

```powershell
npm.cmd run check:local
npm.cmd run check:tactics-native
npm.cmd run check:learning-ui
```

Double-click **Evaluate Bot.cmd** for two rounds per arena per controller. The command-line defaults to one round per arena. You can choose a larger comparison:

```powershell
$env:SF_EVAL_ROUNDS = '3'
$env:SF_EVAL_LIMIT = '60'
npm.cmd run evaluate
```

Reports and test recordings stay local. Evaluation uses separate headless browsers, without touching the normal browser profile or human training recordings. The setup and bridge flags follow [JPEXS's command-line documentation](https://github.com/jindrapetrik/jpexs-decompiler/wiki/Commandline-arguments).
