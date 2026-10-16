# SCM Tidy

VS Code extension. Collapses clean repositories in the Source Control view and keeps
repositories that need attention expanded:

- uncommitted, staged, untracked or merge changes
- commits ahead or behind upstream
- branch without upstream (unpublished)

Useful for multi-root workspaces with many Git repositories, where the Source Control view
expands every repository by default.

Prototype. No runtime dependencies, no build step. Not on the Visual Studio Marketplace.

## Install

Each GitHub release attaches a `.vsix` package. Download the latest one and install it:

```bash
gh release download --repo dxmann73/scm-tidy --pattern '*.vsix' --dir /tmp --clobber
code --install-extension /tmp/scm-tidy-*.vsix --force
```

Without `gh`, download the `.vsix` from the
[releases page](https://github.com/dxmann73/scm-tidy/releases) and run
`code --install-extension <file>.vsix`. Reload the VS Code window afterwards.

Updates are manual: run the same commands again. Uninstall with
`code --uninstall-extension dxmann73.scm-tidy`.

## Use

- Eye button in the Source Control title bar shows only repositories that need attention and
  expands them. Press it again later to refresh, for example after a repository gains changes.
  Expand all repositories with VS Code's built-in Collapse All / Expand All title buttons.
- `SCM Tidy: Show Repositories With Changes` runs the same tidy from the command palette.
- Every run logs its steps and the observed row order to the `SCM Tidy` output channel without
  opening it.

## How it works

VS Code has no extension API to collapse a single repository in the Source Control view. The
extension works around this:

1. Focus the Source Control view (`workbench.scm.focus`).
2. Collapse every repository (`workbench.scm.action.collapseAllRepositories`), so every remaining
   row is a repository row.
3. Move to the last row (`list.focusLast`) and walk up. On each row, `list.select` selects it as
   if from the keyboard. That focuses the repository in Git (`repo.ui.selected`). Hidden
   repositories never appear, and the walk follows the order the view actually shows, including
   the sort chosen in the Source Control "..." menu.
4. `list.select` toggles collapse unless `workbench.tree.expandMode` is `doubleClick`.
   `list.expand` on an already expanded row moves focus to the first child, and `list.collapse`
   on an already collapsed row moves to the parent, so those commands run only when the row is
   not already in the wanted state. `list.focusUp` then moves to the previous repository row
   because children sit below their parent.
5. Stop when `list.select` identifies the same repository as the previous row: focus did not
   move, so the top was reached. Restore the originally selected repository when nothing expanded
   sits above it.

**Fragile by design.** The walk depends on `list.select` focusing a Git repository and on the
built-in list commands. A VS Code update that changes that chain or the tree layout breaks it.

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `scmTidy.runOnStartup` | `false` | Tidy after startup (untested) |
| `scmTidy.startupDelayMs` | `3000` | Quiet period after the last repository opens |
| `scmTidy.stepDelayMs` | `30` | Pause between tree navigation commands |
| `scmTidy.selectTimeoutMs` | `500` | Wait for Git to report the focused repository after `list.select` |

## Limits

- No automatic re-tidy when repository state changes; running it would steal focus.
- The startup tidy switches the sidebar to Source Control.
- Row walking breaks if a VS Code update renames the commands or changes the tree layout.

## Release

Bump `version` in `package.json`, commit, then tag and push:

```bash
git tag v0.0.3 && git push origin main v0.0.3
```

The `release` workflow checks that the tag matches `package.json`, packages the `.vsix` with
`@vscode/vsce` and attaches it to a GitHub release.

## License

[MIT](LICENSE)
