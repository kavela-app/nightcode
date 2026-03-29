import type { StepDefinition } from "../workflow-engine.js";

export const implementStep: StepDefinition = {
  name: "implement",
  allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  resumeFromPrevious: true,
  buildPrompt: (task, repo) => {
    let prompt = `Execute the implementation plan. Make all necessary code changes.

## Task
${task.prompt}

## Instructions
- Follow the plan from the previous steps exactly, unless you discover issues during implementation
- If you discover issues, note them but continue with the best approach
- Write clean, well-structured code that follows existing patterns
- Add comments only where the logic is non-obvious
- Do NOT add unnecessary error handling, abstractions, or over-engineering
- Keep changes minimal and focused on the task`;

    if (task.additionalRepos.length > 0) {
      prompt += `\n\n## Repositories\nThis task spans multiple repositories:\n- ${repo.name} (primary)\n${task.additionalRepos.map(r => `- ${r.name}`).join('\n')}\n\nAll repos are available. Consider cross-repo dependencies.`;
    }

    if (task.notes) {
      prompt += `\n\n## Developer Notes\nThe developer noted:\n${task.notes}\n\nIncorporate this feedback into your implementation.`;
    }

    return prompt;
  },
  systemPrompt: (repo) => {
    let sys = "You are implementing code changes. Be precise and follow existing code patterns.";
    if (repo.systemPrompt) {
      sys = `${repo.systemPrompt}\n\n${sys}`;
    }
    return sys;
  },
};
