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
        self._repo = self._open_or_init_repo(self._root)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _open_or_init_repo(path: Path) -> git.Repo:
        """
        Open the git repo at *path*, initialising it if it doesn't exist yet.

        Handles two extra failure modes that bare ``git.Repo()`` does not:

        * **Dubious ownership** (Git 2.35.2+): git refuses to operate on a
          directory whose owner UID differs from the current process UID.
          This is common when a bind-mounted host directory is owned by the
          host user while the container runs as root (or vice-versa). We
          detect the error, mark the path as safe, and retry — so the
          application is self-healing rather than requiring sysadmin
          intervention after every fresh install.

        * **GitCommandError on other transient failures**: surfaced as
          ``GitServiceError`` with the original message preserved.
        """
        try:
            return git.Repo(str(path))
        except git.InvalidGitRepositoryError:
            repo = git.Repo.init(str(path))
            # Ensure git identity is set locally so commits never fail due to
            # missing global config (belt-and-suspenders alongside the system
            # config set in the Dockerfile).
            with repo.config_writer() as cfg:
                if not cfg.has_option("user", "email"):
                    cfg.set_value("user", "email", "templarc@localhost")
                if not cfg.has_option("user", "name"):
                    cfg.set_value("user", "name", "Templarc")
            return repo
        except git.GitCommandError as exc:
            msg = str(exc)
            if "dubious ownership" in msg.lower():
                # Self-heal: register this path as safe and retry.
                git.cmd.Git().config("--global", "--add", "safe.directory", str(path))
                try:
                    return git.Repo(str(path))
                except git.InvalidGitRepositoryError:
                    return git.Repo.init(str(path))
                except git.GitCommandError as retry_exc:
                    raise GitServiceError(
                        f"Git repository at {path} is still inaccessible after "
                        f"adding safe.directory: {retry_exc}"
                    ) from retry_exc
            raise GitServiceError(f"Failed to open git repository at {path}: {exc}") from exc

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

    def delete_template(
        self,
        git_path: str,
        author: str = "templarc",
    ) -> str:
        """
        Remove a .j2 file from the repo, stage the removal, and commit.

        Returns:
            The new commit SHA (hex string).

        Raises:
            TemplateNotFoundError: if the file does not exist on disk.
        """
        abs_path = self._abs(git_path)
        if not abs_path.exists():
            raise TemplateNotFoundError(f"Template file not found: {git_path!r}")

        self._repo.index.remove([str(abs_path)], working_tree=True)

        actor = git.Actor(author, f"{author}@templarc")
        commit = self._repo.index.commit(
            f"chore: delete {git_path}",
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

    # ------------------------------------------------------------------
    # project.yaml helpers
    # ------------------------------------------------------------------

    _PROJECT_YAML = "project.yaml"

    def read_project_yaml(self, project_git_path: str) -> dict | None:
        """
        Read and parse project.yaml from the project's git directory.

        Returns the parsed dict, or None if the file does not exist or
        cannot be parsed.
        """
        yaml_path = self._abs(f"{project_git_path}/{self._PROJECT_YAML}")
        if not yaml_path.is_file():
            return None
        try:
            return yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            return None

    def write_project_yaml(
        self,
        project_git_path: str,
        project_data: dict,
        author: str = "templarc",
    ) -> str:
        """
        Serialise *project_data* as YAML and write/commit project.yaml.

        project_data keys: name, display_name, description (optional),
        output_comment_style, parameters (list of dicts, optional).

        Returns the new commit SHA.
        """
        content = (
            "# templarc project definition — managed automatically\n"
            + yaml.dump(project_data, default_flow_style=False, allow_unicode=True, sort_keys=False)
        )
        return self.write_template(
            f"{project_git_path}/{self._PROJECT_YAML}",
            content,
            message=f"chore: update {self._PROJECT_YAML}",
            author=author,
        )

    # ------------------------------------------------------------------
    # Remote Git operations (per-project sub-repos)
    # ------------------------------------------------------------------

    @staticmethod
    def _inject_credential(remote_url: str, credential: str | None) -> str:
        """
        Embed a personal access token into an HTTPS remote URL.

        For ``https://`` URLs without embedded credentials, transforms:
            https://github.com/org/repo.git
        into:
            https://oauth2:<token>@github.com/org/repo.git

        SSH URLs are returned unchanged (SSH key auth must be configured
        at the OS level via ssh-agent or ~/.ssh/config).
        """
        if not credential:
            return remote_url
        if remote_url.startswith("https://"):
            host_and_path = remote_url[len("https://"):]
            if "@" not in host_and_path.split("/")[0]:
                return f"https://oauth2:{credential}@{host_and_path}"
        return remote_url

    def _project_repo(self, project_git_path: str) -> git.Repo:
        """
        Return a ``git.Repo`` for the project's subdirectory.

        The subdirectory is expected to be a self-contained Git repository
        (i.e. cloned from a remote). If it is not yet a repo, one is
        initialised (useful before the first clone). Ownership mismatches
        are auto-healed via ``safe.directory`` — see ``_open_or_init_repo``.
        """
        abs_dir = self._abs(project_git_path)
        abs_dir.mkdir(parents=True, exist_ok=True)
        return self._open_or_init_repo(abs_dir)

    def clone_from_remote(
        self,
        project_git_path: str,
        remote_url: str,
        branch: str = "main",
        credential: str | None = None,
    ) -> None:
        """
        Clone *remote_url* into the project's local directory.

        The directory is created if it does not exist. If it already
        contains a Git repository, this call is a no-op (idempotent).

        Raises:
            GitServiceError: if the clone fails.
        """
        abs_dir = self._abs(project_git_path)
        if abs_dir.exists() and (abs_dir / ".git").exists():
            return  # already cloned
        abs_dir.mkdir(parents=True, exist_ok=True)
        url = self._inject_credential(remote_url, credential)
        try:
            git.Repo.clone_from(url, str(abs_dir), branch=branch)
        except git.GitCommandError as exc:
            raise GitServiceError(f"Clone failed: {exc}") from exc

    def get_remote_status(
        self,
        project_git_path: str,
        remote_url: str,
        branch: str = "main",
        credential: str | None = None,
    ) -> dict:
        """
        Fetch the remote and compare local HEAD with ``origin/<branch>``.

        Returns a dict with keys:
          local_sha, remote_sha, ahead, behind,
          status (in_sync | ahead | behind | diverged | not_cloned | error),
          message
        """
        abs_dir = self._abs(project_git_path)
        if not abs_dir.exists() or not (abs_dir / ".git").exists():
            return {
                "local_sha": None,
                "remote_sha": None,
                "ahead": 0,
                "behind": 0,
                "status": "not_cloned",
                "message": "Project directory has not been cloned yet.",
            }
        try:
            repo = git.Repo(str(abs_dir))
            url = self._inject_credential(remote_url, credential)

            # Ensure origin is configured
            if "origin" not in [r.name for r in repo.remotes]:
                repo.create_remote("origin", url)
            else:
                repo.remotes["origin"].set_url(url)

            repo.remotes["origin"].fetch()

            local_sha = repo.head.commit.hexsha if repo.head.is_valid() else None
            remote_ref = f"origin/{branch}"
            try:
                remote_sha = repo.commit(remote_ref).hexsha
            except (git.BadName, git.BadObject):
                return {
                    "local_sha": local_sha,
                    "remote_sha": None,
                    "ahead": 0,
                    "behind": 0,
                    "status": "error",
                    "message": f"Remote branch '{branch}' not found.",
                }

            ahead = sum(1 for _ in repo.iter_commits(f"{remote_ref}..HEAD"))
            behind = sum(1 for _ in repo.iter_commits(f"HEAD..{remote_ref}"))

            if ahead == 0 and behind == 0:
                status = "in_sync"
            elif ahead > 0 and behind == 0:
                status = "ahead"
            elif behind > 0 and ahead == 0:
                status = "behind"
            else:
                status = "diverged"

            return {
                "local_sha": local_sha,
                "remote_sha": remote_sha,
                "ahead": ahead,
                "behind": behind,
                "status": status,
                "message": None,
            }
        except Exception as exc:
            return {
                "local_sha": None,
                "remote_sha": None,
                "ahead": 0,
                "behind": 0,
                "status": "error",
                "message": str(exc),
            }

    def pull_remote(
        self,
        project_git_path: str,
        remote_url: str,
        branch: str = "main",
        credential: str | None = None,
    ) -> dict:
        """
        Pull from the remote using fast-forward-only merge.

        Raises:
            GitServiceError: if the pull fails or the merge is not fast-forward.
        """
        abs_dir = self._abs(project_git_path)
        if not abs_dir.exists() or not (abs_dir / ".git").exists():
            raise GitServiceError(
                "Project has not been cloned yet. Run clone first."
            )
        try:
            repo = git.Repo(str(abs_dir))
            url = self._inject_credential(remote_url, credential)

            if "origin" not in [r.name for r in repo.remotes]:
                repo.create_remote("origin", url)
            else:
                repo.remotes["origin"].set_url(url)

            repo.remotes["origin"].fetch()
            repo.git.merge("--ff-only", f"origin/{branch}")
            return {"new_sha": repo.head.commit.hexsha}
        except git.GitCommandError as exc:
            raise GitServiceError(f"Pull failed: {exc}") from exc

    def push_remote(
        self,
        project_git_path: str,
        remote_url: str,
        branch: str = "main",
        credential: str | None = None,
    ) -> dict:
        """
        Push local commits to the remote.

        Checks that local is not behind remote before pushing (refuses
        force-push). Raises GitServiceError if local is behind or
        the push otherwise fails.
        """
        abs_dir = self._abs(project_git_path)
        if not abs_dir.exists() or not (abs_dir / ".git").exists():
            raise GitServiceError(
                "Project has not been cloned yet. Run clone first."
            )
        try:
            repo = git.Repo(str(abs_dir))
            url = self._inject_credential(remote_url, credential)

            if "origin" not in [r.name for r in repo.remotes]:
                repo.create_remote("origin", url)
            else:
                repo.remotes["origin"].set_url(url)

            repo.remotes["origin"].fetch()
            remote_ref = f"origin/{branch}"
            try:
                behind = sum(1 for _ in repo.iter_commits(f"HEAD..{remote_ref}"))
                if behind > 0:
                    raise GitServiceError(
                        f"Cannot push: local branch is {behind} commit(s) behind remote. "
                        "Pull first to avoid overwriting remote changes."
                    )
            except git.BadName:
                pass  # Remote branch doesn't exist yet — first push is fine

            push_infos = repo.remotes["origin"].push(refspec=f"HEAD:refs/heads/{branch}")
            for info in push_infos:
                if info.flags & git.remote.PushInfo.ERROR:
                    raise GitServiceError(f"Push failed: {info.summary}")

            return {"new_sha": repo.head.commit.hexsha}
        except GitServiceError:
            raise
        except git.GitCommandError as exc:
            raise GitServiceError(f"Push failed: {exc}") from exc

    def test_remote_connection(
        self,
        remote_url: str,
        branch: str = "main",
        credential: str | None = None,
    ) -> dict:
        """
        Test connectivity to a remote without cloning anything.

        Uses ``git ls-remote --heads <url> refs/heads/<branch>`` — fast,
        credential-aware, and requires no local repo state.

        Returns a dict with keys: success (bool), message (str), branch_sha (str | None).
        """
        url = self._inject_credential(remote_url, credential)
        try:
            g = git.cmd.Git()
            output = g.ls_remote("--heads", url, f"refs/heads/{branch}")
            if output.strip():
                sha = output.strip().split()[0]
                return {
                    "success": True,
                    "message": f"Connection successful. Branch '{branch}' found.",
                    "branch_sha": sha,
                }
            else:
                return {
                    "success": False,
                    "message": f"Remote is reachable but branch '{branch}' does not exist.",
                    "branch_sha": None,
                }
        except git.GitCommandError as exc:
            # Sanitize: strip credential from error message before returning
            safe_msg = str(exc).replace(url, remote_url)
            return {
                "success": False,
                "message": f"Connection failed: {safe_msg}",
                "branch_sha": None,
            }
