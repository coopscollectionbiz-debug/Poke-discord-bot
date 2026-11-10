# Mega Evolution: sprite availability

Fresh probe, 2026-11-09 (`audit-data/scripts/probe.py`, results in `audit-data/probe-results.json`). Every candidate file for all 99 Mega and Primal rows was downloaded into a scratch directory and decoded with Pillow. For each file the probe recorded dimensions, frame count, unique frames, loop flag, opaque colour count, alpha levels, transparency, bounding box, byte size and SHA-1, plus a first-frame pixel hash for the shiny-difference check. Nothing was added to `public/`.

## 1. Rules applied

1. Preferred: a verified BW-style **animated** 2D sprite (Showdown `gen5ani` / `gen5ani-shiny`, from the Smogon sprite projects; PokéAPI `black-white/animated` mirrors them).
2. Fallback: a verified BW-style **static** 2D sprite (Showdown `gen5`, then PokéAPI `black-white`).
3. "Pixel art" means ≤ 64 opaque colours **and** ≤ 2 alpha levels (hard-edged transparency).
4. Rejected: Showdown `ani` (3D-model GIFs; 85 of the 99 rows have one), and the **27** Showdown `gen5` static files for Z-A Megas that are downscaled 3D renders (1,139–3,518 colours, 209–254 alpha levels).
5. A shiny counts only if it differs from the normal: different bytes **and** a different first-frame pixel hash. All 98 rows with sprites pass. None is a copy of the normal.
6. A base-form sprite is never used for a Mega. A form with no acceptable sprite is **unavailable for activation**.

## 2. Coverage (93 distinct Mega forms; the 97 rows count Meowstic M/F, Magearna Original and the 3 Tatsugiri appearances separately)

| Introduction group | Mega forms | Animated normal | Animated shiny | Static normal (fallback) | Static shiny (fallback) | No acceptable sprite |
|---|---:|---:|---:|---:|---:|---:|
| X/Y | 30 | 19 | 19 | 30 | 30 | 0 |
| ORAS | 18 | 5 | 5 | 18 | 18 | 0 |
| Legends: Z-A (base game) | 26 | 0 | 0 | 25 | 25 | **1 (Zygarde)** |
| Legends: Z-A Mega Dimension | 19 forms (23 rows) | 0 | 0 | 19 (23 rows) | 19 (23 rows) | 0 |
| **All Megas** | **93** | **24 (25.8%)** | **24 (25.8%)** | **92 (98.9%)** | **92 (98.9%)** | **1** |
| Primal Reversion (out of scope) | 2 | 2 | 2 | 2 | 2 | 0 |

- Every animated sprite found has an animated shiny, and every static normal has a static shiny.
- The 24 animated Megas: Charizard X, Beedrill, Alakazam, Mewtwo X, Mewtwo Y, Ampharos, Steelix, Scizor, Tyranitar, Blaziken, Gardevoir, Mawile, Medicham, Manectric, Banette, Absol, Glalie, Salamence, Latias, Latios, Rayquaza, Garchomp, Lucario, Abomasnow.
- No Z-A Mega has a 2D animation anywhere audited.
- Dimensions: statics are 96×96. Animations range from 55×71 to 114×115 with 10–186 frames (all `loop=0`, infinite). All are well under Discord's limits (largest file 226 KB, the Mega Alakazam shiny animation).
- Transparency: every chosen file has a transparent background.

## 3. Missing and flagged

| Form | Problem | Activation |
|---|---|---|
| **Mega Zygarde** | No 2D sprite in any audited source (Showdown `gen5`/`gen5ani`, PokéAPI BW static/animated). Only 3D renders and official artwork exist. | **Unavailable** until an acceptable asset exists |
| Mega Meowstic (M) / (F) | PokéAPI statics are **byte-identical** for male and female (Showdown's rejected render placeholders are identical too). Consistent upstream, but needs an owner visual check against the official designs. | Needs decision D-6 (gender) anyway |
| Mega Mewtwo X / Y | The PokéAPI animated mirror differs from Showdown (10/20 frames vs 89/122). Showdown `gen5ani` is the chosen source. | No issue |
| 44 statics/animations touch the canvas edge (bounding box reaches 0 or 96) | Normal for large BW-style sprites (it also happens in Gen 5 originals). Visually checked on the Z-A contact sheet (`audit-data/za-static-contact-sheet.png`): no visible cropping of essential features. | Informational |
| Z-A statics (49 rows, PokéAPI `black-white`) | 13–41 colours, hard alpha: genuine 2D pixel art from the Smogon Gen 8+ sprite project (tracker credits in the prior audit, e.g. Clefable by Travis, Heatran by Sphex). The colour counts are higher than X/Y-era sprites (11–19), so the style is slightly richer. Contact sheet reviewed: consistent BW-style front sprites, shinies visibly recoloured. | Acceptable |

## 4. Attribution and licensing

The same terms as the Gen 6–9 species apply (`docs/audits/pokemon-gen6-9/SPRITE-SOURCES-AND-LICENSING.md`): Smogon X/Y Sprite Project (lead Layell) and Smogon Gen 8+ project (lead G.E.Z., leParagon). Credit the spriter and project, non-profit use only. The X/Y project also asks for notice to Layell and a credit page. The per-form credit is in `MEGA-CATALOGUE.csv` (`attribution`). `/credits` must list Mega sprite artists before activation (`tools/generate-credits.mjs`).

## 5. Import plan (not executed)

- `tools/import-sprites.mjs` gains a `--forms mega` mode that writes `public/sprites/pokemon/forms/{normal,shiny,grayscale}/<stableId>.gif` (PNG → single-frame GIF, as for species) and `data/sprites/forms.json` with source URL, source SHA-1, file SHA-1, frames and size.
- Every imported file must match the SHA-1 recorded in this audit (`audit-data/probe-results.json`). Any upstream change fails the import.
- A grayscale variant is generated for the "locked" dashboard state.

## 6. Per-form results

Legend: SD = Pokémon Showdown sprites, PA = PokéAPI sprites (`versions/generation-v/black-white`). Full URLs are in `MEGA-CATALOGUE.csv` (`chosen_normal`, `chosen_shiny`).

### X/Y (30 rows)

| Form | Anim normal | Anim shiny | Static normal | Static shiny | Chosen normal (size, frames, colours, SHA-1) | Chosen shiny SHA-1 | Status |
|---|---|---|---|---|---|---|---|
| Mega Venusaur | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, 2c602e6ad2422a9658335ff945c41da1ca5b4437 | 13c4a50e32e9ea81529e5405d96c07a634c5b6d8 | C: static |
| Mega Charizard X | yes | yes | yes | yes | SD gen5ani: 105x94, 96f, 14c, 38339b6d7e4fa41b9b273a835b24561a3240c649 | ca3b59d1e7c55991501e6e8133673654fcdfbbc0 | A: animated |
| Mega Charizard Y | — | — | yes | yes | SD gen5: 96x96, 1f, 13c, 193b4422cd09a61f89308a31ac2fa677df73d7c7 | 23b23d5e74279efbc390c7e85e5f03bc542d16e6 | C: static |
| Mega Blastoise | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, f1d715a1b8f044f040ce2ae0f4d2a8782d16a858 | b1f9d8235ae375a3418ce794692320ceeef743e7 | C: static |
| Mega Alakazam | yes | yes | yes | yes | SD gen5ani: 88x98, 186f, 15c, 74658284f9fe6c7832b5514bc43b3ab8034cbeba | e46280e235ab53f48cc280e53522e027a1599a32 | A: animated |
| Mega Gengar | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, c2014faacbf89f328383b2cd9342abb43e786d00 | 0aa6fe30214910d2407bad69e84fa0dd608ad06d | C: static |
| Mega Kangaskhan | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, eb70e20dc7859e719b77b30e444706290e11cf03 | f5a42617197033ab0f818a43e1dbce451bcd1d3d | C: static |
| Mega Pinsir | — | — | yes | yes | SD gen5: 96x96, 1f, 14c, ac4b81da0e7f7b459ffc47d957cf5e78e868e056 | 88221a8c54d97134b313a58fbd03a268177aeb67 | C: static |
| Mega Gyarados | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, 8429ead72968196da6814124156a1a9855a23a35 | bd5d20abf9ebd3f5f5011560d55c895411b944da | C: static |
| Mega Aerodactyl | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, cea6c3a0b61e55327cbbb6d976906400b7b71655 | 7012a7d09c4f90eceada91f1c9a95b46f81a9fd0 | C: static |
| Mega Mewtwo X | yes | yes | yes | yes | SD gen5ani: 55x71, 89f, 13c, 23a4301930132d24df850a996ae39c34d08eb0c8 | 874cd381b0d8ba75218ce55bd985906c653648fc | A: animated |
| Mega Mewtwo Y | yes | yes | yes | yes | SD gen5ani: 75x87, 122f, 13c, de0bc472a2160fe1c2c3d5c8ac5c772f01199491 | 0e2151b0635ca239040441e67c13b0b38b3b94ae | A: animated |
| Mega Ampharos | yes | yes | yes | yes | SD gen5ani: 96x96, 10f, 13c, 9609b5f7bca445c4c30438a8cf282b95248ea71a | 957573bdb8335b612b75fcbddcc68dcd9b9064c3 | A: animated |
| Mega Scizor | yes | yes | yes | yes | SD gen5ani: 92x82, 84f, 12c, 7025f6249bd2e57b1413d7416ea9d34b66ad007d | bc8ed8c99bd2876b5e647c3e366474625c38a41a | A: animated |
| Mega Heracross | — | — | yes | yes | SD gen5: 96x96, 1f, 13c, e05ffe1061d4a213832c7d9fda6b69aab824a134 | 8811b616f03730e2928d918b58b05d17f7ea468c | C: static |
| Mega Houndoom | — | — | yes | yes | SD gen5: 96x96, 1f, 13c, 225f2fa7eefb5eddc148ec718159c57f9f91cede | 0ce8a109adbba080abb84b72d31e078910061e69 | C: static |
| Mega Tyranitar | yes | yes | yes | yes | SD gen5ani: 94x87, 102f, 18c, 86a6c9aff6dd69533b809a1cbc69b211bddaff9d | 5e5cace5ae35f2ad9d78b069a56840d14e4953ea | A: animated |
| Mega Blaziken | yes | yes | yes | yes | SD gen5ani: 114x115, 90f, 15c, 79529e7f9eb29106b6c299d0ed1ba7b273056297 | 1b1bc489fc6b4d51960e9c85770f0922d3df375f | A: animated |
| Mega Gardevoir | yes | yes | yes | yes | SD gen5ani: 96x96, 31f, 12c, 7cade356282a578b708aa02ee623706aab52cd6a | e8ee1133229d0ca0392089db6d8d287244ce167b | A: animated |
| Mega Mawile | yes | yes | yes | yes | SD gen5ani: 96x96, 16f, 15c, da3092096817ccb67e5ee5903bd2219360b54556 | 1118f00de1afa95afef1fda705eeec377811ef30 | A: animated |
| Mega Aggron | — | — | yes | yes | SD gen5: 96x96, 1f, 13c, 9eabeba20bc577a8ad2ba34bfa07945f67c8c8e1 | f7f6a86e8a92cebc96675bb9231fad2d5ce7bc87 | C: static |
| Mega Medicham | yes | yes | yes | yes | SD gen5ani: 93x81, 92f, 15c, e647eb2a5963d2547a87d27f37c59a29f752cb82 | 39a86a3fe897e8679fdf39ce2fa3552005d6e21d | A: animated |
| Mega Manectric | yes | yes | yes | yes | SD gen5ani: 92x74, 81f, 13c, 25ea4c5de259c67adda860f2b5e767778f514171 | 793edc079820b406218caad7e787739bb0bd11d9 | A: animated |
| Mega Banette | yes | yes | yes | yes | SD gen5ani: 96x96, 49f, 15c, c9f7f0961c0934270ccb584e466a1c247a9e210c | ae5c4d363a6400585e26eedd1ed0a3b74c0b8c4b | A: animated |
| Mega Absol | yes | yes | yes | yes | SD gen5ani: 96x96, 16f, 13c, a702a19b72ceadfec6f8d4a5067213e2eab83422 | aa2a9bb32a56c408b87aaa257ef12ed742edc5b8 | A: animated |
| Mega Latias | yes | yes | yes | yes | SD gen5ani: 94x109, 95f, 11c, 38c5691d2ae63b6ff55c786902c6725f5cc70579 | a248bf1d4fa9b78ece410240ff80ea619680ec15 | A: animated |
| Mega Latios | yes | yes | yes | yes | SD gen5ani: 100x104, 95f, 13c, 84ef41676c854200a0e5f2e1f88f6f781dd9d64e | dc9a7228849849c4bc9a695a31e42773b053c93e | A: animated |
| Mega Garchomp | yes | yes | yes | yes | SD gen5ani: 93x80, 114f, 14c, acd7ba7439e3e823c8d591e8d05a32f3ba84bcfb | 53c68bc2fd7e998faf8c472b25ba7433a6a0f35d | A: animated |
| Mega Lucario | yes | yes | yes | yes | SD gen5ani: 96x96, 72f, 19c, 2a13ab17dcbbb7bd2e7116b4489e975c476a649f | f5163623299978ff7fe74beef377ac0af0a2e61d | A: animated |
| Mega Abomasnow | yes | yes | yes | yes | SD gen5ani: 96x96, 52f, 14c, 28d283e80152f9161af9d93792b93794d32130fd | 1dbe5467a051d2a5a2ee004f3db737db0f0d0ff7 | A: animated |

### ORAS (18 rows)

| Form | Anim normal | Anim shiny | Static normal | Static shiny | Chosen normal (size, frames, colours, SHA-1) | Chosen shiny SHA-1 | Status |
|---|---|---|---|---|---|---|---|
| Mega Beedrill | yes | yes | yes | yes | SD gen5ani: 103x88, 180f, 15c, 07dd78727a8f444035f543ef26e0bd1497aceeda | c1583e96c9161a85df4d0ec6e84afe14f2fca133 | A: animated |
| Mega Pidgeot | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, 8da148868f7e21296241bf911b5c9d428d6fbb49 | f62c733b68d391e6292f1470fc5e445d61064120 | C: static |
| Mega Slowbro | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, 9ace49a3f4a5aef5bd7719be414e0c1e651c12ea | b3d36e0c3f7c53386ef25570143247b0fc45eacf | C: static |
| Mega Steelix | yes | yes | yes | yes | SD gen5ani: 96x88, 20f, 15c, 2967dc1be805e689d8e7f61f6fcf7e3187911555 | 85fa1091bc0c145684c8caed560351c357c1d176 | A: animated |
| Mega Sceptile | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, f44bacdb7d75cf17242f593da260c36c9033bac3 | 11f2a1c40d46efe1237c11b03e5f9027398108b3 | C: static |
| Mega Swampert | — | — | yes | yes | SD gen5: 96x96, 1f, 14c, ecd40f1aae126e7cbd2fa4ab8ad683bba4c5ca38 | d38e32d6f80907cc2da02ee5731b14f0edd3fe37 | C: static |
| Mega Sableye | — | — | yes | yes | SD gen5: 96x96, 1f, 13c, 768a0e1c8cb1009ca0337f276ddf62af4e66878a | 9ab6134b2e929e18741c597caa7e9ffeaed664eb | C: static |
| Mega Sharpedo | — | — | yes | yes | SD gen5: 96x96, 1f, 13c, 5ef0f9d6e9799accae9a9c594d8f56bc2cd5c956 | 068377144888bfa78bcf2a7b2ea4850df1cb04ab | C: static |
| Mega Camerupt | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, d5478eee8b8bcb4980e2fc7672aadb78d54dd1f5 | 63968b444fcd84ae6e4261273202a9ab302f0390 | C: static |
| Mega Altaria | — | — | yes | yes | SD gen5: 96x96, 1f, 13c, 69f5937c894e2401ef86ae97abcafc819aa17beb | cee0f6f1e71f7aae9027f90f84746a25a31fe42f | C: static |
| Mega Glalie | yes | yes | yes | yes | SD gen5ani: 62x84, 59f, 15c, 23ab0f420d7ed052d997a51478690e936b2105ff | d8ccf2f4480c68d5ed6deb5a13e0a2788e363aa0 | A: animated |
| Mega Salamence | yes | yes | yes | yes | SD gen5ani: 108x77, 103f, 15c, c1572f72199e027b1a1b4b85a2a962e2b6dbe6e9 | 5dca852a8be834433ef30125ec69df36c2b6ab83 | A: animated |
| Mega Metagross | — | — | yes | yes | SD gen5: 96x96, 1f, 14c, 1dd7b8d64a3d01561319c16cda287f8e737e524c | e03032d914fe909454a1c6e01922730e75320464 | C: static |
| Mega Rayquaza | yes | yes | yes | yes | SD gen5ani: 100x108, 12f, 16c, 546eabcbca3ad0a1ead397a13f195e88ff7f9aff | 7d0a598452a443f406eb68e04b1752104d9a684e | A: animated |
| Mega Lopunny | — | — | yes | yes | SD gen5: 96x96, 1f, 14c, 01519b8b73d67b72a47542fe09449946b593ec36 | 3efdc2514f6a92bc577eaede7a386cbccb2c5d40 | C: static |
| Mega Gallade | — | — | yes | yes | SD gen5: 96x96, 1f, 14c, 05c5a2103df73b4fb05656f0d8d1bc698b1c93a7 | f31c0289b981d0f8a5a54b6ffed08daff7ae4b6a | C: static |
| Mega Audino | — | — | yes | yes | SD gen5: 96x96, 1f, 12c, 9217b59bebb25b0ee17044a90ef1eeb7cffa1c3e | 5acf79e45543bece1f5a88d75a330a40392dcc21 | C: static |
| Mega Diancie | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, e4c187313e8b617f6c5f9910237f26eebd01eb94 | 6a7431e3cd517a63222b2782435d9f8ee971bb8f | C: static |

### Legends Z-A (base game) (26 rows)

| Form | Anim normal | Anim shiny | Static normal | Static shiny | Chosen normal (size, frames, colours, SHA-1) | Chosen shiny SHA-1 | Status |
|---|---|---|---|---|---|---|---|
| Mega Clefable | — | — | yes | yes | PA BW: 96x96, 1f, 23c, 167260702a7bb446ccdcc7550e8087f9212f183f | 8c6fd1f4094167705049c031b0ef1cfaef40d72c | C: static |
| Mega Victreebel | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, 0a217675be7b9282dd1bf9d95e24a153389012e8 | 2e32cf551b4317e8af934ea9dbffefa5a312e73c | C: static |
| Mega Starmie | — | — | yes | yes | PA BW: 96x96, 1f, 16c, 475cf4f7507b56e779835917b2d9bf57304498fc | 79d421fc9befc31fffa9176842ce514a6e3b55e2 | C: static |
| Mega Dragonite | — | — | yes | yes | SD gen5: 96x96, 1f, 15c, f47396e96e0ac60c8c3485100730be4ef93544fc | dec748c1022c56661c8a788e56dc74e35b698025 | C: static |
| Mega Meganium | — | — | yes | yes | PA BW: 96x96, 1f, 24c, f62440b3632a1a31302d9443390036d79ede9d77 | 4e6afd55f02b9fa2ee1f21e826d06c89575e7a15 | C: static |
| Mega Feraligatr | — | — | yes | yes | PA BW: 96x96, 1f, 16c, 70c1d2b0fa746d1c9c77559eddb124de462d7504 | 1d07a724fbf7eea0801026e1b5f0965bb59e4211 | C: static |
| Mega Skarmory | — | — | yes | yes | PA BW: 96x96, 1f, 13c, a8868ef695f4dfb0646b4bc262b48bb56e5cc134 | 64cf16f9319d72cbb574a7fe9df0a34c4dde75af | C: static |
| Mega Froslass | — | — | yes | yes | PA BW: 96x96, 1f, 26c, 933b949dee6370b514ae1d6bb4e4abad62f7e282 | 67e2b95811fc0604e27ca30d3a8c9a0daace209b | C: static |
| Mega Emboar | — | — | yes | yes | PA BW: 96x96, 1f, 15c, 453aeca59b8235d0f27f20d4689743d8e02e3c39 | 988bec4822577745b0546d3428ed11237a887787 | C: static |
| Mega Excadrill | — | — | yes | yes | PA BW: 96x96, 1f, 22c, 8ff542f1547700fcc2cf6fc267826738ac660d25 | dad957ab666fce56e6df18aade69663723330a90 | C: static |
| Mega Scolipede | — | — | yes | yes | PA BW: 96x96, 1f, 20c, 71313af7d200d79e3ec939ea3f5b47cf82088ea5 | 1d353c751ba3bd475ef89ff0573530cbf8d67c35 | C: static |
| Mega Scrafty | — | — | yes | yes | PA BW: 96x96, 1f, 15c, 298349add3f5147aa782a6b676b06463ab66df99 | e8771b5d20a2a8c0839659ed20323c56222f77a1 | C: static |
| Mega Eelektross | — | — | yes | yes | PA BW: 96x96, 1f, 22c, d336a05080eae7784ee251870fbe605146e2122a | a1f4c830a3861e898487f7a0c941a43aa047ea04 | C: static |
| Mega Chandelure | — | — | yes | yes | PA BW: 96x96, 1f, 16c, 8d8ccbddd76c4f5deede4d717221f1f8b6ee5f22 | 98d1f751ebbf34de21331e97dfd16dd081fb6755 | C: static |
| Mega Chesnaught | — | — | yes | yes | PA BW: 96x96, 1f, 19c, c6ca0aa15beb7bfa8cdf417ad518cc1ede1db856 | ed382b65f6dd333ca8198d83be1d01d9e3284e49 | C: static |
| Mega Delphox | — | — | yes | yes | PA BW: 96x96, 1f, 37c, 4f853f8bbc9695fe0277938f5fef601cebc99d40 | 72ebec5202bb504fe1edd06705a15716de5a6624 | C: static |
| Mega Greninja | — | — | yes | yes | PA BW: 96x96, 1f, 24c, 942a3f4f58faaecaccf465ec13e050139f4cf20f | 532b2eafc5372e3d90961cbed72070251cb69d29 | C: static |
| Mega Pyroar | — | — | yes | yes | PA BW: 96x96, 1f, 18c, 387216c63811389294ef38016927d7666a75f0a3 | 6e3e60924c5e026db122eaa5980446fc8aa75362 | C: static |
| Mega Floette | — | — | yes | yes | PA BW: 96x96, 1f, 17c, 40a472d1c5572b4b710093f7693ddd9183f6c034 | 93d6afc52b1b61110e2058d2d3b98ed0e4b7d34c | C: static |
| Mega Malamar | — | — | yes | yes | PA BW: 96x96, 1f, 34c, 29eb2d07ca6bb1076bdfa617df5190a7e9014b3a | c5bff2fabd489302372d4e7c96fe91a7cd3a8c23 | C: static |
| Mega Barbaracle | — | — | yes | yes | PA BW: 96x96, 1f, 17c, 65ecf18e6f0138bbd61b02ddec6d70552e4a5af2 | 71ba9e3cc97322bb4a620cac3d9b3d252b066f30 | C: static |
| Mega Dragalge | — | — | yes | yes | PA BW: 96x96, 1f, 20c, aba25c01800c07de8142d17e7b91513e213287cd | 57031a2197abcef9e0fc81644c506a447f06d841 | C: static |
| Mega Hawlucha | — | — | yes | yes | PA BW: 96x96, 1f, 23c, 6826276b0f1e468a55fc434a4dfe0368a9429006 | bcc3683854fbd3d43a2d724b681fcba35ab30e9a | C: static |
| Mega Zygarde | — | — | — | — | : NONE | NONE | **Unavailable** |
| Mega Drampa | — | — | yes | yes | PA BW: 96x96, 1f, 19c, 79de5bbcd3f5a683d6f51d70cf22df4703273d4a | 4bdc51a71867f1bc40d2ae02dfb530fca80cdfd4 | C: static |
| Mega Falinks | — | — | yes | yes | PA BW: 96x96, 1f, 15c, d54b48e1fe5aeb149fddb36b6329fee2559b5a9e | ff76ce18ccfd84b07a36ec02a794ffa6bdaecddc | C: static |

### Legends Z-A: Mega Dimension (23 rows)

| Form | Anim normal | Anim shiny | Static normal | Static shiny | Chosen normal (size, frames, colours, SHA-1) | Chosen shiny SHA-1 | Status |
|---|---|---|---|---|---|---|---|
| Mega Raichu X | — | — | yes | yes | PA BW: 96x96, 1f, 23c, ab3d2fdfe3aea11697b282170ec0a97344bb9ff0 | 8920c70cdb1c2fae012bc361335f936f87eb168f | C: static |
| Mega Raichu Y | — | — | yes | yes | PA BW: 96x96, 1f, 23c, 521a69f610a9251a27302e216e5a65200e37a343 | be74211dd27b8d64cad646fe203658ff6e45fe7a | C: static |
| Mega Chimecho | — | — | yes | yes | PA BW: 96x96, 1f, 20c, 3d9971ca96931b7af331cfd8871125350a376425 | 6ab869b79bc98238ecf1f23802103d21631bfeee | C: static |
| Mega Absol Z | — | — | yes | yes | PA BW: 96x96, 1f, 13c, cc4e60ed55804c5bf707a5f1455bcdac03b20015 | 01d50358800651d40ae24e7dadd6bb4534da4bd5 | C: static |
| Mega Staraptor | — | — | yes | yes | PA BW: 96x96, 1f, 19c, e4c12abf794fdfa7a1242d4c3424791c2b513780 | b9c47ed440e08beb46605ae0e2a97ad65f2fd90c | C: static |
| Mega Garchomp Z | — | — | yes | yes | PA BW: 96x96, 1f, 14c, ef834fd8d9ad17c085d12672ff03f1e0adefcc26 | c63deb1e2ef3d5a30ed4a87c4463db1ef6ec3056 | C: static |
| Mega Lucario Z | — | — | yes | yes | PA BW: 96x96, 1f, 15c, 251475011900be9387e41bcaebaf29fd0bf867c1 | 613da1695c8f9f3ee6a4e04652882a2d9f162be3 | C: static |
| Mega Heatran | — | — | yes | yes | PA BW: 96x96, 1f, 23c, 9d223f9c9461d1ef3f95654e4554783850ff8262 | f7162747e27729cae2a0d2adf2db32cf48f6b299 | C: static |
| Mega Darkrai | — | — | yes | yes | PA BW: 96x96, 1f, 15c, 9e944d712148363cfeb04d35e865d18d97af50fd | 4c1ecbf7843b8b2d7898c66d0be277c607d8560b | C: static |
| Mega Golurk | — | — | yes | yes | PA BW: 96x96, 1f, 16c, 498ff4ddaac1ea61f6caaaf3ac01ad259be7677e | e6e84391abc54c25cf911d1032c4dd8452e4b3cf | C: static |
| Mega Meowstic (Male) | — | — | yes | yes | PA BW: 96x96, 1f, 13c, 34536214db1e93b2d97bc26bce2a5564e8c8a27f | 8e405d77aca04b0080a5a4e946ed4ea32ece1235 | C: static |
| Mega Meowstic (Female) | — | — | yes | yes | PA BW: 96x96, 1f, 13c, 34536214db1e93b2d97bc26bce2a5564e8c8a27f | 8e405d77aca04b0080a5a4e946ed4ea32ece1235 | C: static |
| Mega Crabominable | — | — | yes | yes | PA BW: 96x96, 1f, 19c, c23c2eb181997e9b562852ba43b396b73ba478de | 1a991a995cd58de46a7ce084e84e9d2972fed965 | C: static |
| Mega Golisopod | — | — | yes | yes | PA BW: 96x96, 1f, 17c, 1c86f028640650dbba23fe7657c90a2e5cc6a656 | a3193853c6f41821d7629ffe1c8fb6e95410e716 | C: static |
| Mega Magearna | — | — | yes | yes | PA BW: 96x96, 1f, 35c, 0ea2f554d72a8bd24cbeb534ba74c8f3175ca686 | 0a7b2ab446d62adbfecf3ca611ee5c3d685af919 | C: static |
| Mega Magearna (Original) | — | — | yes | yes | PA BW: 96x96, 1f, 24c, d28bb19ce7f6f87b87fcbbc6f8d9a8d6ab0f685e | dc52964180274e13f4e5f8ed6d7491f4246945f6 | C: static |
| Mega Zeraora | — | — | yes | yes | PA BW: 96x96, 1f, 17c, 765b4f260a46a9d178b64fb64941f2852036e043 | 5eba24c53873cf9f2e2e0a94b7fc5808003aa63d | C: static |
| Mega Scovillain | — | — | yes | yes | PA BW: 96x96, 1f, 31c, f7222149bf4a98560b7195d6949dc2a7e0735e53 | 9e656e2e94383b92ea46c975bfe2684cb895cd92 | C: static |
| Mega Glimmora | — | — | yes | yes | PA BW: 96x96, 1f, 27c, d7aef736f9a572a33917afde4035593656c93f43 | 8a8842b875380dc2afe5daef24e43192ac238ba8 | C: static |
| Mega Tatsugiri (Curly) | — | — | yes | yes | PA BW: 96x96, 1f, 39c, ba2fa9b8cb5b93c26a67e6399999f1ca782d24c7 | b1b3c84eb55aa07ce981f6256d1095e74a725645 | C: static |
| Mega Tatsugiri (Droopy) | — | — | yes | yes | PA BW: 96x96, 1f, 41c, 06c518a7ce5ea180fe5f2fe01d8861ea5657a9fe | b91f939d88a7dea2cdc8267b124b1ef2c4a719c6 | C: static |
| Mega Tatsugiri (Stretchy) | — | — | yes | yes | PA BW: 96x96, 1f, 40c, 2731826b757fc750493eb404d314ae78dfeef712 | 768b3ad631fe6fd3c6f9cfa8ea71116c6434b4e7 | C: static |
| Mega Baxcalibur | — | — | yes | yes | PA BW: 96x96, 1f, 20c, 12f809dab4407a99cd81b3b493e7f677f0c60a5d | 2996db17f165b5871e93b844a044c7800548a95e | C: static |
