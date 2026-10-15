# AGENTS.md

The project notes, architecture and the list of pitfalls are in [CLAUDE.md](CLAUDE.md) (written in Chinese). Read it through before changing anything.

The commands you will use most:

```
npm install
npm run typecheck      # server + web + desktop
npm test               # vitest (server + web)
npm run build:all
npm run e2e            # starts the server on a temporary HOME and runs the WebSocket end-to-end checks (no tokens spent)
```

Anything a user can read in the interface goes through `tr('中文 text')` (the Chinese text is the key; English is in the `en.ts` next to it) — `npm test` fails when an English text is missing.
