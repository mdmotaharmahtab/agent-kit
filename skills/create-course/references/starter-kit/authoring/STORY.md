# Story bible: <course title>

The course tells one continuous story so every module's teaching lands on the same system. Every module gets an
episode box before its opening scenario and a wrap-up after `#resolution`; `story.html` collects the episodes with
the evolving architecture figure. Fill in every `<angle>` field; the example rows show the level of detail.

All names are made up. Never use real client, employer or colleague names.

## Cast

A small cast with plain roles, each introduced in one clause at first use:

- **<The learner's stand-in>**: <role>, starting where the learner starts.
- **<The organisation that builds the system>** and **<the organisation that uses it>**.
- **<The system>**: what it is at the start and how it grows across the course.
- **<Two or three others>**: the colleague who ships fast, the reviewer who asks the right questions, the user with
  demanding needs.
- **<Optional, for security topics: an adversary persona>**, a composite, not a person, with one move per module.

Example: **Priya**, tech lead at **Helix**, a small software company; **Atlas**, the shipment-tracking data product
Helix builds for **Northwind Freight**, a logistics company; **Tomasz**, Helix's backend engineer, who ships fast;
**Marcus**, Northwind's security lead; **Vex**, the adversary persona.

## The thread by module

| Module | Where the system is | What breaks or is demanded | What changes by the end |
|---|---|---|---|
| <NN> | <the system at the start of this module> | <the problem this module's teaching solves, in plain words> | <the fix, and what the next module inherits> |

Example rows:

| Module | Where the system is | What breaks or is demanded | What changes by the end |
|---|---|---|---|
| 00 | A demo: a web front end and an API on one machine, a home-made login | Marcus asks Priya to walk one request through "who are you, prove it, what may you do"; she cannot | The team adopts the vocabulary and a map of one request |
| 01 | The same demo | A review finds passwords stored with a fast hash and tokens that never expire | A slow, salted password hash; short-lived tokens; sessions that can be ended on the server |
| 02 | Pilot users at Northwind Freight | Northwind wants its staff to use their work sign-in | Sign-in through Northwind's identity provider, and an API that checks every token |

## The evolving architecture figure

One SVG per episode, the same layout every time: new parts added, the newly fixed parts highlighted, the current
problem marked. <Name the zones: for example, the user's organisation, the system, identity.>

## Tone and constraints

- Episodes are short and concrete: 150 to 250 words for the episode box, 100 to 180 for the wrap-up. One or two
  lines of dialogue at most.
- Episodes agree with the module's teaching and with earlier episodes; where a module and this bible disagree,
  follow the module and keep the names. Numbers stay consistent across modules.
- No term in an episode before its module teaches it.
