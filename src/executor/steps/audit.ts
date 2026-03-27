import type { StepDefinition } from "../workflow-engine.js";

export const auditStep: StepDefinition = {
  name: "audit",
  allowedTools: ["Read", "Glob", "Grep"],
  resumeFromPrevious: true,
  buildPrompt: (task) => {
    let prompt = `Review the implementation plan from the previous step. Evaluate it for:

1. **Correctness**: Will this plan actually solve the task? Are there logical errors?
2. **Completeness**: Are any edge cases, error handling, or files missing?
3. **Safety**: Could these changes break existing functionality or introduce regressions?
4. **Code quality**: Does the approach follow the codebase's existing patterns and conventions?
5. **Best practices**: Are there simpler or more maintainable approaches?

If the plan has issues:
- List each issue clearly
- Provide specific corrections or alternatives
- Re-state the corrected plan

If the plan is solid:
- Confirm with "PLAN APPROVED"
- Note any minor suggestions that are optional`;

    if (task.notes) {
      prompt += `\n\n## Developer Feedback\nThe developer reviewed the plan and noted:\n${task.notes}\n\nIncorporate this feedback into your audit.`;
    }

    return prompt;
  },
  systemPrompt: (repo) => {
    let sys = "You are auditing a plan. Do NOT edit any files. Only read and analyze.";
    if (repo.systemPrompt) {
      sys = `${repo.systemPrompt}\n\n${sys}`;
    }
    return sys;
  },
};
