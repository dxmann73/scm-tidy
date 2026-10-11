# Push-button tidy: show only repositories with changes

- priority: p3 (low) — no urgency signal in the text
- status: done
- completed: 2026-10-11
- dispatched: 2026-10-10
- refined: 2026-10-10
- verified: 2026-10-10
- verified-branch: main
- verified-commit: 38051bf
- verified-worktree: clean apart from untracked `.plans/`

## Goal

Replace the eye toggle in the Source Control title bar with a single push button. Each press
collapses all repositories and expands only those that need attention (changes, ahead, behind,
unpublished). Pressing it again later re-applies the filter to the current state, so new changes
show up with one click instead of two.

## Non-goals

- Changing the attention rules in `attentionReasons`.
- Changing the row-position logic (`sortRepositories`, list navigation).
- Detecting which repositories the SCM view actually shows.
- The financial-advisor row staying collapsed right after a tidy. That is a row-position bug,
  tracked in `tidy-row-stays-collapsed.md`.
- Automatic re-tidy when a repository gains changes. It would pull focus into the SCM view while
  the user works; the button stays manual.
- An SCM Tidy expand-all button. VS Code's built-in title actions cover it.

## Background

Today `scmTidy.enable` (eye) sets the `scmTidy.enabled` context key and runs a tidy;
`scmTidy.disable` (eye-closed) clears it and runs `workbench.scm.action.expandAllRepositories`.
The `scm/title` menu shows one or the other based on the key. To refresh after new changes, the
user must press disable (expand all), then enable (tidy) again.

`tidy()` itself already starts from `collapseAllRepositories`, so it is idempotent: running it
again from any tree state yields the filtered view. The two-click dance only exists because the
button is a toggle.

## Evidence

- `extension.js:246-254`: enable/disable commands and the `setEnabled` state.
- `extension.js:274-282`: startup tidy runs only when `enabled && runOnStartup`.
- `package.json` `menus.scm/title`: two entries gated on `scmTidy.enabled`.
- VM log `~/.vscode-server/data/logs/20261009T214313/exthost2/.../2-SCM Tidy.log`: disable then
  tidy pressed twice within 17 s, the two-click refresh this plan removes.
- `README.md` "Use" describes the eye/eye-closed toggle and `SCM Tidy: Tidy Now`; the settings
  table says `runOnStartup` applies "when tidy mode is on"; "Release" shows tag `v0.0.2`.
- `.vscodeignore` does not exclude `.plans/`, so plan files would ship in the `.vsix`.
- `code` is not on PATH in agent threads (no `VSCODE_IPC_HOOK_CLI`). The current VS Code server
  is the first entry of `~/.vscode-server/cli/servers/lru.json`; its `server/bin/code-server`
  installs extensions into `~/.vscode-server/extensions`, where `dxmann73.scm-tidy-0.0.2` lives.
- VS Code `scmViewPane.ts` registers `workbench.scm.action.collapseAllRepositories` and
  `workbench.scm.action.expandAllRepositories` in `MenuId.SCMTitle`, group `navigation`. Collapse
  All shows while any repository is expanded, Expand All only when all are collapsed. After a
  tidy, the user reaches expand-all via Collapse All, then Expand All.

## Decisions

- One command, `scmTidy.tidy`, bound to the `scm/title` button with `when: view == workbench.scm`
  and icon `$(eye)`.
- Remove `scmTidy.enable`, `scmTidy.disable`, `ENABLED_KEY`, `setEnabled`, and the `setContext`
  calls. Expand-all is left to VS Code's built-in action.
- Keep `scmTidy.showOrder` unchanged.
- Execution context: the agent VM, in `~/projects/scm-tidy`, from a thread in this project.
- Release is pre-approved once testing passes: commit `extension.js`, `package.json`,
  `README.md`, `.vscodeignore`, and this plan file (in `.plans/4-done/`) with message
  `feat: replace tidy toggle with push button`, tag `v0.0.3`, and push `main` and the tag to
  `origin`. Do not stage other `.plans/` files. The push triggers the
  release workflow. Testing passes when the automated checks succeed and the user confirms the
  manual checks; that confirmation is the only runtime stop.

## Implementation

1. `package.json`
   - Drop the `scmTidy.enable` and `scmTidy.disable` command contributions.
   - Give `scmTidy.tidy` the title `SCM Tidy: Show Repositories With Changes` and icon `$(eye)`.
   - Replace both `scm/title` entries with one entry for `scmTidy.tidy`,
     `when: view == workbench.scm`, `group: navigation@100`.
   - Update the `runOnStartup` description to drop the "when tidy mode is on" clause.
2. `extension.js`
   - Remove `ENABLED_KEY`, `setEnabled`, the startup `setContext`, and the enable/disable
     registrations.
   - Startup tidy gates on `runOnStartup` only.
   - Update the header comment if it mentions the toggle.
3. `README.md`
   - "Use": the eye button shows only repositories that need attention; press it again to refresh
     after changes. Expand all via VS Code's built-in Collapse All / Expand All title buttons.
     Rename `SCM Tidy: Tidy Now` to the new command title.
   - Settings table: `runOnStartup` drops "when tidy mode is on".
   - "Release" example: `v0.0.3`.
4. `.vscodeignore`: add `.plans/**`.
5. Bump `version` to `0.0.3` in `package.json`.
6. Run Verification. Install the `.vsix` on the VM, then ask the user to reload the window, run
   the manual checks, and confirm. Wait for that confirmation.
7. Move this plan to `.plans/4-done/` with a `Completed` outcome and the verification evidence.
8. Commit, tag `v0.0.3`, push `main` and the tag. Confirm the release workflow run succeeds with
   `gh run list --workflow release.yml`.

## Acceptance Criteria

- The SCM title bar shows exactly one SCM Tidy button, never on repository rows.
- Pressing it from any tree state (all expanded, all collapsed, already tidied, manually changed)
  leaves only attention repositories expanded.
- After a clean repository gains changes, one press expands it.
- No reference to `scmTidy.enabled`, `scmTidy.enable`, or `scmTidy.disable` remains.
- Each press logs its steps to the `SCM Tidy` output channel.

## Verification

- `node --check extension.js`
- `grep -rn 'scmTidy\.\(enable\|disable\|enabled\)' extension.js package.json README.md` returns
  nothing.
- `markdownlint '**/*.md' --ignore node_modules`
- `npx @vscode/vsce@3.9.2 package`; `unzip -l scm-tidy-0.0.3.vsix` lists no `.plans/` files.
- Install:

  ```bash
  servers=~/.vscode-server/cli/servers
  server="$(node -p "require('$servers/lru.json')[0]")"
  "$servers/$server/server/bin/code-server" --install-extension scm-tidy-0.0.3.vsix --force
  ```

  Then `~/.vscode-server/extensions/dxmann73.scm-tidy-0.0.3` exists.
- Manual on the VM (user): press the button twice in a row; expand all via VS Code, press again;
  touch a file in a collapsed clean repo, press again. Confirm via the view and the output
  channel.
- After push: release workflow succeeds and the GitHub release has `scm-tidy-0.0.3.vsix`.

## Outcome

Completed. Automated checks passed: `node --check`, no `scmTidy.enable|disable|enabled`
references, markdownlint, `vsce package` without `.plans/` content, `.vsix` installed as
`dxmann73.scm-tidy-0.0.3`. The user ran the button on the VM and accepted the result. A wrong row
expanded during the manual check because `agent-box-setup` was hidden in the Repositories view, a
known limit of the row walk; the user re-showed the repository and declined a fix.
