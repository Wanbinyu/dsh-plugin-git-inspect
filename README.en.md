# dsh-plugin-git-inspect

[简体中文](README.md) | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Read-only Git visibility for agents running inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> [!NOTE]
> This is an independent community plugin. It is not part of the official DeepSeek Harness distribution.

## What It Adds

The plugin registers six read-only model-facing tools:

| Tool | Purpose | Optional arguments |
| --- | --- | --- |
| `git_status` | Show the current branch and working-tree status. | None |
| `git_diff` | Show the working-tree diff or the staged index diff. | `staged`, `path` |
| `git_diff_stat` | Show a file-level summary of changes. | `staged`, `path` |
| `git_log` | Show recent commits in compact one-line form. | `maxCount`, `path` |
| `git_show` | Show a selected commit, tag, or other revision. | `revision`, `path` |
| `git_refs` | List recent local branches, remote-tracking branches, and tags. | `maxCount` |

The working directory comes from the active Harness session (`session.header.cwd`). When a session does not provide one, the plugin falls back to the host process working directory.

## Safety Model

- It never invokes a shell. `git` is resolved through the Harness subprocess service and started with a fixed argv vector.
- User paths are passed after Git's `--` pathspec separator; shell expansion is never involved.
- Pager, color, external diff, text conversion, optional Git locks, and terminal prompts are disabled for predictable automation.
- Only inspection commands are exposed. There is no `commit`, `push`, `reset`, `stash`, checkout, or file-editing tool.
- The Harness cancellation signal is forwarded to the child process.
- stdout and stderr are bounded by configuration; the result reports when output was truncated.

## Requirements

- Windows, macOS, or Linux with `git` available on the host PATH.
- Node.js `>=22.19.0`.
- A DeepSeek Harness composition providing:
  - `@deepseek-ai/dsh-tools`
  - `@deepseek-ai/dsh-system-prompt`
  - `@deepseek-ai/dsh-subprocess`
- A subprocess implementation, such as `@deepseek-ai/dsh-subprocess-local`.

The plugin currently targets the Harness `0.1.0-rc.x` developer-preview line.

## Install As A Bundle

The repository ships `cordis.patch.yml` and declares `dsh.bundle` in `package.json`. With the Harness CLI installed, add it to the `web` profile:

```sh
dsh plugin --profile web add github:Wanbinyu/dsh-plugin-git-inspect
```

Restart dsh after installation. The bundle inserts the `git-inspect` row and installs the plugin runtime. You can inspect or customize [`cordis.patch.yml`](cordis.patch.yml).

## Manual Installation

If the host project needs to own the composition layer, install the package and add the row manually:

```sh
npm install github:Wanbinyu/dsh-plugin-git-inspect
```

Add this row to a Cordis composition that already provides the required Harness services:

```yaml
- id: git-inspect
  name: dsh-plugin-git-inspect
  config:
    timeoutMs: 30000
    maxOutputBytes: 200000
    stderrMaxBytes: 16384
    graceMs: 1000
    defaultLogCount: 20
    maxLogCount: 100
```

The repository includes an overlay example at [`examples/cordis.yml`](examples/cordis.yml). The overlay does not install a subprocess provider; that remains a host composition responsibility.

### Configuration

All limits must be positive integers. `defaultLogCount` cannot exceed `maxLogCount`.

| Option | Default | Effect |
| --- | ---: | --- |
| `timeoutMs` | `30000` | Maximum tool execution time supplied to Harness tools. |
| `maxOutputBytes` | `200000` | stdout capture limit. |
| `stderrMaxBytes` | `16384` | stderr capture limit. |
| `graceMs` | `1000` | Termination grace period for the Git subprocess. |
| `defaultLogCount` | `20` | Commit count used when `git_log.maxCount` is omitted. |
| `maxLogCount` | `100` | Upper bound for `git_log.maxCount`. |

## Tool Calls

```json
{"name":"git_status","arguments":{}}
```

```json
{"name":"git_diff","arguments":{"staged":true,"path":"src/index.ts"}}
```

```json
{"name":"git_log","arguments":{"maxCount":10,"path":"src/index.ts"}}
```

```json
{"name":"git_show","arguments":{"revision":"HEAD","path":"src/index.ts"}}
```

Non-zero Git exit codes, a missing repository, a blank path, an aborted request, or a terminated subprocess are reported as structured tool errors instead of being treated as successful output.

## Development

```sh
git clone https://github.com/Wanbinyu/dsh-plugin-git-inspect.git
cd dsh-plugin-git-inspect
npm install
npm run verify
npm run build
npm pack --dry-run
```

The integration suite creates temporary repositories and exercises the real `git` executable through the local Harness subprocess provider. It covers branch status, working-tree and staged diffs, diff summaries, revisions, refs, path-filtered history, bounded output, cancellation/error paths, and argv safety. GitHub Actions runs type checking, tests, and the package dry-run on Node.js 22.

## Scope

This plugin is a read-only inspection surface for agent workflows. Write operations, remote synchronization, branch switching, worktree management, and file editing are deliberately out of scope so a host composition can apply its own approval policy.

## Links

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [GitHub repository](https://github.com/Wanbinyu/dsh-plugin-git-inspect)
- [Issues](https://github.com/Wanbinyu/dsh-plugin-git-inspect/issues)
- [简体中文说明](README.md)

## License

MIT. See [`LICENSE`](LICENSE).
