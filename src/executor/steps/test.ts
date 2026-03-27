import type { StepDefinition } from "../workflow-engine.js";

export const testStep: StepDefinition = {
  name: "test",
  allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
  resumeFromPrevious: true,
  buildPrompt: (task) => {
    return `Run the project's test suite and verify that your changes work correctly.

## Instructions
1. First, check if a test suite exists (look for test scripts in package.json, pytest, jest, etc.)
2. Run the full test suite
3. If tests fail DUE TO YOUR CHANGES, fix them
4. Do NOT modify test expectations to make them pass unless the old expectations were wrong
5. If no test suite exists, manually verify your changes by reviewing the modified files
6. Report the test results

## Task context
${task.prompt}`;
  },
  systemPrompt: (repo) => {
    let sys = "You are running tests and fixing any failures caused by your changes.";
    if (repo.systemPrompt) {
      sys = `${repo.systemPrompt}\n\n${sys}`;
    }
    return sys;
  },
};
