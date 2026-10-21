// The process animations of the classic themes (dark / light / …), and what a character theme falls back to for a
// process it leaves out or gets wrong. Quiet on purpose: one row, the accent and the state colours only.
import type { ProcessAnim } from './frames.js';
import type { Process } from './process.js';

const f = (...rows: string[]) => rows.map((r) => [r]);
const DONE = { done: ['✓'], fail: ['✗'] };

export const DEFAULT_ANIMS: Record<Process, ProcessAnim> = {
  // the first word is on its way: a prompt typing its dots
  start: { fps: 4, loop: f('›   ', '›·  ', '›·· ', '›···'), color: { '›': 'accent' }, inline: { fps: 6, loop: ['·', '∙', '•', '∙'] } },
  // thinking: a thought rising, a question, then the idea
  think: { fps: 4, loop: f('.   ', '.o  ', '.oO ', '.oO?', '.oO?', ' oO!', '  O!', '    '), color: { '?': 'accent', '!': 'accent' }, inline: { fps: 5, loop: ['∘', '○', '◎', '○'] } },
  // a book, its page turning
  read: { fps: 6, loop: f('[|   ]', '[ /  ]', '[ —  ]', '[  \\ ]', '[   |]', '[    ]'), color: { '|': 'accent', '/': 'accent', '—': 'accent', '\\': 'accent' }, inline: { fps: 8, loop: ['⠁', '⠃', '⠇', '⠧', '⠷', '⠿'], ...DONE } },
  // a lens sweeping a line, one hit lit
  search: { fps: 7, loop: f('⌕·····', '·⌕····', '··⌕···', '···⌕··', '····⌕·', '·····⌕', '··*···'), color: { '⌕': 'accent', '*': 'yellow' }, inline: { fps: 6, loop: ['⠂', '⠄', '⠠', '⠐'], ...DONE } },
  // a pencil writing a line; at the end the line is ticked
  edit: { fps: 7, loop: f('✎     ', '─✎    ', '──✎   ', '───✎  ', '────✎ ', '─────✎'), done: f('─────✓'), fail: f('───✗  '), color: { '✎': 'accent', '✓': 'green', '✗': 'red' }, inline: { fps: 4, loop: ['✎', '✐'], ...DONE } },
  // a prompt typing its command
  cmd: { fps: 6, loop: f('$ ▌   ', '$ n▌  ', '$ np▌ ', '$ npm▌', '$ npm ', '$ npm▌'), color: { '$': 'accent', '▌': 'accent' }, inline: { fps: 3, loop: ['▌', ' '], ...DONE } },
  // three boxes ticked one by one
  test: { fps: 4, loop: f('[ ][ ][ ]', '[✓][ ][ ]', '[✓][✓][ ]', '[✓][✓][✓]'), done: f('[✓][✓][✓]'), fail: f('[✓][✗][ ]'), color: { '✓': 'green', '✗': 'red' }, inline: { fps: 10, loop: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], ...DONE } },
  // a history growing commit by commit
  git: { fps: 4, loop: f('o      ', 'o──o   ', 'o──o──o', 'o──o──●'), done: f('o──o──✓'), color: { '●': 'accent', '✓': 'green' }, inline: { fps: 4, loop: ['∘', '○', '●'], ...DONE } },
  // packages dropping into a row
  install: { fps: 6, loop: f('↓     ', '▪↓    ', '▪▪↓   ', '▪▪▪↓  ', '▪▪▪▪↓ ', '▪▪▪▪▪ '), color: { '↓': 'accent' }, inline: { fps: 8, loop: ['⡀', '⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿'], ...DONE } },
  // a signal going out
  web: { fps: 5, loop: f('(·)   ', '(·)   ', '(·))  ', '(·))) ', '(·))))'), color: { '·': 'accent' }, inline: { fps: 6, loop: ['◜', '◝', '◞', '◟'], ...DONE } },
  // one becoming several
  agent: { fps: 4, loop: f('  ●  ', '  ●● ', ' ● ● ', '●  ● ', '● ● ●', '● ● ●'), color: { '●': 'accent' }, inline: { fps: 3, loop: ['∴', '∵'], ...DONE } },
  // a list written line by line
  plan: { fps: 5, loop: f('▪      ', '▪ ─    ', '▪ ───  ', '▪ ─────', '✓ ─────'), color: { '▪': 'accent', '✓': 'green' }, inline: { fps: 4, loop: ['⠒', '⠶', '⠿'], ...DONE } },
  // a wheel turning
  tool: { fps: 8, loop: f('[-]', '[\\]', '[|]', '[/]'), color: { '-': 'accent', '\\': 'accent', '|': 'accent', '/': 'accent' }, inline: { fps: 6, loop: ['◐', '◓', '◑', '◒'], ...DONE } },
  // knocking on your door
  wait: { fps: 4, loop: f('▐    ', '▐ )  ', '▐ )) ', '▐ )))', '▐    ', '▐    '), color: { ')': 'yellow' }, inline: { fps: 2, loop: ['⧗', '⧖'] } },
  // pages pressed into one
  compact: { fps: 4, loop: f('▤▤▤▤▤', ' ▤▤▤▤', '  ▤▤▤', '   ▤▤', '    ■'), color: { '■': 'accent' }, inline: { fps: 5, loop: ['⣿', '⣶', '⣤', '⣀'] } },
  // a line drawn between two ends
  connect: { fps: 6, loop: f('●      ●', '●─     ●', '●──    ●', '●───   ●', '●────  ●', '●───── ●', '●──────●'), color: { '●': 'accent' }, inline: { fps: 4, loop: ['◌', '○', '◎', '●'] } },
};
