// The phone shell's side of the interface language (relative imports only: its own build has no aliases).
import { registerEnglish } from '../../../server/src/i18n/core';
import { EN_SHELL } from './en';

registerEnglish(EN_SHELL);
export * from '../../../server/src/i18n/core';
