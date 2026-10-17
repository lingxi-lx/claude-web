/**
 * The gateway's subagent split route as the session runner reaches it (index.ts wires it to the one GatewayService):
 * the base URL and key a conversation's engine is given when its subagents run on another provider's model.
 */
type SplitHook = (main: string, sub: string, model: string) => { base: string; key: string } | null;
let hook: SplitHook | null = null;
export function setSplitHook(f: SplitHook | null) { hook = f; }
export function splitEndpoint(main: string, sub: string, model: string): { base: string; key: string } | null {
  return hook?.(main, sub, model) ?? null;
}
