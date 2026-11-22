# Decisions (and the reasons behind them)

## 2026-11-22: Fix audio does not balance the two speakers (0.10.143)
- The user turned off speaker balance "for now": Fix audio only splits L/L and R/R, levels each side on its own (-17 LUFS, peak
  under -6 dBFS, the pair together under the ceiling) and puts the Dynamics Limiter at -6 dB. Nothing else.
- Why: in real edits, lowering the louder side (or leaving a side judged as bleed unraised) made one person much quieter than the
  other. Supersedes "balance only lowers" of 2026-11-03 as a default; `audio.balance` stays in the code, unused by the panel.

## 2026-11-22: Folders tab (favourite folders), its own tab
- The user asked for folder shortcuts inside Premiere, like the free Portal extension they showed (drop folders, buttons that open
  them, names, colours, relative to the project). Built in Asistent as the Folders tab (the user's choice of placement over a
  Tools row or a strip on every tab). Own code and own name; nothing of Portal's is used.
- Edit mode instead of a right-click menu (Premiere's UXP gives a panel no context menu) and ↑ / ↓ instead of drag to reorder.
- Read only: opening a folder is the only action; office server folders are only opened.

## 2026-11-22: colour is learned from every editor; Saturation and Contrast allowed per client (the colour audit)
- After the colour audit (docs/CLIENT_COLOR/AUDIT_2026-11-22.md) the user decided: Auto color learns from the grades of **all**
  editors in the exported projects, not only the user's.
- Auto color **may set Saturation and Contrast per client**, learned from the editors (lifts the rule "only Exposure / Temperature /
  Tint" for single clips once it is built and measured; a hand-made Lumetri is still never touched, low confidence never applied).
  Not built yet: TODO COL.
- One **read-only** pass over the office raw files of the existing learning records is allowed, to add the measurements the old
  records lack (nothing written, renamed or moved on the server; results only on this computer).
- Why: Auto color's white balance disagrees with the editors about as often as it agrees, and its exposure-only result looks like
  "almost nothing" next to an editor's grade that also lifts saturation and shapes contrast.

## 2026-11-22: Move off faces places by a lane per Style and moves only on a collision (0.10.141)
- **Measured before building** (docs/SUBTITLE_PLACEMENT.md): editors keep a lane, move under a face (never above), off other
  text either way, and do not follow zooms. The old rule (ReShape's chin + 0.11 for everyone) landed where the lines already
  sat, which is why the user saw "almost nothing".
- **The user's choices:** the line moves only when a zoom (or anything) makes a face or text collide, not with every zoom;
  "like the editors" (about 90 % stay); all clients may be named in the docs; the measuring scripts are committed (no
  client data; the per-chunk data and frames stay in `<app>/dev/placement/`).
- **ReShape's placement gets the collision moves** (the user: "Give it the new collision moves"): its own base (chin + 0.11,
  above a low face, from the old 3 frames per shot) is unchanged and equals the old result when nothing collides; text and
  per-line face collisions now move its lines too. A two-row ReShape chunk would be centred half a line lower than the old
  rule; ReShape's style is one row, so it does not occur. ReShape's subtitle output is untouched (golden identical).
- **Hands and products are not avoided:** no avoidance was measurable and the detectors are unreliable for it.
- **A line with no free place is left where it was** and listed ("nothing uncertain applied").
- **16:9 keeps the old rule** until 16:9 videos are measured. Two replay targets were missed (centre error 0.037 against
  0.033; fewer moves than the editors); the user chose to build it anyway after seeing the numbers.

## 2026-11-22: subtitles Max words, Case, Line break; the transcript's times per sentence (0.10.138-0.10.140)
- **Max words is a hard cap** (the user asked for "maximum 3 words or 2 words"): never more, both lines counted. The one exception
  is a single counted unit (a number with what it counts), which is never split. ReShape is excluded (frozen); 16:9 goes through
  the delivery phrase cutter when capped, because its own grouping cannot keep a count.
- **Case:** ALL CAPS also capitalises the English line; today's client capital styles keep their English as it was. A client's
  names keep their own spelling in both cases (the user's GStroy rule of 2026-11-10).
- **Line break (the user's choices of 2026-11-21):** every subtitle over 3 words breaks (not only keyword lines); the colour is
  the client style's measured keyword colour, changeable per style in the panel (Auto: the Submagic orange #EF7A00). The colour
  goes into the .srt as `<font color>`, the only way a colour can reach a caption without the editor: no script can style a
  caption in Premiere 26 (docs/NATIVE_GRAPHICS.md). Whether Premiere keeps it is the user's test; if it shows the tag as text,
  the tag comes out.
- **Hormozi 6 look (the user, 2026-11-21):** an After Effects template with the Submagic look was proposed and then dropped by
  the user ("its fine"); nothing was built.
- **Protected files touched:** `subtitles.py`, `subtitle_job.py` (optional arguments whose defaults are the old calls; ReShape's
  style is returned as is). `scripts/reshape_golden.py check`: identical (SRT, English SRT, job JSON).
- **Transcript with times:** a time on every sentence, not on every paragraph (a tight voice-over has no pauses, so a paragraph
  could run 40 s under one time). Paragraphs also break after 4 sentences or 60 words.

## 2026-11-21: In & Out own presets, Phase 5 foundation (0.10.135)
- **The user approved the Phase 5 plan on 2026-11-21 ("approved", then "Go ahead").** Built: steps 1-4. Step 5, the editor page, is not built.
- **Points editor only.** No two-handle bezier mode.
- **Multi-piece properties are not editable in this phase:** Out Anticipate position, Pop Out scale, Swing Out rotation.
- **A saved preset keeps its base, curves and default length.** Not Edge, Turn, Strength, Blur or the start and end values: those are read from the base at load.
- **Apply with unsaved edits writes the edited curve,** labelled "(edited)" in the tile and the summary.
- **Own tiles sit right after None.**
- **Save as new / Rename / Delete, no overwrite.** Deleting a picked own preset falls back to its base.
- **The Keyframer's editor is left untouched.** It shares only the maths; `panel/curvegraph.js` is the new module, not yet used by the Keyframer.
- **A registry inside `inoutplan.js`** (`find(side, id)`) rather than a list passed through eight call sites, so the preview and Apply get own presets with no change of their own.

## 2026-11-21: no Claude credit in commits; history rewritten once
- **The user: "Remove him you have permission and stop adding him"** (Claude was listed as a contributor on GitHub because 197 of
  199 commit messages ended with a `Co-Authored-By: Claude ...` line). From now on no commit carries such a line.
- **The one approved rewrite of history:** the lines were removed from every commit message (`git filter-branch --msg-filter`,
  files, authors and dates unchanged), and `main`, `improvements/2026-11` and the release tags were force-pushed. Every commit
  hash changed; the hashes quoted in the documents were replaced by the new ones. A bundle of the repository as it was is kept
  on the development Mac in `~/Library/Application Support/Asistent/backup/asistent-before-rewrite-2026-11-21.bundle`.
  Any other clone must be cloned again. "History is never rewritten" stands for everything else.

## 2026-11-21: Cut silences after the audit (0.10.122)
- **The user: "use the agents to fix them"** after the audit's list; taken as the go for TODO SIL (the dead channel) as well.
  Not decided by the user and so not built: Calm as the default pacing, keeping unselected clips in the new sequence.
- **Words are read only when a rule uses them** (hesitation sounds, AI rough cut's takes). The 2026-11-15 rule "Manual dB is
  the level alone" still holds for what counts as silence, and the word guard is off there; but AI rough cut with Manual dB now
  reads the words and cuts repeated takes, because the result claimed "AI rough cut" while reading nothing.
- **Every new detection rule may only keep more or list more** (review of the first version): pooled statistics are a union
  with the clip's own labels; the one-way false-start check applies only to a take that is a prefix of the winner; the
  dead-channel rule flags what Silero half-hears and is off with one microphone. The one rule that cuts more is the false
  start whose full sentence only adds words, and the dead channel's hiss no longer counting as speech (TODO SIL, measured).
- **ReShape for Cut silences is decided by any path of the run**, and a doubtful name counts as ReShape (a wrong "no" sends a
  client's sound).
- **Protected files touched** (`subtitle_job.py`: cloud-only key and callbacks, a unique temp name; `host/host.jsx`: only the
  `as_cut_*` block): `reshape_golden.py check` identical.

## 2026-11-21: Cut silences may read its AI words through ElevenLabs too; the second cloud exception (0.10.121)
- **Decision (the user, 2026-11-21: "Do it", after asking whether ElevenLabs could make Cut silences faster and more precise):**
  Cut silences' AI-assisted words (hesitation sounds, repeated takes) are read by Scribe when the editor saved a key and left
  the switch on: the same switch and key as the subtitles, and the same rule for what leaves the computer (only the sound of
  the selected clips' dialogue mix, each transcript deleted at ElevenLabs after use).
- **ReShape stays local** here too (Claude's default, the user did not object): a project in a ReShape folder is never sent.
  Cut silences has no style to say so, so the project folder does (`roughcut_job.is_reshape`).
- **The words decide what, the level decides where:** no word timestamps from any recognizer are as exact as the 10 ms level,
  so Scribe changes which passages go, not where a cut sits. Automatic and Manual dB never use words and never send anything.
- **One reading for both features:** Cut silences stores and looks up Scribe's reading under the subtitles' key (empty prompt,
  `recognition.CLOUD`'s tag); the request is the same, so the words are the same.

## 2026-11-21: subtitles may be recognised by ElevenLabs; the first exception to "no cloud, no paid tools" (0.10.119)
The user's audit of 2026-11-20: Bulgarian words in the Auto style come out wrong on every client but ReShape, and the wait is
too long. ReShape is "perfect how it is" and out of every change.
- **Measured first** (docs/BENCHMARK.md): the subtitles the office's editors burned into 28 finished videos of five clients
  (made in Submagic, corrected by hand) are the reference, half for tuning, half held back. Shipped Auto leaves 650 of 4171
  reference words wrong or missing; nearly all are already wrong in Whisper's first reading (the layers after it broke 13 right
  words and fixed 13 of 2237). The best local profile reached 604. ElevenLabs Scribe v3 on the same sound: 365, in about a
  twentieth of the time. The ceiling is the model, not the settings.
- **Decision (the user, 2026-11-21: "Build it in asistent"):** every style but ReShape's is read by Scribe when the editor saved
  an ElevenLabs key and left the switch on (Settings > Subtitles). This is the one exception to the permanent rules "no cloud,
  nothing uploaded" and "no paid tools", made by the user after seeing the table and the price (free plan for trying; client
  work needs the Starter plan, about $6 a month for about 27 hours).
- **What leaves the computer:** only the sound of the windows being subtitled; never picture, file or project names, the names
  prompt or the corrections. Never for ReShape, the rough cut, Cut silences or anything else (Cut silences' AI words allowed since 0.10.121, above). ElevenLabs keeps uploads by
  default (no-retention is an enterprise feature), so each transcript is deleted there as soon as its words are back; whether
  that also removes their copy of the sound is not stated in their docs.
- **When it fails** (no internet, key refused, no time left): that window is read on this computer by the shipped profile and
  the result line says why. Nothing is stored as ElevenLabs' reading in that case.
- **The text layers after Scribe:** the dictionary repair is off (on Scribe's words it broke 6 and fixed 1; 147 / 232 with it,
  143 / 231 without); writing rules, the editor's corrections, learned fixes, alignment and line cutting run as before.
- **On this computer nothing changes yet** for the non-ReShape styles (`DEFAULT = STRICT`, the 0.10.118 behaviour). The local
  experiments (`NEXT`: full precision 285 / 326 against 315 / 335; a second reading that cannot win with fewer words) are kept
  in `recognition.py` but their held-back runs were stopped when the user chose ElevenLabs. What the audit got wrong: it blamed
  the repair and the swapped readings for most wrong words; measured, they were about even.
- **Rule change (approved with the plan of 2026-11-20):** for every style but ReShape's, "a speed change must give
  bit-identical results" becomes "the wrong words must not rise on the held-back videos". For ReShape bit-identical stays.
- **Protected ReShape files touched** (`asr.py`, `lexicon.py`, `subtitle_job.py`): every addition is an optional argument whose
  default is the old call; ReShape's profile has an empty cache tag, no cloud, no extra options and no new result keys. Pinned
  by `tests/test_recognition_profiles.py`, `tests/test_cloudasr.py` (a ReShape run never asks ElevenLabs) and
  `scripts/reshape_golden.py check` (identical).
- **The office share is only read** (the user's rule of 2026-11-20): the benchmark copies sound into a local store and refuses
  to write under `/Volumes/`.

## 2026-11-15: Auto import is on by default and watches the project's own folder (0.10.113)
The user asked for "auto export" to be on by itself and linked to the folder the project is saved in, "cause most of the time
it's the folder where I download the assets"; asked which row, the user chose Auto import (not Show exports, which left the
project's folder in 0.10.5 because sound effects downloaded there were shown as exports). So a project with no folder of its
own watches its .prproj's folder from the start; an editor's off is remembered per project; a folder the editor picked or
dropped still wins, and existing projects keep their folders. One folder still belongs to one project: the project open now
takes it over. What lives in a project folder and is not a download is skipped: Premiere's previews, auto-saves and caches,
Asistent's own Asistent_* folders, and the editor's exports (named by Premiere's preferences or an export event). Files from
before switching on are left alone, as before.

## 2026-11-15: brand colour on Premiere's own text is a Tint before the Graphic group (0.10.112)
Premiere 26.5.3 exposes no fill, font or size on its own text to scripts (probed again), so the only way to colour it is an
effect on the clip. A Tint with Map White To the colour and Map Black To black turns white letters exactly into the colour and
keeps a dark outline or shadow (logos keep Black To = the colour too: one flat colour). It must be inserted before the Graphic
group: appended after the Text layer Premiere does not draw it (measured). Coloured, non-white text becomes a darker shade, not
the exact colour; captions on caption tracks cannot be coloured.

## 2026-11-15: Auto Cut silences cuts voices 8 dB under the main voice; subtitles choose readings by Whisper's score (0.10.95)
The user's red/green labels on Lokali v10: everything kept was at the main voice level, everything rejected 7.2+ dB under, the
guest's answers 3-6 dB under; a single speaker's softer real line elsewhere was 6.6 dB under. 8 dB sits between; it is a default
with an option (Keep every voice), because the user said it is not the case for every client. Subtitles: in every style but
ReShape's, a piece with an unknown heard word is read three ways and Whisper's own score of each text over the sound decides
(2 points, also per token so a shorter text does not win by leaving words out). Measured on Lokali (-12.0 / -2.3). Earlier the
sound check was rejected for single dictionary repairs (2026-11-15 below); here it chooses between whole readings Whisper made
itself, which it separated clearly. Protected ReShape files touched (asr.py: optional counts; subtitle_job.py: the strict
branch only); `scripts/reshape_golden.py check` identical.

## 2026-11-15: a dictionary repair keeps the number of syllables; no sound check for dictionary repairs (0.10.94)
Measured on all 16 dictionary repairs of the 30 subtitle runs on this Mac: the 6 that changed the number of syllables were wrong
or doubtful (съседни, Кара x2, тям, отавила, случва), all right ones kept it, except the vowel next to я / ю the step was made for.
Whisper's sound check (audiocheck.margin) was measured on the same repairs and does not separate them (right +2.4 … -15, wrong
+8.8 … -19.9), so it stays on learned fixes and speaker forms only. The ReShape style was never the reason for its accuracy:
the style only cuts lines; its recordings are clean lavalier speech in standard Bulgarian, and its projects carry the editor's
correction lines. The ReShape style keeps the pre-0.10.94 repair rules (`strict=False`, the user: "leave ReShape as it is").

## 2026-11-15: Cut silences clones in batches within 2 hours of scratch timeline (0.10.94)
Each clone is the whole clip until it is trimmed; slots one after another reached 28.6 hours on a 101-cut 8-minute clip and
Premiere crashed. Batches keep the timeline short at the cost of 3 Undo steps per batch (the user's rule: say how many).

## 2026-11-11: the rough cut is built from clones, the XML only makes the sequence (0.10.45)
An imported XML makes new master clips, and Premiere re-interprets them (26.5.2: rotation flag off, S-Log3 gone, L/R copies
plain stereo). Clones of the editor's own track items keep everything. The clones' trims and moves touch only the copies in
the new sequence; the source sequence is still only read; nothing is removed.

## 2026-11-18: a learnt camera clock counts as a witness up to 2.0 s of spread (0.10.117)
The user, 2026-11-18 ("do it, if it breaks we reverse it"): the FX30s write whole seconds, so the sure pairs' clock-vs-sound
differences wander by up to about 2 s; at 1.0 s GStroy КП11 Видео 8 (spread 1.6 s) left 5 short-take pairs unsynced that
agree with the clocks within 0.7 s (now synced; a sixth has too weak a sound and is only named). Checked on 9 earlier shoots: no pair that synced before was lost or moved (offsets
identical to 0.00 ms), 7 more pairs sync, more "recorded at the same time" hints. Risk accepted: repetitive noise (drill,
hammer) matching wrongly in both stretches AND the clocks; such pairs are named in the panel's accepted notes.
To reverse: `CLOCK_PRECISE = 1.0` in `groups.py`.

## 2026-11-11: a short take may sync on two stretches when the learnt clocks agree (0.10.45)
Three stretches cannot exist in a 4-12 s clip. Two agreeing stretches plus the cameras' clocks learnt from the sure pairs (never
raw clocks) within 1.5 s is two independent witnesses; every other pair keeps the old rule.

## 2026-11-11: the rough cut reads with a compression-ratio limit of 3.0 (0.10.45)
A retake is repeated text; at 2.4 Whisper took it for a loop and re-read the stretch up to six times. Only the rough cut, under
its own cache keys; the subtitles keep faster-whisper's defaults.

## 2026-11-10: every client style joins the article (0.10.23, replaces the next entry)
The user said yes to the question in 0.10.22: all five client styles (one Submagic template) write „IPHONE-А“. ReShape, short and
standard keep their output. The client's own brand takes no article at all (the user: "Its not GStroy-A its GStroy",
"Its not CREDISSIMO-TO its CREDISSIMO"): the article is dropped (a writing rule for the brand, its time stays in the word);
applied to every client's brand (ЕКОПАК, BEAUTY SECTOR, AULA, AULA.BG too). Other English names keep it (IPHONE-А, SANDBOX-А).

## 2026-11-10: AULA's article joining is AULA's only (0.10.22)
AULA's editors write an English name with its Bulgarian article joined („IPHONE-А“); Whisper gives „iPhone -а“ as two words, so
the other styles can show „IPHONE -А“ or even put „-А“ in the next chunk. The joining is a preset key (`join_articles`), on for
AULA only: ReShape, short, standard and the other clients stay byte-identical; whether the others want it is the user's call.
Only after a word with Latin letters, so a Bulgarian word is never glued.

## 2026-11-10: names may span words and keep their own case; no lone letters or dashes in the client styles (0.10.21)
The user wants GStroy written GStroy even in a capitals style, and Whisper gives it as two words („G -Stroy“), as it does
„Бюти Сектор“, „Double Gold“. So `names` keys may hold the split form (joined before grouping, the times from the first piece to
the last, longest key first), and a name is shown exactly as the preset writes it. The client styles (all four from one Submagic
template) also drop a lone dash Whisper writes and never leave a one-letter word alone on a line: the exports show neither.
ReShape, short and standard are byte-identical; the client presets changed only where these rules apply.

## 2026-11-10: a client's name is written its way by the preset (0.10.20)
The user chose CREDISSIMO (the exports wrote it both ways). A preset's `names` maps a said word to the client's spelling, only in
that style and only how the word is written (the guide allows a writing rule; the said word is not changed). One word only:
GStroy's „G -Stroy“ comes as two words from Whisper, so it stays a Captions-tab correction line until a joining rule is needed.

## 2026-11-10: Credissimo's preset; preset settings are chosen by shape, not by break agreement (0.10.19)
Credissimo shares GStroy's template but cuts its two lines evenly and its chunks run longer. Where chunks break agrees with the
editors at 61-63 % (boundary F1 57) for every setting tried, so break agreement cannot choose the settings; they are chosen so
the chunks have the editors' size and shape (mean words, two-line share) at the same agreement. Its red keywords are rarer and
semantic (money words), so the accent rule takes a word pattern; still only a suggestion. The protected `subtitles.py` gained
optional keys only; every other preset's output was compared byte for byte before and after.

## 2026-11-10: client subtitle styles are presets measured on the client's exports; GStroy touches protected files (0.10.18)
The user asked for a GStroy subtitle profile from its finished videos and the same for every client later. A client style is a
preset in `subtitles.PRESETS` (like ReShape), measured, not guessed: line lengths, breaks, timing, case and position from text
recognition on the exports and Asistent's own word times. GStroy needs three things no preset had: capitals (`upper`), a
stacked layout with the last word alone underneath (`stack`) and suggested keywords (`accent`). They are new optional keys
read only when a preset has them, added to the protected `subtitles.py` and `PRESET_NAMES` in `subtitle_job.py`; ReShape's
baseline test stays byte-identical and the golden full-job check identical. Keywords are only suggested (listed, `accent` in
the JSON): the editors pick them by meaning and no length rule matched better than 43 %. The look (font, colour, shadow) stays
the editor's Track Style, as no script can style captions.

## 2026-11-08: ▶ plays in Premiere, not in a player of Asistent's own (0.10.11)
The user heard the line twice (Asistent's afplay beside the timeline) and wanted it in the Program Monitor. QE's sequence player is
the only playback control a script has in 26.0.2, so the host plays and stops it; the stop happens only while the playhead is still
in that line's passage. This adds two commands to the protected `host.jsx` / `hostbridge.py` (nothing else in them changed; the
ReShape golden check stayed identical).

## 2026-11-08: whisper.cpp (Metal, beam 5) measured: 7x faster, not adopted yet
The candidate left by the speed decision below. On the same 143 s (docs/BENCHMARK.md): 20.8 s against 152.2 s, but it invented a
line („Абонирайте се!“), wrote „млн.“ for „мм“ and its word times sit further from the aligned ones (median 0.53 s against
0.23 s). Speed is not bought with words: it stays an experiment in `<app>/experiments` until the verified references show no
more meaning errors than Classic; then only as an optional backend, never for ReShape.

## 2026-11-08: no native-graphics subtitle output in Premiere 26.0.2 (probed again)
The user asked for an optional output as native, editable text graphics styled from a client profile (no MOGRT). New probes
on the same Premiere 26.0.2 (docs/NATIVE_GRAPHICS.md): ExtendScript can store a string in Source Text, but the graphic then draws
nothing; the real text document is binary and unreadable to scripts (cut at the first zero byte), font/size/fill/stroke are not
parameters, UXP reads Source Text as null. So no script can put words into a native graphic or style one; only transform values
and timing are writable. The output mode is not built and MOGRTs are not substituted; captions + the client's Track Style + the
editor's one Upgrade click stay. Probe again after a Premiere update.

## Audit of 0.10.1 (2026-11-08, 0.10.6)
- **When ownership cannot be proven, the editor's work wins.** Caption pairs need every line's time (records from older
  versions are never trusted for removal), a Lumetri is untouched only when its whole snapshot equals the one Asistent learnt
  (unknown = the editor's), and an unreadable managed.json owns nothing.
- **Fix audio refuses rather than loses.** overwriteClip was measured in NEW TEST to drop the original's Volume keyframes, and
  no API copies an effect chain: a clip carrying effects or keyframes is not split, with the reason.
- **Updates can always go back.** A copy of the installed version is kept before anything changes; the packages are not staged
  in a second venv (several hundred MB per update) but put back from a pip freeze.
- **Speed changes stay bit-identical** (decode streamed into place, the aligner kept loaded); sync pair pruning was not done
  because no pruning rule could be shown to keep every true pair.

## Architecture
- **Hybrid: UXP panel + local Python engine.** UXP cannot run FFmpeg/NumPy/Whisper or spawn processes; a
  standalone app cannot import into bins or edit sequences. Rejected: CEP/ExtendScript as the main side (legacy, and the
  user's Quick Search already lives there; one exception since 0.9.45, see „Captions on the timeline“), cloud services, databases, web frameworks.
- **Engine on `127.0.0.1:47390`, stdlib HTTP, header `X-Asistent: 1`.** A browser page cannot add a custom
  header without a CORS preflight, which is never approved; Host header checked against DNS rebinding.
  No token file (the panel could not read one reliably). Port chosen away from Quick Search (47231–47234).
- **Manifest network permission `"all"`.** `http://127.0.0.1:47390` (with port) was silently blocked by UXP in
  0.1.0; `"all"` works.
- **Engine data outside the Obsidian vault** (`~/Library/Application Support/Asistent`) so Syncthing does not
  copy the venv, caches and logs between Mac and PC.
- **LaunchAgent `ProcessType Interactive`.** `Background` put the engine on efficiency cores: 187 s vs 6.6 s for 28 clips.
- **Install without dialogs** with Adobe's UnifiedPluginInstallerAgent: `--remove "Asistent"` (reports −406
  but unloads the running panel) then `--install`; `--install` alone leaves the old panel loaded ("already exists").
- **Python 3.12 venv** (stable NumPy/SciPy wheels); Homebrew default 3.15 not used.

## Colour buttons (0.9.58)
- **Separate buttons narrow the plans, they do not fork the code.** „Бяло“ and „Експозиция“ run the one analysis and the one apply of „Авто цвят“; only `plansFor(..., only)` drops the other correction. Reason: the user's rule was to keep every calibrated value and check as it was; a second code path would have to be kept equal by hand.
- **No Contrast/Saturation button for one clip.** The single-clip engine never had such a measure (a target for contrast or saturation is a taste, not a measurement). Shot Match has them because the reference camera defines the target. Exposing them alone would mean inventing the algorithm.
- **„Изравни POV-тата“ is Auto Shot Match, not a second feature.** It already starts from the clip's current Lumetri values and writes absolute values for the components it changes, so previous corrections are kept and a repeat press gives the same result.

## Rough cut build path (2026-11-03)
- **Engine-written FCP7 XML imported with UXP `importFiles`**, one new sequence per run, never edits the source sequence. Probed in TEST.prproj (see `docs/ROUGHCUT_PLAN.md`, M0 results): frame-exact, linked, markers possible. Rejected as the primary path: cloning the sequence and deleting (removal through UXP crashes 26.0.2) and UXP additive trimming (unprobed, fragile on 26.0.2).

## Premiere API usage (26.0.2)
- **Call every method through `maybe()`/`has()`.** Adobe's types start at 26.2; 26.0.2 lacks e.g.
  `SequenceSettings.getVideoFrameRate` (use `sequence.getTimebase()`: ticks per frame).
- **Selection:** a clip is selected if it matches `sequence.getSelection().getTrackItems()` (by kind/start/end)
  OR `trackItem.getIsSelected()` (0.9.8; with only the first, a second POV was missed).
- **Times in whole frames as ticks** (`TickTime.createWithTicks`, 254016000000 ticks/s): an in-between time and a
  `ClipProjectItem` both gave „Invalid parameter“ for `createInsertProjectItemAction`; a plain `ProjectItem` works.
- **No track item removal through UXP.** Clone + remove crashed Premiere (SIGABRT in `dvascripting::Engine`,
  `EvalScriptAsync_ScriptingThread` → `napi_delete_reference` → `V8_Dcheck`): CEP panels running ExtendScript
  (Quick Search polls every 3 s; AutoCut, Mister Horse) free a UXP-held object after deletion.
- **One transaction per press**; Premiere clones a clip as it was BEFORE the transaction, so a split copy
  gets its own effect in a second step (max 2 Undo for any number of clips). A new `VideoFilterComponent`
  has no parameters until it sits on a clip, so a new Lumetri costs one step before the values are set.
- `exportSequenceFrame(seq, time, name, dir, w, h)` exists in 26.0.2 and adds `.png` itself: pass the name
  without extension.

## Sync
- **Timeline selection → new `SYNC – <sequence>` sequence** (user's choice after the crash). Rejected: in-place
  moves across tracks (needs removal → crash); Project-panel selection (user wants the timeline); multicam
  (not creatable via UXP).
- 5 ms agreement tolerance (cameras hear sources over different paths), independent non-overlapping windows,
  slope only over ≥ 60 s and ≤ 100 ppm, Tukey-tapered windows and no peak at the search edge (edge artefacts
  produced false matches), coverage ≥ 60 % of all windows for High. Timecode only as a hint (Sony record-run
  timecode is not shared between cameras); file dates never.
- Same-folder pairs are not compared (one camera cannot record two clips at once).

## Audio
- Routing only with Premiere's Fill effects (never summing channels → no phase cancellation); split = clone
  of the audio clip on the nearest empty audio track; „Раздели L/R“ refuses when both channels carry one sound
  (stereo camera mic, one voice heard twice) because it plays doubled.
- Level = clip Volume (Premiere scale 0.1778 = 0 dB, max +15 dB); target −17 LUFS, peak ≤ −6 dBFS (user rule),
  noise ≤ −55 dBFS; phrase leveling corrects only the excess beyond 4 dB natural dynamics, ±6 dB, ≥ 1 dB steps,
  ramps inside pauses.
- User rejected muting secondary cameras in SYNC („не мютвай нищо“): all tracks play.

## Auto import
- One folder belongs to one project and vice versa; a file is handed only to that project while it is open.
- A browser rename from a temp name is the completion signal (0.3 s); other copies wait 1.5 s of stable size;
  FFprobe must read the file. Import in place, never copy or rename. Long-poll (`wait=10`) instead of 4 s polling.

## Colour
- **Analysis in linear light, decided per clip**; never one correction per client (spec).
- Neutral reference = largest near-neutral bright group INSIDE the camera-cast range (±0.9 temp, ±0.5 tint in
  log2 chroma), checked against grey world on low-chroma mid-tones; plain grey world alone rejected (spec + tests:
  a green wall or warm wood would be "neutralised"). Skin found after the cast is removed (a warm grey wall looks like skin).
- Exposure from skin (target 0.62 encoded luma, within the spec's 45–75 IRE guidance), 0.5-stop steps, ±2
  (user: typical +0.5 … +2). The plain-gain highlight model is only a warning; the real Lumetri result must be
  measured on an exported frame (Lumetri rolls highlights off).
- S-Log3 decoded on legal-range code values (95/420 points); log footage is suggestion-only until colour
  management is verified.
- Preview Only by default; apply High confidence only („Приложи сигурните“), Medium on request.
- Colour work goes into **Asistent**, not Quick Search (first spec forbids touching Quick Search).

## Rejected / postponed
- Phase 5 postponed by the user (to be done in the office).
- Remotion/HyperFrames, ElevenLabs/TTS, paid plugins, cloud transcription: out by the user's rules.

## Highlight clipping: step back over 3 %, tolerate the final result up to 3.25 % (2026-11-01, 0.9.17)
The first render check steps Exposure back once whenever new clipping is over 3.00 % (measured with
`pullback_units`, validated on C0739: 4.42 % → 3.08 %). The user chose to keep this even when the first
result is inside the soft tolerance. The 0.25-point tolerance (`CLIP_SOFT_TOLERANCE`) only classifies the
final result (ACCEPTED_WITH_WARNING) and never triggers another correction: one more step would darken the
skin to win a few hundredths of a percent.

## Colour: one static best-effort value per clip (2026-11-01, user)
Every corrected parameter is one constant value across the whole clip, the best overall from the measured
moments; no keyframes. A clip that burns too much or is otherwise beyond the range gets one capped pass (what
is possible) and the work moves on: no repeated attempts, and one failing clip never stops the others.

## Colour: Asistent may update only its own, untouched Lumetri (2026-11-01, user, 0.9.24)
A Lumetri is Asistent's when the fingerprint of all its parameters matches one Asistent recorded after
writing it (`managed.json`, per clip source range). Then a new press adds the new differences to it. Any
manual change to any parameter makes it the user's grade, and it is never touched again. Unknown (older)
Lumetris are treated as manual.

## Skin only from detected faces, confidence-based fallback (2026-11-01, user, 0.9.30)
Colour cannot separate skin from OSB, plywood or pale walls (same hue and saturation on the FX3/FX30), and area or
camera-difference thresholds are no fix (close-ups). Skin is therefore measured only inside faces found by YuNet
(OpenCV `FaceDetectorYN`, MIT model bundled, CPU, ~10 ms a frame; chosen over Haar cascades, which OpenCV 5 no longer
ships, and over MediaPipe, which is much heavier). No face → neutral surfaces on common moments, then mid-tones on
comparable content; saturation only from faces. Every measurement carries a confidence, and the render check
compares only on anchors all frames share and reports what it skipped.

## Subtitles go in as an SRT the user drags (2026-11-01, M0 probes, 0.9.39)
Premiere 26.0.2 imports an .srt as a project item (`importFiles`), but neither `createOverwriteItemAction` nor
`createInsertProjectItemAction` places it (no error, nothing appears, no caption track), and there is no API to create a
caption track. So Asistent imports the SRT into a bin and the user drags it over the sequence once; our line breaks
survive. Premiere's own transcript (`Transcript`) is not used for now: its export rejects a clip without a transcript and
its own captions would re-break the lines.

## Subtitles 0.9.44 (2026-11-01)
- **Original 4a1a method:** Whisper large-v3 + MMS_FA forced alignment + names prompt + `spoken` dictionary + a correction pass (`tools/autoedit`). Same model as Asistent; the alignment and the correction pass are what Asistent lacked.
- **Per piece, not one mix:** measured to give correct words where the joined mix did not.
- **Aligner is optional and isolated** (own venv, subprocess, falls back to Whisper times) because torch is about 0.9 GB and the MMS_FA weights are CC-BY-NC 4.0: installing them for client work is the user's decision.
- **Grouping by cost, not by a word count:** 2-3 words is the target, the cuts follow pauses, punctuation and function words; the old „max 2 words“ rule of the 4a1a burned-in captions (`caption_max_words` 2) is no longer the short preset's limit (user, 2026-11-01).

## Subtitles M3 (2026-11-01, 0.9.42)
- **Duplicate audio rule (replaced in 0.9.43):** the first version dropped an item covered ≥ 50 % by a lower-track item („lowest track wins“, the plan's rule). Measured on 8 GStroy clips it picked the noisy camera mic and produced wrong words. Now the engine decides: items that overlap ≥ 50 % of the shorter one AND whose loudness envelopes correlate (≥ 0.5, lag ±0.25 s) are the same speech; the cleanest copy wins (speech level over noise floor, quiet copies penalised; within 3 dB the lowest track wins) and the part of a weaker item the winner does not cover is kept. Two different people talking at once do not correlate, so both stay.
- **Whisper settings stay default (2026-11-01):** a descriptive `initial_prompt`, VAD, `condition_on_previous_text=False` and beam 10 were each tried on the real clips and gave no reliable gain (worse text, dropped speech, one hallucination, +20 % time). Better input audio was the real lever. A prompt of the user's own names and terms is still planned (M4).
- **Channels for recognition:** the same classification as „Оправи звука“ (one-sided clip → its sound side, two microphones summed, otherwise averaged); never a polarity-inverted sum.
- **Mix origin** is the earliest item, not sequence 0, so silence before the first speech costs no recognition time; word times are shifted back by that origin.
- **Preset `auto`** follows the sequence shape (landscape → standard, else short); if the frame size cannot be read it falls back to short and logs it.
- **Whisper words are cached** by mix + prompt + model; presets and fps are applied after the cache, so changing them does not run Whisper again.
- **Download never automatic:** only the button that names the size starts it (checked by a wiring test); a missing model or backend is an instruction in Bulgarian, not a download.

## Captions on the timeline: a small CEP host (2026-11-01, 0.9.45; reverses „CEP rejected“ for this one job)
The user asked that one press puts the subtitles on the timeline. UXP in Premiere 26.0.2 cannot: `Sequence` has no
`createCaptionTrack` (method list read through the bridge), `createOverwriteItemAction`/`createInsertProjectItemAction` do
nothing for an SRT (M0), `SequenceEditor.createAddItemAction(s)` need more parameters than a project item and are for
track items. ExtendScript has `Sequence.createCaptionTrack(projectItem, startAtTime, captionFormat)`. So `host/` is a tiny
invisible CEP extension (same pattern as Quick Search's background extension, which has run under Premiere 26 for hours):
it long-polls the engine, runs `host.jsx`, posts the answer. It listens on no port, carries only fixed commands, is a
separate extension from Quick Search (which Asistent still never imports, calls or modifies).
- **No removal, no muting.** The permanent rules stay: nothing is removed through UXP (crash) and no track is muted or
  rearranged on the user's behalf. So a second press does not replace the first track: the engine remembers the
  signature of the track it placed (`captionstate.py`: index, item count, first/last time); if the sequence still holds
  that track, the panel says so and tells the editor to delete it. A track the editor changed no longer matches and is
  not touched. Automating that delete is possible only if ExtendScript offers a safe call (to probe, needs the user's OK).
- **Verification belongs to the panel:** it reads the caption tracks back (UXP, read only) and compares count and
  first/last time with the SRT; a mismatch is shown, not hidden.
- **Needs one Premiere restart** to load the extension, and `PlayerDebugMode=1` (set for CSXS 10-13; already needed by
  Quick Search). Unsigned CEP could stop working in a later Premiere: then the SRT is still made and the panel says to
  import it by hand.

## Subtitle words: readings + dictionary, never a guess (2026-11-01, 0.9.45)
Whisper's probability cannot tell a wrong word from a right one, and the same piece read with different context gives
different words. So each piece is read three times (0.7 s, 2 s, 4 s of surrounding sound); the 2 s reading is aligned and
gives the words and times; the other two only vote. A word changes only if two readings agree AND the Bulgarian
dictionary knows the new word and not the old one (voting alone turned „градината“ into „градвината“). Everything the
readings or the dictionary doubt is reported by word and time. Cost: three times the recognition time (cached per
context). The dictionary is GPL v2 data downloaded at setup, not stored in the repository.

## Speed, context and the Bulgarian transcription guide (2026-11-02, 0.9.48)
- **One reading per stretch of a file, 4 s of context, windows merged** (not 3 readings per piece with 0.7/2/4 s): 252 s of audio → 91 s. 2 s of context was too little (prices read as dates), 6 s pulled in the neighbouring takes („Превърна мен“). A second, narrow reading is taken only for a piece that still has an unknown word or a first-person „съм …л/ла“ form, and the reading with fewer doubts wins.
- **Parallelism, not threads:** one reading with 10 threads was slower than with 4 on the M4 Max (efficiency cores); several readings at once are faster (5 × 2 threads: 3.8× real time against 1.8×). `asr._parallelism` sizes it by cores; a GPU takes one reading at a time.
- **The aligner's confidence is not a reason to discard a time** (lowest-scored words: 57 % within 80 ms against Whisper's 7 %); a word is distrusted only when squeezed into too little time for its letters. Numbers are aligned through their spoken form (`numbers.py`).
- **Words outside sound are marked, not deleted** (guide §7): no speech-like sound under the word (`align.unheard`), or voiced sound without a word (`align.uncovered_speech`). Deleting would be a guess as well.
- **Guide vs the user's decision on gender:** the guide proposes per-speaker male/female/auto metadata; the user removed the global setting because both speakers are in one edit, and the guide itself says never one global conversion. So forms are never converted; a disagreement between two readings is flagged (`agreement.py`).
- **Not built:** an acoustic-fit arbiter between readings (right 4 of 7 times), changing „взима“ to „взимаме“ without evidence (guide §3), automatic month-to-price rewriting (guide §5: mark it).
- The guide is the permanent reference (`docs/BULGARIAN_TRANSCRIPTION_GUIDE.md`, linked from CLAUDE.md and docs/INDEX.md); its §10 table is `tests/test_guide_regressions.py`.

## Corrections, gender, alignment choice (2026-11-02, 0.9.46)
- **Corrections re-time.** The editor's `чуто => казано` lines are applied to the heard words before the forced alignment, so the new words get times from the sound. Replacing text over the old timestamps (the first idea) leaves the phrase where the wrong words were. Names/terms (lines without `=>`) go to Whisper's prompt only. Rejected for now: fuzzy snapping to terms (a legitimate word could be turned into a term).
- **large-v2 tested as a second opinion and rejected (2026-11-02).** Same four pieces, same settings: it fixed „неща“ but broke „Примерно на мен“ („Прилива на мен“), „то и за градината“ („той за градината“) and made the end phrase worse („ще чакам да бойдиш с вън“). The 2.9 GB test model was deleted. large-v3 stays.
- **Whisper cannot be tuned out of its mistake** (beam 10, no temperature fallback, float32, hotwords off, short windows all give the same wrong end phrase), and a prompt that contains the answer would be cheating. A different ASR model (e.g. large-v2) was not tried: it is a ~3 GB download for the user to approve.
- **Gender setting: tried in 0.9.46, removed in 0.9.47.** The user's edits mix both speakers, so any gender rule would rewrite correct forms. Pitch had been measured and rejected (150-258 Hz for one speaker in one clip). A form the readings disagree on is marked „?“ and left as heard.
- **MMS_FA stays the aligner.** stable-ts 2.19.1 (MIT, Whisper attention + silence suppression) measured worse on the same 13 post-pause words (median -0.10 s, 5/13 within 80 ms vs +0.04 s, 11/13). Its licence advantage does not pay for that.
- **Silence trim:** thresholds as shares of the way from noise floor to speech level, because a quiet microphone has a small gap (a fixed „35 dB under“ missed „Ей,“ on a −19 dB piece).
- **No caption track deletion.** ExtendScript has `createCaptionTrack` only (probed: no caption track object, QE removes only video/audio tracks). Unchanged rule: refuse to stack, tell the editor what to delete.

## 2026-11-03: L/L and R/R through subclips with their own channel mapping, never Fill effects
The user wants the result of their manual workflow (duplicate audio below, Modify Clip > Audio Channels L/L and R/R). No Premiere API sets the channels of a clip already on the timeline (UXP has none; ExtendScript `setAudioChannelMapping` works on a project item). So each side is an audio-only subclip of exactly the media range the clip uses, mapped L/L or R/R, overwriting the original audio (upper) and placed on the free track below (lower), then relinked. Chosen by the user over re-placing the source clip (which would replace the video too) and over doing it only inside the SYNC build. Probed and verified in TEST.prproj before release; the panel never removes anything, an overwrite replaces the original audio clip in place.

## 2026-11-03: limiter per clip instead of on the Mix track; balance only lowers
The user's video puts Dynamics (Limiter -6 dB) on the Mix track. Not reachable by any script API in 26.0.2, so each levelled clip gets the same Dynamics and the engine keeps the SUM of both sides under -6 dB by the gains. Balancing between two speakers only ever lowers the louder side (max 12 dB, tolerance 2 dB) and ignores a channel without its own speaker: lifting the quieter side would lift its noise or bleed. Existing Dynamics with the user's own settings is never modified.

## 2026-11-03: repeated takes are matched with difflib and only listed (Phase 8 M3)
`rapidfuzz` was proposed in the plan; difflib on normalised words was enough on the real test footage and needs no new dependency, so it is used first. Takes are matched by whole sentences, grouped and chained into passages (a scene said three times is one group). Nothing is cut for a repeat in 0.9.64, in either mode: the user decides the take in the „Преглед“ view (next), and the score and Smart cutting are M4. A group whose losing takes say other content words or any number is marked as different text, never as a plain repeat.

## 2026-11-03: Внимателно cuts plain repeats too (changes the plan's "Safe never removes a take")
The user pressed Внимателно on three takes of one line and expected two of them gone ("it kept all 3"). So a plain repeat (same content, no number different, the last take complete) is cut in both modes, from the first take to the winner when only short setup talk lies between. What stays only listed in both modes: a group said differently (another number or several other content words). What only Умно cuts: a start repeated inside a sentence (a cut inside one sentence is the riskiest).

## 2026-11-03: the tool is in English
The user asked for the whole tool in English, replacing Bulgarian (no language switch), with English names for what Asistent creates in Premiere. The rule "panel texts in Bulgarian" in CLAUDE.md is replaced. Bulgarian stays only where it is data about Bulgarian speech or folder names, not text for the user to read.

## 2026-11-12: a minimal panel, chosen from mockups (0.10.59)
The user found the panel crowded ("everything is everywhere") but uses every feature, so nothing was hidden behind a
"more" list. Three clickable mockups (artifacts: A · Rows, B · Tiles, C · Stages, with the Motion tab drawn in each) let
the user choose: **A · Rows** for Tools and Motion, **Amethyst #8745A5 + Golden Yellow #FFC945**, and a soft blurred glow.
Rules kept: only CSS `css_probe` proved (rows are flex with a fixed button width, not the mockup's grid; the glow is a
pre-rendered image because UXP has no proven blur; the gradient is a second background that UXP may ignore), `div.btn`
through `button()` / `enable()`, colours through tokens. Set-once things stay next to their tool (Track names' colours in
its ▾, the export folders in their Automatic row); Settings holds only the developer tools; the Log is a clock icon that
is always one press away (the user's choice over a tab or Settings).

## 2026-11-11: the whole panel takes the Tracker page's dark look (0.10.58)
The user asked for the Tracker's look (0.10.57: charcoal grounds, quiet lines, a violet accent, short explanations with the
rest in tooltips) on the whole tool, within the existing UI rules. Done by changing the `:root` tokens only, so every page
follows, plus one shared button system. Two choices: each Tools card keeps its main button in solid violet (each card is
its own task, so one accent per card; the Tracker keeps one accent for the whole page because its steps are one workflow);
the Tools cards keep their ⓘ for the explanation, the other pages get a one-line `.desc.brief` with the full text as its
tooltip. The rules stay: colours only through the tokens, only CSS `css_probe` proved (no gap, grid, transitions),
`div.btn` through `button()` / `enable()`, SVG colours from CSS.

## 2026-11-03: the panel's new look stays plain HTML/CSS/JS, no UI library
The user asked for a premium, compact look and named shadcn/ui, Spectrum Web Components, Magic UI, React Bits, Adobe's Premiere samples and Playwright. Checked: shadcn, Magic UI and React Bits need React, Tailwind, Radix or framer-motion/WebGL, none of which runs in UXP; they are design references only. Spectrum Web Components run in UXP only with `enableSWCSupport`, the `@swc-uxp-wrappers` packages and a bundler, a developer reported them not rendering in Premiere 25.6.4, and swapping `<button>` for `<sp-button>` would change what `onTap`, `setBusy`, the test bridge and the wiring tests depend on. So the look is made with design tokens over the existing native elements, Spectrum's sizes as the reference, and Playwright only as a development tool for screenshots of a browser preview (Chrome is not UXP: Premiere stays the final check). CSS is limited to what the panel already proved in Premiere until `css_probe` measures more.

## 2026-11-03: Asistent draws its own buttons (div.btn)
The CSS probe showed that Premiere 26.0.2 draws every `<button>` with its own grey face whatever the CSS says. Of three ways (own buttons with the panel's colours; Spectrum's `sp-button` with Premiere's slightly brighter blue; keep the grey buttons) the user chose own buttons. They are `div`s with class `btn`; `enable(b, on)` is the only way to switch one on or off (the `disabled` property for `onTap` and the bridge, the attribute for the look). New buttons in code go through `button()`; never add a `<button>` element.

## 2026-11-04: subtitles are text graphics from Asistent's own After Effects template
The user asked for subtitles as graphics instead of an SRT and chose editable text graphics with static lines (over a styled caption
track or rendered images). Premiere-made templates expose their text to scripts only as binary, and FFmpeg here cannot draw text, so
Asistent builds its own .mogrt in After Effects (scripted, once) with one exposed "Text" field, and the host places one per line with
`importMGT` on a new top track. The .srt is still written; the caption-track code stays for placing an SRT by hand.

## 2026-11-04: subtitles stay captions after all (restyle all at once)
Right after 0.9.80 the user said the point is to select all subtitles and change font, shadow and everything in the Properties panel.
Premiere edits many clips together only for its own captions and its own text graphics; a template from After Effects shows only
its exposed fields, and no script can create Premiere's own text graphics with words in them (no command for "Upgrade Caption to
Graphic" either). Captions do exactly what the user asked (all selected -> Properties; Track Style to keep a look), so the panel
places a caption track again; the template graphics code stays for designed templates later.

## 2026-11-04: subtitles learn from the editors' fixes, per client, through the office folder (0.9.95)
The user: learning runs in the background and is not shown; everyone's fixes help everyone, through the office, not a cloud.
The folder sits in the client folder (`Production/ReShape/ReShape Subtitle Learning`, the user's choice), so it is found by
walking up from the project and names the client; no office address is written in the code (the repo goes public). Each
computer appends to its own file, so two editors never write the same file over SMB. One editor's fix must not reach everyone
unchecked: names reach the client at once, a word fix needs a second project (its own computer at once), other clients need
three projects by two computers, a single dictionary word needs the words it was fixed between, and the sound check (Whisper
reading both texts) refuses a fix that fits more than 8 worse. Measured: that catches a different word but not a near-miss,
so the confirmations carry the weight. The writing rules (не знам, по-, the article) are applied without asking: they change
how a said word is written, which the user asked for, like the punctuation rules.

## 2026-11-04: reference-style subtitles: captions, the editor's one click, then Asistent moves lines off faces
The user needs exact words, every line its own layer, all restyled at once in Properties, and lines moved off faces (the reference
puts them mid-frame). Premiere 26: its own text graphics do all of that but no script can put words into them (UXP and ExtendScript
probed; Adobe says the graphics calls are for After Effects templates), and template graphics cannot be restyled together (open
feature request). The user chose: Asistent places exact captions, the editor runs Upgrade Caption to Graphic once, Asistent moves the
graphics. English: local NLLB-200 (user's OK to download), translated per sentence and cut to the Bulgarian clauses.

## Updates through GitHub releases, installed from the panel (0.9.87, 2026-11-04)
The user wants colleagues to stop downloading every version by hand. The repo is public, so its releases can be read without a
login: each release carries one zip with everything and `latest.json` with the zip's SHA-256. The engine checks (a GET only, at
most every 6 h) and installs only when the editor presses Update, because an update restarts the engine and reloads the panel
(never in the middle of someone's work). The engine runs from a copy in the app folder, so an update never needs git or the repo.
Not chosen: an automatic silent install (it could restart the engine during a job), a private repo with a token on every
computer (a secret to hand out), Adobe's marketplace (review and a public listing for an internal tool).

## 2026-11-04: a new subtitle pair replaces Asistent's own earlier pair (0.9.97, reverses "No caption track deletion")
The user: Apply and rebuild must not leave two pairs on top of each other. No script deletes a caption track (ExtendScript has
only `createCaptionTrack`, QE `removeTracks` takes video/audio/submix counts, UXP `CaptionTrack` has no remove), but UXP
`SequenceEditor.createRemoveItemsAction` removes the lines. That call crashed Premiere 26.0.2 in 0.3 (clone + remove while CEP
panels ran ExtendScript), so it was probed in NEW TEST with the user's OK first: 13 tracks of 60 lines removed while Asistent's
host ran ExtendScript continuously and Quick Search polled, then `premiere-captions.place` three times in a row (each removed the
previous pair's 120 lines); Premiere stayed up, no crash report. So after a new pair is placed, the lines of the earlier pair are
removed in one step, only when its remembered signature (now with the English track too) still matches when read again; the
emptied tracks stay and the panel says so. Hiding the old tracks (`CaptionTrack.setMute`) was the fallback, not needed.

## 2026-11-04: lines keep phrases whole, wait for the cut; the 1.3B translator (0.9.97)
- **Cuts.** The ReShape style shows a line 0.18 s before its first word; across a cut that put the line over the previous shot
  and ended the previous line early (the user saw it). Every clip start is a cut; a line never starts before its cut.
- **Phrases by cost, with the dictionary.** An adjective-noun pair (`agreement.bond`) costs 4 to split, „може да“ 3; ending on
  „е“ is allowed (cost 2) only before such a pair; ReShape lines may be 25 characters (their longest). Tried and dropped
  because they changed nothing on any saved run: a cost for ending on „просто“, „дори“, „които“ (the line limits leave no
  better place). Checked on the ReShape video (8 cuts changed, all better) and 12 Ludi Glavi runs (none changed in their style).
- **Translator: NLLB 1.3B over 600M.** Compared on the 14 ReShape sentences: 1.3B got the meaning where 600M did not (by just
  losing weight / fat cells aren't just bigger / bruises easily), at about twice the time. The previous sentence as a forced
  start (context) made both models return nothing for most sentences, so every sentence is still translated alone. 1.3B writes
  "lipidemia" for липедема; an editor's English fix is remembered per line (learning).

## 2026-11-04: Whisper hears the edit between clips; English cut by each line's own translation (0.9.98)
- **Silence between clips, context kept outside.** Compared on the ReShape recording: as before / the media between the clips
  silent / everything outside the clips silent. Silencing between the clips changed one thing (the lost „Затова“ back);
  silencing all lost „Когато“ at a clip start and wrote „лимфният“. So only the media between the clips of one window is
  silent (5 ms ramps); the context before the first and after the last clip stays (read_segment's note: Whisper needs it).
- **Edge scraps.** A word the clip edge cuts and the "unheard" check flags is left out and listed, not shown. A clear word at
  the edge stays (the clip may start a few frames into a word, as with „Затова“).
- **English hints, not reranking.** Each line translated alone (beam 2) gives the words that belong to it; they add 2.0 of
  attention toward their line before the cut. Picking among the 4 best sentences by those words gave "and form" once but broke
  others ("It's | a chronic | disease of adipose tissue"), so the first sentence is always used. Word order the lines cannot
  follow stays for the editor.
- **English word fixes are client-wide at once** (like name lines, not like Bulgarian word fixes, which wait for 2 projects):
  they change only the English line, which the editor reads anyway, and typing the old word back takes one out.

## 2026-11-04: colour applies on the first click (0.9.99, reverses "preview first")
The user: the Apply buttons are not needed; a press should put the effect in and show before/after. The colour spec's "preview
first" came from the start of the project; the safety that matters stays: low confidence is never applied, a manual grade is
never touched, the frame check after writing takes back what made the picture worse, and one Undo takes the press back. Medium
confidence is applied too (the user chose no approval step at all); it is said per clip in Details. Match POVs the same; the
reference camera buttons now re-match at once.


## 2026-11-08: subtitle recognition stays on the CPU in int8 with beam 5
The user wants whichever is faster and more accurate. Measured on the same 143 s: float32 is slower and not better; the Apple GPU
through mlx-whisper is 12x faster but has no beam search and misreads clearly more (it turned the product word „гелче“ into
„дядче“ and invented lines). Speed is not bought with words, so int8 beam 5 stays. A GPU backend with beam search (whisper.cpp
Metal) is the one candidate left that could be both; measure it the same way before any change.

## 2026-11-08: Show exports watches the office's export tree, through file events only (0.10.7)
The user: exports were not shown, or up to ~30 s late. Premiere names the Export tab's folder only when it rewrites its
preferences, sometimes after the export, so a new plan folder was always late. Premiere's UXP export events exist but did not
fire for an ExtendScript export, so they cannot be relied on. The office always exports into Exported Videos/<client>/<plan>, so
a folder whose children held exports of 3 different clients is watched as a whole, counting only video files exactly two levels
deep (a compressed copy in a subfolder and sound files never count). It is never scanned: on the Mac, file events report only
this computer's writes, so a colleague's export on the shared drive cannot open Finder here; Windows gets no tree for that reason.
Rejected: scanning the whole tree (colleagues' exports), watching the whole Production drive (raw footage copied in would count),
asking the editor to add every plan folder.

## 2026-11-05: Show exports no longer watches the project's folder (0.10.5)
The user's answer of 2026-11-04 was to watch the project's folder automatically. In use it showed sound effects downloaded into
Assets as exports, and the office exports into Exported Videos, which Premiere's preferences name; so only that folder and the
added ones are watched.

## 2026-11-05: a covered clip measured on its file counts when nothing on the clip changes its colour (0.10.4)
The user wants Auto color to work in every situation. Measuring the file was marked "low" because a correction on the clip would
not show in it; when the clip carries none (only the fixed effects and an untouched or Asistent's own Lumetri), the file is exactly
what lies under the layer, so the measurement keeps its confidence and its values are written as absolute ones. Ownership of a
Lumetri follows the media file, not the piece: a cut must not turn Asistent's correction into "a hand grade". The rule that a hand
grade is never touched stays.

## 2026-11-05: Show exports finds the Export tab's folder in Premiere's preferences (0.10.3)
The office exports into Production/Exported Videos/<client>/<plan>, never next to the project, so watching the project's folder
alone (the plan) would miss every export. Premiere keeps the Export tab's last output file and folder in its preferences file;
the engine reads it (only when it changes) and watches that folder without its subfolders. Chosen over waiting for the UXP
export events (not probed: a client project was open) and over asking the editor to add folders. The events stay the plan for
Media Encoder and Quick Export.

## 2026-11-04: Exposure ±0.5 may move Exposure in the editor's own Lumetri (0.10.1, narrows "never touch a manual grade")
The user pressed +0.5 on a clip whose Lumetri they had set by hand and nothing happened. ±0.5 is the editor's own step, the same
as typing into the slider, so it now changes Exposure there too; nothing else in that Lumetri, never a keyframed Exposure, and
the Lumetri is not recorded as Asistent's, so the measuring buttons (Auto color, White balance, Exposure, Match POVs) still never
touch a hand grade. The user asked for ±0.5 only "for now".

## 2026-11-04: English words a Bulgarian speaker says are written in English (0.10.2)
The user asked for it („Бюти сектор“ = "Beauty Sector"). It is a writing rule (the same said word, another spelling), so it
fits the guide's rule that a word is never rewritten on a hunch. Precision before reach: only common English words (one
Whisper token), only the usual Cyrillic spelling of their sound, never a Bulgarian word or one with its ending swallowed
(„работ“), so Bulgarian loans spelled the Bulgarian way stay Cyrillic. Rejected: any word one letter from a Bulgarian word
(blocked „бюти“, „бранд“), a pronunciation model (download, slower), asking Whisper again in English (a 30 s window per word).

## 2026-11-04: subtitle speed changes keep the output identical (0.10.2)
Only changes that give the same subtitles were made (checked byte for byte on a cold ReShape run): running independent work at
the same time and more threads per reading (2, 4 and 8 threads read identical words). Splitting one long window into parallel
pieces or Whisper on the Apple GPU (MLX) would be faster still but change the words; they wait for the user's choice.

## 2026-11-10: protected subtitle files touched by the field-bug fixes (0.10.25), golden identical
`host/host.jsx` (`as_target`: the panel's project by path and the sequence by id, for captions, graphics and the L/R split),
`engine/asistent/hostbridge.py` and `panel/premiere-captions.js` (the sequence id passed to the host), and
`engine/asistent/subtitle_job.py` (`plan_windows` takes `max_window`, default unchanged; `window_audio` split out of
`read_window`, same audio and key) changed only how the sequence is found and how the rough cut may plan its windows. The
subtitle output is the same: `scripts/reshape_golden.py check` identical on 2026-11-10 (SRT, English SRT, job JSON; 76 s).
The guard also lists `subtitles.py`, changed earlier by the client styles (0.10.18-0.10.24), which leave the ReShape preset
as it was (same golden run).

## 2026-11-10: Keyframer curves are baked; Premiere's own modes are set natively (0.10.32)
Phase 0 (docs/probes/cockpit-phase0.md): UXP sets a keyframe's interpolation (Bezier, Linear, Hold) but not its bezier
handles. A custom curve is therefore written as one keyframe per sequence frame between the editor's two keyframes (media
time, speed taken into account); Premiere's own modes are set on the editor's keys and add nothing. Only keys Asistent added
(its record, re-checked on the clip) are ever removed, each in a quarter-frame window, so a key the editor adds in between
survives. A press above 3000 keys is refused.

## 2026-11-10: track names by an 80 % main folder; colours off by default; naming after Sync and rough cut on (0.10.34)
A camera is "one folder" as in the SYNC layout, but real sequences carry a stray file on a camera track and Fix audio's L/R
copies are new files in the camera's folder (NEW TEST, measured), so a track counts by the folder of at least 80 % of its
files and sound is matched by file, then folder. Only Premiere's default names and Asistent's own are changed: the editor's
names are never overwritten. A colour label exists only on the project item (no per-clip label in UXP or ExtendScript), so it
recolours the file everywhere: Keep unless the editor chooses one. Sync and rough cut make sequences that are Asistent's own,
so they are named right away; the hook in `main.js` is one guarded call after a successful build and never fails the build.

## 2026-11-10: the pre-export check measures per clip, says what it cannot see (0.10.35)
Premiere offers no script access to the mixed sound short of exporting it, so each clip is measured on its file in the range
it uses (true peak, 4x oversampled) plus the highest Volume it reaches. Only the channel a clip plays counts when Asistent
knows it (its own L / R copies by name, Fill effects); otherwise the louder channel decides, which can only over-warn. The
-6 dBFS rule applies to camera and microphone tracks (tracknames.js); other tracks are only flagged near 0 dBFS. Track
faders, Audio Gain and effects are not included and the panel says so. Safe areas: 9:16 keeps text off the apps' buttons and
caption (common to TikTok, Reels, Shorts), other frames title safe 90 %. Caption track positions and missing fonts are not
readable and are shown as "?", never as passed.

## 2026-11-10: colour learning keeps its records on this computer until EL0 is approved (0.10.36)
The user listed EL1 with "I need your OK for EL0 first" (office folders per client). Writing on the shared server was left
for an explicit yes; EL1 records locally in `<app>/learning/color/` so nothing is lost meanwhile. It runs on its own thread
(one export at a time), not in the job pool, so a long analysis after an export never delays Sync or subtitles. The report
compares with Auto color's file analysis (not the value the frame check kept) and only where Asistent was sure.

## 2026-11-11: Sync redoes Fix audio instead of copying the clips; no gap between recordings (0.10.38)
The SYNC sequence is built from whole files (a fixed sync point per recording), so edits on the clips cannot come with it.
Fix audio is deterministic for the same range, so Sync runs it again on the files that had Asistent's L / R copies, through
the button's own code; anything else the editor did to the clips (cuts, effects) still stays in the editor's sequence. The
2 s gap between recordings was the layout's own choice; the user does not want it, so recordings now follow directly.


## 2026-11-11: Stash clips keeps its sequences and never overwrites (0.10.50)
The user said "go" without choosing between deleting Asistent's temporary stash sequences and keeping them. Keeping is the
choice that needs no new exception to the rule "the host removes nothing without the user's approval of that deletion", so
the stash sequences (and what an import brings) stay in the bin "Asistent stash". A stash goes in only where its tracks are
free (moved to free tracks, tracks added on top): a clone with overwrite would cut or remove the editor's clips under it,
which is the same kind of removal.

## 2026-11-11: the tracker follows a placed box first, without smoothing, and writes no key where it is lost (0.10.51)
The plan had faces first; the user asked for After Effects style tracking of any object with text attached, so the placed
box came first (the face mode can reuse the same write path later). After Effects does not smooth a track, and a smoothed
path slides against the object, so the keys are the measured positions (they are within a tenth of a pixel on the
benchmark). A lost frame gets no key rather than a guessed one (Premiere moves straight across it, the strip shows it red).
The attached clip keeps its offset from the tracked point as After Effects' "apply to layer" does; Scale and Rotation are
off by default because a text that grows and turns with a hand-held object is rarely wanted.

## 2026-11-12: subtitle cuts follow the delivery; ReShape keeps the classic rules (0.10.61)
The user asked for captions cut as a subtitle editor would by the speaker's delivery, not by a word count, and for the last word
of a phrase never to wait for the next caption. Measured first on the editors' own chunks of 40 client videos: the leftovers
came from hard limits (the style's usual size, three words), so those became targets with a price and a lone leftover word got
a cost of its own. The editors' cuts are a check, not the goal: they end chunks on „за“, „да“, „че“ (their tool's habit) where
our rule never ends one, so nothing was tuned towards that. ReShape's preset is protected (the user, 2026-11-08) and the user
was asleep when this was built, so it stays on the classic rules; switching it is one key (`"delivery": True`) once the user
says so (its golden check will then differ). Word lengthening was measured and left out: it made the cuts worse on Whisper's
word times; pitch and loudness need the sound, which the job has but these 40 videos do not.

## 2026-11-12: Silences replaces the rough cut in the panel; no recognition (0.10.65)
The user asked to focus the rough cut on removing silences only, accurate and fast, with the multiple POVs in mind. Speech
recognition is what made the rough cut slow and is not needed to find silence, so the new mode listens to each microphone's
level against its own noise floor, with Silero only as a helper (it misses short loud words, so it may never remove a loud
stretch). Every microphone counts (the union), because grouping microphones that hear each other (the mix's rule for
subtitles) could cut a second speaker's quieter words. Margins favour keeping speech: a cut word is worse than a little air.

## 2026-11-14: Brand kits are folders; Asistent never rewrites brand.json and never deletes a kit (0.10.71)
- A kit is a folder found in a library, as a client folder, or as a `Brand Kit` folder above the project: the office keeps
  clients on the server, Content Studio keeps hand-made kits in `brand-kits/`, and both are read the same way, so no import
  step and no database. Files are sorted by folder words and type, so a server folder made by hand works without
  `brand.json`.
- `brand.json` is written by hand (the brand-kits project) and holds much more than Asistent shows: Asistent only reads it.
  The editor's changes go into `asistent-kit.json` next to it (hidden colours are hidden there, not removed from brand.json).
- Delete moves the kit into `_Deleted kits` in the same library (the permanent rule: nothing is removed without a specific
  approval); Forget only stops showing a client folder.
- Premiere is given the server's file while the server is reachable, never the local copy: an office project opened on
  another computer must not point at one computer's disk. The local copies are for when the server is away (the panel says
  "relink later") and for installing fonts.
- MOGRTs are placed for the brand kit (the user's spec lists them); the earlier "no MOGRTs" decisions were about subtitles.
- Placement goes above every clip it would overlap (a new track on top when none is free), never over or into the editor's
  clips, like Stash clips; the clipboard goes through the engine (`pbcopy` / `clip`) so the panel needs no new UXP permission.

## 2026-11-14: Keyframer updates live after Apply, one Undo step per update (0.10.72)
The user asked for changes to apply without pressing Apply again. Live starts only with a press of Apply on a clip (nothing is
written before the editor chose to shape that clip), stays on that clip only, waits 500 ms after the last change (a drag: until
it ends) so a run of presses is one update, and can be switched off. Every update is its own transaction, so Cmd+Z goes back
one update at a time; Undo last still takes out all of Asistent's keys on the clip.

## 2026-11-15: the tracker says unsure or lost rather than guess (0.10.76)
The user asked for small, blurry, low-detail and fast objects, and for uncertainty instead of inaccurate keyframes. The
tracker now prefers a lost frame (no key) to a sure frame it cannot back up: a match is sure only when it clearly beats every
other place (after weighing by the motion) and the background's own match on the boxed frame; blur-only or smeared matches,
fallbacks and ambiguous frames are at most unsure, and more than three of them in a row become lost; a lost frame reports the
last measured place, never a guessed path. The cost: fast, motion-blurred things show more orange frames, and a thing that
looks like its surroundings while moving faster than its own size a frame is mostly lost. Unsure frames still get keys, as
before. Tuning was checked on scenes the rules were not tuned on (the tests) before it was kept.

## 2026-11-15: Keyframer motion blur is an Asistent Transform that moves only inside each frame's shutter window (0.10.88)
The user asked for a motion blur switch and amount that follow the speed, for every effect, visible in Premiere. Premiere's
Motion has no motion blur. Measured in NEW TEST: Directional Blur (Legacy) is an exact Gaussian (sigma = 0.98 x Blur Length,
0° vertical) and could be keyed per frame, but only blurs straight moves (no scale or rotation blur). The Transform effect's
own blur (composition shutter off) averages 16 samples from just after the frame to the end of the window and honours keys
between frames, so a Transform at rest on every frame that, inside the window, carries Motion(t)^-1 · Motion(u) gives
Premiere's real blur for Position, Scale and Rotation without touching the editor's Motion keys. Moving the animation into a
Transform was rejected: it changes the editor's keys. Measured limits built in: Premiere draws Position's path between keys
as a curve (window ends pinned with a second key), setting the interpolation in the same step adds a key at media time 0
(new keys are Linear already, so it is not set), Scale keys past about 4x make Premiere blend every frame straight (such
frames stay sharp). Amount 0-100 % is the shutter angle 0-360°, capped at 346° (the window must end before the next frame).

## 2026-11-15: the tracker uses colour, but never picks an object up again on colour alone (0.10.77)
The user's basketball showed the grey template's limit: a plain object matches anything with the same shading (the dark
shorts were called sure). Colour now weighs every candidate and gates sure frames and jumps. A rule that picked the ball up
again after a loss from colour, grey and spot together over two frames followed the ball on many more frames, but scored
against hand-marked positions it put 7-11 keys in wrong places (court corners, the player's head), because in that clip the
ball, the shadowed court and the skin share one colour. Wrong keys are worse than red frames (the user's rule: say unsure or
lost rather than guess), so it was not kept. Tuning on the one clip was chaotic (a 1 % change of one threshold moved the result
a lot): settings were chosen for what they prevent, then checked on synthetic colour scenes over six seeds.

## 2026-11-15: Cut silences decides in regions the editor can turn around; Manual dB is the level alone (0.10.96)
- The engine measures once and decides per setting, so the preview is cheap and the cut is the preview (same code path, the
  editor's choices sent back as time ranges). Nothing unsure is cut: a voice within 2 dB above the off-mic line and takes that
  are not a plain repeat are kept and flagged.
- Manual dB uses no Silero and no main voice, in every mode: the brief's priority is that it is predictable. So "Silences
  only" keeps every voice in Automatic and AI-assisted, and in Manual the number decides.
- Minimum silence is the whole pause (AutoCut's meaning). The three old pacings keep their results under new numbers
  (1.3 / 0.87 / 0.65 s) instead of silently cutting more.
- Mute and "keep the spaces" are done in the NEW sequence by leaving the sound or the piece out: Asistent still never mutes
  a track or removes an item in the editor's sequence (permanent rules).
- Off-mic classification stays on loudness relative to each microphone's main voice + Silero: word confidence, spectral tilt
  and in-phrase dynamics were measured on the user's labels and did not separate them. pyannote not added.
- The default mode is Silences + off-mic (what 0.10.95 did by default and what the user asked for that morning).

## 2026-11-15: Cut silences is cut by the host in a duplicate; the host may remove clips THERE only (0.10.108)
- **Why:** the copies way crashed Premiere 26.5.3 inside its UXP layer on long selections (2 of 8 runs after every panel-side change, CHANGELOG 0.10.99-0.10.107); ExtendScript does not go through that layer.
- **Decision (the user, 2026-11-15: "Yes"):** the host duplicates the editor's sequence (`Sequence.clone()`), razors the duplicate, removes from it what is not a kept piece (`TrackItem.remove(false, false)`) and moves the pieces together. This is the one exception to "the host never removes anything": only in the sequence `as_rough_cut` start made, checked by id and name in every later phase, and the razor only runs when that sequence is the one in front. The editor's own sequence is never touched. `wiring.test.js` keeps every other host function free of `.remove(`.
- **Kept:** the copies way as a fallback without the host (at most 40 pieces). Removing track items through UXP stays forbidden.

## 2026-11-21: In & Out animations write to an Asistent-owned Transform, never to Motion (0.10.125, not built yet)
- **Why:** the plan (`docs/IN_OUT_PLAN.md`) recommended it and asked Phase 0 to confirm. Probes P1-P9 in NEW TEST
  (`docs/probes/inout-phase0.md`): the effect at rest leaves the picture bit-identical; it acts after Motion around the
  clip's visible centre and crops nothing at the layer's bounds; per-frame keys land exactly and Shutter Angle blurs them;
  Undo is per press, not per clip; the blur's Transform and ours never touched each other in either order; on a text
  graphic it works fully when inserted before the Graphic group. None of the four fallback triggers fired.
- **Decision:** one owned Transform (`AE.ADBE Geometry2`) per clip, recognised by a static tag in Skew Axis (Skew 0)
  plus the record `asistent.inout.v1`; the editor's Motion, Opacity and own Transform are never written. On a clip with a
  Graphic group it is inserted before the group. Key time of frame f: `inPt × |speed| + f × |speed| / fps`.
- **Not decided:** Strength on presets that cannot travel less. Not tested: a type-tool text clip.
- **Added in 0.10.127 (the user's go-ahead, 2026-11-21):** the two protective hooks: the Keyframer's `readSelection` skips
  the tagged Transform, and the blur's `addOwn` takes a Transform only when the count rose by exactly one and it is not
  tagged. Measured rule for a clip rotated with Motion: the Transform's Position runs along the clip's own rotated axes.

## 2026-11-21: In & Out curve editor and own presets: builder's choices, the user's look pending (0.10.136)
- **Why:** the Phase 5 plan (`docs/IN_OUT_PLAN.md`, approved 2026-11-21) asks for a page that edits a curve and keeps it as an own
  preset. The maths and the store rules were built in 0.10.135; 0.10.136 adds the page (`panel/inoutedit.js`).
- **Builder's choices, not asked of the user (the user's look pending):**
  - On an own preset the name box starts with that preset's name, and "Save as new" makes the name unique ("Snappy", "Snappy 2").
  - Reset on an own preset goes back to the built-in base curve.
  - Switching to a side with nothing picked closes the editor.
  - The stored choices read again (the engine coming back) clear unsaved edits only when something really changed, and never under a
    running Apply: that reload waits until the Apply has ended.
  - Save, Rename and Delete do nothing until the panel store has loaded from the engine ("Your presets are still loading. Try again in
    a moment."). This came from the rules-reviewer BLOCK: a save before the load would have written a list without the earlier presets.
- **Review:** the fixes made after the review (the store guard, the deferred reload, a press on the graph disarming Delete, the Save
  sentence) passed the reviewer's re-check. The reviewer judged the tile refill safe on reasoning and asks for a soak through the bridge first.
