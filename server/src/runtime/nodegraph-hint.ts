// spec 2026-10-24 D4: tell Claude that Claude Web draws ```nodegraph blocks. Behind the setting ui.nodegraphHint (default on).
export const NODEGRAPH_HINT_KEY = 'ui.nodegraphHint';

const HINT = [
  '# Interactive diagrams (Claude Web)',
  'The user reads your replies in Claude Web, which draws a fenced code block with the language `nodegraph` as an interactive node graph: cards in columns from left to right, curved edges, drag and zoom. Use one when cards and connections explain the answer better than prose — a flow or pipeline, dependencies, who can reach what (permissions, access paths), an architecture. Not for plain lists or tables. Mermaid `flowchart` blocks are drawn the same way.',
  'The block holds one JSON object (valid JSON, no comments):',
  '```nodegraph',
  '{"title": "…", "subtitle": "…", "badge": {"count": "error", "text": "{n} open paths", "okText": "No open paths"},',
  ' "nodes": [{"id": "link", "title": "Share link", "subtitle": "…", "rows": [{"id": "read", "label": "read", "value": "Anyone", "options": [{"value": "Anyone", "marks": {"e1": "error"}}, {"value": "Admin", "marks": {"e1": "dashed"}}]}], "list": {"title": "…", "items": ["…", {"text": "…", "tags": ["…"]}]}}],',
  ' "edges": [{"id": "e1", "from": "anyone", "to": "link", "fromRow": "read", "label": "public", "style": "error"}]}',
  '```',
  '- Only nodes[].id / title and edges[].from / to are required. Edge style: normal (grey), strong (highlighted, glowing), error (red, glowing — a problem such as an open access path), dashed (inactive or broken).',
  '- A row with options becomes a dropdown; picking an option applies its marks (edge id → style). Give marked edges an id. fromRow starts the edge at that row.',
  '- badge: {"count": <style>, "text": "… {n} …", "okText": "…"} counts edges in that style and updates when the user changes a dropdown; a plain string is shown as is.',
  '- Keep it under about 40 cards, with short unique ids.',
].join('\n');

export const nodegraphHintPrompt = (on: boolean): string => (on ? HINT : '');
