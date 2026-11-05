"""Managed correction ownership: Asistent updates only a Lumetri exactly as it left it."""
from asistent.managed import KEEP, ManagedStore

SNAP = "0:Exposure=0.0000|1:Temperature=-4.9000|2:Tint=12.8000|3:Contrast=0.0000"


def test_only_the_exact_lumetri_asistent_wrote_is_its_own(tmp_path):
    s = ManagedStore(str(tmp_path / "managed.json"))
    key = "/media/fx39024.MP4|0.000|22.522"
    assert not s.owned(key, SNAP)                                    # nothing recorded yet: a grade
    s.record(key, SNAP, {"temperature": -4.9, "tint": 12.8})
    assert s.owned(key, SNAP)
    touched = SNAP.replace("Contrast=0.0000", "Contrast=12.0000")    # someone moved Contrast by hand
    assert not s.owned(key, touched)
    assert not s.owned("/media/other.MP4|0.000|5.000", SNAP)         # the same values on another clip


def test_a_cut_or_trimmed_piece_of_the_same_file_keeps_asistents_lumetri(tmp_path):
    s = ManagedStore(str(tmp_path / "managed.json"))
    s.record("/Volumes/Видео 7/кам2/fx31028.MP4|36.036|50.550", SNAP)            # Match POVs on the uncut clip
    assert s.owned("/Volumes/Видео 7/кам2/fx31028.MP4|42.100|50.550", SNAP)      # the right half after a cut
    assert s.owned("/Volumes/Production/X/кам2/fx31028.MP4|36.036|44.000", SNAP)  # the same drive under another path
    assert not s.owned("/Volumes/Видео 7/кам2/fx31028.MP4|42.100|50.550", SNAP.replace("Tint=12.8000", "Tint=13.0000"))
    assert not s.owned("/Volumes/Видео 7/кам2/fx31029.MP4|0.000|5.000", SNAP)    # another file: still a grade


def test_first_write_and_step_back_both_count(tmp_path):
    s = ManagedStore(str(tmp_path / "managed.json"))
    key = "k"
    first = SNAP.replace("Exposure=0.0000", "Exposure=0.6500")
    back = SNAP.replace("Exposure=0.0000", "Exposure=0.5000")
    s.record(key, first)
    s.record(key, back)
    assert s.owned(key, first) and s.owned(key, back)                # an Undo of the step back stays ours


def test_history_is_bounded_and_survives_a_restart(tmp_path):
    path = str(tmp_path / "managed.json")
    s = ManagedStore(path)
    snaps = [SNAP.replace("Exposure=0.0000", f"Exposure={i}.0000") for i in range(KEEP + 2)]
    for x in snaps:
        s.record("k", x)
    again = ManagedStore(path)
    assert again.owned("k", snaps[-1]) and not again.owned("k", snaps[0])


def test_empty_key_or_snapshot_is_never_owned(tmp_path):
    s = ManagedStore(str(tmp_path / "managed.json"))
    assert not s.owned("", SNAP) and not s.owned("k", "")
