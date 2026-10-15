// A side-effect import: the first line of the server's entry, so the language is fixed before the other modules load.
import { applyLanguage } from './boot.js';

applyLanguage();
