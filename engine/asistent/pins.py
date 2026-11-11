"""Fixed versions of what Asistent downloads by itself (0.10.6, SEC-002): the model repositories at one commit, and the
SHA-256 of every file, checked after a download. The values are those of the files in use on the development Mac
(2026-11-08); a new model version is a deliberate change here, never something a download picks up on its own."""
from __future__ import annotations

import hashlib
import os

WHISPER_REVISION = "edaa852ec7e145841d8ffdb056a99866b5f0a478"       # Systran/faster-whisper-large-v3
WHISPER_SHA256 = {
    "config.json": "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9",
    "preprocessor_config.json": "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
    "tokenizer.json": "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca",
    "vocabulary.json": "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1",
    "model.bin": "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1",
}
TURBO_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"          # mobiuslabsgmbh/faster-whisper-large-v3-turbo (0.10.40)
TURBO_SHA256 = {
    "config.json": "b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e",
    "preprocessor_config.json": "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
    "tokenizer.json": "297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd",
    "vocabulary.json": "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1",
    "model.bin": "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da",
}
NLLB_REVISION = "30c36268408177b0fce2bfcfa205d877accd327d"          # JustFrederik/nllb-200-distilled-1.3B-ct2-int8
NLLB_SHA256 = {
    "config.json": "0c2f6fa2057c7264d052fb4a62ba3476eeae70487acddfa8e779a53a00cbf44c",
    "model.bin": "72d7533dc7a0e8f10f19a650d4e90faf9cbfa899db5411ad124bd5802bd91263",
    "sentencepiece.bpe.model": "14bb8dfb35c0ffdea7bc01e56cea38b9e3d5efcdcb9c251d6b40538e1aab555a",
    "shared_vocabulary.txt": "a132a83330f45514c2476eb81d1d69b3c41762264d16ce0a7ea982e5d6c728e5",
}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(folder: str, hashes: dict) -> list[str]:
    """-> the files in `folder` that are missing or differ from their pinned SHA-256 (empty: all as pinned). A file that
    differs is renamed to "<name>.bad", so the next download fetches it again instead of trusting it."""
    bad = []
    for name, want in hashes.items():
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            bad.append(name)
        elif sha256(path) != want:
            os.replace(path, path + ".bad")
            bad.append(name)
    return bad
