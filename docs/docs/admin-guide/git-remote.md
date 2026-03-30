---
title: Remote Git
sidebar_position: 12
---

# Remote Git

Projects can link to a remote Git repository, allowing you to pull templates from a central source and push local edits back.

## Configuration

In the project settings (**System → Projects → [project] → Remote Git**):

| Field | Description |
|-------|-------------|
| Remote URL | HTTPS or SSH URL (e.g., `https://github.com/org/templates.git`) |
| Branch | Branch to track (e.g., `main`) |
| Credential | Secret reference for HTTPS auth (e.g., `secret:git_token`) |

## Status Badges

| Status | Meaning |
|--------|---------|
| `no_remote` | No remote URL configured |
| `not_cloned` | Remote configured but not yet cloned locally |
| `in_sync` | Local and remote are on the same commit |
| `ahead` | Local has commits not yet pushed to remote |
| `behind` | Remote has commits not yet pulled locally |
| `diverged` | Both local and remote have diverged commits |
| `error` | An error occurred checking status |

## Workflow

### Initial Setup

1. Configure the remote URL, branch, and credential in project settings
2. Click **Clone** to clone the remote repository into the project's `git_path`

### Day-to-Day

```
Edit templates locally via the Template Editor
       ↓
Changes are committed to the local Git repo
       ↓
Click "Pull" to fetch latest from remote (fast-forward only)
       ↓
Click "Push" to publish your changes back
```

:::warning
Pull is fast-forward only. If the remote and local have diverged, Templarc will refuse the pull and report `diverged` status. Resolve the divergence manually via git CLI before retrying.
:::

:::warning
Push checks for divergence before executing. If the remote is ahead, you must pull first. There is no force-push capability in the UI.
:::

## Credential Format

For HTTPS remotes, the credential is embedded in the URL as:
```
https://oauth2:<token>@host/path/repo.git
```

The raw token is never logged. Use a secret reference pointing to a personal access token or deploy key token.

For SSH remotes, pass the URL unchanged. Ensure the API container has the appropriate SSH key configured in `~/.ssh/`.

## No Auto-Sync

Remote sync is **always manual**. There is no automatic push or pull — a human (or automation via the admin API) must explicitly trigger these operations.
