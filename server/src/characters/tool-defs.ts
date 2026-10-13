// The character tools of the `web` MCP server (spec docs/superpowers/specs/2026-10-13-cafe-design.md §4): their names
// and schemas only — web/mcp.ts lists them, characters/tools.ts answers them. No imports: the MCP process loads this.

const character = {
  type: 'object',
  description: 'The whole character: { v: 1, id, name, palette, front (24 strings of 24), back (24 strings of 24), rig: { legs, eyes, hands } }. See character_guide.',
};

export const CHARACTER_TOOLS = [
  {
    name: 'character_guide',
    title: 'How to draw a cafe character',
    description: 'The cafe-character skill: the character format, the pixel-art rules, how to work from a photo, and the flow (draft → show the user → refine → save → assign). Read it before drawing a character for Claude Web\'s 网吧.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'How to draw a cafe character', readOnlyHint: true },
  },
  {
    name: 'character_draft',
    title: 'Draft a cafe character',
    description: 'Check a character and keep it as a draft (the same id replaces the previous draft). Answers with what is wrong, or with a picture of it (front, back, walking, typing, eating) to compare against what the user asked for. The draft also shows up, moving, in the cafe\'s 角色库.',
    inputSchema: { type: 'object', properties: { character }, required: ['character'] },
    annotations: { title: 'Draft a cafe character', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'character_save',
    title: 'Save a cafe character',
    description: 'Turn a draft into a saved character (by its id), once the user is happy with it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { title: 'Save a cafe character', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'character_assign',
    title: 'Give a cafe character to someone',
    description: 'Give a saved character to: "admin" (the 网管, the main conversation), "default" (every guest without one of their own), "type:<sub-agent type>" (e.g. "type:Explore") or "name:<agent name>" (e.g. "name:researcher"). id null takes it back. Changes the user\'s settings: they are asked.',
    inputSchema: { type: 'object', properties: { id: { type: ['string', 'null'] }, target: { type: 'string' } }, required: ['id', 'target'] },
    annotations: { title: 'Give a cafe character to someone', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'character_list',
    title: 'List cafe characters',
    description: 'Every character of the cafe (built-in, saved, draft) and who has which: the admin, the default, a type, a name.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List cafe characters', readOnlyHint: true },
  },
] as const;

export const CHARACTER_TOOL_NAMES: ReadonlySet<string> = new Set(CHARACTER_TOOLS.map((t) => t.name));
