import type { StepDefinition } from "../workflow-engine.js";

export const planStep: StepDefinition = {
  name: "plan",
  allowedTools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  buildPrompt: (task, repo) => {
    let prompt = `You are in PLAN MODE. Analyze the following task and create a detailed implementation plan.
Do NOT make any file changes. Only explore and read the codebase.

## Task
${task.prompt}

## Instructions
1. Explore the codebase to understand the current structure and patterns
2. Identify all files that need to be modified or created
3. Design a step-by-step implementation approach
4. Consider edge cases and potential risks
5. Estimate the scope: small (1-3 files), medium (4-8 files), or large (9+ files)

## Output Format
Provide a structured plan with:
- **Summary**: One paragraph describing the approach
- **Files to modify**: List each file with what changes are needed
- **Files to create**: List any new files needed
- **Risks**: Potential issues or breaking changes
- **Testing strategy**: How to verify the changes work`;

    if (task.notes) {
      prompt += `\n\n## Developer Notes\nThe developer has provided these additional notes:\n${task.notes}`;
    }

    return prompt;
  },
  systemPrompt: (repo) => {
    let sys = "You are planning only. Do NOT edit, write, or create any files. Only use read-only tools to explore the codebase.";
    if (repo.systemPrompt) {
      sys = `${repo.systemPrompt}\n\n${sys}`;
    }
    return sys;
  },
};
