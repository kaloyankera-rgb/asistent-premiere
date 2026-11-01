# Development workflow for the Premiere extensions (model routing)

Applies to Asistent (`tools/asistent`) and Quick Search (`tools/premiere-barzo`). Goal: spend Opus only where
it pays off, without trading away correctness. Correctness and keeping existing features always win over
saving tokens.

## Who does what
| Task | Who | Examples |
|---|---|---|
| Trivial | the main session directly; `quick-helper` (Haiku) only when the job is long and mechanical | one-line fix, a question about the code, version bump, find where X is |
| Simple | the main session (Sonnet) directly | small bug with a known cause, a label or layout change, one new option |
| Medium | the main session (Sonnet) plans and implements; `test-runner` afterwards if the tests are many | a new button with engine endpoint, a fix across 2-4 files |
| Complex | `architecture-planner` (Opus) plans → user approves → `feature-builder` (Sonnet) implements → `test-runner` (Sonnet) verifies | a new colour module, a new sync mode, a Windows port of a feature |
| Critical | Opus directly (switch the main session to Opus) or `architecture-planner` | crash in Premiere with unknown cause, a design decision that is hard to undo |

Never use Opus for simple edits, formatting, ordinary UI changes or repetitive work.

## Rules for the main session
- Do not delegate by reflex. A subagent starts cold and re-reads files; for small work answering directly is
  cheaper. Delegate when the work is large, clearly separable, or needs a different model.
- In this app agents start only when the user asks. When a task looks Complex or Critical, say so in one line
  and suggest the agent (or a model switch) instead of quietly doing it on the current model.
- Give a subagent what it needs in the prompt (files, the plan, findings) so it does not explore again.
  Ask for short reports.
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
