// The showcase's clips by id (spec §5.1): the product's ten built-in character themes in its order
// (web/src/themes/builtin/index.ts ORDER), then "describe a new one", coloured by the theme it makes (the metro
// fixture, scripts/lib/fixtures/theme-metro). No JSON here: the browser side imports this.
export const THEME_IDS = ['phosphor', 'abyss', 'koi', 'moon', 'dither', 'orb', 'garden', 'paper', 'letters', 'ink'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DESCRIBE_ID = 'describe';
export const DESCRIBE_THEME = 'metro';
