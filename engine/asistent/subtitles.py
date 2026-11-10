"""Subtitle text core: words with times -> caption lines per preset, frame-snapped, and the SRT writer.

Pure Python, no Premiere and no ASR here. Line breaking is copied from tools/autoedit/export.py (`caption_lines`):
numbers stay with their word or unit, function words never end a line, a pause ends a caption, spelling goes
through bgtext. Input times are sequence seconds, output times are whole frames of the sequence.
"""
import math
import re

from . import bgtext

PUNCT_END = re.compile(r"[.,?!…]$")
# A pause between two words longer than this ends the caption (seconds).
PAUSE_SPLIT = 0.35
# A caption stays on screen this long after its last word in a pause (seconds); inside continuous speech it stays until
# the next caption starts, so nothing flashes off for a moment and back.
TAIL_HOLD = 0.15
CONTINUOUS_GAP = 0.35      # a gap to the next caption up to this is bridged (no blink), a longer one is a pause
MIN_CLEAR = 0.2            # two captions never leave a blank screen shorter than this (it reads as a blink): the first stays
LEAD = 0.03                # a caption appears this long before its first word (about one frame: it reads as in sync)
CUT_SLACK = 0.1            # a word the aligner put this little before a cut still belongs to the clip after it
# Whisper word probability below this is reported to the review list; the SRT text itself is never marked.
LOW_P = 0.5

NUMBER_WORDS = {"едно", "един", "една", "две", "два", "три", "четири", "пет", "шест", "седем", "осем", "девет", "десет",
                "сто", "хиляда", "хиляди"}
# A line must not end in one of these: they belong to the word that follows. Words of one or two letters
# (в, с, и, а, е, да, не...) are handled by length in `_attach_function_words`.
FUNCTION_WORDS = {"във", "със", "или", "към", "при", "над", "под", "пред", "след", "като", "ако", "но", "че", "за", "на",
                  "от", "до", "по", "през", "без", "между", "около", "върху", "чрез", "срещу", "зад", "освен", "щом",
                  "докато", "защото", "когато", "ще"}
UNITS = {"евро", "€", "лева", "лв", "nm", "процента", "%", "кг", "km", "км", "hz", "херца", "секунди", "минути",
         "монитора", "градуса", "метра", "мм", "см", "ват", "w", "часа", "години", "дни", "долара", "$", "kg", "mm", "cm"}

# short: for 9:16, one line of at most 2 words; max_chars is the nominal size (what fits at the usual font size),
# soft_chars is the real limit (a longer pair is still allowed, a third word never is).
# standard: for 16:9, up to 2 lines of 42 characters.
PRESETS = {
    # phrases of 2-3 words chosen by `_group_phrases` (pauses, punctuation, grammar); never more than 3 words unless a
    # number phrase ("за 8 евро", "Формула 1") needs more, never more than 22 characters.
    "short": {"max_words": 3, "max_chars": 16, "soft_chars": 18, "lines": 1, "line_chars": 22,
              "min_s": 0.5, "max_s": 2.5, "phrases": True},
    "standard": {"max_words": None, "max_chars": 42, "soft_chars": 42, "lines": 2, "line_chars": 42,
                 "min_s": 1.0, "max_s": 6.0},
    # the ReShape client's own style (docs/SUBTITLE_STYLE.md, measured on 7 of its videos): 2-3 words, no punctuation, every
    # line 0.18 s before its first word (their lines fade in over ~4 frames and are fully there as the word starts); 25
    # characters is their longest line, so „Задържането на течности“ (23) stays one line
    "reshape": {"max_words": 3, "max_chars": 14, "soft_chars": 16, "lines": 1, "line_chars": 25,
                "min_s": 0.4, "max_s": 2.5, "phrases": True, "lead": 0.18, "bare": True},
    # the GStroy client's own style (docs/SUBTITLE_STYLES/GSTROY.md, measured on 9 of its exported videos, 395 lines):
    # 1-3 words, CAPITALS, no punctuation; a chunk longer than 12 characters is stacked on two lines with its last word
    # alone underneath (112 of 132 two-line chunks); every third chunk or so that last word is the green keyword;
    # the chunk appears with its first word (Asistent's usual 0.03 s lead, measured median 0.03-0.04 s). line_chars is the
    # whole chunk here: 18 gave the editors' own mean (2.21 words) and two-line share (41 %, theirs 40 %) on their speech
    "gstroy": {"max_words": 3, "max_chars": 12, "soft_chars": 13, "lines": 2, "line_chars": 18,
               "min_s": 0.35, "max_s": 2.5, "phrases": True, "bare": True, "upper": True, "stack": 12, "accent": 6, "drop_dashes": True,
               # the brand as the user writes it, also in capitals (2026-11-10); Whisper hears „G -Stroy“
               "names": {"gstroy": "GStroy", "g-stroy": "GStroy", "g -stroy": "GStroy", "g stroy": "GStroy", "джи строй": "GStroy",
                         "джистрой": "GStroy"}},
    # the Credissimo client's own style (docs/SUBTITLE_STYLES/CREDISSIMO.md, 9 exported videos, 674 chunks): the same look
    # as GStroy's, but its two lines are cut where they come out most even, and a red keyword on about one chunk in six,
    # often a money word; its chunks run longer (2.5 words, 11 % with 4): up to 4 words and 20 characters gave its editors'
    # mean (2.50 against 2.52) and two-line share (49 % against 48 %) on their own speech in all 9 videos; the chunk appears
    # with its first word like GStroy's (Asistent's usual 0.03 s lead)
    "credissimo": {"max_words": 4, "max_chars": 12, "soft_chars": 13, "lines": 2, "line_chars": 20,
                   "min_s": 0.35, "max_s": 2.5, "phrases": True, "bare": True, "upper": True, "stack": 12, "split": "even", "drop_dashes": True,
                   "accent": 9, "accent_near": 2,
                   "accent_words": r"^(пари|парите|парички|бюджет|кредит|заем|назаем|вноск|разход|доход|финанс|кредисимо|credissimo"
                                   r"|спестя|заплат|сметк|лихв|харч|буфер|евро$|лев$|лева$|левчета|карта$|картата$|цента$|стотинк"
                                   r"|дълг$|дълга$|дългове)",
                   "names": {"кредисимо": "CREDISSIMO", "credissimo": "CREDISSIMO", "кредисимото": "CREDISSIMO"}},
    # the ЕКОПАК client's own style (docs/SUBTITLE_STYLES/EKOPAK.md, 7 exported videos, 400 chunks): the same template again,
    # cut evenly like Credissimo's, a green keyword (#18CC6E) on about one chunk in four, often a recycling word; 17 characters
    # a chunk gave its editors' shape on their speech (2.25 words against 2.35, two-line 41 % against 42 %, breaks 65 %)
    "ekopak": {"max_words": 4, "max_chars": 12, "soft_chars": 13, "lines": 2, "line_chars": 17,
               "min_s": 0.35, "max_s": 2.5, "phrases": True, "bare": True, "upper": True, "stack": 12, "split": "even", "drop_dashes": True,
               "accent": 7, "accent_near": 2,
               "accent_words": r"^(боклук|отпад|контейнер|опаковк|рецикл|разделн|картон|пластмас|стъкл|хартия|хартии|метал|алумини"
                               r"|кутийк|бутилк|буркан|екопак|ecopack|сортир|платформ|сигнал|карта$|картата$)",
               "names": {"ecopack": "ЕКОПАК", "екопак": "ЕКОПАК"}},
    # the Beauty Sector client's own style (docs/SUBTITLE_STYLES/BEAUTY_SECTOR.md, 7 exported videos, 350 chunks): the template,
    # cut evenly (96 %), a coral keyword (#D45E58) on about one chunk in three, often the procedure or its result; brand and
    # product names in Latin capitals as its subtitles write them (Whisper: „Бюти Сектор“, „Double Gold“, „HiFull“)
    "beautysector": {"max_words": 4, "max_chars": 12, "soft_chars": 13, "lines": 2, "line_chars": 18,
                     "min_s": 0.35, "max_s": 2.5, "phrases": True, "bare": True, "upper": True, "stack": 12, "split": "even",
                     "drop_dashes": True, "accent": 6, "accent_near": 1,
                     "accent_words": r"^(кож|контур|лифтинг|процедур|резултат|колаген|стегн|отпусн|брадичк|тонус|еластичн|консултаци"
                                     r"|стимул|дефинир|очертан|тренировк|курс|операци|неинвазив|ултразвук|целулит|мазнин|обиколк"
                                     r"|тяло|лице|лицето|салон)",
                     "names": {"бюти сектор": "BEAUTY SECTOR", "beauty sector": "BEAUTY SECTOR",
                               "double gold": "DOUBLO GOLD", "doublo gold": "DOUBLO GOLD", "дабъл голд": "DOUBLO GOLD",
                               "hifu": "HIFU", "hifull": "HIFU", "hifo": "HIFU", "хайфу": "HIFU", "high flow": "HIFU",
                               "high flow lifting": "HIFU ЛИФТИНГ", "hifu lifting": "HIFU ЛИФТИНГ",
                               "bodysculpt": "BODY SCULPT", "body sculpt": "BODY SCULPT", "боди скълпт": "BODY SCULPT",
                               "smas": "SMAS", "смас": "SMAS", "dr vandev": "DOCTOR VANDEV", "доктор вандев": "DOCTOR VANDEV"}},
    # AULA (measured 2026-11-10, docs/SUBTITLE_STYLES/AULA.md): the same Submagic template; English product names in Latin
    # capitals with the Bulgarian article joined by a hyphen („IPHONE-А“), the brand AULA.BG.
    "aula": {"max_words": 4, "max_chars": 12, "soft_chars": 13, "lines": 2, "line_chars": 17,
             "min_s": 0.35, "max_s": 2.5, "phrases": True, "bare": True, "upper": True, "stack": 12, "split": "even",
             "drop_dashes": True, "join_articles": True, "accent": 7, "accent_near": 1,
             "accent_words": r"^(компютър|функци|файл|текст|известие|настройк|иконк|батери|папк|телефон|снимк|данни|качеств"
                             r"|кабел|технологи|алгоритъм|детектор|сигурност|парол|плъгин|хакер|сайт|трафик|уязвим|меню|бутон"
                             r"|прозор|колон|версия|систем|апликаци|трик|гадже|доверие|знани|стъпк|защит|блокир|разпозна"
                             r"|отпечатък|следа|мрежи|автоматич)",
             "names": {"aula": "AULA", "аула": "AULA", "aula .bg": "AULA.BG", "aula .bgm": "AULA.BG", "aulabg": "AULA.BG",
                       "aula.bg": "AULA.BG", "aol .bg": "AULA.BG", "аула бг": "AULA.BG", "яло абг": "AULA.BG",
                       "sunbox": "SANDBOX", "сандбокс": "SANDBOX", "gta 6": "GTA VI",
                       "айфон": "IPHONE", "айфона": "IPHONE-А", "айфонът": "IPHONE-ЪТ"}},
}

# NTSC rates arrive as 23.976 / 29.97 / 59.94; the sequence really runs at N*1000/1001.
_NTSC = (24000 / 1001.0, 30000 / 1001.0, 60000 / 1001.0, 120000 / 1001.0)


def preset_for(width, height):
    """9:16 and square sequences get "short", landscape gets "standard"; an unknown size gets "short"."""
    try:
        w, h = float(width), float(height)
    except (TypeError, ValueError):
        return "short"
    if w <= 0 or h <= 0:
        return "short"
    return "standard" if w > h else "short"


def exact_fps(fps):
    """The real frame rate for a rounded NTSC value; any other rate is returned as is."""
    fps = float(fps)
    for r in _NTSC:
        if abs(fps - r) < 0.01:
            return r
    return fps


def initial_prompt(terms):
    """Names and terms the user listed -> the Whisper prompt string ("A, B, C."). Empty list -> empty string."""
    if isinstance(terms, str):
        terms = [terms]
    seen, out = set(), []
    for t in terms or []:
        t = str(t).strip().rstrip(",;").strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return ", ".join(out) + "." if out else ""


def _clean_words(words):
    """Whisper words -> plain dicts: stripped text, end >= start, p defaults to 1.0, in time order."""
    out = []
    for w in words or []:
        text = str(w.get("word", "")).strip()
        if not text:
            continue
        start = float(w["start"])
        end = max(float(w.get("end", start)), start)
        p = w.get("p")
        out.append({"word": text, "start": start, "end": end, "p": 1.0 if p is None else float(p)})
    out.sort(key=lambda w: w["start"])
    return out


_SENTENCE_END = re.compile(r"[.!?…]+[\"»“)]*$")
_CLAUSE_OPEN = {"ако", "щом", "когато", "докато"}
_CLITICS = {"го", "я", "ги", "ме", "те", "ни", "ви", "му", "й", "им", "ще"}
_BINDERS = {"не", "да", "ще", "си", "се", "ли", "и", "но", "а", "ни", "ви", "ме", "те", "го", "я", "ги"}


def tidy_words(words):
    """Words (Whisper's, sequence seconds) -> (words, {"joined": n, "commas": [word, ...]}). No word is added or removed.

    1. Punctuation Whisper put in a token of its own (",79," after "5"; ","), and the decimal part of a number, are
       attached to the word before: "5 ,79," becomes "5,79,".
    2. A conditional clause ("Ако …", "Щом …", "Когато …", "Докато …") is closed by a comma before the main clause. When
       Whisper wrote none, one is added before the first object pronoun or "ще" that comes after at least three words
       and is followed by at most four, unless the word before it is a particle that binds to it ("не го", "да го").
       There is often no pause to find it by (seen: "Ако е под 700 евро я взимаме": 0.04 s)."""
    out = []
    joined = 0
    for w in sorted(words, key=lambda w: (w["start"], w["end"])):
        text = str(w.get("word", "")).strip()
        glue = out and (re.fullmatch(r"[,.;:!?…]+", text) or (re.match(r"^[,.]\d", text) and re.search(r"\d$", out[-1]["word"])))
        if glue:
            prev = out[-1]
            prev["word"] += text
            prev["end"] = max(prev["end"], w["end"])
            prev["p"] = min(prev.get("p", 1.0), w.get("p", 1.0))
            joined += 1
        else:
            out.append(dict(w, word=text))
    commas = []
    i = 0
    while i < len(out):
        j = i
        while j < len(out) and not _SENTENCE_END.search(out[j]["word"]):
            j += 1
        sent = out[i:j + 1]
        if len(sent) >= 5 and _norm_token(sent[0]["word"]) in _CLAUSE_OPEN and not any("," in x["word"] for x in sent):
            for k in range(3, len(sent) - 1):
                prev, cur = sent[k - 1], sent[k]
                if (_norm_token(cur["word"]) in _CLITICS and len(sent) - k <= 4 and _norm_token(prev["word"]) not in _BINDERS
                        and not re.search(r"[^\w]$", prev["word"], flags=re.UNICODE)):
                    prev["word"] += ","
                    commas.append(prev["word"])
                    break
        i = j + 1
    return out, {"joined": joined, "commas": commas}


def _norm_token(word):
    return re.sub(r"[^\w]", "", str(word).lower(), flags=re.UNICODE)


def _glued(w, nxt):
    # A number and the word next to it are read together: "Формула 1", "за 8 евро", "едно евро", "25 Nm".
    if PUNCT_END.search(w["word"]):
        return False
    digit = lambda t: bool(re.search(r"\d", t))
    num = lambda t: digit(t) or t.lower().strip(".,?!") in NUMBER_WORDS
    # A digit goes with the word before it ("Формула 1", "за 8"), any number with the unit after it.
    return digit(nxt["word"]) or (num(w["word"]) and nxt["word"].lower().strip(".,?!") in UNITS)


def _units(words):
    """Words -> units that must stay on one line ("за 8 евро", "Формула 1")."""
    units = []
    for i, w in enumerate(words):
        if units and _glued(words[i - 1], w):
            units[-1].append(w)
        else:
            units.append([w])
    return units


def _attach_function_words(units):
    """A short or function word goes to the next unit, so it never ends a line. Back to front, so that
    chains ("или за състезателни") are caught too."""
    merged = []
    for u in reversed(units):
        t = u[0]["word"]
        short = len(re.sub(r"[.,…]+$", "", t)) <= 2 or t.lower() in FUNCTION_WORDS
        if merged and len(u) == 1 and short and not PUNCT_END.search(t):
            merged[0] = u + merged[0]
        else:
            merged.insert(0, u)
    return merged


def _text_len(words):
    return len(" ".join(w["word"] for w in words))


def _lines(units, cfg):
    """The units of one caption -> lines (lists of words). Two lines are split where they come out most even."""
    flat = [w for u in units for w in u]
    if cfg.get("stack"):
        return _stacked(units, cfg)
    if cfg["lines"] == 1 or len(units) == 1 or _text_len(flat) <= cfg["line_chars"]:
        return [flat]
    best = None
    for k in range(1, len(units)):
        a = [w for u in units[:k] for w in u]
        b = [w for u in units[k:] for w in u]
        la, lb = _text_len(a), _text_len(b)
        over = max(0, la - cfg["line_chars"]) + max(0, lb - cfg["line_chars"])
        score = (over, abs(la - lb))
        if best is None or score < best[0]:
            best = (score, [a, b])
    return best[1]


def _stacked(units, cfg):
    """A "stack" preset (GStroy): a chunk up to `stack` characters is one line; a longer one is two lines, the last unit (a
    word, or a number with its unit: „48 волта“) alone underneath, the rest above it. Only when the top line would come out
    longer than `line_chars` / 2 + 4 (a rare 4-word chunk) are the two lines split where they are most even instead.
    With "split": "even" (Credissimo) every two-line chunk is cut where the two lines come out most even (90 % of that client's
    two-line chunks; its editors put one word alone below in only 66 %)."""
    flat = [w for u in units for w in u]
    if len(units) == 1 or _text_len(flat) <= cfg["stack"]:
        return [flat]
    if cfg.get("split") == "even":                             # Credissimo: the most even cut, a tie gives the longer top line
        lone = lambda part: len(part) == 1 and len(_word_core(part[0]).strip("„“\"«(")) <= 1   # „С“ alone on a line
        cuts = [k for k in range(1, len(units))
                if not lone([w for u in units[:k] for w in u]) and not lone([w for u in units[k:] for w in u])]
        if not cuts:                                           # „С DOUBLO GOLD“ stays one line, as the editors wrote it
            return [flat]
        k = min(cuts, key=lambda k: (abs(_text_len([w for u in units[:k] for w in u])
                                         - _text_len([w for u in units[k:] for w in u])), -k))
        return [[w for u in units[:k] for w in u], [w for u in units[k:] for w in u]]
    cut = len(units) - 1
    if _word_core(units[-1][-1]) in NON_FINAL:                 # „осветителят / се“: a little word never stands alone below
        cut -= 1
    if cut < 1:
        return [flat]
    top, bottom = [w for u in units[:cut] for w in u], [w for u in units[cut:] for w in u]
    if _text_len(top) <= cfg["line_chars"] // 2 + 4:
        return [top, bottom]
    best = None
    for k in range(1, len(units)):
        a, b = [w for u in units[:k] for w in u], [w for u in units[k:] for w in u]
        if best is None or abs(_text_len(a) - _text_len(b)) < best[0]:
            best = (abs(_text_len(a) - _text_len(b)), [a, b])
    return best[1]


def _accents(groups, cfg):
    """An "accent" preset (GStroy's green keyword): the indices of the chunks whose last word is suggested for the accent
    colour. The client's editors choose it by meaning; measured on its videos, the green word is the chunk's last word in
    80 of 86 one-word cases and the longest word in 74, on about every third chunk. Rule: a last word of at least
    `accent` letters that is not a function word, at least as long as the previous chunk's last word and longer than the
    next one's, and never two chunks in a row. It agrees with the editors on 43 % of its picks (chance: about 30 %): a
    suggestion for the editor, who changes it in Premiere.
    `accent_near` widens the comparison to that many chunks on each side (Credissimo: 2, a red word on about one chunk in
    six); `accent_words` (a pattern) marks a last word whatever its length, still never two chunks in a row (Credissimo's
    money words: „пари“, „бюджет“, „вноска“)."""
    last = [_word_core(g[-1][-1]) for g in groups]
    near = cfg.get("accent_near", 1)
    words = re.compile(cfg["accent_words"]) if cfg.get("accent_words") else None
    out, prev = [], -2
    for i, w in enumerate(last):
        if i - prev < 2:
            continue
        if not (words and words.match(w)):
            if len(w) < cfg["accent"] or w in NON_FINAL:
                continue
            if any(len(x) > len(w) for x in last[max(0, i - near):i]) or any(len(x) >= len(w) for x in last[i + 1:i + 1 + near]):
                continue
        out.append(i)
        prev = i
    return out


def _fits(units, cfg):
    flat = [w for u in units for w in u]
    if cfg["max_words"] is not None and len(flat) > cfg["max_words"]:
        return False
    # A caption longer on screen than the maximum would be cut off in the middle of speech.
    if flat[-1]["end"] - flat[0]["start"] > cfg["max_s"]:
        return False
    return all(_text_len(line) <= cfg["line_chars"] for line in _lines(units, cfg))


def _group(words, cfg):
    units = _attach_function_words(_units(words))
    groups, cur = [], []
    for k, u in enumerate(units):
        # A unit longer than the limit (a long number phrase) still goes out alone rather than being split.
        if cur and not _fits(cur + [u], cfg):
            groups.append(cur)
            cur = []
        cur = cur + [u]
        nxt = units[k + 1][0] if k + 1 < len(units) else None
        full = cfg["max_words"] is not None and sum(len(x) for x in cur) >= cfg["max_words"]
        if nxt is None or PUNCT_END.search(u[-1]["word"]) or nxt["start"] - u[-1]["end"] > PAUSE_SPLIT or full:
            groups.append(cur)
            cur = []
    return groups


# --- natural phrases (short preset) --------------------------------------------------------------------------
# Bulgarian short pronouns and particles lean on the verb next to them: a caption does not start with them
# (except after a sentence end) and a caption never ends on a preposition, conjunction or particle.
ENCLITIC = {"се", "си", "ми", "ти", "му", "ѝ", "ни", "ви", "им", "ме", "го", "ги", "ли", "бе"}
# never the last word of a caption: prepositions, conjunctions, particles, the verb „съм“ and the short pronouns
NON_FINAL = FUNCTION_WORDS | ENCLITIC | {"в", "с", "и", "а", "да", "не", "ще", "би", "е", "са", "съм", "сме", "сте", "бях", "беше",
                                        "щях", "ни", "ний", "нито", "ами", "защо", "дали", "щото", "преди", "върху", "из", "във",
                                        "ту", "един", "една", "едно", "някой", "някоя", "някои", "всеки", "всяка", "всички", "този", "тази", "тези",
                                        "мой", "моя", "моята", "твой", "твоя", "негов", "неговия", "нейния", "наш", "нашия", "ваш", "вашия",
                                        "такъв", "такава", "такива", "още", "само", "много"}
# a verb that takes „да“ stays with it: „може да изглежда“, „трябва да“
MODAL = {"мога", "можеш", "може", "можем", "можете", "могат", "трябва", "искам", "искаш", "иска", "искаме", "искат", "започва",
         "започват", "спре", "спрат", "успее", "успеят"}
# the verb „съм“ may end a line when the next line holds an adjective with its noun („Това е / хронично заболяване“),
# never before a participle („съм / направил“)
COPULA = {"е", "са", "съм", "сме", "сте"}
PHRASE_COST = {"base": 1.0, "one_word": 1.4, "three_words": 0.3, "four_words": 3.0, "four_words_function": 1.0,
               "over_soft": 0.3, "over_hard": 20.0, "ends_function": 40.0, "starts_enclitic": 1.2, "too_short": 1.5,
               "too_long": 4.0, "inner_sentence_end": 4.0, "inner_comma": 0.6, "inner_pause": 3.0, "ends_clitic": 1.0,
               "starts_li": 40.0, "splits_adjective": 4.0, "ends_copula": 2.0,
               "splits_modal": 3.0, "splits_name": 5.0}
# A short pronoun after a noun or a verb belongs to it and may end a caption („бюста ви“, „колегите ми“, „благодаря ви“),
# as may „ли“ („и прави ли“); after a function word it leans on the verb that follows („ще ви покажа“) and may not.
TRAILING = {"ли", "ми", "ти", "му", "ѝ", "ни", "ви", "им", "си", "ги", "го", "ме", "се"}


def _word_core(w):
    return re.sub(r"[.,?!…:;]+$", "", w["word"].lower())


def _can_end(u):
    return PUNCT_END.search(u[-1]["word"]) is not None or _word_core(u[-1]) not in NON_FINAL


def _ends_on_clitic(flat):
    """The caption ends on a short pronoun or „ли“ that belongs to the content word before it."""
    return len(flat) > 1 and _word_core(flat[-1]) in TRAILING and _word_core(flat[-2]) not in NON_FINAL \
        and not PUNCT_END.search(flat[-2]["word"])


def _break_cost(prev, nxt):
    """How good a place to cut between two words: 0 = best (sentence end or a real pause), higher = inside a phrase."""
    t = prev["word"]
    gap = nxt["start"] - prev["end"]
    cost = 0.0 if re.search(r"[.?!…]$", t) else 0.3 if t.endswith(",") else 1.4
    if gap >= PAUSE_SPLIT:
        cost = min(cost, 0.0)
    elif gap >= 0.2:
        cost = min(cost, 0.5)
    elif gap >= 0.12:
        cost = min(cost, 0.9)
    elif cost > 0:
        cost += 0.4                                            # no pause at all: one breath, one phrase
    if _word_core(nxt) in ENCLITIC and not re.search(r"[.?!…]$", t) and gap < PAUSE_SPLIT:
        cost += PHRASE_COST["starts_enclitic"]
    if _word_core(nxt) == "ли":                                # „ли“ always leans on the word before it
        cost += PHRASE_COST["starts_li"]
    if gap < PAUSE_SPLIT and _bond(t, nxt["word"]):           # „хронично / заболяване“: an adjective stays with its noun
        cost += PHRASE_COST["splits_adjective"]
    if gap < PAUSE_SPLIT and _word_core(prev) in MODAL and _word_core(nxt) == "да":
        cost += PHRASE_COST["splits_modal"]
    if prev.get("english") and nxt.get("english") and not re.search(r"[.,?!…]$", t):   # „Beauty / Sector“: one name
        cost += PHRASE_COST["splits_name"]
    return cost


_bonds: dict = {}


def _bond(a, b):
    if (a, b) not in _bonds:
        from . import agreement
        _bonds[(a, b)] = agreement.bond(a, b)
    return _bonds[(a, b)]


def _phrase_cost(units, cfg, forced_edges, after=()):
    """Cost of showing these units as one caption (lower is better). after: the next two words, if any."""
    c = PHRASE_COST
    flat = [w for u in units for w in u]
    n = len(flat)
    chars = _text_len(flat)
    glued = any(len(u) > 1 for u in units)
    little = sum(1 for w in flat if _word_core(w) in NON_FINAL)    # function words add no weight to a phrase
    if n > cfg["max_words"] + 1 or (n == cfg["max_words"] + 1 and not glued and little < 2) \
            or (chars > cfg["line_chars"] and len(units) > 1):
        return None                                            # not allowed
    cost = c["base"]
    cost += c["one_word"] * (0.3 if forced_edges else 1.0) if n == 1 else 0.0
    cost += c["three_words"] if n == 3 else (c["four_words_function"] if little >= 2 or glued else c["four_words"]) if n == 4 else 0.0
    for a, b in zip(flat, flat[1:]):                           # a caption is one phrase: no sentence end, pause or comma inside
        if re.search(r"[.?!…]$", a["word"]):
            cost += c["inner_sentence_end"]
        elif b["start"] - a["end"] >= PAUSE_SPLIT:
            cost += c["inner_pause"]
        elif a["word"].endswith(","):
            cost += c["inner_comma"]
    cost += max(0, chars - cfg["soft_chars"]) * c["over_soft"] + (c["over_hard"] if chars > cfg["line_chars"] else 0)
    speech = flat[-1]["end"] - flat[0]["start"]
    cost += c["too_short"] if speech < 0.35 and n > 1 else c["too_short"] + 1.0 if speech < 0.3 and n == 1 else 0.0
    cost += c["too_long"] if speech > cfg["max_s"] else 0.0
    if not _can_end(units[-1]):
        if _ends_on_clitic(flat):
            cost += c["ends_clitic"]
        elif _word_core(flat[-1]) in COPULA and len(after) == 2 and _bond(after[0]["word"], after[1]["word"]):
            cost += c["ends_copula"]
        else:
            cost += c["ends_function"]
    return cost


def _group_phrases(words, cfg):
    """Dynamic programming over the units (number phrases stay whole): the cheapest way to cut the speech into
    captions. Cuts prefer sentence ends and real pauses, never end on a function word, rarely start on a clitic, and
    keep 2-3 words together. Returns the groups as lists of units, like `_group`."""
    units = _units(words)
    n = len(units)
    best = [(0.0, -1)] + [(float("inf"), -1)] * n
    for j in range(1, n + 1):
        for i in range(max(0, j - 5), j):                      # at most 5 units in a caption (a glued unit counts as one)
            if best[i][0] == float("inf"):
                continue
            seg = units[i:j]
            before = i == 0 or re.search(r"[.?!…]$", units[i - 1][-1]["word"]) or units[i][0]["start"] - units[i - 1][-1]["end"] >= PAUSE_SPLIT
            after = j == n or re.search(r"[.?!…]$", units[j - 1][-1]["word"]) or units[j][0]["start"] - units[j - 1][-1]["end"] >= PAUSE_SPLIT
            nxt = [w for u in units[j:j + 2] for w in u][:2]
            c = _phrase_cost(seg, cfg, bool(before and after), nxt)
            if c is None:
                continue
            if i > 0:
                c += _break_cost(units[i - 1][-1], units[i][0])
            if best[i][0] + c < best[j][0]:
                best[j] = (best[i][0] + c, i)
    if best[n][0] == float("inf"):                             # cannot happen with 5-unit captions, but never fail
        return _group(words, cfg)
    groups, j = [], n
    while j > 0:
        i = best[j][1]
        groups.append(units[i:j])
        j = i
    return groups[::-1]


BARE = re.compile(r"^[„“\"«(]+|[.,?!…:;\"»“”)]+$")


def _shown(word, cfg):
    """A word as the caption shows it: a "bare" preset drops the punctuation around it (inside stays: „360-градусово“, „1,5“);
    an "upper" preset (GStroy) shows it in capitals; a preset's "names" write a client's name its way, however Whisper wrote it
    (Credissimo: „Кредисимо“ -> „CREDISSIMO“, the user's choice 2026-11-10: only how the said name is written)."""
    shown = BARE.sub("", word) or word if cfg.get("bare") else word
    names = cfg.get("names")
    if names:
        core = BARE.sub("", shown) or shown
        if core.lower() in names:                              # the name exactly as the client writes it, capitals or not
            return shown.replace(core, names[core.lower()])    # („GStroy“ stays GStroy in a capitals style, the user 2026-11-10)
    return shown.upper() if cfg.get("upper") else shown


def _join_names(words, cfg):
    """A client's name Whisper splits into several words („G -Stroy“) becomes one word, written as the preset's `names` says;
    its times run from the first piece to the last. Keys of `names` with a space are the split forms (lowercase)."""
    split = dict(sorted(((k, v) for k, v in (cfg.get("names") or {}).items() if " " in k), key=lambda kv: -len(kv[0].split())))
    if not split:
        return words
    core = lambda w: re.sub(r"[.,?!…:;]+$", "", w["word"]).lower()
    out, i = [], 0
    while i < len(words):
        for key, name in split.items():
            n = len(key.split())
            if " ".join(core(w) for w in words[i:i + n]) == key:
                last = words[i + n - 1]["word"]
                tail = last[len(re.sub(r"[.,?!…:;]+$", "", last)):]
                out.append(dict(words[i], word=name + tail, end=words[i + n - 1]["end"],
                                p=min(w.get("p", 1.0) for w in words[i:i + n])))
                i += n
                break
        else:
            out.append(words[i])
            i += 1
    return out


ARTICLE = re.compile(r"-(а|я|ът|ят|та|то|те|ти)[.,?!…:;]*")


def _join_articles(words, cfg):
    """A "join_articles" preset (AULA) writes an English name with its Bulgarian article joined by a hyphen, as its editors do
    („IPHONE-А“, „SANDBOX-А“); Whisper hears „iPhone -а“ as two words. Only after a word with Latin letters; the name part is
    written as the preset's `names` say („Sunbox -а“ -> „SANDBOX-А“). Times run from the name to the article."""
    names = cfg.get("names") or {}
    out = []
    for w in words:
        if out and ARTICLE.fullmatch(w["word"].lower()) and re.search(r"[A-Za-z]", out[-1]["word"]):
            prev = out[-1]
            base = re.sub(r"[.,?!…:;]+$", "", prev["word"])
            out[-1] = dict(prev, word=names.get(base.lower(), base) + w["word"], end=w["end"],
                           p=min(prev.get("p", 1.0), w.get("p", 1.0)))
        else:
            out.append(w)
    return out


def build_captions(words, preset="short", fps=25.0, cuts=()):
    """Words (sequence seconds, `p` optional) -> captions {"start", "end", "text", "words", "flags"}.

    cuts: sequence times where a clip starts (an edit). A caption never appears before the cut its first word comes after:
    the lead would show it over the end of the previous shot and take the previous line off early (the user, 2026-11-04).

    Spelling is fixed, lines follow the preset, every start/end is a whole frame at `fps`, the preset's
    min/max duration holds without overlapping the next caption, and no caption has zero length.
    A word with p < 0.5 adds {"word", "p", "at"} to `flags`; the text itself stays clean.
    """
    cfg = PRESETS[preset] if isinstance(preset, str) else preset
    fps = exact_fps(fps)
    words = _join_names(_clean_words(words), cfg)
    if cfg.get("drop_dashes"):                                 # the client template shows no punctuation, not even a lone „–“
        words = [w for w in words if not re.fullmatch(r"[–—-]+[.,]?", w["word"])]
    if cfg.get("join_articles"):
        words = _join_articles(words, cfg)
    if not words:
        return []
    # Spelling applies to the shown text only; the times stay as spoken.
    fixed = bgtext.fix_prepositions([w["word"] for w in words])
    words = [dict(w, word=t) for w, t in zip(words, fixed)]
    groups = _group_phrases(words, cfg) if cfg.get("phrases") else _group(words, cfg)

    frame = lambda t: int(math.floor(t * fps + 0.5))
    min_f = max(1, int(math.ceil(cfg["min_s"] * fps - 1e-9)))
    max_f = max(min_f, int(math.floor(cfg["max_s"] * fps + 1e-9)))
    # A caption appears about one frame before its first word, but never before the previous caption's speech ended;
    # a preset with its own lead (a client's style) starts that early whatever the previous caption is doing.
    lead = cfg.get("lead", LEAD)
    cuts = sorted(cuts)
    first = []
    for i, g in enumerate(groups):
        s = g[0][0]["start"]
        t = s - lead
        if i and "lead" not in cfg:
            t = max(t, groups[i - 1][-1][-1]["end"] if groups[i - 1][-1][-1]["end"] < s else t)
        edit = max((c for c in cuts if c <= s + CUT_SLACK), default=None)
        if edit is not None:
            t = max(t, edit)
        first.append(frame(max(t, 0.0)))
    # Starts strictly increase: two captions can never start on the same frame.
    for i in range(1, len(first)):
        first[i] = max(first[i], first[i - 1] + 1)

    accents = set(_accents(groups, cfg)) if cfg.get("accent") else set()
    captions = []
    for i, g in enumerate(groups):
        flat = [w for u in g for w in u]
        # in continuous speech the caption stays until the next one starts (no blink); in a pause it clears soon after
        nxt_start = groups[i + 1][0][0]["start"] if i + 1 < len(groups) else None
        if nxt_start is not None and nxt_start - flat[-1]["end"] <= CONTINUOUS_GAP:
            end = first[i + 1]
        else:
            end = frame(flat[-1]["end"] + TAIL_HOLD)
        end = min(max(end, first[i] + min_f), first[i] + max_f)
        if i + 1 < len(groups):
            if first[i + 1] - end < MIN_CLEAR * fps:             # a blank of a few frames between two captions is a blink
                end = min(first[i + 1], first[i] + max_f)
            end = min(end, first[i + 1])
        end = max(end, first[i] + 1)
        captions.append({
            "start": first[i] / fps,
            "end": end / fps,
            "text": "\n".join(" ".join(_shown(w["word"], cfg) for w in line) for line in _lines(g, cfg)),
            "words": [dict(w) for w in flat],
            "flags": [{"word": w["word"], "p": w["p"], "at": w["start"]} for w in flat if w["p"] < LOW_P],
        })
        if i in accents:                                       # the suggested keyword, as shown (its last word)
            captions[-1]["accent"] = _shown(flat[-1]["word"], cfg)
    return captions


def _srt_time(t):
    ms = max(0, int(math.floor(t * 1000 + 0.5)))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def write_srt(captions, path):
    """UTF-8 with BOM (the form Asistent verified in Premiere), \\n line endings, numbered from 1."""
    # The BOM is written by hand: the "utf-8-sig" codec writes nothing for an empty file.
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\ufeff")
        for n, c in enumerate(captions, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (n, _srt_time(c["start"]), _srt_time(c["end"]), c["text"]))
