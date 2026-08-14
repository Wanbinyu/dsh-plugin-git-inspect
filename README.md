# dsh-plugin-git-inspect

Read-only Git inspection tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This plugin adds three model-facing tools:

- `git_status`: current branch and working-tree status.
- `git_diff`: working-tree or staged diff, optionally limited to a path.
- `git_log`: compact recent history, optionally limited to a path.

The plugin never runs a shell. It resolves `git` through `ctx.subprocess`, passes a fixed argv vector, forwards the tool cancellation signal, disables the pager and optional Git locks, and bounds captured output. It intentionally does not provide `commit`, `push`, `reset`, `stash`, or other mutating operations.

## Install

The package is designed for the DeepSeek Harness developer-preview line:

```sh
npm install dsh-plugin-git-inspect
```

The host composition must already provide `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-system-prompt`, and `@deepseek-ai/dsh-subprocess`.

## Configure

Add the plugin to a Cordis composition:

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

The host must also mount a subprocess provider such as `@deepseek-ai/dsh-subprocess-local`. See [`examples/cordis.yml`](examples/cordis.yml) for an overlay example.

## Development

```sh
npm install
npm run verify
```

The test suite creates temporary Git repositories and exercises the real `git` executable through the local Harness subprocess provider.

## Compatibility

DeepSeek Harness is in developer preview and may make breaking changes. The package peers currently target the `0.1.0-rc.x` package line. Pin the plugin and Harness packages together in production compositions.

## Upstream status

DeepSeek Harness currently asks community authors to publish independent plugins with the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic and share them in Discussions. Its contributing guide currently says that external pull requests are not accepted.

## License

MIT
