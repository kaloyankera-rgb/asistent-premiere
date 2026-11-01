# Asistent — Premiere Pro workflow assistant

Independent, zero-budget, local assistant for the user's daily short-form editing in Adobe Premiere Pro
(sync two POV cameras, lavalier audio, dialogue levels, auto import of downloads, colour: white balance
and exposure). Built 2026-11-01 from the user's spec (first message of the session) plus the colour
engine spec in `docs/color-spec/` (see `COLOR_CORRECTION_PLAN.md`).

Read first when continuing: `PROJECT_STATUS.md` → `TODO.md` → `BUGS.md`.
`DECISIONS.md` explains why things are the way they are. `PROGRESS.md` is the detailed chronological log
(search it, do not read it whole). Model routing and agents: `../DEV_WORKFLOW.md` in the Content Studio vault,
or the snapshot in `docs/dev-workflow/`. Map of all docs and new-machine setup: `docs/INDEX.md`.

## Architecture
- **UXP panel** `panel/` (manifest v5, id `com.contentstudio.asistent`, host `premierepro` ≥ 26.0.0,
  plain HTML/JS, no build). The only UI. Talks to Premiere through `require("premierepro")`.
  - `main.js` UI and flows · `engine.js` HTTP client · `premiere.js` timeline reading, SYNC sequence,
    shared helpers (`transaction`, `has`, `maybe`, `ensureBin`, `readTimeline`, `readItems`)
  - `premiere-audio.js` Fill L/R, split copy, Volume level/keyframes · `channels.js` effect-chain routing
  - `premiere-import.js` auto import · `premiere-color.js` Lumetri apply + render check
  - `devbridge.js` test bridge executor · `premiere-probe.js` Lumetri capability probe · `moments.js` where a clip can be measured on the timeline, cameras and Shot Match moments (pure) · `colorplans.js` what each apply button applies (pure) · `layout.js` SYNC layout · `version.js` written by packaging
- **Asistent host** `host/` (since 0.9.45): an invisible CEP extension (`CSXS/manifest.xml`, `main.js`, `host.jsx`) installed by
  `scripts/install_host_mac.sh` (called by `release_mac.sh`). It long-polls `GET /host/poll` and runs ExtendScript inside Premiere,
  now only `createCaptionTrack` for the subtitles (UXP cannot). A NEW extension needs one Premiere restart; `host.jsx` is read per
  command, so edits to it need none. Separate from Quick Search. Development: `scripts/dev_cmd.py host ping|probe|captions|eval`.
- **Python engine** `engine/asistent/` (stdlib HTTP server on `127.0.0.1:47390`, requests must carry
  header `X-Asistent: 1`; web origins and foreign Host headers are rejected). Started by `engine/run_engine.py`.
  - `server.py` endpoints · `jobs.py` background jobs (progress, cancel) · `config.py` paths, version, logging
  - `media.py` ffprobe/ffmpeg · `cache.py` decoded-audio cache · `sync.py` audio sync · `groups.py` many-clip groups
  - `audio.py` channel analysis, loudness, phrase leveling · `importer.py` folder watching and queue
  - `shotmatch.py` Auto Shot Match: anchors (skin from faces, neutrals, tones), Lumetri simulation, absolute fit, check
  - `asr.py` speech recognition (faster-whisper large-v3 from `<app>/models/whisper`, local only, never downloads by itself; optional `requirements-asr.txt`)
  - `subtitles.py` Phase 7 text core: captions from timed words (Bulgarian spelling `bgtext.py`, phrase grouping for 9:16, frame snap, no blink, SRT with BOM)
  - `subtitle_job.py` + `dialoguemix.py` the `/subtitles` job: cleanest microphone per speech, per-piece recognition (3 readings), `align.py`/`align_worker.py` optional MMS_FA alignment in `venv-align`, `consensus.py` + `lexicon.py` word votes with the Bulgarian dictionary, `corrections.py` the editor's `чуто => казано` lines (applied before the alignment), `subtitle_settings.py` per-project choices; `scripts/check_subtitles.py` checks a run against the audio
  - `hostbridge.py` + `captionstate.py` the channel to the Asistent host (below) and the memory of which caption track Asistent placed
  - `devbridge.py` test bridge: the panel runs commands from the engine (`scripts/dev_cmd.py`), only in TEST.prproj, off without the flag file `devbridge.enabled`
  - `faces.py` face detector (YuNet through OpenCV, model in `models/`); no OpenCV/model → no skin anchor
  - `managed.py` fingerprints of the Lumetri corrections Asistent wrote (ownership, `managed.json`)
  - `color.py` exposure/white-balance analysis, previews, render check, Lumetri calibration, probe measurement
  - `profiles.py`, `prepare.py`: Phase 5 draft, NOT wired, NOT tested
- Engine data (outside the synced vault): `~/Library/Application Support/Asistent/` (Windows
  `%LOCALAPPDATA%\Asistent\`): `venv/`, `logs/engine.log`, `cache/audio/`, `frames/`, `import.json`,
  `lumetri.json` (slider calibration, created on first verified render), `lumetri_capabilities.json` (probe),
  `managed.json` (Lumetri corrections Asistent wrote: may be updated by Asistent, never a manual grade),
  `color_audit.jsonl` (one record per clip and „Приложи“ press: measured, written, kept, reverted, status).
- Dependencies: Python 3.12 venv with `numpy==2.5.4`, `scipy==1.18.1`, `watchdog==7.0.0`, `opencv-python-headless==5.0.0.93` (`requirements.txt`),
  `pytest==9.2.0` (`requirements-dev.txt`); system FFmpeg/FFprobe (Homebrew on Mac); Node only for tests.

## Development rules
- Every change: bump the version in BOTH `panel/manifest.json` and `engine/asistent/config.py` → run tests →
  `scripts/release_mac.sh` (packs `.ccx`, removes + installs it with Adobe's UnifiedPluginInstallerAgent
  without a dialog, restarts the engine LaunchAgent) → git commit. The user asked not to double-click `.ccx`.
- Tests: `"$HOME/Library/Application Support/Asistent/venv/bin/python" -m pytest tests -q -W error -p no:cacheprovider`
  (211 tests; `test_real_footage.py` needs the GStroy footage on this Mac, skipped elsewhere) and
  `node --test tests/layout.test.js tests/channels.test.js tests/wiring.test.js tests/moments.test.js tests/colorplans.test.js` (50 tests);
  a new panel module must also be added to the zip list in `scripts/package_ccx.sh` (a test checks it).
- Premiere tests only in the user's test project `TEST.prproj`, never in client projects; never close or
  restart Premiere without asking. Client footage stays local; never look at client frames as images (measure them with numbers, delete any overlay you wrote).
- The Premiere 26.0.2 API differs from Adobe's published types (they start at 26.2): call methods through
  `maybe()`/`has()`, log what exists (`debug(...)` → engine log), never assume an index or unit.
- Diagnose from logs: `~/Library/Application Support/Asistent/logs/engine.log` (panel writes every step and
  the API method lists), `~/Library/Logs/Adobe/Adobe Premiere Pro 2026/UXPLogs_*`, crash dumps in
  `~/Library/Caches/Adobe/Premiere Pro/26.0/SentryIO-db/completed/` (symbolicate with `atos`).
- Code style: English code and comments; all user-facing panel text and messages in Bulgarian
  (natural Bulgarian, no long dash). Comments explain why, as in the existing modules.

## Bulgarian subtitles: read the guide first
`docs/BULGARIAN_TRANSCRIPTION_GUIDE.md` is the permanent reference for everything that touches the subtitle pipeline
(`subtitle_job.py`, `subtitles.py`, `lexicon.py`, `consensus.py`, `corrections.py`, `suspects.py`, `agreement.py`,
`align*.py`, `numbers.py`). Its rules, and where they live in the code:
- verbatim by default; edits go in a separate layer with a log (`verbatim` + `edits` in the result JSON);
- never rewrite a word on a hunch: only a dictionary-checked repair of a mis-heard word (`lexicon.repair`), the editor's
  own `чуто => казано` line (`corrections.py`), or a punctuation rule (`subtitles.tidy_words`); everything doubtful is
  marked and listed with a reason (`suspects.py`, `agreement.py`, the "unheard" check in `align.py`);
- grammatical gender: no global male/female setting (the user removed it: both speakers are in one edit); first-person
  forms are only CHECKED (readings that disagree are flagged), never converted;
- after any text change the affected words are re-aligned (corrections run before the aligner);
- the table in guide §10 is `tests/test_guide_regressions.py`; never fix an example by hard-coding its replacement.

## Permanent user rules (do not break)
- Independent of the user's own CEP extension Quick Search (`com.contentstudio.barzo`, ports 47231–47234):
  never import, call or modify it.
- One button press = one Undo step wherever Premiere allows; when it cannot, the panel says how many.
- Never remove track items through UXP (crashed Premiere 26.0.2, see `DECISIONS.md`); the host never removes anything either unless the user approves a specific deletion.
- Never mute, reroute or rearrange tracks on the user's behalf.
- Main microphone peak ≤ −6 dBFS; no compression or limiting by default.
- Nothing uncertain is applied automatically (sync, routing, colour); zero correction is a valid result.
- Colour: preview first; only Exposure/Temperature/Tint so far; never contrast/saturation/LUT unless the
  colour plan's modules are implemented and verified; never touch a manual Lumetri grade (a Lumetri counts as
  Asistent's own only when its full fingerprint matches one in `managed.json`).
- Sync works from the timeline selection and builds a new `SYNC – <sequence>`; the user's sequence is read only.
- No AI voices, no paid tools, no cloud, nothing uploaded.

## Version control and documentation (GitHub, private repo)
- The repo is `tools/asistent` (own git, branch `main`). Remote `origin` is a PRIVATE GitHub repository.
  History is never rewritten: no force-push, no `reset --hard`, no history rewriting, no deleting branches or tags.
  Rename files with `git mv`. Never commit secrets, models, `dist/`, logs or client footage (`.gitignore` covers them).
- Documents and what each is for: `CLAUDE.md` rules and architecture · `PROJECT_STATUS.md` what exists and what is
  verified in Premiere · `TODO.md` remaining tasks in priority order · `BUGS.md` open bugs and limits ·
  `CHANGELOG.md` one entry per released change · `PROGRESS.md` dated log (search, do not read whole) ·
  `DECISIONS.md` why. Map: `docs/INDEX.md`.
- **Definition of done for every task** (do all, in this order, without being asked): code → tests pass →
  version bump (manifest + config) → `scripts/release_mac.sh` → user verifies in `TEST.prproj` where Premiere is
  involved → update the docs: `CHANGELOG.md` (new entry), `PROJECT_STATUS.md` (replace outdated lines, mark verified
  or unverified), `TODO.md` (tick or remove the finished task, add new ones), `BUGS.md` (new/fixed bugs),
  `PROGRESS.md` (dated line), `DECISIONS.md` (only if a decision was made) → one descriptive commit
  (`Asistent X.Y.Z: what and why`; docs-only commits start with `Docs:`) → tell the user what is committed.
- Commit only completed and verified work, never half-finished code; do not commit failing tests.
  The pre-commit hook (`scripts/githooks`, enabled by `git config core.hooksPath scripts/githooks`) refuses a code
  commit that does not also stage `CHANGELOG.md` and `PROJECT_STATUS.md`.
- **Pushing needs the user's explicit approval each time** (`git push origin main`, plain push only). Ask after the
  commit: "committed X, push to GitHub?". Never push on your own, never create tags or releases without being asked.
- Before ending a session or when the user says "update the project state": make sure the state docs above are
  current and everything finished is committed, so a new session can continue from `PROJECT_STATUS.md` + `TODO.md`.
