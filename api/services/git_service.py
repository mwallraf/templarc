"""
Git service — read/write Jinja2 template files from a local Git repository.

All template content lives on disk inside a single Git repository rooted at
TEMPLATES_REPO_PATH. The service wraps GitPython to provide:

  - read_template       — read raw .j2 content (frontmatter + body)
  - write_template      — write + stage + commit in one call
  - get_commit_sha      — SHA of the last commit that touched a file
  - list_templates      — all .j2 files under a project subdirectory
  - get_file_history    — per-file commit history
  - parse_frontmatter   — split YAML frontmatter from Jinja2 body

Design decisions:
  - The GitService instance holds a reference to one git.Repo. For production,
    construct one instance at startup and share it (thread-safe for reads;
    writes serialize naturally via Python's GIL + the repo lock).
  - Paths accepted by public methods are RELATIVE to the repo root. The service
    always resolves them against repo.working_dir before touching the filesystem
    so that no caller can escape the repo boundary via path traversal.
  - parse_frontmatter is a pure static method with no filesystem dependency,
    making it easy to test independently.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import git
import yaml


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class TemplateNotFoundError(FileNotFoundError):
    """Raised when the requested .j2 file does not exist in the repo."""


class GitServiceError(RuntimeError):
    """Raised for unexpected Git operation failures."""


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class CommitInfo:
    sha: str
    message: str
    author: str
    authored_at: datetime


# ---------------------------------------------------------------------------
# Frontmatter parsing (pure — no filesystem dependency)
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(
    r"^---\r?\n(?P<fm>.*?)\r?\n---\r?\n?(?P<body>.*)",
    re.DOTALL,
)


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """
    Split YAML frontmatter from a template body.

    The frontmatter block must start at byte 0 and be delimited by ``---``
    lines. Returns ``({}, content)`` if no frontmatter is found so that
    callers can safely unpack in all cases.

    Args:
        content: Raw file content, possibly including frontmatter.

    Returns:
        (frontmatter_dict, template_body)  — frontmatter_dict is {} when absent.
    """
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return {}, content

    try:
        fm = yaml.safe_load(m.group("fm")) or {}
    except yaml.YAMLError:
        fm = {}

    return fm, m.group("body")


# ---------------------------------------------------------------------------
# Git service
# ---------------------------------------------------------------------------

class GitService:
    """
    Wraps a local Git repository for reading and writing Jinja2 template files.

    Usage::

        svc = GitService("/path/to/templates_repo")
        body = svc.read_template("cisco/cisco_891.j2")
        sha  = svc.write_template("cisco/cisco_891.j2", new_content,
                                  message="update hostname param",
                                  author="admin")
    """

    def __init__(self, repo_path: str | Path) -> None:
        self._root = Path(repo_path).resolve()
        if not self._root.exists():
            self._root.mkdir(parents=True)
        try:
            self._repo = git.Repo(str(self._root))
        except git.InvalidGitRepositoryError:
            self._repo = git.Repo.init(str(self._root))

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _abs(self, relative_path: str | Path) -> Path:
        """
        Resolve a caller-supplied relative path to an absolute path inside
        the repo, guarding against path traversal (``../../etc/passwd``).
        """
        resolved = (self._root / relative_path).resolve()
        if not str(resolved).startswith(str(self._root)):
            raise GitServiceError(
                f"Path traversal attempt: {relative_path!r} escapes the repo root."
            )
        return resolved

    def _rel(self, absolute_path: Path) -> str:
        """Return POSIX-style path relative to the repo root."""
        return absolute_path.relative_to(self._root).as_posix()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read_template(self, git_path: str) -> str:
        """
        Return the raw content of a .j2 file (frontmatter + body).

        Raises:
            TemplateNotFoundError: if the file does not exist in the repo.
        """
        abs_path = self._abs(git_path)
        if not abs_path.is_file():
            raise TemplateNotFoundError(
                f"Template not found in repo: {git_path!r}"
            )
        return abs_path.read_text(encoding="utf-8")

    def write_template(
        self,
        git_path: str,
        content: str,
        message: str,
        author: str,
    ) -> str:
        """
        Write content to a .j2 file, stage it, and create a commit.

        Creates intermediate directories if needed. The commit author name
        and email are derived from ``author`` (email defaults to
        ``<author@templarc>``).

        Returns:
            The new commit SHA (hex string).
        """
        abs_path = self._abs(git_path)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")

        self._repo.index.add([str(abs_path)])

        actor = git.Actor(author, f"{author}@templarc")
        commit = self._repo.index.commit(
            message,
            author=actor,
            committer=actor,
        )
        return commit.hexsha

    def get_commit_sha(self, git_path: str) -> str:
        """
        Return the SHA of the most recent commit that modified ``git_path``.

        Raises:
            TemplateNotFoundError: if the file has never been committed.
            GitServiceError: on unexpected Git errors.
        """
        rel = self._rel(self._abs(git_path))
        try:
            commits = list(self._repo.iter_commits(paths=rel, max_count=1))
        except (git.GitCommandError, ValueError):
            # ValueError is raised by GitPython when the repo has no commits yet
            # (HEAD points to a branch ref that doesn't exist).
            raise TemplateNotFoundError(
                f"No commits found for {git_path!r} — file may not have been committed yet."
            )

        if not commits:
            raise TemplateNotFoundError(
                f"No commits found for {git_path!r} — file may not have been committed yet."
            )
        return commits[0].hexsha

    def list_templates(self, project_git_path: str) -> list[str]:
        """
        Return all .j2 file paths under ``project_git_path``, relative to the
        repo root, sorted alphabetically.

        Args:
            project_git_path: Subdirectory path relative to the repo root
                              (e.g. ``"cisco"`` or ``"routing/ospf"``).
        """
        abs_dir = self._abs(project_git_path)
        if not abs_dir.is_dir():
            return []
        return sorted(
            self._rel(p)
            for p in abs_dir.rglob("*.j2")
            if p.is_file()
        )

    def get_file_history(
        self, git_path: str, limit: int = 20
    ) -> list[CommitInfo]:
        """
        Return up to ``limit`` commits that touched ``git_path``, most-recent
        first.

        Returns an empty list if the file has no history yet.
        """
        rel = self._rel(self._abs(git_path))
        try:
            commits = self._repo.iter_commits(paths=rel, max_count=limit)
        except (git.GitCommandError, ValueError):
            # ValueError when repo has no commits yet (HEAD ref doesn't exist)
            return []

        result = []
        for c in commits:
            result.append(
                CommitInfo(
                    sha=c.hexsha,
                    message=c.message.strip(),
                    author=c.author.name,
                    authored_at=datetime.fromtimestamp(
                        c.authored_date, tz=timezone.utc
                    ),
                )
            )
        return result

    # ------------------------------------------------------------------
    # Frontmatter (delegates to module-level pure function)
    # ------------------------------------------------------------------

    @staticmethod
    def parse_frontmatter(content: str) -> tuple[dict, str]:
        """Thin wrapper — delegates to the module-level pure function."""
        return parse_frontmatter(content)
