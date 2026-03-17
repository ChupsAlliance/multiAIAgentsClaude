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
2. If a teammate reports errors or is stuck, send them guidance via SendMessage
3. If a teammate fails, reassign tasks to another teammate
4. Track completion — each teammate should report verification evidence

### Step 4: Final Verification & Shutdown
When all teammates report completion:
1. Run final build verification yourself: {{PROJECT_TYPE}}
2. If verification fails, send the error to the responsible teammate to fix
3. Only after PASSING: send shutdown_request to each teammate
4. Print final summary with evidence

## QUALITY GATES
- All code must be COMPLETE (no TODO/placeholder/stub)
- Dependencies installed and importable
- Build/compile passes with 0 errors
- App is runnable

Begin now.
