# Third-party material

The MIT license covers this project's original controller, launcher, recording and training code, bridge-building instructions, documentation, example model, and numeric test fixtures. It does not grant rights to the Superfighters game or external dependencies.

- **Superfighters v1.3:** developed by [MythoLogic Interactive](https://mythologicinteractive.com/Superfighters). The original and modified SWF files, game art/audio, extracted ActionScript, and generated patch files are excluded from this repository. Supply a local copy separately. The bridge builder generates patches locally against those scripts; the generated files are not distributed.
- **Ruffle:** installed from the [`@ruffle-rs/ruffle`](https://www.npmjs.com/package/@ruffle-rs/ruffle) package. See the [Ruffle repository](https://github.com/ruffle-rs/ruffle) for its license.
- **Playwright:** installed from npm. See [Playwright](https://github.com/microsoft/playwright) for its license.
- **JPEXS Free Flash Decompiler:** obtained separately from its [official releases](https://github.com/jindrapetrik/jpexs-decompiler/releases). It is not bundled. See its repository for licensing.
- **Python training libraries:** installed separately using `learning-requirements.txt`; their licenses remain with their respective packages.

The example model was trained on the maintainer's gameplay demonstrations. Its release metadata uses anonymous match identifiers. The small inference fixtures contain numeric game observations and prediction probabilities; they contain no game code, graphics, audio, browser data, or raw input recordings.
