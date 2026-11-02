/* World: MCP auth. Levels, side quests, bonus missions and the scorecard for this world. */
window.WORLD = {
  id: "example",
  title: "Example world (MCP auth, Levels 0 and 1)",
  blurb: "Anika asks Claude a question only Atlas can answer. Each level is one real way for Atlas to know who is asking and what they may see, and each fixes the problem the level before it left.",
  levels: [
    { n: 0, file: "level-0.html", title: "Meet the map", d: "The cast, the request, where the proof goes, and Atlas's two questions." },
    { n: 1, file: "level-1.html", title: "The fixed key", d: "One secret string for all of Northwind. Five minutes to set up. Then the tests." }
  ],
  sides: [],
  bonus: [],
  score: {
    rows: [
      "Does Atlas know <b>which person</b> is calling?",
      "Can Anika and a colleague get <b>different</b> access?",
      "Does the audit log <b>name the person</b>?",
      "When someone <b>leaves Northwind</b>, is their access gone?",
      "If the credential is <b>copied</b>, how bad is it?",
      "Does it work for a <b>program with no person</b>, like a nightly job?",
      "How much <b>setup</b> does Northwind do?"
    ],
    cols: [
      { level: 1, head: "1. Fixed key", cells: [
        ["no", "No: only \"a Northwind key\""],
        ["no", "No: everyone behind the key gets the same access"],
        ["no", "No: it names the key; a name header is only a claim"],
        ["no", "No: the key keeps working until Helix rotates it"],
        ["no", "Bad: it works for anyone, for months"],
        ["yes", "Yes"],
        ["yes", "Minutes: paste one key"] ] }
    ]
  }
};
