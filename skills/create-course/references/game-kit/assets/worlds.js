/* The game's id: this browser saves the game's progress under it, so give every game its own. */
window.GAME_ID = "example-game";

/* Every world in the game, in play order (sorted by n on the map). levels = main-quest level count.
   ready: false shows a world that is not built yet dimmed on the map, marked "(coming)". */
window.WORLDS = [
  { n: 1, id: "example", title: "Example world", levels: 2,
    d: "A model world to copy: two levels on how an MCP server knows who is calling and what they may see." }
];
