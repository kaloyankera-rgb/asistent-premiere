# Development workflow for the Premiere extensions (model routing)

Applies to Asistent (`tools/asistent`) and Quick Search (`tools/premiere-barzo`). Goal: spend the strongest
model (Fable) only where a wrong answer costs a day, without trading away correctness. Correctness and keeping
existing features always win over saving tokens. Rebuilt 2026-11-20 (the user: "important tasks to Fable").

## The team (`.claude/agents/`, linked into both extension folders)
| Agent | Model | Job | Edits? |
|---|---|---|---|
| main session | Opus | conductor: sizes the task, asks about agents for big ones, briefs them, commits, asks before push | yes |
| `architecture-planner` | Fable | plan for a big feature or a hard-to-undo decision | no |
| `crash-investigator` | Fable | crash or bug of unknown cause: logs, crash dumps, `atos`, repro in NEW TEST; cause + proof + fix | no |
| `rules-reviewer` | Fable | last gate before a commit: diff vs the permanent rules, public-repo safety, real bugs; PASS/BLOCK | no |
| `feature-builder` | Sonnet | implements an approved plan or a known-cause fix, runs tests | yes |
| `test-runner` | Sonnet | Asistent pytest in a scratch HOME, Node tests, ReShape guard + golden, packaging checks | no |
| `live-tester` | Sonnet | bridge tests (`dev_cmd.py`) in TEST/NEW TEST only; "works through the bridge", never "looks right" | no |
| `release-clerk` | Haiku | version bump + CHANGELOG/STATUS/TODO/BUGS/PROGRESS from the reports; suggests the commit message | docs only |
| `quick-helper` | Haiku | searches, renames, small mechanical edits | yes |

## Who does what
| Task | Who | Examples |
|---|---|---|
| Trivial | the main session directly | one-line fix, a question about the code, find where X is |
| Simple | the main session directly | small bug with a known cause, a label or layout change, one new option |
| Medium | the main session directly (agents only if the user names them) | a new button with engine endpoint, a fix across 2-4 files |
| Complex (ask first) | `architecture-planner` → user approves → `feature-builder` (parallel only on separate files) → `test-runner` + `live-tester` in parallel → `rules-reviewer` → `release-clerk` → main session commits, asks before push | a new colour module, a new sync mode, a Windows port of a feature |
| Crash / unknown cause (ask first) | `crash-investigator` → user sees the cause → `feature-builder` → the same checks as Complex | Premiere crash, a result that is wrong for no visible reason |
| Critical decision (ask first) | `architecture-planner`, or the main session on Fable (`/model fable`) | a design decision that is hard to undo |

Fable never for simple edits, formatting, ordinary UI changes, test runs or paperwork.

## Rules for the main session
- Do not delegate by reflex. A subagent starts cold and re-reads files; for small work answering directly is
  cheaper. Delegate when the work is large, clearly separable, or needs a different model.
- Agents start only when the user asks (the user's rule, 2026-11-20, in every client: VS Code, desktop app,
  terminal). For a Complex or Critical task (or a crash with unknown cause), ASK before starting the work:
  one question naming the agents you would use and why, e.g. "This is a big task: use the agents
  (planner -> builder -> tests -> review)?" On yes run the chain; on no do it in the main session.
  Trivial, Simple and Medium tasks: no question, no agents, unless the user names one.
- Give a subagent what it needs in the prompt (files, the plan, findings) so it does not explore again.
  Ask for short reports. An agent's report is a claim: check the diff or result before telling the user.
- The user's checkpoints stay with the user: approving a plan, one look in Premiere after any panel look
  change (the bridge cannot see what is painted), and a yes before every push or release.
- live-tester runs only when Premiere already has TEST/NEW TEST open; Premiere 2026 is also the user's editing
  app, so never open, switch or restart without the user's OK for that session.
- Parallel subagents only for independent pieces that touch different files.
- Do not paste big logs into context: `grep`/`tail` them. Do not read `PROGRESS.md` (both projects) whole;
  search it.

## Keeping state between sessions
Each project has a short entry point that a new session reads first:
- Asistent: `CLAUDE.md` → `PROJECT_STATUS.md` → `TODO.md` → `BUGS.md` (`DECISIONS.md` for why).
- Quick Search: `CLAUDE.md` → `PROJECT_STATE.md` (`PROGRESS.md` is the detailed dated log, search only).

After a milestone (a feature works, a bug is fixed, a release is built, or before `/clear`), update the
state file: version, what is done, what is pending, what is verified in Premiere and what is not, new
decisions. Keep it compact: replace outdated lines instead of appending history (history goes to `PROGRESS.md`).
The user can trigger this with "update the project state".

## Session commands (Claude Code)
- `/model` (or the model menu in the desktop app): pick the main session's model. `opusplan` = Opus in plan
  mode, Sonnet when executing.
- `/context`: what fills the context window right now.
- `/usage` (or `/cost`): usage and limits.
- `/compact`: summarise the conversation and keep going (after a long debugging stretch).
- `/clear`: start fresh (after the state file is updated and the work is committed).
- `/agents`: list and edit the subagents.
Never clear or compact on your own; only when the user says so.
