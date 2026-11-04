# Bulgarian Speech-to-Text & Subtitle Quality Guide

**Project:** Asistent (Adobe Premiere Pro extension)  
**Purpose:** Reference for Claude Code and the subtitle pipeline when transcribing, proofreading, aligning and segmenting spoken Bulgarian.  
**Priority:** Faithfulness to the audio > linguistic plausibility > polished written style.

> **Critical limitation:** This guide is not an acoustic model. Reading it does not teach Whisper to hear phonemes better or guarantee correct timestamps. Apply it to context prompting, evidence-based transcript review, error detection, subtitle grouping, and testing. Verify disputed words with the original audio; align only after the transcript is corrected.

## 1. Core transcription policy

1. Transcribe **what the person actually says**, not what they probably intended to say. Do not invent, omit, reorder or paraphrase words merely to make a sentence grammatical.
2. Preserve colloquial Bulgarian, repetitions and meaningful fillers unless a separate, explicitly selected *clean-read* mode requests their removal. Default to **verbatim**.
3. Bulgarian is a **Cyrillic** language. Use standard Bulgarian spelling for recognizable words and consistent spelling for proper names and brands.
4. Split the tasks: **ASR -> uncertain-span review -> text correction -> word alignment -> phrase grouping -> SRT export -> Premiere import**. Do not silently merge a text change with unchanged old timestamps.
5. If audio is unclear, mark the segment for review instead of inventing a plausible phrase. Maintain a record of uncertainty with timecode and evidence.
6. The initial and final seconds of every file and each chunk boundary require explicit checking; these locations often lose short words.

## 2. Bulgarian grammatical gender (род)

Bulgarian has three grammatical genders: **masculine, feminine, neuter**, but speaker gender is **not the same as grammatical gender of every noun or adjective**. First-person past participles and some predicate adjectives agree with the **speaker** when they refer to the speaker; other words agree with their own noun or subject.

### 2.1 First-person past tense with `съм` or omitted auxiliary

| Speaker | Typical spoken form | Example |
|---|---|---|
| Male | -л | „Аз съм **направил** това.“ / „**Казал** съм му.“ |
| Female | -ла | „Аз съм **направила** това.“ / „**Казала** съм му.“ |
| Neuter grammatical agreement | -ло | „Детето е **направило** това.“ |
| Plural | -ли | „Ние сме **направили** това.“ |

More pairs: **ходил/ходила**, **искал/искала**, **видял/видяла**, **бил/била**, **купил/купила**, **отишъл/отишла**.

**Important:** Do not blindly change *-ла* to *-л*: „Тя каза, че е **направила** това“ remains feminine even if the narrator is male. In „Купих **лампа**“ the noun *лампа* stays feminine regardless of the speaker. If the speaker quotes somebody else, retain the quoted form.

### 2.2 Predicative adjectives

- Male speaking about himself: „Аз съм **готов**“, „Бях **доволен**“, „Бях **уморен**“.
- Female speaking about herself: „Аз съм **готова**“, „Бях **доволна**“, „Бях **уморена**“.
- A male can correctly say „Тази стая е **готова**“ because *стая* is feminine.

### 2.3 Safe gender-aware correction

- Provide **Male / Female / Auto / Unknown** metadata per speaker, **not** one global conversion for all speakers.
- Use speaker metadata to resolve *acoustically ambiguous* first-person endings and predicate adjectives only when grammar and context support the choice.
- Keep the actually audible gender form if it clearly contradicts metadata; flag for review rather than falsifying the transcript.
- For speaker changes, dialogue, quotes or reported speech, track who each adjective/participle refers to.
- Avoid inferring a person's gender from their voice alone; set metadata only when supplied or reliably established in project context.

## 3. Verb forms, person and number

- Singular and plural matter: „**взимам**“, „**взима**“, „**взимаме**“, „**взимат**“ are different forms. Do not change „го взима“ to „го взимаме“ without checking what was said.
- Distinguish „**ще чака**“ (he/she will wait) from „**чакай**“ (imperative); „**ще чакай**“ is suspicious and should trigger audio review, not an invented correction.
- In first-person past simple, forms such as „**купих**“, „**боядисах**“ usually do **not** mark the speaker's gender. Do not impose gender where the form has none.
- Watch negatives and short grammatical words: **не, ли, се, си, съм, е, да, ще, го, я, ми, ти**. Losing one can reverse meaning or change the sentence.

## 4. Bulgarian articles, nouns and agreement

- Bulgarian definite articles are **suffixes**: *стена -> стената*, *одеяло -> одеялото*, *човек -> човекът/човека* (full vs short article based on syntax in formal writing).
- Male full/short definite forms in edited standard Bulgarian: „**Човекът** дойде“ (subject) vs „Видях **човека**“ (object). In subtitles, do not add an inaudible article simply because it would be grammatically preferred.
- Adjectives agree with the relevant noun: „**нова стена**“, „**ново одеяло**“, „**нов рафт**“, „**нови рафтове**“.
- Distinguish **одеяло** (not *одяло* in standard spelling), **одеялце** (diminutive), **рафт** (not *раф* if the word is *рафт*).
- Treat suffixes carefully. Conversational reductions in pronunciation do not always change the standard written form, but lexical identity must be confirmed from audio.

## 5. Numbers, prices and dates

Whisper may confuse numbers and dates, especially in rapid speech. Review every surprising calendar word inside shopping/price context.

- „**две и седемдесет**“ may refer to a price, but never guess whether it means **2,70**, **2,79** or another value without audio/context.
- „**пет и седемдесет и девет**“ may be formatted **5,79** only after confirmation.
- Use Bulgarian decimal comma: **5,79**, not **5 ,79**.
- Do not silently turn „**септември**“ into a price. Mark it as suspicious and re-listen to the original audio.
- Preserve amounts, units, negatives and comparisons precisely (e.g., **15** vs **50**, **два** vs **двайсет**).
- Choose consistent subtitle style for spoken numbers (words or digits), but do not alter meaning.

## 6. Punctuation and spoken Bulgarian

- Use **. ? ! ,** minimally, based on meaning and actual clauses. Do not put a comma solely because of a breath.
- A pause does not always mean the sentence ended; a sentence boundary does not always coincide with silence.
- Keep short parentheticals and discourse markers natural: „Ами“, „нали“, „значи“, „примерно“, „общо взето“.
- Preserve genuine spoken disfluencies in verbatim mode; optional clean-read mode may remove redundant fillers **only after explicit user approval**.
- Do not place a comma automatically after „А уж“ or „Примерно на мен“: evaluate the full sentence.
- Start of a caption does not automatically require uppercase when the phrase continues; choose a consistent house style.

## 7. Acoustic uncertainties and likely failure cases

Look for:

- Soft word starts and ends (first/last seconds of the recording), clipped consonants, overlaps between speakers.
- VAD deleting low-volume syllables or leading/trailing speech.
- Chunk boundaries dropping or duplicating words, incorrect offset accumulation.
- Homophones and reduced endings in fast colloquial Bulgarian.
- Background music, reverb, noise, multiple voices, microphone imbalance.
- Hallucinated words during quiet intervals.
- Contextually absurd outputs (e.g., „десом“ or a month name in a price) which merit audio review rather than automatic substitution.

**Audio pipeline checks:** record sample rate and channel handling; preserve original time origin; inspect stereo channel selection; avoid destructive denoising; check original file duration vs extracted audio; handle chunks with overlap and reconcile duplicates; do not cut at word boundaries; preserve true timeline offset for clips taken from a Premiere sequence.

## 8. Accurate word-level subtitle timing

1. Obtain the **correct transcript** (human-verified when necessary).
2. Use an alignment method that **actually supports Bulgarian**; verify the model and its license/installation. Do not assume WhisperX provides Bulgarian alignment out of the box.
3. Check every word's start and end against audio, especially short particles, pauses, clip starts/ends, and speaker overlaps.
4. Convert time references correctly: file-relative time vs source in/out vs active sequence time. Account for clip speed changes, cuts, sample rate and frame rate when relevant.
5. Never retain timestamps blindly after replacing a word or restoring a missing phrase; realign affected spans.
6. Enforce nonnegative, monotonically ordered intervals and a positive duration. Avoid unintended overlaps on a single caption track.
7. SRT uses `HH:MM:SS,mmm --> HH:MM:SS,mmm` and UTF-8 encoding.

**Do not treat syntactically valid SRT as proof of sync accuracy.** Alignment must be checked against sound.

## 9. Natural subtitle grouping (2–3 words preferred, not mandatory)

The goal is easy reading in sync with natural phrase delivery, **not** a rigid per-caption word count.

- Prefer 2–3 words when they form a coherent unit; permit 1 or 4+ when meaning or rhythm demands it.
- Do not split *article/adjective + noun*: „**само една стена**“ is a natural group.
- Keep clitics and their verb together whenever practical: „**ще я боядисам**“, „**трябваше да боядисам**“.
- Prefer breaks at strong pauses, clause boundaries and changes of speaker; avoid isolated prepositions, particles and auxiliaries.
- For „**Само една стена трябваше да боядисам**“, possible grouping is:
  - „Само една стена“
  - „трябваше да боядисам“
  Exact grouping depends on actual speech, word alignment and edit style.
- Avoid strobing captions with extremely short display times; set minimum durations based on readability and avoid overlong lingering.
- Do not infer intonation reliably from text alone; use actual pauses/prosody when available and treat them as signals, not infallible boundaries.

## 10. Project-specific regression examples

These examples were identified from previous Asistent outputs. Only corrections explicitly confirmed by the user are ground truth; others require audio verification.

| Approx. timestamp | ASR output | Correct / status |
|---|---|---|
| 00:07.891 (older clip) | „раф“ | Probably „рафт“; verify audio |
| 00:18.969 (older clip) | „сума ти нища“ | Likely „сума ти неща“; verify audio |
| 00:22.506 (older clip) | „ще чакай“ | Suspicious; verify audio |
| 00:22.890 (older clip) | „да бъде десом“ | **User confirmed:** „само една стена трябваше да боядисам“; recover and realign omitted words |
| 00:13.580 (newer clip) | „одяло“ | Standard spelling: „одеяло“ |
| 00:18.051 (newer clip) | „одяло“ | Standard spelling: „одеяло“ |
| 00:20.320 (newer clip) | „септември“ | Suspicious in price context; verify audio |
| 00:25.192 (newer clip) | „одялоце“ | Likely „одеялце“; verify audio |
| 00:28.395 (newer clip) | „го взима“ | Could be correct; verify before changing |
| 00:30.430 (newer clip) | „одялоците“ | Suspicious; verify audio |
| 00:33.400 (newer clip) | „Взиваме го“ | Likely „Взимаме го“; verify audio |
| 00:41.842 (newer clip) | „5 ,79“ | Typography: „5,79“ |

Timestamps are **illustrative regression anchors**, not a universal mapping for every future SRT.

## 11. Engineering implementation checklist

- [ ] Make Bulgarian (`bg`) explicit for known Bulgarian recordings; compare model/settings against baseline.
- [ ] Save raw ASR segments, word timestamps and confidence-related diagnostics if provided by the selected model. Never pretend confidence scores exist when they do not.
- [ ] Keep `verbatim` transcript immutable and apply edits in a separate corrected layer, with a change log and reviewer notes.
- [ ] Allow speaker metadata: `male`, `female`, `auto/unknown` **per speaker**; use only for ambiguous agreement.
- [ ] Flag suspect spans: nonwords, ungrammatical agreement, suspicious numbers, missing boundaries, sudden time gaps, very low-duration words.
- [ ] Re-run recognition or review only suspect audio intervals, retaining surrounding context; avoid silent hallucination-prone text replacement.
- [ ] Re-align after edits with a Bulgarian-supported method. Test any Stable-ts/WhisperX solution against actual Bulgarian audio; don't assume an English aligner is valid.
- [ ] Segment from verified word timestamps, observing phrase cohesion, pause structure and readable durations.
- [ ] Support SRT export + direct Premiere import/caption-track placement. Prevent duplicates on regeneration; maintain correct sequence offsets.
- [ ] Compare WER/CER (against human reference), word timing error, omitted first/last words, gender-form errors and natural segmentation on beginning/middle/end samples.
- [ ] Regression-test the examples above; distinguish confirmed errors from suspected ones.
- [ ] Preserve existing code behavior until improvement is measured. Commit tested changes; request approval before GitHub push.

## 12a. Writing rules and learned fixes (Asistent 0.9.95, the user's decision 2026-11-04)

- Writing rules (`bgnorm.py`) change only how a word that was said is written: „не“ apart from the verb, „по-“ and „най-“
  joined, the full or short article of a masculine word by its place (after a preposition short; the subject before
  „е/не/ще…“ and after „това е“ full). They never add, drop or exchange a word, and never touch the editor's own fixes.
- Learned fixes (`learning.py`) are the editors' own corrections from earlier projects of the same client. One is used only
  with enough confirmations, between the words it was fixed between when it is a single dictionary word, and when Whisper
  does not find it clearly worse than the heard words for that sound (`audiocheck.py`). An editor typing the original back
  undoes it for everyone.

## 12. Instructions for Claude Code

Read this guide before changing the subtitle pipeline. Audit current code and identify where Bulgarian text corrections happen relative to forced alignment. Propose small, testable changes. Never fix the specific examples by hardcoding their replacement into general subtitles. Use the examples as regression tests, and benchmark changes on the **same** original audio. Report what was verified, what remains uncertain, and what was not tested. If a setting or a dependency is undocumented, do not claim it is in use.
