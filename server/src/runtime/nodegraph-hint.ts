// spec 2026-10-24 D4: tell Claude that Claude Web draws ```nodegraph blocks. Behind the setting ui.nodegraphHint (default on).
export const NODEGRAPH_HINT_KEY = 'ui.nodegraphHint';

/**
 * The example in the hint (review D2: it must pass our own format — a fromRow is a row of the edge's `from` card).
 * web/src/ui/node-graph/hint-example.test.ts reads these lines from this file and runs them through normalizeNodeGraph:
 * keep it one quoted string per line, no single quotes inside.
 */
export const NODEGRAPH_EXAMPLE = [
  '{"title": "Access", "subtitle": "…", "badge": {"count": "error", "text": "{n} open paths", "okText": "No open paths"},',
  ' "nodes": [{"id": "anyone", "title": "Anyone", "subtitle": "Public internet"},',
  '  {"id": "link", "title": "Share link", "rows": [{"id": "read", "label": "read", "value": "Anyone", "options": [{"value": "Anyone", "marks": {"e2": "error"}}, {"value": "Admin", "marks": {"e2": "dashed"}}]}]},',
  '  {"id": "bucket", "title": "customers", "list": {"title": "…", "items": ["…", {"text": "…", "tags": ["…"]}]}}],',
  ' "edges": [{"id": "e1", "from": "anyone", "to": "link", "label": "public"}, {"id": "e2", "from": "link", "to": "bucket", "fromRow": "read", "label": "read", "style": "error"}]}',
].join('\n');

const HINT = [
  '# Interactive diagrams (Claude Web)',
  'The user reads your replies in Claude Web, which draws a fenced code block with the language `nodegraph` as an interactive node graph: cards in columns from left to right, curved edges, drag and zoom. Use one when cards and connections explain the answer better than prose — a flow or pipeline, dependencies, who can reach what (permissions, access paths), an architecture. Not for plain lists or tables. Mermaid `flowchart` blocks are drawn the same way.',
  'The block holds one JSON object (valid JSON, no comments):',
  '```nodegraph',
  NODEGRAPH_EXAMPLE,
  '```',
  '- Only nodes[].id / title and edges[].from / to are required. Edge style: normal (grey), strong (highlighted, glowing), error (red, glowing — a problem such as an open access path), dashed (inactive or broken).',
  '- A row with options becomes a dropdown; its value is the current pick (a value not among the options is added to them). Picking an option applies its marks (edge id → style). Give marked edges an id.',
  '- fromRow starts the edge at that row: it must be the id of a row of the edge\'s from card.',
  '- badge: {"count": <style>, "text": "… {n} …", "okText": "…"} counts edges in that style and updates when the user changes a dropdown; a plain string is shown as is.',
  '- Keep it under about 40 cards, with short unique ids. At most 30 rows a card, 30 options a row, 50 list items; text past 200 characters is cut.',
].join('\n');

export const nodegraphHintPrompt = (on: boolean): string => (on ? HINT : '');
