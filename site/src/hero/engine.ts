// The only door from the site into the product's café engine (web/src/features/cafe, server/src/characters/core).
// Never Cafe.tsx / state.ts: they bring zustand and the app's WebSocket.
export { createWorld, step, WORK_FRESH_MS, type World, type Actor, type Receipt, type StepOpts } from '@cafe/sim';
export { buildMap, type CafeMap, type Seat } from '@cafe/map';
export { sceneSize, onPage, fitView, hitTest, drawRoom, drawItems, darken, drawGlows, labels, type View, type Look, type ItemTag, type SceneSize } from '@cafe/render';
export { resolveCharacter, BUILTIN, type CharacterDef } from '@characters';
export type { BgSession, BgTask, BgAgent } from '@shared';
