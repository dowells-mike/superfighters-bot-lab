# Contributing

Improvements to aiming, routing, and weapon collection are welcome. A useful bug report includes the arena, weapon, approximate positions, expected behavior, and what happened instead.

Run `npm ci` and `npm test` before sending a change. Portable tests do not need the game or Python. For bridge or input changes, also run `npm run check:local` with a prepared local game. Use `npm run check:tactics-native` for connector/collision changes.

For combat changes, use `npm run evaluate` and report the number of rounds, arenas, difficulty, wins, and damage trades. Native spawns are random; one lucky match is not enough evidence. Do not change game rules to improve a benchmark.

Keep commits focused and explain the gameplay problem they solve. When changing controller code, rerun evaluation before treating an older result as current. Controller fingerprints prevent stale comparisons from appearing in the panel.

Please keep SWF files, extracted game scripts, browser profiles, raw recordings, generated tools, credentials, and personal model backups out of commits. Recordings may be useful for debugging locally, but review their contents before sharing any examples.

The current combat direction prioritizes gun pressure. Grenades and reactive dodges are intentionally disabled; discuss a measured improvement before reintroducing them.
