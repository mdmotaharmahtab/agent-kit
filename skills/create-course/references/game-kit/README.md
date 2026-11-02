# Game kit (see the skill's `references/game-course.md`)

Start a game course by copying this folder into the new course's root.

- `index.html`: the world map (reads `assets/worlds.js`).
- `assets/game.js`: the engine (levels, side quests, bonus missions, challenges, mock terminal, exams, scorecard,
  cloud switch, per-world progress). Its API is documented at the top of the file. `assets/game.css`: the styles.
- `assets/worlds.js`: the game's id and the list of worlds. The browser saves the whole game's progress under
  `GAME_ID`, so give every game its own; without one, the game's folder is used.
- `worlds/example/`: a model world, two levels on how an MCP server knows who is calling and what they may see:
  `world.js`, the hub `index.html`, two level pages. Copy its page skeleton for every page.
- `authoring/WORLD_BRIEF.md`: the brief each world builder follows. `authoring/AUDIT_BRIEF.md`: the per-world audit
  ("can a game-only player understand the source?"). Edit cast, addresses and banned names for the new course.
- `authoring/tools/`: `autoplay.js` (plays one page to the end), `playworld.js` (plays a whole world in a served
  browser), `headless_play.js` (the same in Node with jsdom), `check_game.py` (static rules: pages
  exist, side-quest links resolve, banned names, no references to a normal course's modules or labs, and each
  stop's main-path word count, with a WARN above about 220 words).

Serve the game from its root, so pages can fetch `authoring/...`: `python3 -m http.server 8765 --directory <game root>`
(on Windows, `py -3` if `python3` is not found). Then run `check_game.py` the same way:
`python3 authoring/tools/check_game.py`.

`headless_play.js` needs jsdom, which the kit does not ship. Run `npm install jsdom` once, in a folder of your
choice outside the game. `NODE_PATH` must then name the `node_modules` folder that install created (the folder
that holds `jsdom/`), not the folder you installed in. From the game root:
`NODE_PATH=<your folder>/node_modules node authoring/tools/headless_play.js` (in PowerShell, first
`$env:NODE_PATH = "<your folder>\node_modules"`, then `node authoring/tools/headless_play.js`).
