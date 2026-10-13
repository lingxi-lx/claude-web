---
name: cafe-character
description: Make a pixel-art character for Claude Web's 网吧 (the internet-cafe view of background sub-agents) from a photo or a description — a 24 × 24 front and back picture in a small palette — preview it, refine it with the user, save it and give it to someone (the admin, a sub-agent type, a name). Use when the user asks to make, draw, design or customise a character, avatar, pet or 角色 / 小人 for the cafe or for the sub-agents.
---

# Making a 网吧 character

The cafe (Claude Web's 后台 page) shows every sub-agent as a guest walking around a pixel internet cafe; the main
conversation is the admin (网管) at the front desk. Everyone is the built-in octopus unless the user gives them a
character of their own. You make one with the `character_*` tools of the `web` MCP server.

## The format

```json
{
  "v": 1,
  "id": "cat-mimi",
  "name": "咪咪",
  "palette": { "k": "#2a1a12", "o": "#e8a33c", "w": "#ffffff", "p": "#1b1b1b" },
  "front": ["24 strings of 24 characters: a palette letter, or . for transparent"],
  "back":  ["the same, seen from behind (no face)"],
  "rig": { "legs": 18, "eyes": [[8, 10], [9, 10], [15, 10], [16, 10]], "hands": [[4, 15], [19, 15]] }
}
```

- `id`: lowercase letters, digits and `-`, at most 40. `name`: what shows over its head, at most 16 characters (the
  user's language).
- `palette`: 1–16 colours, each key one character (not `.`), each value `#rrggbb`.
- `front` faces the viewer, `back` is seen from behind. Exactly 24 rows of exactly 24 characters each. The cafe mirrors
  them for the other two directions, so draw the front facing slightly to the viewer's right or straight on.
- `rig.legs`: the first row (0-based, 12–23) of the legs or the lower body. Walking lifts the left and right halves of
  the rows from here down in turn; sitting hides them behind the chair. Put everything that should stay visible while
  seated (head, body, arms) above it.
- `rig.eyes`: every pixel of the eyes on the front (up to 32). A blink paints them in the most-used colour.
- `rig.hands`: 1–2 points where the hands are when seated; typing, gaming and the noodle bowl are drawn there.

## Drawing rules

- Think small and bold: a head about half the height, a small body, short legs. At 24 × 24 every pixel is a feature.
- Outline the whole silhouette with one dark colour (not pure black: a very dark version of the main colour).
- 4–8 colours look best: an outline, a main colour, a shade (lower / right side), a highlight (upper-left), eye white,
  pupil, and one or two accent colours for what makes the character recognisable.
- Eyes are at least 2 × 2 pixels with a pupil, so the face reads at the cafe's size. Keep a pixel of space at the
  edges.
- The back has the same silhouette and colours, no face; show the hair / back of the head / tail.
- Count every row: 24 characters, no more, no less. Write the rows, then check their lengths before you call a tool.

## From a photo or a description

Look for what makes the subject recognisable and keep only that: hair style and colour, glasses, a hat, the colour of
the clothes, a beard, a pet's fur pattern and ear shape, one signature object. Turn a person into a chibi (big head,
tiny body). Do not try to reproduce a face in detail — the likeness comes from the colours and the one or two
features you keep. Never write anything about the photo into the character other than the drawing and the name.

## The flow

1. Call `character_guide` if you need this text again. Draw the character.
2. `character_draft` with the whole JSON. If it answers with errors, fix exactly those (usually a row length) and draft
   again. When it is accepted you get a picture: front, back, four walking frames, typing, eating. Look at it
   critically against the photo / description and improve it at least once on your own if something is off.
3. Tell the user the draft is in the cafe's 角色库 (where they can watch it move) and ask what to change. Iterate with
   `character_draft` (same id) until they are happy.
4. `character_save` with the id.
5. Ask who should get it, then `character_assign` with a target: `admin` (the 网管), `default` (every guest without
   one of their own), `type:<sub-agent type>` (for example `type:Explore`), or `name:<agent name>` (a workflow agent's
   name, for example `name:researcher`). The user is asked to confirm. `character_list` shows what exists and who
   has what.
