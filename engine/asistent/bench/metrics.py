"""Scores of one recognition result against one human-verified reference (Bulgarian).

- WER and CER through jiwer, in the raw and the normalized view (`normalize.py`);
- the words that change meaning, counted on the reference side of the word alignment: numbers and prices, negations,
  names (capitalised words not starting a sentence, plus the reference's own name list); an error is a substitution or a
  deletion of such a word; an inserted negation (in the result, not in the reference) is counted apart, it flips meaning;
- omissions: deleted reference words, and runs of 3+ deleted words in a row (a dropped passage);
- word timing, when both sides have word times: start error of the words the alignment marks equal;
- correction effort: substitutions + deletions + insertions (the word edits an editor would make).
jiwer is imported here only (its own venv, requirements-bench.txt).
"""
from __future__ import annotations

import re
import statistics

from .normalize import raw_tokens, tokens

# the same set the take matcher protects (takes.NEGATIONS), Bulgarian only: a benchmark of Bulgarian speech
NEGATIONS = {"не", "ни", "нито", "без", "няма", "нямаше", "нямам", "нямаш", "нямат", "никак", "нищо", "никой", "никога", "никъде"}
_NUMBER_WORDS = {"нула", "едно", "един", "една", "две", "два", "три", "четири", "пет", "шест", "седем", "осем", "девет", "десет",
                 "сто", "двеста", "триста", "хиляда", "хиляди", "милион", "милиона", "половин", "процента", "лева", "лв", "евро",
                 "стотинки", "цента"}
_NUMBER_STEMS = ("надесет", "найсет", "десет", "йсет", "стотин")
_SENTENCE_END = re.compile(r"[.!?…]$")


def is_number(tok: str) -> bool:
    t = tok.lower()
    return any(ch.isdigit() for ch in t) or t in _NUMBER_WORDS or t.endswith(_NUMBER_STEMS)


def name_tokens(text: str, extra=()) -> set[str]:
    """Lower-case tokens of names in the reference: capitalised words that do not start a sentence, plus `extra`."""
    names = {t for n in extra for t in raw_tokens(n)}
    start = True
    for w in str(text).split():
        core = re.sub(r"^[\"„“«(]+|[\"»”)\.,!?…:;]+$", "", w)
        if core and core[0].isupper() and not start and not core.isupper():
            names.update(raw_tokens(core))
        start = bool(_SENTENCE_END.search(w))
    return names


def _ops(ref: list[str], hyp: list[str]):
    """-> (jiwer word output, [(op, ref_index | None, hyp_index | None)]) for one pair of token lists."""
    import jiwer

    out = jiwer.process_words(" ".join(ref) or "<empty>", " ".join(hyp) or "<empty>")
    ops = []
    for ch in out.alignments[0]:
        if ch.type == "equal" or ch.type == "substitute":
            for k in range(ch.ref_end_idx - ch.ref_start_idx):
                ops.append(("equal" if ch.type == "equal" else "sub", ch.ref_start_idx + k, ch.hyp_start_idx + k))
        elif ch.type == "delete":
            for k in range(ch.ref_start_idx, ch.ref_end_idx):
                ops.append(("del", k, None))
        elif ch.type == "insert":
            for k in range(ch.hyp_start_idx, ch.hyp_end_idx):
                ops.append(("ins", None, k))
    return out, ops


def _cer(ref: list[str], hyp: list[str]) -> float:
    import jiwer

    return float(jiwer.cer(" ".join(ref) or "<empty>", " ".join(hyp) or "<empty>"))


def _category(ops, ref, hyp, member) -> dict:
    total = sum(1 for t in ref if member(t))
    wrong = [ref[r] for op, r, _ in ops if op in ("sub", "del") and member(ref[r])]
    return {"in_reference": total, "errors": len(wrong), "examples": wrong[:8]}


def score(ref_text: str, hyp_text: str, ref_words=None, hyp_words=None, names=()) -> dict:
    """ref_text/hyp_text: whole texts. ref_words/hyp_words: optional [{word, start}] in the same order as the texts' raw
    tokens (used for timing only). names: extra names of the reference (manifest)."""
    result = {}
    for view in ("raw", "normalized"):
        ref, hyp = tokens(ref_text, view), tokens(hyp_text, view)
        out, ops = _ops(ref, hyp)
        result[view] = {"wer": round(float(out.wer), 4), "cer": round(_cer(ref, hyp), 4), "words": len(ref),
                        "substitutions": out.substitutions, "deletions": out.deletions, "insertions": out.insertions}
        if view == "normalized":
            dels = [r for op, r, _ in ops if op == "del"]
            runs, run = [], []
            for r in dels:
                if run and r == run[-1] + 1:
                    run.append(r)
                else:
                    if len(run) >= 3:
                        runs.append(run)
                    run = [r]
            if len(run) >= 3:
                runs.append(run)
            nm = name_tokens(ref_text, names)
            result["meaning"] = {
                "numbers": _category(ops, ref, hyp, is_number),
                "negations": _category(ops, ref, hyp, lambda t: t in NEGATIONS),
                "names": _category(ops, ref, hyp, lambda t: t in nm),
                "inserted_negations": [hyp[h] for op, r, h in ops if op in ("ins", "sub") and hyp[h] in NEGATIONS
                                       and (op == "ins" or ref[r] not in NEGATIONS)][:8],
            }
            result["omissions"] = {"deleted_words": len(dels), "dropped_passages": [" ".join(ref[k] for k in rr) for rr in runs][:8]}
            result["effort"] = {"word_edits": out.substitutions + out.deletions + out.insertions}
    if ref_words and hyp_words:
        result["timing"] = timing(ref_words, hyp_words)
    return result


def timing(ref_words, hyp_words) -> dict:
    """Start error (hyp - ref, seconds) of the words that match in the raw-token alignment."""
    ref = [raw_tokens(w["word"])[0] if raw_tokens(w["word"]) else "" for w in ref_words]
    hyp = [raw_tokens(w["word"])[0] if raw_tokens(w["word"]) else "" for w in hyp_words]
    _, ops = _ops(ref, hyp)
    errs = [hyp_words[h]["start"] - ref_words[r]["start"] for op, r, h in ops if op == "equal"]
    if not errs:
        return {"matched": 0}
    absd = sorted(abs(e) for e in errs)
    return {"matched": len(errs), "median_abs_s": round(statistics.median(absd), 3),
            "p90_abs_s": round(absd[min(len(absd) - 1, int(0.9 * len(absd)))], 3),
            "within_80ms": round(sum(1 for e in absd if e <= 0.08) / len(absd), 3),
            "mean_signed_s": round(statistics.fmean(errs), 3)}
