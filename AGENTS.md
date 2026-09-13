# SCM Tidy

VS Code extension that collapses clean repositories in the Source Control view. Plain
JavaScript, CommonJS, no runtime dependencies, no build step.

## Layout

- `extension.js`: all extension code.
- `package.json`: manifest, commands, `scm/title` menu, settings.
- `.github/workflows/release.yml`: on `v*` tag, packages the `.vsix` and creates a GitHub release.

## Commands

- Syntax check: `node --check extension.js`
- Package locally: `npx @vscode/vsce@3.9.2 package` (output `*.vsix` is git-ignored)
- Install locally: `code --install-extension scm-tidy-<version>.vsix --force`
- Lint Markdown: `markdownlint '**/*.md' --ignore node_modules`

## Conventions

- VS Code has no API to collapse single SCM repositories. The extension drives the tree with
  `list.*` commands and replicates VS Code's repository sort. Check behavior against VS Code
  source (`src/vs/workbench/contrib/scm/browser/`) before changing sort or menu logic.
- Title bar buttons belong in the `scm/title` menu with `view == workbench.scm`; without that
  clause they also render on every repository row.
- Log each step to the `SCM Tidy` output channel. No silent early returns.
- Release: bump `version` in `package.json`, tag `v<version>`. The workflow fails on mismatch.
