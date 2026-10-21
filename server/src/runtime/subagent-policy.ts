// 子代理硬绑定 (2026-10-19 user request): a subagent model picked for a conversation means the user wants its work
// done by subagents — without having to say 「用子代理」 in every prompt. The main model was left to judge, and often
// did the work itself. Pure prompt text, a section of the system prompt; the model itself is bound by
// CLAUDE_CODE_SUBAGENT_MODEL (every subagent, whatever its definition or the tool call asks for).

/** The model's own name in a pick: `cw-x:<provider>:<model>` → `<model>`. */
export function subagentModelName(pick: string): string {
  return pick.replace(/^cw-x:[^:]*:/, '');
}

/** The system-prompt section for a picked subagent model ('' = none: same as the main model, or 只聊天). */
export function subagentPolicyPrompt(pick: string | undefined): string {
  const model = pick ? subagentModelName(pick) : '';
  if (!model) return '';
  return [
    '# Subagents',
    `The user has assigned a dedicated model to subagents (${model}) and wants the work done by them. This is a standing instruction that applies to every request, however small: the user does not need to ask for subagents in each message.`,
    '- Any work that needs tools — reading or searching files, exploring the codebase, research, running commands or tests, editing or writing code, reviews — goes to subagents through the Agent tool. Do not do it yourself in the main conversation, even when it looks quick.',
    '- This user instruction overrides the general guidance on when not to use the Agent tool (such as "to read a specific file path, use the Read tool instead"): in this conversation, those cases go to a subagent too.',
    '- Launch independent pieces in parallel (several Agent calls in one message); one subagent is fine for a small task.',
    '- Keep for yourself only: understanding the request, planning, decisions, combining the subagents\' results, managing the plan (TodoWrite), and talking to the user. Answer directly without a subagent only when no tool is needed at all.',
    '- Give each subagent a complete, self-contained brief: the goal, the relevant files and paths, constraints, and what to report back.',
    `- Do not pass a \`model\` to the Agent tool: every subagent runs on ${model} regardless.`,
  ].join('\n');
}
