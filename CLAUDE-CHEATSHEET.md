# Templarc — Claude Code Quick Reference

## Python Environment Setup (do this once)

```bash
# Install uv if not present
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create local venv and install dependencies
uv venv .venv
source .venv/bin/activate      # macOS/Linux (.venv\Scripts\activate on Windows)
uv pip install -r requirements.txt
```

**Always use `uv` — never `pip` or `python -m venv` directly.**

Common commands with active venv:
```bash
uv run alembic upgrade head          # apply DB migrations
uv run alembic revision --autogenerate -m "description"   # generate migration
uv run pytest tests/ -v             # run tests
uvicorn api.main:app --reload       # start API
```

---

## Daily Workflow

### Starting a session
Always start a new session with:
```
Resume work on Templarc. Read CLAUDE.md first, then tell me where we left off in the phase prompts.
```

### Resuming after a break
```
I'm back. Read CLAUDE.md and the phase prompts in prompts/ to understand the project.
We were working on [Phase X, Step Y]. Current status: [describe where you stopped].
Continue from there.
```

---

## Phase Prompt Usage

Each phase prompt file in `prompts/` contains numbered steps. Work through them sequentially.

**How to use a step:**
1. Open the phase file
2. Copy the prompt block for the current step
3. Paste into Claude Code
4. Review output before moving to next step

**Critical rule:** Never start Step N+1 until you've tested Step N works.

---

## Invoking Subagents

### Before any DB/model change:
```
Use the schema-guardian subagent to review this proposed change: [describe change]
```

### After implementing a service:
```
Use the test-writer subagent to write tests for api/services/parameter_resolver.py
```

### After implementing a router:
```
Use the api-reviewer subagent to review api/routers/templates.py
```

---

## Useful One-Off Prompts

### When you hit a bug:
```
There's a bug in [file/function]. Here's the error: [paste error].
Read the file, understand the context from CLAUDE.md, then fix it. 
Explain what caused it before changing anything.
```

### When adding a new feature not in the phase prompts:
```
I want to add [feature description]. Before writing any code:
1. Read CLAUDE.md to understand the architecture
2. Identify which files will need to change
3. Identify any new DB changes needed (if so, invoke schema-guardian first)
4. Propose the approach
5. Wait for my approval before implementing
```

### When something feels wrong architecturally:
```
I'm concerned about [specific thing]. Read CLAUDE.md and the relevant code,
then tell me if this violates any of the core design rules and what the 
better approach would be.
```

### When a phase step is complete:
```
Phase [X] Step [Y] is done and tests pass. 
Update the completion checklist in prompts/phase[X]-*.md and tell me what's next.
Make sure all docs are updated, run the doc-write and project-docs reviewers.
```

---

## MCP Setup (do this before starting Phase 1)

```bash
# GitHub MCP — for PR creation and issue reading
claude mcp add github
# Enter your GitHub token when prompted

# PostgreSQL MCP — so Claude can inspect your actual schema
claude mcp add postgres
# Enter: postgresql://user:pass@localhost/templarc
```

Once configured, you can say:
- "Check the current DB schema and make sure the Alembic migration is correct"
- "Look at issue #12 and implement the fix"
- "Create a PR for the Phase 2 work with a proper description"

---

## Git Workflow

Work in feature branches per phase:
```bash
git checkout -b phase/1-foundation
# ... do Phase 1 work ...
git checkout -b phase/2-parameter-system
```

Ask Claude to commit at logical checkpoints:
```
The parameter scoping tests all pass. Commit this with a descriptive message.
```

---

## Troubleshooting

**"Claude keeps breaking existing code when adding new features"**
→ Always say: "Do not modify any existing working code unless necessary. Show me what you plan to change before changing it."

**"Claude's solution is too complex"**
→ Say: "This is over-engineered. What's the simplest implementation that satisfies the requirements in CLAUDE.md? Propose that instead."

**"I want to understand what was just built"**
→ Say: "Explain what you just implemented as if I'm onboarding a new developer. Use the concepts from CLAUDE.md."

**"Context is getting long and Claude seems confused"**
→ Start a new session and use the resume prompt at the top of this file.
