# Claude Code Mastery Guide
### Built for the COD Profitability System — Tunisia E-Commerce

*Synthesized from Anthropic official docs, 80+ practitioner sources, claudelog.com mechanics, and your specific project context.*

---

## THE ONE MENTAL MODEL THAT CHANGES EVERYTHING

Before any technique: Claude Code is not autocomplete. It is a **while-True loop with a context budget**.

```
while task_not_done:
    read_context()        ← 99.4% of all tokens consumed here
    pick_tool()
    execute()
    observe_result()
    decide_next_step()
```

Every decision you make — your CLAUDE.md, your prompts, your skills, your hooks — is **context budget management**. The bottleneck is never the output. It is always the re-reading loop. Once you internalize this, every technique in this guide becomes obvious rather than arbitrary.

**The four consequences of this model:**
1. A bloated CLAUDE.md doesn't just slow Claude down — it degrades ALL instructions equally
2. Every file Claude reads costs tokens on EVERY subsequent action in that session
3. Subagents exist because they get a fresh context — not because they're smarter
4. `/clear` between tasks isn't housekeeping — it's the single highest-leverage habit

---

## PART 1: THE CONTROL LAYER — CLAUDE.md

### What it is

A file Claude reads automatically at the start of every session. Think of it as the one-page onboarding doc you'd hand a brilliant contractor on their first day. It answers three questions:

- **WHY** — what this project does and why each part exists
- **WHAT** — tech stack, directory structure, key files
- **HOW** — commands, conventions, what Claude consistently gets wrong

### The 200-line hard limit

Research shows LLMs reliably follow ~150–200 instructions. Claude Code's system prompt already consumes ~50 slots. A 500-line CLAUDE.md doesn't give you more control — it gives you *uniform degradation* where Claude ignores everything slightly, including the rules you care most about.

**The test:** If Claude already follows a convention naturally, delete that instruction. Document failures, not successes.

### The WHY / WHAT / HOW framework

```markdown
# COD Profitability System

## WHY
Internal tool for tracking per-product profitability and investor settlements
for a Tunisian COD e-commerce business. Replaces manual spreadsheets.

## WHAT
- Next.js 14 App Router + TypeScript
- Supabase (database + auth)
- Deployed on Vercel
- French-language UI

## Stack layout
src/
  app/          → Next.js pages (App Router)
  components/   → Shared UI
  lib/
    calculations/  → ALL financial logic lives here only
    supabase/      → DB client
  types/         → Shared TypeScript types

## HOW
- `npm run dev` — local dev
- `npm run typecheck` — run after every file change
- `npm run lint` — before every commit

## Critical rules
- All cost variables read from DB settings table — never hardcode fees
- Revenue = totalPrice field only — never deliveryPrice or deliveryCost
- Navex costs begin at `deposit` status — not `uploaded`
- duplicated=true orders excluded from ALL calculations
- All UI text in French
- See docs/business-logic.md for full cost model
- See docs/data-model.md for schema details
```

### Progressive disclosure — the highest-leverage pattern

Never embed large docs in CLAUDE.md. Tell Claude *where to find* information:

```markdown
## References (load on demand — do NOT @-include)
- Full cost model: docs/business-logic.md
- DB schema: docs/data-model.md
- Order status pipeline: docs/order-pipeline.md
- Investor settlement logic: docs/investor-settlement.md
```

This saves thousands of tokens per session. Claude reads those files when the task actually needs them.

### DO vs DON'T patterns

| ❌ Problematic | ✅ Correct |
|---|---|
| `"Never use --foo flag"` | `"Never use --foo; use --bar instead"` |
| 500-line comprehensive manual | 150-line doc focused on what Claude gets wrong |
| `@docs/business-logic.md` (embeds on load) | `"See docs/business-logic.md"` (on-demand) |
| One root CLAUDE.md for everything | Hierarchical: root + subdirectory-specific |

### Hierarchical CLAUDE.md architecture

```
~/.claude/CLAUDE.md          ← Personal preferences, applies to ALL projects
./CLAUDE.md                  ← Project root, checked into git, team-shared
./src/lib/calculations/CLAUDE.md  ← Financial engine rules (loaded only when working there)
./src/components/CLAUDE.md   ← UI conventions (loaded only when working there)
```

Most specific (most nested) wins on conflicts. This means you can put strict financial rules only where Claude is touching financial code — not polluting every session.

### .claudeignore — the free 25% token saving

Create this at project root. Claude won't read these files, ever:

```
node_modules/
.next/
dist/
*.lock
.git/
supabase/.temp/
test-data/
*.log
coverage/
```

---

## PART 2: THE WORKFLOW — PLAN → ANNOTATE → IMPLEMENT → SIMPLIFY

This is the Anthropic-internal workflow. Every session should follow this loop.

### Phase 1: EXPLORE (cheapest, most valuable)

Before planning anything, Claude reads the relevant code. No modifications. Builds a mental model of the current state. This phase catches the most expensive failure mode: *implementations that work in isolation but break the surrounding system*.

```
Read src/lib/calculations/ and docs/business-logic.md. 
Understand the current calculation architecture. 
Do not write any code yet.
```

### Phase 2: PLAN (activate with Shift+Tab × 2)

Plan Mode is read-only. Claude cannot edit files, run bash, or call state-modifying MCP tools. It can only read, search, think, and produce a plan.

**What Plan Mode forces:**
- Consistently structured output (not a wall of prose)
- Claude resolves ambiguity before touching code
- You see exactly what it's going to do before it does it
- ~50% fewer tokens than normal mode

**Opus Plan Mode** (the premium version):
- `/model` → option 4
- Opus reasons over the full codebase (1M context)
- Asks clarifying questions upfront
- Produces editable `plan.md` file
- Executes with Sonnet (cost-efficient)

Save plans to version control: add `"plansDirectory": "./plans"` to `.claude/settings.json`.

### Phase 3: ANNOTATE (your irreplaceable contribution)

This is where **your domain expertise** matters. Claude is a brilliant generalist. You are the COD e-commerce expert. Before implementation starts, annotate the plan:

```markdown
<!-- YOUR INLINE ANNOTATIONS IN THE PLAN FILE -->

Step 2: Build cost calculation function
→ FIRAS NOTE: This must use configurable DB settings, not hardcoded values.
→ FIRAS NOTE: Exchange orders burden allocated to delivered orders, not exchange order itself.
→ FIRAS NOTE: to_be_returned treated identically to returned — same cost treatment.
→ REMOVE: Step 2c (variant-level COGS) — COGS set per product only.
```

Open the plan in your editor with `Ctrl+G`. This is the highest-leverage 5 minutes in any session.

**What to annotate:**
- Trim scope: "Remove X from the plan — not this session"
- Protect interfaces: "These function signatures must not change"
- Override choices: "Use Zod not Yup for validation"
- Add business rules Claude doesn't know: "Converty fee charged at creation on totalPrice, non-recoverable even on cancellation"

### Phase 4: IMPLEMENT

```
Implement the annotated plan. Run typecheck after each file change.
```

Nothing more needed. The plan is the context. Claude executes.

### Phase 5: SIMPLIFY (non-negotiable after every feature)

```
/simplify
```

Launches 3 parallel review agents on all changed files. Auto-fixes issues. Runs after EVERY feature, no exceptions. This is the difference between accumulating technical debt and not.

Narrow it when needed:
```
/simplify focus on TypeScript types and financial calculation correctness
```

### The full session loop

```
git commit                          ← safety checkpoint, always
    ↓
claude (fresh session)
    ↓
Plan Mode (Shift+Tab ×2)
"Read docs/X.md. Understand the current state. Plan [feature]."
    ↓
Ctrl+G → annotate plan
    ↓
Exit Plan Mode → "Implement the annotated plan"
    ↓
/simplify
    ↓
Manual test in browser
    ↓
git add . && git commit -m "feat: [feature name]"
    ↓
/clear                              ← fresh context for next feature
```

### The Research-Plan-Implement pipeline (Boris Tane method)

For complex features spanning multiple files, use this 5-step variant:

1. `"Read the codebase and produce research.md"` — Claude researches, writes findings
2. Review `research.md` — correct misunderstandings BEFORE planning (this is the point)
3. `"Write a detailed implementation plan to plan.md"` — Claude plans
4. Annotate `plan.md` with your domain knowledge
5. `"Implement it all"` — Claude executes with full documented context

**Why it matters:** The plan file survives context compaction. When Claude hits the context limit mid-feature, it can re-read `plan.md` and continue accurately. Without this, long sessions drift.

---

## PART 3: THE EXTENSION SYSTEM — 4 LAYERS

### Layer 1: CLAUDE.md
Always loaded. Universal rules. The foundation. Already covered above.

### Layer 2: Skills — repeatable workflows

Skills are markdown files in `.claude/skills/` that teach Claude specific procedures. They follow **progressive disclosure**: ~100 tokens of metadata always in context, full instructions loaded only when triggered.

```
.claude/skills/
├── cost-engine/
│   ├── SKILL.md
│   └── references/
│       └── cost-model.md
├── order-pipeline/
│   └── SKILL.md
├── converty-sync/
│   └── SKILL.md
└── investor-settlement/
    └── SKILL.md
```

**The critical truth about skills: they are probabilistic (~70% trigger rate), NOT deterministic.**

If something MUST happen every time → use a Hook, not a skill.

#### Writing skill descriptions that actually trigger

The description is the trigger. Claude decides to load a skill based on ~100 tokens of metadata. Vague description = never triggers.

```yaml
# ❌ NEVER TRIGGERS
---
name: cost-engine
description: Helps with cost calculations
---

# ✅ TRIGGERS RELIABLY
---
name: cost-engine
description: |
  Calculate product-level profitability, contribution margins, and cost 
  attribution for COD e-commerce orders. Use whenever the task involves: 
  profitability, margins, COGS, Navex fees, Converty fees, delivery costs, 
  return costs, exchange burden, packing costs, or financial calculations.
---
```

**Make descriptions "pushy"** — Claude undertriggers by default. List every trigger phrase explicitly.

#### Two types of skills

**Reference skills** (background knowledge — Claude applies automatically, no invocation needed):
```yaml
---
name: cost-engine
description: [trigger description above]
user-invocable: false
---
## Cost Model Rules
- Revenue = totalPrice ONLY
- Navex delivery fee: read from settings table (currently 6 TND)
[... full rules ...]
```

**Task skills** (explicit actions — user invokes with `/skill-name`):
```yaml
---
name: deploy
description: Deploy to production Vercel
context: fork
disable-model-invocation: true
---
1. Run typecheck
2. Run lint
3. Build
4. Push to Vercel
5. Verify deployment
```

#### Dynamic context injection in skills

Skills can inject live data at invocation time with `!command` syntax:

```markdown
---
name: order-pipeline
---
Current branch: !`git branch --show-current`
Last migration: !`ls supabase/migrations | tail -1`
Recent changes: !`git diff --stat HEAD~3`
```

Claude sees the result, not the command. Use this to give skills real-time project awareness.

#### Built-in skills (zero setup, use immediately)

| Skill | What it does | When |
|---|---|---|
| `/simplify` | 3 parallel agents review changed files, auto-fix | After EVERY feature |
| `/review` | Correctness check — bugs, logic, security | Before every commit |
| `/batch` | Decomposes work into parallel units | Cross-cutting changes |
| `/debug` | Reads session debug log | When output is unexpected |

### Layer 3: Hooks — deterministic guards

Hooks are shell scripts in `.claude/settings.json` that fire on specific events. **Unlike skills (70%), hooks execute 100% of the time, zero exceptions.**

The rule: CLAUDE.md says "never run rm -rf" → Claude follows ~70% of the time. A PreToolUse hook that blocks rm -rf → blocked 100% of the time. **For safety rules, deterministic beats probabilistic.**

#### Event types

| Event | When | Use for |
|---|---|---|
| `PreToolUse` | Before tool runs | Block dangerous commands |
| `PostToolUse` | After tool completes | Auto-format, type-check |
| `Stop` | Agent finishes response | Verify work, run tests |
| `SessionStart` | Session begins | Load context, check git status |

#### Exit codes

- `0` — success (output shown in verbose mode)
- `2` — **BLOCK** the action (stderr fed back to Claude as an error message)

#### Your three hooks

**Hook 1 — Dangerous command guard (PreToolUse):**
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "if echo \"$TOOL_INPUT\" | grep -qE 'rm -rf|DROP TABLE|git push --force|DELETE FROM.*WHERE'; then echo 'BLOCKED: Dangerous command requires manual confirmation' >&2; exit 2; fi"
      }]
    }]
  }
}
```

**Hook 2 — TypeScript checker (PostToolUse):**
```json
{
  "PostToolUse": [{
    "matcher": "Write",
    "hooks": [{
      "type": "command",
      "command": "cd /path/to/project && npx tsc --noEmit 2>&1 | head -20 || true"
    }]
  }]
}
```

**Hook 3 — Stop checklist (Stop):**
```json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "echo 'Session complete. Checklist: [ ] typecheck passed [ ] lint clean [ ] git committed [ ] manual tested'"
    }]
  }]
}
```

### Layer 4: Subagents — isolated specialists

Subagents are separate Claude instances with their own isolated context window, custom system prompt, and specific tool access.

**The most important architectural fact:**

> Subagents start with a FRESH context. They do NOT inherit your conversation history, files the main agent read, or skills triggered in the main session.

The ONLY inputs to a subagent:
1. The prompt string you send via the Task tool
2. CLAUDE.md files (re-read from scratch)
3. Skills that match (lower trigger reliability without conversation context)

#### The subagent context problem — and how to solve it

Skills trigger based on description matching the prompt. But subagents have no conversation context to help relevance matching. A skill described as "use when user mentions profitability" may never trigger in a subagent — because there's no "user", only a task prompt.

**Approach A — Embed domain rules directly in the agent file (recommended for financial rules):**
```markdown
---
name: business-logic-reviewer
description: Review financial calculations for COD business logic correctness.
tools: Read, Grep, Glob
model: sonnet
---
You are a financial logic auditor for a Tunisian COD e-commerce system.

## Rules You Must Verify Against
- Revenue = totalPrice field ONLY — never deliveryPrice or deliveryCost
- Navex pickup fee = 4 TND per DAY tracked as lump sum — NOT per order
- Navex delivery fee = 6 TND per delivered order
- Navex return fee = 4 TND per returned order
- Converty fee = 0.3% of totalPrice at order creation — non-recoverable
- Navex costs begin at `deposit` status — not `uploaded`
- duplicated=true → exclude from ALL calculations including Converty fee
- to_be_returned treated identically to returned
- exchange=true → extra delivery cycle, no additional revenue, burden on delivered orders
- isTest=true → exclude entirely
- All cost variables must be read from DB settings — never hardcoded
```

**Approach B — Tell subagent to read skill files (single source of truth, costs tokens):**
```markdown
---
name: business-logic-reviewer
tools: Read, Grep, Glob
model: sonnet
---
## Before reviewing any code:
1. Read .claude/skills/cost-engine/SKILL.md
2. Read docs/business-logic.md
Then review against those rules.
```

Use Approach A for your financial reviewer. The rules are short enough to embed and too critical to risk not loading.

#### Your three subagents

**1. business-logic-reviewer**
- Model: sonnet
- Tools: Read, Grep, Glob (read-only — cannot modify)
- Purpose: Verify financial calculations against COD business rules
- When: After implementing any calculation function, before committing

**2. perf-auditor**
- Model: haiku (cheap — mostly scanning)
- Tools: Read, Grep, Glob
- Purpose: Check for N+1 queries, missing indexes, unbounded loops
- When: After implementing data-heavy features

**3. french-reviewer**
- Model: haiku
- Tools: Read, Grep
- Purpose: Verify all UI-facing strings are in French, no English leakage
- When: After any UI work

#### When to use subagents

✅ Use when:
- Research that would consume 10K+ tokens in main context
- Code review (separate context = unbiased, no anchoring bias)
- Parallel investigation of unrelated codepaths
- Tasks needing restricted tool access (read-only auditor)

❌ Don't use when:
- The task needs conversation history (subagent won't have it)
- Simple one-file changes (overhead not worth it)
- Tasks that depend on what was just discussed

**Practical limit: 3–4 custom subagents max.** More and you spend cognitive overhead deciding which to invoke.

---

## PART 4: CONTEXT MANAGEMENT — THE EXPERT SKILL

This is what separates users from operators. Context management is not a setting. It is a discipline.

### The 7 rules

**Rule 1: One feature per session.**
`/clear` between unrelated tasks. Non-negotiable.

**Rule 2: Manual `/compact` at 50% context.**
Don't wait for autocompact. It triggers at ~83% and disrupts your workflow. Compact at 50% with instructions:
```
/compact focus on: current feature state, business rules established, file changes made so far. 
Discard: debugging tangents, exploratory discussions that didn't produce code.
```

**Rule 3: Delegate research to subagents.**
```
Use a subagent to investigate how the order sync handles duplicate detection.
```
The research happens in a fresh context window. Results returned as a summary. Your main context stays clean.

**Rule 4: Reset after ~20 iterations.**
Claude's effective reasoning degrades after ~20 exchanges in a session. Symptoms: repeating questions, forgetting established rules, regressing on conventions. Solution: commit work, `/clear`, brief context handoff note, continue.

**Rule 5: Use .claudeignore.**
Already covered. ~25% token savings. Free.

**Rule 6: Scope requests narrowly.**
```
# ❌ Wastes tokens with broad reads
"Look at the codebase and fix the calculation"

# ✅ Precise and efficient  
"Read src/lib/calculations/contribution-margin.ts and fix the exchange order burden allocation"
```

**Rule 7: Commit before every session.**
Your escape hatch. If Claude goes sideways, `git checkout` restores everything. Without this, you're flying without a parachute.

### Context loss recovery

When context degrades mid-feature (Claude starts repeating questions, forgetting rules, ignoring conventions):

```bash
git commit -am "WIP: [feature] progress checkpoint"
```
```
/clear
```
New session:
```
Continuing work on [feature]. Status:
- Completed: [list what's done + which files]
- Remaining: [list what's left]
- Critical rule reminder: [the 1-2 rules most relevant to remaining work]
Read src/[path]/ and continue from where we left off.
```

### Poison context awareness (claudelog pattern)

One of the most underestimated failure modes. Every action pairing in your context creates potential behavioral associations that persist for the session.

**Real example:** Tell Claude to update code, then immediately request deployment. Claude begins associating every future update with immediate deployment — even experimental changes.

**Common poison patterns:**
- **Context bleeding** — Task A's conventions bleeding into Task B
- **Implicit associations** — "update then deploy" becoming a permanent pairing
- **Temporal confusion** — earlier session instructions contaminating current task
- **Contradictory guidance** — "always test before deploy" + "emergency hotfix, skip tests" creating decision paralysis

**Prevention:**
- Explicit task boundaries: "We are now starting a new task unrelated to the previous one."
- `/clear` between task types (not just features — *types* of work)
- Use subdirectory CLAUDE.md files to scope rules to their domain
- When you detect poisoned behavior: `/clear` immediately, don't fight it

### Context inspection as a discipline

```
/context
```

Shows token breakdown: system prompt, tools, MCP tools, memory files, custom agents, messages.

**Strategic use:**
1. Run `/context` before a long session to see baseline overhead
2. Identify MCP servers consuming tokens but not needed for this task
3. Disable unused servers: `@server-name disable` or via `/mcp`
4. Run `/context` again to verify savings
5. Re-enable when needed

Each MCP server adds tokens. Supabase MCP when you're doing pure UI work = wasted context budget. Disable it.

**Pro move:** After generating context data, ask: *"Where is my context potentially inefficient?"* Claude will identify bottlenecks and suggest optimizations.

---

## PART 5: PROMPTING PATTERNS FOR FINANCIAL SYSTEMS

### The formula

```
[Files to read first] + [Specific deliverable] + [Key constraints] + [What NOT to do]
```

### Good prompts vs bad prompts

```
# ❌ BAD — vague, no constraints, no scope
"Build me the settings page"

# ✅ GOOD — files, deliverable, constraints, exclusions
"Read CLAUDE.md and docs/business-logic.md.
Build the settings page at (admin)/settings/page.tsx:
- Form fields: Navex delivery fee, return fee, pickup fee, Converty %, packing cost
- Read/write via api/settings/route.ts
- Zod validation on all fields
- All labels in French
- Settings saved to DB settings table, NOT .env
- Do not build the API route — that already exists at the path above"
```

```
# ❌ BAD — no scope, will go wide
"Fix the calculation"

# ✅ GOOD
"Read src/lib/calculations/contribution-margin.ts.
The exchange order burden is being allocated incorrectly — it's currently applied per order
but should be spread proportionally across delivered orders for the same product.
Fix this function only. Do not touch other calculation files."
```

### The verification rule for financial calculations

Every financial function must be verifiable with known numbers. After implementation:

```
Run this test case manually and show me the result:
- Product: toy set, 1 order delivered at 45 TND
- Navex delivery: 6 TND, return fee: 4 TND (not applicable — delivered)
- Packing: 2 TND
- COGS: 12 TND
- Converty fee: 45 × 0.003 = 0.135 TND
- No ad spend
Expected contribution margin: 45 - 12 - 6 - 2 - 0.135 = 24.865 TND
Verify your implementation produces this result.
```

Never trust financial output without a known-numbers verification. Non-negotiable for investor-facing data.

### Common mistake table

| Mistake | Fix |
|---|---|
| Kitchen sink session (mixing tasks) | `/clear` between tasks |
| Correcting same error 3+ times | `/clear` + rewrite the initial prompt |
| Bloated CLAUDE.md (500+ lines) | Prune to <200, move details to `docs/` |
| Starting without a plan | Plan Mode first, always |
| No git before session | Commit before every session |
| Skipping `/simplify` | Run it after EVERY feature |
| Trusting financial output blindly | Verify with known test numbers |
| Building everything in one session | One feature per session |
| Asking Claude to re-read the whole codebase | Scope to specific files/paths |

---

## PART 6: ADVANCED PATTERNS (claudelog mechanics)

### Rev the Engine — pushing Sonnet beyond base capability

For complex, high-stakes implementations, don't just run Plan Mode once. Run it multiple times.

```
Round 1: Plan Mode — "Plan the contribution margin calculation engine"
→ Review, find gaps
Round 2: Plan Mode — "Refine the plan. The previous plan missed: [list gaps]"
→ Review again
Round 3: Implement
```

This costs more tokens in planning but produces dramatically better implementations. Reserve for sessions like the calculation engine (Session 4) and investor settlement (Session 8).

**Combine with ultrathink** (prefix your prompt):
```
ultrathink. Plan the contribution margin calculation engine accounting for:
exchange order burden allocation, return cost attribution, and the Navex 
pickup fee as a daily lump sum not per-order.
```

### Split Role Subagents — multi-perspective analysis

When you need comprehensive review (e.g., before shipping the investor view), use parallel agents with different roles:

```
Use subagents to review the investor settlement calculation from the following perspectives:
1. Financial accuracy — does the waterfall match the settlement spec?
2. Security — any data accessible to investor that shouldn't be?
3. Edge cases — what happens with zero delivered orders? Negative periods?
4. French language — all investor-facing labels correct?
```

Four parallel reviews, consolidated results. Better than any single review pass.

### Skeleton Projects — the research-before-build pattern

When starting a new component type you haven't built before:

```
Use a subagent to find the best Next.js + Supabase pattern for [specific feature].
Evaluate options from:
- Official Supabase examples
- GitHub (search for production repos using this pattern)
- Criteria: TypeScript strict, App Router, RLS-aware
Produce a recommendation with pros/cons before I write any code.
```

This is especially useful for the Converty scraping layer (Session 6) — novel territory.

### Tight Feedback Loops — bash scripts for complex operations

For operations requiring many write/edit calls (e.g., updating 10 files with a new type annotation), a bash script outperforms sequential Claude edits:

```
Write a bash script that updates all [X] files with [Y change].
Test it on one file first, show me the result, then run on all files.
```

Single tool call instead of 10 sequential edits. Faster. Token-efficient. Recoverable.

### Task Lists as Instruction Mirrors

When you give Claude a complex task, **read the task list before Claude starts executing**. It reveals whether Claude understood your intent.

Task list diverges from your intent → stop, correct, restart. Task list mirrors your intent exactly → proceed confidently.

**Divergence signals to watch for:**
- Steps in wrong order
- Missing a step you explicitly mentioned
- Adding a step you didn't ask for
- Wrong granularity (one step split into 10, or 10 steps collapsed into 1)
- Misinterpreted action (you said "review" → Claude planned "commit")

This 30-second check saves entire sessions.

---

## PART 7: SUPABASE + MCP — INTEGRATION RULES

### Security rules (non-negotiable)

- **NEVER connect MCP to production data**
- Scope to specific project with `project_ref` parameter
- Use read-only mode when working with real data
- Review every tool call before execution in the terminal
- MCP is for development and schema work ONLY

### Token optimization with MCP

MCP results consume tokens proportional to response size. A 500-row SQL result ≈ 4,000 tokens consumed in your main context.

Rules:
- Always use LIMIT clauses in any MCP query Claude generates
- Filter data before it enters context
- For large dataset analysis: write Python/pandas code to run locally rather than pulling data through MCP

### Disabling MCP when not needed

When doing pure UI work, disable the Supabase MCP:
```
/mcp
→ disable supabase
```
Re-enable when you need schema work or query testing. Saves meaningful context tokens across a session.

---

## PART 8: MODEL SELECTION — TACTICAL NOT HABITUAL

Don't use Opus for everything. Anthropic internally uses Haiku for routine grunt work. Match model to task.

| Model | Cost | Best for in your project |
|---|---|---|
| **Sonnet 4.6** | $3/$15 per M | 80% of sessions — feature implementation, UI, API routes |
| **Opus 4.6** | $15/$75 per M | Architecture decisions, calculation engine design, investor logic |
| **Opus Plan Mode** | Hybrid | Complex sessions: plan with Opus, implement with Sonnet |
| **Haiku 4.5** | $1/$5 per M | Light subagents: french-reviewer, file scanning, simple searches |

**Tactical rule:** Start every session with Sonnet. Switch to Opus only when the plan is too complex or the reasoning is visibly insufficient. Use Haiku only in subagents you invoke frequently.

---

## PART 9: GIT DISCIPLINE — NON-NEGOTIABLE

```bash
# Before every session
git add . && git commit -m "checkpoint: pre-[session name]"

# After every working feature
git add . && git commit -m "feat: [feature name]"

# After every working fix
git add . && git commit -m "fix: [what was fixed]"

# If session goes sideways
git checkout .            # Discard all uncommitted changes
git checkout HEAD~1       # Go back one commit
```

**The rule:** If you haven't committed, you have no escape hatch. Claude can and will make multi-file changes that break things non-obviously. Your only recovery is git.

Branch strategy for your 11 sessions:
```bash
git checkout -b session-01-database-schema
# work
git checkout main && git merge session-01-database-schema
git checkout -b session-02-typescript-types
```

---

## PART 10: THE COMPLETE COMMAND REFERENCE

### Session commands
| Command | Purpose |
|---|---|
| `/context` | See token breakdown — run this strategically |
| `/cost` | Display token consumption and estimated cost |
| `/compact` | Compress conversation with custom focus instructions |
| `/clear` | Full context reset — use between tasks |
| `/model` | Switch models (sonnet/opus/opusplan) |
| `Shift+Tab ×2` | Enter/exit Plan Mode |
| `Ctrl+G` | Edit plan in external editor — YOUR annotation moment |
| `Ctrl+O` | Toggle verbose mode — see Claude's thinking |
| `Esc` | Stop Claude mid-action |
| `--continue` | Resume most recent session |

### Built-in skills
| Skill | Purpose |
|---|---|
| `/simplify` | 3 parallel agents, auto-fix — run after every feature |
| `/review` | Correctness check before commit |
| `/batch` | Codebase-wide parallel changes |
| `/debug` | Troubleshoot unexpected output |
| `/agents` | Create/list custom agents |
| `/skills` | List available skills |

### MCP commands
| Command | Purpose |
|---|---|
| `/mcp` | List and toggle MCP servers |
| `@server-name disable` | Disable specific MCP server |
| `@server-name enable` | Re-enable MCP server |

---

## PART 11: PRE-SESSION CHECKLIST

Use this before every Claude Code session:

```
□ git committed (clean working tree)
□ Know the ONE feature this session delivers
□ Know which files are in scope (narrow the blast radius)
□ relevant docs/ files updated if business logic changed
□ .claudeignore up to date
□ MCP servers: enable only what this session needs
□ Plan Mode: will use for architecture, skip for tiny fixes
□ Verification: have known test numbers ready for financial features
```

---

## PART 12: YOUR PROJECT-SPECIFIC RULES SUMMARY

These are the rules Claude must never get wrong. They live in CLAUDE.md and in the business-logic-reviewer subagent.

### Order pipeline rules
```
pending/abandoned  → Converty 0.3% fee charged at creation on totalPrice
attempt            → phone calls only, no physical movement
confirmed          → scheduled, Converty only, no Navex cost yet  
uploaded           → sent to Navex API, NOT physically picked up
                     zero Navex cost if cancelled here
deposit            → ★ COST BOUNDARY: Navex fees begin here (physical pickup)
in transit         → active delivery
delivered          → terminal: revenue realized
to_be_returned     → treat IDENTICALLY to returned (same cost model)
returned           → terminal: Navex return fee applies
rejected           → cancelled before deposit = zero Navex cost
```

### Calculation rules
```
Revenue            = totalPrice field ONLY
                     NEVER deliveryPrice or deliveryCost (manipulable marketing fields)
Navex delivery fee = configurable DB setting (currently 6 TND)
Navex return fee   = configurable DB setting (currently 4 TND)  
Navex pickup fee   = configurable DB setting (4 TND/day) — lump sum, NOT per order
Converty fee       = 0.3% × totalPrice at creation — non-recoverable
Packing cost       = configurable DB setting — flat per package
COGS               = set per product, NOT per variant
                     variant COGS = unit cost × quantity in variant
All costs          = ALWAYS read from DB settings table — NEVER hardcode
```

### Exclusion rules
```
duplicated=true    → exclude from ALL calculations + Converty fee
isTest=true        → exclude entirely
exchange=true      → extra delivery cycle, no additional revenue
                     cost burden allocated to delivered orders
```

### Two-layer profitability
```
Layer 1 — Contribution Margin (per product):
  Revenue − COGS − delivery fee − packing − Converty fee 
  − ad spend allocation − return cost burden 
  − failed lead cost burden − exchange cost burden

Layer 2 — Net Profit (business):
  Σ contribution margins − overhead − Navex pickup fees
```

### Architecture rules
```
All financial calculations  → server-side only in src/lib/calculations/
                              NEVER duplicate on client
Settlement snapshots        → immutable JSON — historical accuracy preserved
Soft deletes               → products, investors, batches use is_active: false
Settings                   → database table, NOT .env
UI language                → French everywhere
```

---

## APPENDIX: QUALITY SOURCES

| Resource | What it gives you |
|---|---|
| [claudelog.com](https://claudelog.com) | Advanced mechanics, CLAUDE.md vault, community patterns |
| [code.claude.com/docs](https://code.claude.com/docs) | Official reference |
| [github.com/anthropics/skills](https://github.com/anthropics/skills) | Official skill library (37.5K ⭐) |
| [github.com/hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | Community resources |
| [boristane.com/blog/how-i-use-claude-code](https://boristane.com/blog/how-i-use-claude-code/) | Research-Plan-Implement method |
