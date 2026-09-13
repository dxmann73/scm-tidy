// SCM Tidy: collapse clean repositories in the Source Control view.
//
// VS Code has no API to collapse a single repository node. This extension
// collapses all repositories with the built-in command, then walks the SCM
// tree with list navigation commands and expands the rows that need
// attention. Row positions are computed by replicating VS Code's repository
// sort (scmViewService.ts compareRepositories). If that replica drifts from
// VS Code, the wrong rows get expanded; use "Show Computed Repository Order"
// to compare.

const vscode = require('vscode');
const path = require('path');

const ENABLED_KEY = 'scmTidy.enabled';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors compareFileNames in src/vs/base/common/comparers.ts.
function compareFileNames(a, b) {
  const result = collator.compare(a, b);
  if (result === 0 && a !== b) {
    return a < b ? -1 : 1;
  }
  return result;
}

// Mirrors comparePaths: segment by segment, shorter path first on equal prefix.
function comparePaths(a, b) {
  const partsA = a.split(path.sep);
  const partsB = b.split(path.sep);
  const length = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const result = compareFileNames(partsA[i], partsB[i]);
    if (result !== 0) {
      return result;
    }
  }
  return partsA.length - partsB.length;
}

// Mirrors getRepositoryName: workspace folder name for root repos, else basename.
function repositoryName(repo) {
  const folder = vscode.workspace.getWorkspaceFolder(repo.rootUri);
  if (folder && folder.uri.toString() === repo.rootUri.toString()) {
    return folder.name;
  }
  return path.basename(repo.rootUri.fsPath);
}

function workspaceFolderIndex(repo) {
  const folder = vscode.workspace.getWorkspaceFolder(repo.rootUri);
  if (!folder) {
    throw new Error(`SCM Tidy: repository outside workspace folders: ${repo.rootUri.fsPath}`);
  }
  return folder.index;
}

function sortRepositories(git) {
  const sortOrder = vscode.workspace.getConfiguration('scm').get('repositories.sortOrder');
  // repo.ui.selected is true for one repository only, so it cannot tell which
  // repositories the view shows. Assume all are visible.
  const visible = [...git.repositories];
  switch (sortOrder) {
    case 'discovery time':
      // Discovery follows workspace folder order. Git API order breaks ties,
      // e.g. nested repositories inside one folder.
      return visible
        .map((repo, openIndex) => ({ repo, openIndex, folderIndex: workspaceFolderIndex(repo) }))
        .sort((a, b) => a.folderIndex - b.folderIndex || a.openIndex - b.openIndex)
        .map(({ repo }) => repo);
    case 'path':
      return [...visible].sort((a, b) => comparePaths(a.rootUri.fsPath, b.rootUri.fsPath));
    case 'name':
      return [...visible].sort(
        (a, b) =>
          compareFileNames(repositoryName(a), repositoryName(b)) ||
          comparePaths(a.rootUri.fsPath, b.rootUri.fsPath),
      );
    default:
      throw new Error(`SCM Tidy: unsupported scm.repositories.sortOrder "${sortOrder}"`);
  }
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

async function tidy(git, { restoreEditorFocus }) {
  if (running) {
    log('tidy already running, skipped');
    return;
  }
  running = true;
  try {
    const stepDelayMs = vscode.workspace.getConfiguration('scmTidy').get('stepDelayMs');
    const sortOrder = vscode.workspace.getConfiguration('scm').get('repositories.sortOrder');
    log(`tidy: git state ${git.state}, ${git.repositories.length} repositories, sortOrder "${sortOrder}"`);
    const repos = sortRepositories(git);
    log(`tidy: ${repos.length} visible repositories`);
    // With one visible repository, the SCM tree shows no repository rows.
    if (repos.length < 2) {
      log('tidy: fewer than 2 visible repositories, nothing to do');
      return;
    }
    repos.forEach((repo, index) => {
      const reasons = attentionReasons(repo);
      log(`  row ${index}: ${repositoryName(repo)} ${reasons.length ? `expand (${reasons.join(', ')})` : 'collapse'}`);
    });
    const hadEditor = vscode.window.activeTextEditor !== undefined;

    log('run workbench.scm.focus');
    await run('workbench.scm.focus', stepDelayMs);
    log('run workbench.scm.action.collapseAllRepositories');
    await run('workbench.scm.action.collapseAllRepositories', stepDelayMs);

    // Bottom-up, so expanding a row never shifts the rows still to visit.
    for (let index = repos.length - 1; index >= 0; index--) {
      if (attentionReasons(repos[index]).length === 0) {
        continue;
      }
      log(`expand row ${index}: ${repositoryName(repos[index])}`);
      await run('list.focusFirst', stepDelayMs);
      for (let step = 0; step < index; step++) {
        await run('list.focusDown', stepDelayMs);
      }
      await run('list.expand', stepDelayMs);
    }
    await run('list.focusFirst', stepDelayMs);
    log('tidy: done');

    if (restoreEditorFocus && hadEditor) {
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }
  } finally {
    running = false;
  }
}

async function setEnabled(context, enabled) {
  await context.globalState.update(ENABLED_KEY, enabled);
  await vscode.commands.executeCommand('setContext', ENABLED_KEY, enabled);
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
  const enabled = context.globalState.get(ENABLED_KEY, false);
  await vscode.commands.executeCommand('setContext', ENABLED_KEY, enabled);

  // Register commands before waiting on Git, so a slow Git start never swallows them.
  const gitReady = getGitApi();
  gitReady.then(
    () => log('git API ready'),
    (error) => reportError(error),
  );

  async function runTidy() {
    output.show(true);
    log('command: tidy');
    try {
      await tidy(await gitReady, { restoreEditorFocus: false });
    } catch (error) {
      reportError(error);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('scmTidy.enable', async () => {
      await setEnabled(context, true);
      await runTidy();
    }),
    vscode.commands.registerCommand('scmTidy.disable', async () => {
      log('command: disable, expand all');
      await setEnabled(context, false);
      await vscode.commands.executeCommand('workbench.scm.action.expandAllRepositories');
    }),
    vscode.commands.registerCommand('scmTidy.tidy', runTidy),
    vscode.commands.registerCommand('scmTidy.showOrder', async () => {
      try {
        const git = await gitReady;
        const sortOrder = vscode.workspace.getConfiguration('scm').get('repositories.sortOrder');
        log("command: show order");
        output.appendLine(`scm.repositories.sortOrder: ${sortOrder}`);
        sortRepositories(git).forEach((repo, index) => {
          const reasons = attentionReasons(repo);
          const status = reasons.length ? `expand (${reasons.join(', ')})` : 'collapse';
          output.appendLine(`${index + 1}. ${repositoryName(repo)}  ${status}  ${repo.rootUri.fsPath}`);
        });
        output.show(true);
      } catch (error) {
        reportError(error);
      }
    }),
  );

  const config = vscode.workspace.getConfiguration('scmTidy');
  if (enabled && config.get('runOnStartup')) {
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
