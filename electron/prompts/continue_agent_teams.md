You are continuing an existing mission in this project directory: {{PROJECT_PATH}}
Project type: {{PROJECT_TYPE}}

## PREVIOUS WORK STATUS
{{SUMMARY}}

## NEW INSTRUCTION FROM USER
{{MESSAGE}}

## EXECUTION PROTOCOL (Agent Teams)

### Step 1: Team Setup
1. Create a team via TeamCreate with team_name="mission-cont"
2. Analyze the user instruction and decide what agents are needed
3. Spawn agents via Agent tool with team_name="mission-cont" and subagent_type="general-purpose"
4. mode: "bypassPermissions" for each agent
5. Spawn agents in parallel when possible

### Step 2: Agent Work Instructions
Each agent prompt MUST include:
1. cd into working directory: {{PROJECT_PATH}}
2. Complete ALL tasks — write COMPLETE files, NO stubs or placeholders
3. Install dependencies: {{PROJECT_TYPE}}
4. After writing code, BUILD AND VERIFY: {{PROJECT_TYPE}}
5. If build fails, READ the error, FIX the code, re-run until passing
6. Use SendMessage to notify Lead and teammates of progress
7. Print '[<name>] VERIFIED: <evidence>' with actual build output

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
6. Track completion — each teammate should report verification evidence

### Step 4: Final Verification & Shutdown
When all teammates have reported completion OR been reassigned/timed out:
1. Run final build verification yourself: {{PROJECT_TYPE}}
2. If verification fails, send the error to the responsible teammate to fix (or fix it yourself if they are no longer active)
3. Only after PASSING: send shutdown_request to each teammate
   - **Do NOT wait for acknowledgement** — agents that completed their work may have gone idle, that is normal
   - Proceed to cleanup after sending shutdown_request regardless of response
4. Print final summary with evidence

⚠ **CRITICAL — NEVER end the mission early:**
- One agent failing or going idle does NOT mean the mission fails
- Always reassign incomplete work and continue with other agents
- Only consider the mission done when build verification PASSES

## QUALITY GATES
- All code must be COMPLETE (no TODO/placeholder/stub)
- Dependencies installed and importable
- Build/compile passes with 0 errors
- App is runnable

{{PERMISSION_MODE}}

Begin now.
