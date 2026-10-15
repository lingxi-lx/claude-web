import type { CharacterDef } from './types.js';
import { tr } from '../../i18n/index.js';

// The built-in characters (spec §2): the octopus every guest is by default (its colour is the agent's: the renderer
// swaps the body colours) and the admin — the octopus in a blue cap with a staff badge. Drawn by
// a script once (an ellipse body, six two-pixel tentacles, outlined), pasted here as data.

const PALETTE = {
  k: '#3a1d14', // outline
  o: '#d97757', // body
  h: '#f2a481', // highlight
  s: '#b95e43', // tentacles (shade)
  w: '#ffffff', // eye white
  p: '#1b1b1b', // pupil
  c: '#ef8f86', // cheeks
};

const EYES: [number, number][] = [[7,8],[8,8],[9,8],[15,8],[16,8],[17,8],[7,9],[8,9],[9,9],[15,9],[16,9],[17,9],[7,10],[8,10],[9,10],[15,10],[16,10],[17,10],[7,11],[8,11],[9,11],[15,11],[16,11],[17,11]];

export const OCTOPUS: CharacterDef = {
  v: 1,
  id: 'octopus',
  name: tr('小章鱼'),
  palette: PALETTE,
  front: [
    "........................",
    "........................",
    "..........kkkkk.........",
    ".......kkkhooookkk......",
    "......khhoooooooook.....",
    ".....khhoooooooooook....",
    "....koooooooooooooook...",
    "....koooooooooooooook...",
    "...kooowwwooooowwwoook..",
    "...kooowwwooooowwwoook..",
    "...kooowppooooowppoook..",
    "...kooowppooooowppoook..",
    "...kocooooooooooooocok..",
    "...koooooookkkoooooook..",
    "....koooooooooooooook...",
    "...ksssssssssssssssssk..",
    "...ksssssssssssssssssk..",
    "...ksskssssssssssskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "..kssksskssk.kssksskssk.",
    "...kk.kk.kk...kk.kk.kk..",
    "........................",
  ],
  back: [
    "........................",
    "........................",
    "..........kkkkk.........",
    ".......kkkhohhokkk......",
    "......khhoooooooook.....",
    ".....koooooooooooook....",
    "....koooooooooooooook...",
    "....koooooooooooooook...",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "....koooooooooooooook...",
    "...ksssssssssssssssssk..",
    "...ksssssssssssssssssk..",
    "...ksskssssssssssskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "..kssksskssk.kssksskssk.",
    "...kk.kk.kk...kk.kk.kk..",
    "........................",
  ],
  rig: { legs: 15, eyes: EYES, hands: [[4, 13], [19, 13]] },
  builtin: true,
};

export const ADMIN: CharacterDef = {
  v: 1,
  id: 'admin',
  name: tr('网管'),
  palette: { ...PALETTE, b: '#2b6cd6', d: '#1d4a99' },
  front: [
    "............b...........",
    "........bbbwwbbbb.......",
    ".......bbbbbbbbbbb......",
    "......bbbbbbbbbbbbb.....",
    "......ddddddddddddddddd.",
    ".....khhoooooooooook....",
    "....koooooooooooooook...",
    "....koooooooooooooook...",
    "...kooowwwooooowwwoook..",
    "...kooowwwooooowwwoook..",
    "...kooowppooooowppoook..",
    "...kooowppooooowppoook..",
    "...kocooooooooooooocok..",
    "...koooooookkkoooooook..",
    "....koooooooowwoooook...",
    "...ksssssssssbbssssssk..",
    "...ksssssssssssssssssk..",
    "...ksskssssssssssskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "..kssksskssk.kssksskssk.",
    "...kk.kk.kk...kk.kk.kk..",
    "........................",
  ],
  back: [
    "............b...........",
    "........bbbbbbbbb.......",
    ".......bbbbbbbbbbb......",
    "......bbbbbbbbbbbbb.....",
    "......ddddddddddddddddd.",
    ".....koooooooooooook....",
    "....koooooooooooooook...",
    "....koooooooooooooook...",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "...koooooooooooooooook..",
    "....koooooooossoooook...",
    "...ksssssssssssssssssk..",
    "...ksssssssssssssssssk..",
    "...ksskssssssssssskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "...ksskssksskssksskssk..",
    "..kssksskssk.kssksskssk.",
    "...kk.kk.kk...kk.kk.kk..",
    "........................",
  ],
  rig: { legs: 15, eyes: EYES, hands: [[4, 13], [19, 13]] },
  builtin: true,
};

export const BUILTIN: CharacterDef[] = [OCTOPUS, ADMIN];
export const BUILTIN_IDS = new Set(BUILTIN.map((c) => c.id));

/** The palette letters a guest's agent colour replaces (body, highlight, tentacles) — only on the octopus. */
export const TINTED = { o: 0, h: 0.28, s: -0.18 } as const;
