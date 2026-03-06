"""
Unit tests for api.services.git_service.

All tests that touch the filesystem use pytest's tmp_path fixture so they
are isolated and never modify the real templates_repo.

Scenarios covered:
  parse_frontmatter  — with, without, malformed YAML, body-only, CRLF
  GitService.read_template   — happy path, not found, path traversal guard
  GitService.write_template  — create, update, nested dirs, returns SHA
  GitService.get_commit_sha  — after write, before any commit
  GitService.list_templates  — empty dir, single, nested, non-.j2 excluded
  GitService.get_file_history — single commit, multiple commits, no history
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import git
import pytest

from api.services.git_service import (
    CommitInfo,
    GitService,
    GitServiceError,
    TemplateNotFoundError,
    parse_frontmatter,
)


# ===========================================================================
# parse_frontmatter (pure — no filesystem)
# ===========================================================================

class TestParseFrontmatter:
    def test_valid_frontmatter(self):
        content = textwrap.dedent("""\
            ---
            parameters:
              - name: router.hostname
                widget: text
            ---
            hostname {{ router.hostname }}
        """)
        fm, body = parse_frontmatter(content)
        assert fm == {"parameters": [{"name": "router.hostname", "widget": "text"}]}
        assert "hostname {{ router.hostname }}" in body

    def test_no_frontmatter_returns_empty_dict(self):
        content = "hostname {{ router.hostname }}\n"
        fm, body = parse_frontmatter(content)
        assert fm == {}
        assert body == content

    def test_body_only_after_frontmatter(self):
        content = "---\nkey: value\n---\nbody line\n"
        fm, body = parse_frontmatter(content)
        assert fm == {"key": "value"}
        assert body.strip() == "body line"

    def test_empty_frontmatter_block(self):
        content = "---\n---\nbody\n"
        fm, body = parse_frontmatter(content)
        assert fm == {}
        assert "body" in body

    def test_malformed_yaml_returns_empty_dict(self):
        content = "---\n: bad: yaml: [\n---\nbody\n"
        fm, body = parse_frontmatter(content)
        assert fm == {}
        assert "body" in body

    def test_crlf_line_endings(self):
        content = "---\r\nkey: value\r\n---\r\nbody\r\n"
        fm, body = parse_frontmatter(content)
        assert fm == {"key": "value"}
        assert "body" in body

    def test_multiline_body_preserved(self):
        content = "---\ntitle: test\n---\nline1\nline2\nline3\n"
        _, body = parse_frontmatter(content)
        assert "line1" in body
        assert "line2" in body
        assert "line3" in body

    def test_frontmatter_with_list(self):
        content = "---\nthings:\n  - a\n  - b\n---\nbody\n"
        fm, _ = parse_frontmatter(content)
        assert fm["things"] == ["a", "b"]

    def test_no_trailing_newline_after_closing_delimiter(self):
        """Frontmatter closed by --- without a body after it."""
        content = "---\nkey: val\n---"
        fm, body = parse_frontmatter(content)
        assert fm == {"key": "val"}
        assert body == ""


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    """Return a fresh temp directory — GitService will init a repo inside it."""
    return tmp_path / "templates_repo"


@pytest.fixture
def svc(repo_dir: Path) -> GitService:
    return GitService(repo_dir)


# ===========================================================================
# GitService.read_template
# ===========================================================================

class TestReadTemplate:
    def test_reads_existing_file(self, svc: GitService) -> None:
        svc.write_template("leaf.j2", "hostname {{ h }}", "add leaf", "tester")
        content = svc.read_template("leaf.j2")
        assert content == "hostname {{ h }}"

    def test_not_found_raises(self, svc: GitService) -> None:
        with pytest.raises(TemplateNotFoundError):
            svc.read_template("does_not_exist.j2")

    def test_path_traversal_raises(self, svc: GitService) -> None:
        with pytest.raises(GitServiceError, match="traversal"):
            svc.read_template("../../etc/passwd")

    def test_reads_frontmatter_and_body_together(self, svc: GitService) -> None:
        raw = "---\nname: test\n---\nbody {{ x }}\n"
        svc.write_template("t.j2", raw, "add", "a")
        assert svc.read_template("t.j2") == raw


# ===========================================================================
# GitService.write_template
# ===========================================================================

class TestWriteTemplate:
    def test_returns_sha_string(self, svc: GitService) -> None:
        sha = svc.write_template("new.j2", "content", "msg", "dev")
        assert isinstance(sha, str)
        assert len(sha) == 40  # full SHA-1 hex

    def test_creates_file_on_disk(self, svc: GitService, repo_dir: Path) -> None:
        svc.write_template("created.j2", "body", "init", "dev")
        assert (repo_dir / "created.j2").read_text() == "body"

    def test_creates_nested_directories(self, svc: GitService, repo_dir: Path) -> None:
        svc.write_template("cisco/ios/template.j2", "content", "add", "dev")
        assert (repo_dir / "cisco" / "ios" / "template.j2").exists()

    def test_update_overwrites_existing(self, svc: GitService, repo_dir: Path) -> None:
        svc.write_template("f.j2", "v1", "add", "dev")
        svc.write_template("f.j2", "v2", "update", "dev")
        assert (repo_dir / "f.j2").read_text() == "v2"

    def test_two_writes_produce_different_shas(self, svc: GitService) -> None:
        sha1 = svc.write_template("f.j2", "v1", "add", "dev")
        sha2 = svc.write_template("f.j2", "v2", "update", "dev")
        assert sha1 != sha2

    def test_commit_message_recorded(self, svc: GitService) -> None:
        svc.write_template("f.j2", "body", "my special message", "dev")
        commit = svc._repo.head.commit
        assert commit.message == "my special message"

    def test_author_recorded(self, svc: GitService) -> None:
        svc.write_template("f.j2", "body", "msg", "alice")
        commit = svc._repo.head.commit
        assert commit.author.name == "alice"


# ===========================================================================
# GitService.get_commit_sha
# ===========================================================================

class TestGetCommitSha:
    def test_returns_sha_after_write(self, svc: GitService) -> None:
        written_sha = svc.write_template("f.j2", "body", "add", "dev")
        retrieved_sha = svc.get_commit_sha("f.j2")
        assert retrieved_sha == written_sha

    def test_returns_latest_sha_after_update(self, svc: GitService) -> None:
        svc.write_template("f.j2", "v1", "add", "dev")
        updated_sha = svc.write_template("f.j2", "v2", "upd", "dev")
        assert svc.get_commit_sha("f.j2") == updated_sha

    def test_uncommitted_file_raises(self, svc: GitService, repo_dir: Path) -> None:
        # Write file without going through write_template (no commit)
        (repo_dir / "raw.j2").write_text("raw")
        with pytest.raises(TemplateNotFoundError):
            svc.get_commit_sha("raw.j2")

    def test_different_files_have_different_shas(self, svc: GitService) -> None:
        sha_a = svc.write_template("a.j2", "a", "add a", "dev")
        sha_b = svc.write_template("b.j2", "b", "add b", "dev")
        assert svc.get_commit_sha("a.j2") == sha_a
        assert svc.get_commit_sha("b.j2") == sha_b


# ===========================================================================
# GitService.list_templates
# ===========================================================================

class TestListTemplates:
    def test_empty_directory_returns_empty(self, svc: GitService, repo_dir: Path) -> None:
        (repo_dir / "empty_proj").mkdir()
        assert svc.list_templates("empty_proj") == []

    def test_nonexistent_path_returns_empty(self, svc: GitService) -> None:
        assert svc.list_templates("no_such_dir") == []

    def test_single_file(self, svc: GitService) -> None:
        svc.write_template("proj/tmpl.j2", "body", "add", "dev")
        assert svc.list_templates("proj") == ["proj/tmpl.j2"]

    def test_multiple_files_sorted(self, svc: GitService) -> None:
        svc.write_template("proj/b.j2", "b", "add b", "dev")
        svc.write_template("proj/a.j2", "a", "add a", "dev")
        result = svc.list_templates("proj")
        assert result == ["proj/a.j2", "proj/b.j2"]

    def test_nested_directories(self, svc: GitService) -> None:
        svc.write_template("proj/sub/deep.j2", "x", "add", "dev")
        svc.write_template("proj/top.j2", "y", "add", "dev")
        result = svc.list_templates("proj")
        assert "proj/sub/deep.j2" in result
        assert "proj/top.j2" in result

    def test_non_j2_files_excluded(self, svc: GitService, repo_dir: Path) -> None:
        svc.write_template("proj/tmpl.j2", "j2 content", "add", "dev")
        # Place a non-.j2 file directly (no commit needed for list to see it on disk)
        (repo_dir / "proj").mkdir(exist_ok=True)
        (repo_dir / "proj" / "readme.txt").write_text("doc")
        result = svc.list_templates("proj")
        assert all(p.endswith(".j2") for p in result)
        assert not any("readme" in p for p in result)

    def test_other_project_not_included(self, svc: GitService) -> None:
        svc.write_template("proj_a/a.j2", "a", "add", "dev")
        svc.write_template("proj_b/b.j2", "b", "add", "dev")
        result = svc.list_templates("proj_a")
        assert all(p.startswith("proj_a/") for p in result)


# ===========================================================================
# GitService.get_file_history
# ===========================================================================

class TestGetFileHistory:
    def test_single_commit(self, svc: GitService) -> None:
        sha = svc.write_template("f.j2", "v1", "initial commit", "alice")
        history = svc.get_file_history("f.j2")
        assert len(history) == 1
        assert history[0].sha == sha
        assert history[0].message == "initial commit"
        assert history[0].author == "alice"

    def test_multiple_commits_most_recent_first(self, svc: GitService) -> None:
        svc.write_template("f.j2", "v1", "first", "alice")
        sha2 = svc.write_template("f.j2", "v2", "second", "bob")
        history = svc.get_file_history("f.j2")
        assert len(history) == 2
        assert history[0].sha == sha2  # most recent first
        assert history[0].author == "bob"
        assert history[1].author == "alice"

    def test_limit_respected(self, svc: GitService) -> None:
        for i in range(5):
            svc.write_template("f.j2", f"v{i}", f"commit {i}", "dev")
        history = svc.get_file_history("f.j2", limit=3)
        assert len(history) == 3

    def test_no_history_returns_empty(self, svc: GitService, repo_dir: Path) -> None:
        # File on disk but never committed
        (repo_dir / "raw.j2").write_text("raw")
        assert svc.get_file_history("raw.j2") == []

    def test_authored_at_is_datetime(self, svc: GitService) -> None:
        from datetime import datetime
        svc.write_template("f.j2", "body", "add", "dev")
        history = svc.get_file_history("f.j2")
        assert isinstance(history[0].authored_at, datetime)
        assert history[0].authored_at.tzinfo is not None  # timezone-aware

    def test_history_only_for_requested_file(self, svc: GitService) -> None:
        svc.write_template("a.j2", "a", "add a", "dev")
        svc.write_template("b.j2", "b", "add b", "dev")
        history = svc.get_file_history("a.j2")
        # Only one commit touched a.j2
        assert len(history) == 1
