// SCM Tidy: collapse clean repositories in the Source Control view.
//
// VS Code has no API to collapse a single repository node. This extension
// collapses all repositories with the built-in command, then walks the SCM
// tree bottom-up. list.select focuses a row as if from the keyboard, which
// makes Git set repo.ui.selected on the repository for that row. Hidden
// repositories never appear, so the walk sees the view's order instead of
// guessing it from scm.repositories.sortOrder. list.select toggles collapse
// unless workbench.tree.expandMode is doubleClick. list.expand on an already
// expanded row moves focus to the first child; list.collapse on an already
// collapsed row moves to the parent. Only send the command when the row is
// not already in the wanted state.

const vscode = require('vscode');
const path = require('path');

let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repositoryName(repo) {
  const folder = vscode.workspace.getWorkspaceFolder(repo.rootUri);
  if (folder && folder.uri.toString() === repo.rootUri.toString()) {
    return folder.name;
  }
  return path.basename(repo.rootUri.fsPath);
}

function repositoryKey(repo) {
  return repo.rootUri.toString();
}

function sameRepository(a, b) {
  return repositoryKey(a) === repositoryKey(b);
}

function selectedRepositories(git) {
  return git.repositories.filter((repo) => repo.ui.selected);
}

function attentionReasons(repo) {
  const { state } = repo;
  const reasons = [];
  const changes =
    state.mergeChanges.length +
    state.indexChanges.length +
    state.workingTreeChanges.length +
    state.untrackedChanges.length;
  if (changes > 0) {
    reasons.push(`${changes} changes`);
  }
  const head = state.HEAD;
  if (head && head.ahead) {
    reasons.push(`${head.ahead} ahead`);
  }
  if (head && head.behind) {
    reasons.push(`${head.behind} behind`);
  }
  if (head && head.name && !head.upstream) {
    reasons.push('unpublished');
  }
  return reasons;
}

async function getGitApi() {
  const extension = vscode.extensions.getExtension('vscode.git');
  if (!extension) {
    throw new Error('SCM Tidy: built-in Git extension not found');
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  const git = exports.getAPI(1);
  if (git.state !== 'initialized') {
    await new Promise((resolve) => {
      const listener = git.onDidChangeState((state) => {
        if (state === 'initialized') {
          listener.dispose();
          resolve();
        }
      });
    });
  }
  return git;
}

let output;

function log(message) {
  output.appendLine(`${new Date().toISOString().slice(11, 23)} ${message}`);
}

async function run(command, stepDelayMs) {
  await vscode.commands.executeCommand(command);
  await sleep(stepDelayMs);
}

function describeSelection(selected) {
  return selected.map((repo) => `${repositoryName(repo)} ${repo.rootUri.fsPath}`).join(', ');
}

function rejectSelectionCount(selected, context) {
  if (selected.length === 0) {
    const error = new Error(`SCM Tidy: no repository selected ${context}`);
    error.code = 'scmTidy.noSelection';
    return error;
  }
  return new Error(
    `SCM Tidy: ${selected.length} repositories selected ${context}: ${describeSelection(selected)}`,
  );
}

function selectAndIdentify(git, timeoutMs) {
  const listeners = [];
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const finish = (action) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      listeners.forEach((listener) => listener.dispose());
      action();
    };

    const onChange = () => {
      const selected = selectedRepositories(git);
      // ExtHost sets the new source control selected before clearing the old
      // one, so onDidChange can run with two selected. Keep waiting.
      if (selected.length === 1) {
        finish(() => resolve({ repo: selected[0], via: 'event' }));
      }
    };

    for (const repo of git.repositories) {
      listeners.push(repo.ui.onDidChange(onChange));
    }

    vscode.commands.executeCommand('list.select').then(
      () => {
        if (done) {
          return;
        }
        timer = setTimeout(() => {
          const selected = selectedRepositories(git);
          if (selected.length === 1) {
            finish(() => resolve({ repo: selected[0], via: 'timeout' }));
            return;
          }
          finish(() => reject(rejectSelectionCount(selected, 'after list.select')));
        }, timeoutMs);
      },
      (error) => finish(() => reject(error)),
    );
  });
}

function readSelectToggles() {
  const expandMode = vscode.workspace.getConfiguration('workbench').get('tree.expandMode');
  if (expandMode !== 'singleClick' && expandMode !== 'doubleClick') {
    throw new Error(`SCM Tidy: unsupported workbench.tree.expandMode "${expandMode}"`);
  }
  log(`workbench.tree.expandMode: ${expandMode}`);
  return expandMode !== 'doubleClick';
}

async function applyRowState(repo, expandedBefore, selectToggles, stepDelayMs) {
  const reasons = attentionReasons(repo);
  const desired = reasons.length > 0;
  const expanded = selectToggles ? !expandedBefore : expandedBefore;
  if (desired && !expanded) {
    log(`    expand (${reasons.join(', ')})`);
    await run('list.expand', stepDelayMs);
    return;
  }
  if (!desired && expanded) {
    log('    collapse');
    await run('list.collapse', stepDelayMs);
    return;
  }
  if (desired) {
    log(`    already expanded (${reasons.join(', ')})`);
    return;
  }
  log('    already collapsed');
}

async function restoreOriginalSelection(
  git,
  originallySelected,
  rowsBottomToTop,
  stepDelayMs,
  selectTimeoutMs,
  selectToggles,
) {
  if (!originallySelected) {
    log('restore selection: nothing was selected before the walk');
    return;
  }
  const key = repositoryKey(originallySelected);
  const rowsTopToBottom = [...rowsBottomToTop].reverse();
  const index = rowsTopToBottom.findIndex((repo) => repositoryKey(repo) === key);
  if (index < 0) {
    log(`restore selection: ${repositoryName(originallySelected)} not visible, skip`);
    return;
  }
  if (index === 0) {
    log(`restore selection: already on ${repositoryName(originallySelected)}`);
    return;
  }
  const blockers = rowsTopToBottom
    .slice(0, index)
    .filter((repo) => attentionReasons(repo).length > 0);
  if (blockers.length > 0) {
    log(
      `restore selection: skip ${repositoryName(originallySelected)}, expanded ${blockers.map(repositoryName).join(', ')} sit above it`,
    );
    return;
  }
  log(`restore selection: move down ${index} to ${repositoryName(originallySelected)}`);
  for (let step = 0; step < index; step++) {
    await run('list.focusDown', stepDelayMs);
  }
  const { repo, via } = await selectAndIdentify(git, selectTimeoutMs);
  if (repositoryKey(repo) !== key) {
    throw new Error(
      `SCM Tidy: restore selection landed on ${repositoryName(repo)} instead of ${repositoryName(originallySelected)}`,
    );
  }
  const desired = attentionReasons(repo).length > 0;
  await applyRowState(repo, desired, selectToggles, stepDelayMs);
  log(`restore selection: ${repositoryName(repo)} (${via})`);
}

async function tidy(git, { restoreEditorFocus }) {
  if (running) {
    log('tidy already running, skipped');
    return;
  }
  running = true;
  try {
    const config = vscode.workspace.getConfiguration('scmTidy');
    const stepDelayMs = config.get('stepDelayMs');
    const selectTimeoutMs = config.get('selectTimeoutMs');
    const selectToggles = readSelectToggles();
    const initiallySelected = selectedRepositories(git);
    if (initiallySelected.length > 1) {
      throw rejectSelectionCount(initiallySelected, 'before walk');
    }
    const originallySelected = initiallySelected[0];
    log(
      `tidy: git state ${git.state}, ${git.repositories.length} repositories, originally selected ${originallySelected ? repositoryName(originallySelected) : '(none)'}`,
    );
    // With one visible repository, the SCM tree shows no repository rows.
    // git.repositories also includes hidden repos, so a later walk may still
    // find a single row or none; those cases are handled in the loop.
    if (git.repositories.length < 2) {
      log('tidy: fewer than 2 repositories, nothing to do');
      return;
    }
    const hadEditor = vscode.window.activeTextEditor !== undefined;

    log('run workbench.scm.focus');
    await run('workbench.scm.focus', stepDelayMs);
    log('run workbench.scm.action.collapseAllRepositories');
    await run('workbench.scm.action.collapseAllRepositories', stepDelayMs);
    log('run list.focusLast');
    await run('list.focusLast', stepDelayMs);

    const rows = [];
    let previous;
    const limit = git.repositories.length + 1;
    for (let iteration = 1; iteration <= limit; iteration++) {
      let identified;
      try {
        identified = await selectAndIdentify(git, selectTimeoutMs);
      } catch (error) {
        if (iteration === 1 && error && error.code === 'scmTidy.noSelection') {
          log('tidy: no repository rows, nothing to do');
          if (restoreEditorFocus && hadEditor) {
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
          }
          return;
        }
        throw error;
      }
      const { repo, via } = identified;
      log(`  row ${iteration}: ${repositoryName(repo)} ${repo.rootUri.fsPath} (${via})`);
      const isTop = previous !== undefined && sameRepository(previous, repo);
      const desired = attentionReasons(repo).length > 0;
      // Newly reached rows are collapsed. The duplicate top row is already in
      // its desired state from the previous visit.
      const expandedBefore = isTop ? desired : false;
      await applyRowState(repo, expandedBefore, selectToggles, stepDelayMs);
      if (isTop) {
        log('walk: top reached');
        break;
      }
      rows.push(repo);
      previous = repo;
      if (iteration === limit) {
        throw new Error(`SCM Tidy: row walk exceeded ${limit} iterations`);
      }
      log('run list.focusUp');
      await run('list.focusUp', stepDelayMs);
    }

    log(`walk: ${rows.length} repository rows`);
    await restoreOriginalSelection(
      git,
      originallySelected,
      rows,
      stepDelayMs,
      selectTimeoutMs,
      selectToggles,
    );
    log('tidy: done');

    if (restoreEditorFocus && hadEditor) {
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }
  } finally {
    running = false;
  }
}

// Resolve once no repository has opened for delayMs.
function waitForRepositoriesToSettle(git, delayMs) {
  return new Promise((resolve) => {
    let timer = setTimeout(done, delayMs);
    const listener = git.onDidOpenRepository(() => {
      clearTimeout(timer);
      timer = setTimeout(done, delayMs);
    });
    function done() {
      listener.dispose();
      resolve();
    }
  });
}

function reportError(error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  log(`error: ${message}`);
  output.show(true);
  vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
}

async function activate(context) {
  output = vscode.window.createOutputChannel('SCM Tidy');
  context.subscriptions.push(output);
  log('activate');

  // Register commands before waiting on Git, so a slow Git start never swallows them.
  const gitReady = getGitApi();
  gitReady.then(
    () => log('git API ready'),
    (error) => reportError(error),
  );

  async function runTidy() {
    log('command: tidy');
    try {
      await tidy(await gitReady, { restoreEditorFocus: false });
    } catch (error) {
      reportError(error);
    }
  }

  context.subscriptions.push(vscode.commands.registerCommand('scmTidy.tidy', runTidy));

  const config = vscode.workspace.getConfiguration('scmTidy');
  if (config.get('runOnStartup')) {
    gitReady
      .then(async (git) => {
        await waitForRepositoriesToSettle(git, config.get('startupDelayMs'));
        await tidy(git, { restoreEditorFocus: true });
      })
      .catch(reportError);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
