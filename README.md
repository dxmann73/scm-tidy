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

- Eye button in the Source Control title bar turns tidy mode on and tidies. Eye-closed button
  turns it off and expands all repositories.
- `SCM Tidy: Tidy Now` tidies again, for example after committing.
- Every run logs its steps to the `SCM Tidy` output channel.
- `SCM Tidy: Show Computed Repository Order` lists the computed order and the expand/collapse
  decision in the `SCM Tidy` output channel. Compare it with the view if the wrong repositories
  expand.

## How it works

VS Code has no extension API to collapse a single repository in the Source Control view. The
extension works around this:

1. Focus the Source Control view (`workbench.scm.focus`).
2. Collapse every repository (`workbench.scm.action.collapseAllRepositories`).
3. Compute the row order of all open repositories by replicating VS Code's sort for
   `scm.repositories.sortOrder`. `discovery time` uses workspace folder order.
4. Walk the rows bottom-up with `list.focusFirst` / `list.focusDown` and run `list.expand` on each
   repository that needs attention.

**Fragile by design.** If the computed order differs from the view, the wrong repositories get
expanded. Sorting chosen through the Source Control "..." menu is stored in workspace state the
extension cannot read; it only follows the `scm.repositories.sortOrder` setting. Repositories
hidden through the Repositories view also shift rows: the Git API cannot tell which are shown.

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `scmTidy.runOnStartup` | `false` | Tidy after startup when tidy mode is on (untested) |
| `scmTidy.startupDelayMs` | `3000` | Quiet period after the last repository opens |
| `scmTidy.stepDelayMs` | `30` | Pause between tree navigation commands |

## Limits

- No automatic re-tidy when repository state changes; running it would steal focus.
- The startup tidy switches the sidebar to Source Control.
- Row walking breaks if a VS Code update renames the commands or changes the tree layout.

## Release

Bump `version` in `package.json`, commit, then tag and push:

```bash
git tag v0.0.2 && git push origin main v0.0.2
```

The `release` workflow checks that the tag matches `package.json`, packages the `.vsix` with
`@vscode/vsce` and attaches it to a GitHub release.

## License

[MIT](LICENSE)
