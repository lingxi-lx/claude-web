// The default model (and Claude family map) for a source added in one step — the same rules as the quick connect
// (web/src/features/providers/quick.ts quickPlan), on the server.
import type { ProviderType } from '../protocol.js';
import { claudeFamilyMap, pickChatModel } from '../models/catalog.js';

export function planModels(type: ProviderType, models: string[], hints: string[] = []): { defaultModel?: string; modelMap?: { haiku?: string; sonnet?: string; opus?: string } } {
  if (!models.length) return {};
  const hinted = hints.find((h) => models.includes(h));
  if (type !== 'anthropic') return { defaultModel: hinted ?? pickChatModel(models) ?? models[0] };
  const fam = claudeFamilyMap(models);
  const def = fam.sonnet ?? hinted ?? pickChatModel(models) ?? models[0];
  // an Anthropic-format endpoint serving other models: every family on the default (the CLI calls all three)
  const modelMap = Object.keys(fam).length ? fam : { haiku: def, sonnet: def, opus: def };
  return { defaultModel: def, modelMap };
}
