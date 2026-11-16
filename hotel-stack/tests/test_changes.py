import pytest

from hotelcore import change_checks, changes
from hotelcore.baml_client.types import ChangeProposal
from hotelcore.changes import ProposalError, clean_path, resolve
from tests.test_api import FakePool


def proposal(*edits) -> ChangeProposal:
    return ChangeProposal.model_validate({"title": "t", "reason": "r", "edits": list(edits)})


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A tiny repo; the engine's REPO points at it, publishing is stubbed."""
    (tmp_path / "hotels/h/kb").mkdir(parents=True)
    (tmp_path / "hotels/h/kb/pool.md").write_text("# Pool\nOpen 9-5.\n")
    monkeypatch.setattr(changes, "REPO", tmp_path)
    monkeypatch.setattr(changes, "after_write", lambda files, note, author: None)
    return tmp_path


@pytest.mark.parametrize("bad", [".env", "hotels/h/.env", "../outside.py", "/etc/passwd", "data/x.json",
                                 "dashboard/node_modules/x.js", "src/hotelcore/baml_client/types.py", "README.md"])
def test_paths_outside_the_allowed_areas_are_refused(bad):
    with pytest.raises(ProposalError):
        clean_path(bad)


def test_allowed_paths_pass():
    assert clean_path("./hotels/h/kb/pool.md") == "hotels/h/kb/pool.md"
    assert clean_path("src/hotelcore/tools/rooms.py") == "src/hotelcore/tools/rooms.py"


def test_edits_resolve_to_before_and_after(repo):
    files = resolve(proposal({"path": "hotels/h/kb/pool.md", "old_text": "9-5", "new_text": "9-7"},
                             {"path": "hotels/h/kb/spa.md", "content": "# Spa\n"}), repo)
    by = {f["path"]: f for f in files}
    assert by["hotels/h/kb/pool.md"]["after"] == "# Pool\nOpen 9-7.\n"
    assert by["hotels/h/kb/spa.md"]["before"] is None and by["hotels/h/kb/spa.md"]["before_hash"] is None


def test_old_text_must_match_exactly_once(repo):
    with pytest.raises(ProposalError, match="exactly once"):
        resolve(proposal({"path": "hotels/h/kb/pool.md", "old_text": "Sauna", "new_text": "x"}), repo)


def test_a_no_op_proposal_is_refused(repo):
    with pytest.raises(ProposalError, match="does not change"):
        resolve(proposal({"path": "hotels/h/kb/pool.md", "content": "# Pool\nOpen 9-5.\n"}), repo)


def row(repo, status="ready"):
    files = resolve(proposal({"path": "hotels/h/kb/pool.md", "old_text": "9-5", "new_text": "9-7"}), repo)
    return {"id": 1, "kind": "files", "status": status, "title": "t", "files": files}


def test_apply_writes_files_and_undo_restores_them(repo, monkeypatch):
    c = row(repo)
    monkeypatch.setattr(changes, "get", lambda db, i: c)
    changes.apply(FakePool(), 1, "owner")
    assert (repo / "hotels/h/kb/pool.md").read_text() == "# Pool\nOpen 9-7.\n"
    c["status"] = "applied"
    changes.undo(FakePool(), 1, "owner")
    assert (repo / "hotels/h/kb/pool.md").read_text() == "# Pool\nOpen 9-5.\n"


def test_apply_refuses_when_the_file_changed_since_the_proposal(repo, monkeypatch):
    c = row(repo)
    (repo / "hotels/h/kb/pool.md").write_text("# Pool\nClosed.\n")
    monkeypatch.setattr(changes, "get", lambda db, i: c)
    with pytest.raises(ProposalError, match="changed since the proposal"):
        changes.apply(FakePool(), 1, "owner")


def test_only_ready_changes_can_be_applied(repo, monkeypatch):
    c = row(repo, status="failed")
    monkeypatch.setattr(changes, "get", lambda db, i: c)
    with pytest.raises(ProposalError, match="checks passed"):
        changes.apply(FakePool(), 1, "owner")


def test_areas_come_from_paths():
    assert change_checks.areas_for(["hotels/h/kb/a.md", "hotels/h/prompts/voice/x.md", "src/hotelcore/x.py",
                                    "dashboard/src/app/page.tsx", "db/migrations/006.sql"]) == \
        ["code", "dashboard", "kb", "migrations", "voice"]


def test_render_check_catches_a_template_with_a_missing_fact():
    path = "hotels/contigo-ranch/sms_templates.yaml"
    good = (change_checks.REPO / path).read_text()
    bad = good + "\nbroken:\n  description: x\n  text: '{{facts.no_such_fact}}'\n"
    with change_checks.scratch_repo([{"path": path, "after": good}]) as root:
        assert change_checks.check_render(root / "hotels/contigo-ranch")["ok"]
    with change_checks.scratch_repo([{"path": path, "after": bad}]) as root:
        with pytest.raises(Exception, match="no_such_fact"):
            change_checks.check_render(root / "hotels/contigo-ranch")
