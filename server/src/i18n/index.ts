// The server's side of the interface language: its own English texts, registered on the shared core.
import { registerEnglish } from './core.js';
import { EN_SERVER } from './en.js';

registerEnglish(EN_SERVER);
export * from './core.js';
