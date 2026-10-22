// The character-theme tools of the `web` MCP server (spec 2026-10-22 §5): names and schemas only — web/mcp.ts lists
// them, themes/tools.ts answers them. No imports: the MCP process loads this.

const files = {
  json: { type: 'object', description: 'theme.json as an object: { id, name: { zh, en }, mode, colors, chatDim, processes }. See theme_guide.' },
  backdrop: { type: 'string', description: 'backdrop.js source: `export default { init, frame, event, resize, theme, data }`. Runs in a sandboxed worker without network.' },
  css: { type: 'string', description: 'theme.css (optional): rules under html[data-ascii="<id>"], no external resources.' },
};

export const THEME_TOOLS = [
  {
    name: 'theme_guide',
    title: 'How to make a character theme',
    description: 'The ascii-theme skill: the theme format (colours and their contrast rules, the 16 process animations, the backdrop API, CSS hooks), the flow (draft → look at the trial run → refine → save → apply), and a complete built-in theme to start from. Read it before making a Claude Web character (ASCII-art) theme.',
    inputSchema: { type: 'object', properties: { example: { type: 'string', description: 'Which built-in theme to include as the example (default "phosphor"); theme_list names them.' } } },
    annotations: { title: 'How to make a character theme', readOnlyHint: true },
  },
  {
    name: 'theme_draft',
    title: 'Draft a character theme',
    description: 'Check a theme and keep it as a draft (the same id replaces the previous draft). Answers with every problem (format, missing processes, contrast, CSS that reaches outside, code that does not compile) and — when the app is open — a trial run: a picture of the backdrop after 3 seconds plus the 16 process animations, and how long its frames took. Look at the picture and fix what is off before saving.',
    inputSchema: { type: 'object', properties: files, required: ['json', 'backdrop'] },
    annotations: { title: 'Draft a character theme', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'theme_get',
    title: 'Read a character theme',
    description: 'The three files of a theme (a built-in one, a saved one or a draft), to change it: draft the edited copy under a new id (a built-in one) or the same id (one of the user\'s).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { title: 'Read a character theme', readOnlyHint: true },
  },
  {
    name: 'theme_save',
    title: 'Save a character theme',
    description: 'Turn a draft into a saved theme (by its id), once the user is happy with it. It then shows up in Settings → Appearance.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { title: 'Save a character theme', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'theme_apply',
    title: 'Use a character theme',
    description: 'Switch the app to a theme (a saved or built-in one, by id). Changes the user\'s appearance setting: they are asked.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { title: 'Use a character theme', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'theme_list',
    title: 'List character themes',
    description: 'Every character theme: built-in, saved and drafts, and which one is in use.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List character themes', readOnlyHint: true },
  },
  {
    name: 'theme_delete',
    title: 'Delete a character theme',
    description: 'Delete one of the user\'s themes (saved and draft) by id. Built-in themes cannot be deleted.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { title: 'Delete a character theme', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
] as const;

export const THEME_TOOL_NAMES: ReadonlySet<string> = new Set(THEME_TOOLS.map((t) => t.name));
