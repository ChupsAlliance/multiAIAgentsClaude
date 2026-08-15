You are fixing QA failures in an existing project in this directory: {{PROJECT_PATH}}
Project type: {{PROJECT_TYPE}}

**Do NOT re-plan or redesign the project. Your only job is to make the listed QA
failures below pass. The prior mission already built this project — you are not
starting over.**

## PREVIOUS WORK STATUS
{{SUMMARY}}

## QA FAILURES TO FIX
{{QA_FAILURES}}

## PRIOR AGENT ROSTER
{{PRIOR_ROSTER}}

## EXECUTION PROTOCOL (Agent Teams)

### Step 1: Team Setup
1. Create a team via TeamCreate with team_name="qa-fix"
2. Recreate the roster listed in PRIOR AGENT ROSTER above — do not add agents
   beyond what's needed to fix the listed failures. Do not invent new roles.
3. Spawn agents via Agent tool with team_name="qa-fix" and subagent_type="general-purpose"
4. mode: "bypassPermissions" for each agent
5. Spawn agents in parallel when possible

### Step 2: Agent Work Instructions
Each agent prompt MUST include:
1. cd into working directory: {{PROJECT_PATH}}
2. Focus ONLY on the QA FAILURES TO FIX listed above — do not touch unrelated code
3. Install dependencies if needed: {{PROJECT_TYPE}}
4. After making a fix, BUILD AND VERIFY: {{PROJECT_TYPE}}
5. If build fails, READ the error, FIX the code, re-run until passing
6. Re-run the specific failing check(s) described in QA FAILURES TO FIX, not just a build
7. Use SendMessage to notify Lead and teammates of progress
8. Print '[<name>] VERIFIED: <evidence>' with actual output showing the failure is fixed

### Step 3: Active Monitoring (CRITICAL)
After spawning, ACTIVELY monitor:
1. Read messages from teammates as they are auto-delivered
2. **When a teammate ASKS a question** (via SendMessage):
   - If you know the answer from project context, docs, or reference materials → reply directly
   - If the question requires a decision only the user can make → escalate to the user using the QUESTION PROTOCOL (if in interactive mode)
   - ALWAYS reply promptly — teammates are BLOCKED waiting for your answer
3. When a teammate reports BUILD_RESULT: PASS, mark them as **done** — even if they go silent after that, do NOT wait for further messages from them
4. If a teammate reports errors or is stuck, send them specific fix guidance via SendMessage
   - If no progress after 2 SendMessage exchanges → **reassign their remaining tasks to another active teammate**
   - **Do NOT shut down the mission** because one agent is stuck or unresponsive
5. If a teammate goes silent WITHOUT printing BUILD_RESULT:
   - Send one status-check message. If no response, assume stuck.
   - Reassign their incomplete tasks to another teammate and continue
6. Track completion — each teammate should report verification evidence tied to a specific listed failure

### Step 4: Final Verification & Shutdown
When all teammates have reported completion OR been reassigned/timed out:
1. Run final build verification yourself: {{PROJECT_TYPE}}
2. Re-verify every failure listed in QA FAILURES TO FIX is actually resolved
3. If verification fails, send the error to the responsible teammate to fix. If they are no longer active, spawn a new teammate for the same role and hand it the error — never fix it yourself
4. Only after PASSING: send shutdown_request to each teammate
   - **Do NOT wait for acknowledgement** — agents that completed their work may have gone idle, that is normal
   - Proceed to cleanup after sending shutdown_request regardless of response
5. Print final summary with evidence, mapped to each fixed failure

⚠ **CRITICAL — NEVER end the mission early:**
- One agent failing or going idle does NOT mean the mission fails
- Always reassign incomplete work and continue with other agents
- Only consider the mission done when every listed QA failure is verified fixed

## QUALITY GATES
- Every failure listed in QA FAILURES TO FIX is verified fixed, not just "build passes"
- All code must be COMPLETE (no TODO/placeholder/stub)
- Dependencies installed and importable
- Build/compile passes with 0 errors
- App is runnable

{{PERMISSION_MODE}}
{{QA_HEADED_MODE}}

Begin now.
