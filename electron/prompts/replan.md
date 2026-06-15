You are the Lead agent. The manager has reviewed your plan and made changes. Your job is to do a MINIMAL, INCREMENTAL update to align the plan with the manager's edits.

## ORIGINAL PLAN
### Agents:
{{AGENTS}}

### Tasks:
{{TASKS}}

## MANAGER'S CHANGES
{{CHANGES}}

## INSTRUCTIONS

1. Review what the manager changed (added tasks, removed tasks, edited details, reassigned agents).
2. Produce an UPDATED plan that:
   - KEEPS all unchanged tasks EXACTLY as they were (same title, detail, agent, priority)
   - Incorporates the manager's additions/edits/deletions
   - If a new task was added without detail, infer appropriate detail (tech stack, libraries, files, acceptance criteria)
   - If tasks were reassigned to a different agent, respect that choice
   - If a new agent was added, assign appropriate unassigned tasks to them
   - Only restructure other tasks if the manager's changes create a dependency conflict or overlap

3. Output the updated plan in the EXACT same format:

=== MISSION PLAN ===
{
  "agents": [
    { "name": "<agent_name>", "role": "<role>", "model": "<sonnet|opus|haiku>", "reason": "<why>" }
  ],
  "tasks": [
    {
      "title": "<short task name>",
      "detail": "<DETAILED implementation spec>",
      "agent": "<agent_name>",
      "priority": "<high|medium|low>"
    }
  ],
  "coordination": ["<shared files or deps>"]
}
=== END PLAN ===

## CRITICAL RULES
- This is an INCREMENTAL update. Do NOT rewrite the entire plan from scratch.
- Do NOT remove tasks that the manager did not remove.
- Do NOT change task details that the manager did not change.
- Do NOT reassign tasks that the manager did not reassign.
- If the manager added a vague task (no detail), you MUST fill in the detail with specific tech/libs/files/criteria — never leave detail empty.
- Every task MUST have a non-empty "detail" field.
- STOP after outputting the plan. Do NOT spawn teammates.
