"""The panel's settings in the engine's app folder (panelstore.py): they survive a panel update."""
import pytest

from asistent import config, panelstore


def test_put_get_delete(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    assert panelstore.get_all() == {}
    panelstore.put("asistent.subtitleStyle", "reshape")
    panelstore.put("asistent.englishFixed./p/A.prproj", '{"Защо": "Why"}')
    assert panelstore.get_all() == {"asistent.subtitleStyle": "reshape", "asistent.englishFixed./p/A.prproj": '{"Защо": "Why"}'}
    panelstore.put("asistent.subtitleStyle", None)
    assert list(panelstore.get_all()) == ["asistent.englishFixed./p/A.prproj"]


def test_only_the_panels_own_keys(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    for bad in ("other", "", 5):
        with pytest.raises(ValueError):
            panelstore.put(bad, "x")
    with pytest.raises(ValueError):
        panelstore.put("asistent.x", "y" * (panelstore.MAX_VALUE + 1))
