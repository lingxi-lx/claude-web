// One interface for the forges the PR bar talks to (spec E2): GitHub (github-forge.ts) and GitLab (gitlab-forge.ts).
import type { BranchPr, PrCommentRef } from '../protocol.js';
import type { CommentCandidate } from './comments.js';

export interface Target { provider: 'github' | 'gitlab'; host: string; owner: string; repo: string }

/** The transport the service owns (token lookup, fetch or `glab api`): forges only say what to call. */
export interface ForgeApi {
  rest<T = any>(t: Target, path: string, init?: { method?: string; body?: unknown; text?: boolean }): Promise<T>;
  graphql<T = any>(t: Target, query: string, variables: Record<string, unknown>): Promise<T>;
}

export interface Forge {
  readonly kind: 'github' | 'gitlab';
  prForBranch(t: Target, branch: string): Promise<{ pr?: BranchPr; why?: string }>;
  setAutoMerge(t: Target, prId: string, on: boolean): Promise<void>;
  failureLog(t: Target, jobId: number): Promise<string>;
  comments(t: Target, number: number): Promise<CommentCandidate[]>;
  authorTrusted(t: Target, authorKey: string): Promise<boolean>;
  reply(t: Target, number: number, c: PrCommentRef, body: string): Promise<void>;
  resolve(t: Target, number: number, c: PrCommentRef): Promise<void>;
}
