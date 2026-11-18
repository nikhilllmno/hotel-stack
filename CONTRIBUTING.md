# Contributing

## Secrets never go in git

This repo is public. Keep API keys, tokens, passwords and connection strings in
`.env` files (git ignores them) and document the variable names in `.env.example`.

[gitleaks](https://github.com/gitleaks/gitleaks) checks for secrets in two places:

- **CI:** `.github/workflows/gitleaks.yml` scans the full git history on every push and pull request.
- **Pre-commit (local):** stops a commit that adds a secret before it leaves your machine.

### Turn on the pre-commit hook

Do this once in each clone:

```bash
pipx install pre-commit        # or: pip install pre-commit / brew install pre-commit
pre-commit install
```

The hook uses the gitleaks version pinned in `.pre-commit-config.yaml`, so you do not need to install gitleaks.

Run it on demand:

```bash
pre-commit run gitleaks              # staged changes
gitleaks git . --redact --verbose    # full history (needs a local gitleaks)
```

### When gitleaks flags something

- **A real secret:** remove it, load it from an env var, and add the name to `.env.example`.
  Then **rotate the key** at the provider. A pushed secret is public, even if you delete it later.
- **A false positive** (test fixture, doc placeholder, public ID): add a narrow entry to `.gitleaks.toml`.
  Scope it to the exact file path, and for app or source code also to a regex on that line.
  Never allowlist a whole app directory.
- **A one-off:** add `# gitleaks:allow` at the end of the line.
