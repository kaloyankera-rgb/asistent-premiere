"""install.install_panel (fixed 2026-11-08): Adobe must list exactly the new panel version. Installing over the old panel left
older copies enabled and Premiere loaded the first one. A fake Adobe installer stands in for UnifiedPluginInstallerAgent."""
import os

import pytest

from asistent import install


class FakeAgent:
    """Mimics UnifiedPluginInstallerAgent: --install appends a version, --remove drops the first listed, --list prints them."""

    def __init__(self, listed, keeps_old=True, fail_relative=True, fail_installs=0, fail_on=()):
        self.listed, self.keeps_old, self.fail_relative, self.fail_installs, self.calls = list(listed), keeps_old, fail_relative, fail_installs, []
        self.fail_on, self.installs = set(fail_on), 0       # fail_on: which install calls fail (1 = the first)

    def __call__(self, cmd, **kw):
        flag, arg = cmd[1], cmd[2] if len(cmd) > 2 else None
        self.calls.append((flag, arg))
        out = ""
        if flag == "--install":
            self.installs += 1
            if self.installs in self.fail_on:
                out = "Failed to install"
            elif self.fail_relative and not os.path.isabs(arg):
                out = "Failed to install, status = -160!"
            elif self.fail_installs:
                self.fail_installs -= 1
                out = "Failed to install"
            else:
                ver = os.path.basename(arg).split("-")[1].rsplit(".", 1)[0]
                if not self.keeps_old:
                    self.listed = []
                self.listed.append(ver)
        elif flag == "--remove" and self.listed:
            self.listed.pop(0)
        elif flag == "--list":
            out = "\n".join(f" Enabled    Asistent    {v}" for v in self.listed) + "\n Enabled    Animation Composer for Premiere 2.2.1"

        class R:
            stdout, stderr, returncode = out, "", 0
        return R()


@pytest.fixture
def agent(monkeypatch):
    def make(**kw):
        fake = FakeAgent(**kw)
        monkeypatch.setattr(install, "upia", lambda: "/fake/UPIA")
        monkeypatch.setattr(install.subprocess, "run", fake)
        return fake
    return make


def test_old_copies_left_beside_the_new_one_are_removed(agent, tmp_path):
    fake = agent(listed=["0.10.7", "0.10.8"])
    install.install_panel(str(tmp_path / "Asistent-0.10.9.ccx"), "0.10.9")
    assert fake.listed == ["0.10.9"]


def test_a_clean_install_over_is_left_alone(agent, tmp_path):
    fake = agent(listed=["0.10.8"], keeps_old=False)
    install.install_panel(str(tmp_path / "Asistent-0.10.9.ccx"), "0.10.9")
    assert fake.listed == ["0.10.9"] and not any(f == "--remove" for f, _ in fake.calls)


def test_the_path_given_to_adobe_is_absolute(agent, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    fake = agent(listed=[])
    install.install_panel("Asistent-0.10.9.ccx", "0.10.9")
    assert fake.listed == ["0.10.9"] and all(os.path.isabs(a) for f, a in fake.calls if f == "--install")


def test_one_failed_reinstall_is_retried(agent, tmp_path):
    fake = agent(listed=["0.10.8"], fail_on={2})        # the install over works, the clean reinstall fails once
    install.install_panel(str(tmp_path / "Asistent-0.10.9.ccx"), "0.10.9")
    assert fake.listed == ["0.10.9"] and fake.installs == 3


def test_a_failure_says_what_is_listed_and_how_to_install_by_hand(agent, tmp_path):
    fake = agent(listed=["0.10.8"], fail_installs=5)
    with pytest.raises(RuntimeError) as e:
        install.install_panel(str(tmp_path / "Asistent-0.10.9.ccx"), "0.10.9")
    assert "Double-click Asistent-0.10.9.ccx" in str(e.value)
