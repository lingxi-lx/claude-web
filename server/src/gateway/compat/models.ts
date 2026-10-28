// Model catalog shapes for the compatibility layer: one internal model list rendered as the OpenAI
// `/v1/models` object or the Gemini `/v1beta/models` object. Pure builders — the only ambient value
// is the optional default `created` timestamp when the caller does not pass one.

/** Capability hints a model may advertise (`/v1/models` 同 + 能力字段). */
export interface CompatModelCaps {
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  /** context window in tokens */
  contextWindow?: number;
  /** maximum output tokens */
  maxOutputTokens?: number;
}

/** One model the gateway exposes to compatible clients. */
export interface CompatModel {
  id: string;
  displayName?: string;
  /** epoch seconds — the OpenAI list's `created` */
  created?: number;
  ownedBy?: string;
  capabilities?: CompatModelCaps;
}

/** A plain model id or a descriptor; both work anywhere a model list is accepted. */
export type CompatModelInput = string | CompatModel;

const nonEmpty = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Trim ids, drop blank / duplicate entries, keep the first descriptor seen for an id. */
export function normalizeModels(models: readonly CompatModelInput[] | undefined): CompatModel[] {
  const seen = new Set<string>();
  const out: CompatModel[] = [];
  for (const item of models ?? []) {
    const model: CompatModel = typeof item === 'string' ? { id: item } : item;
    const id = nonEmpty(model?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...model, id });
  }
  return out;
}

/** Deterministic (UTF-16 code unit) order, independent of the machine's locale. */
const byId = (a: CompatModel, b: CompatModel): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sorted = (models: readonly CompatModelInput[] | undefined): CompatModel[] => normalizeModels(models).sort(byId);

/** Only the known capability keys, and only when at least one was set. */
function capsOf(m: CompatModel): CompatModelCaps | undefined {
  const c = m.capabilities;
  if (!c) return undefined;
  const out: CompatModelCaps = {};
  if (c.vision !== undefined) out.vision = c.vision;
  if (c.tools !== undefined) out.tools = c.tools;
  if (c.reasoning !== undefined) out.reasoning = c.reasoning;
  if (c.contextWindow !== undefined) out.contextWindow = c.contextWindow;
  if (c.maxOutputTokens !== undefined) out.maxOutputTokens = c.maxOutputTokens;
  return Object.keys(out).length ? out : undefined;
}

export interface OpenAIModelListOpts {
  /** `created` for models that do not carry one (epoch seconds); defaults to now */
  created?: number;
  /** `owned_by` for models that do not carry one */
  ownedBy?: string;
  /**
   * Also carry Anthropic's model-list fields (`type`, `display_name`, `created_at`, `has_more`,
   * `first_id`, `last_id`) — `GET /v1/models` is the same path for both SDKs, one body reads to both.
   */
  anthropic?: boolean;
}

/** `GET /v1/models` — OpenAI's `{ object: 'list', data: Model[] }` (plus capability fields). */
export function buildOpenAIModelList(models: readonly CompatModelInput[] | undefined, opts: OpenAIModelListOpts = {}) {
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const data = sorted(models).map((m) => {
    const caps = capsOf(m);
    const at = m.created ?? created;
    return {
      id: m.id,
      object: 'model' as const,
      ...(opts.anthropic ? { type: 'model' as const, display_name: m.displayName ?? m.id, created_at: new Date(at * 1000).toISOString() } : {}),
      created: at,
      owned_by: m.ownedBy ?? opts.ownedBy ?? 'claude-web-gateway',
      ...(caps ? { capabilities: caps } : {}),
    };
  });
  return {
    object: 'list' as const,
    data,
    ...(opts.anthropic ? { has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null } : {}),
  };
}

/** `GET /v1beta/models` — Gemini's `{ models: Model[] }`. */
export function buildGeminiModelList(models: readonly CompatModelInput[] | undefined) {
  return {
    models: sorted(models).map((m) => {
      const caps = capsOf(m);
      return {
        name: `models/${m.id}`,
        displayName: m.displayName ?? m.id,
        ...(caps?.contextWindow !== undefined ? { inputTokenLimit: caps.contextWindow } : {}),
        ...(caps?.maxOutputTokens !== undefined ? { outputTokenLimit: caps.maxOutputTokens } : {}),
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      };
    }),
  };
}
