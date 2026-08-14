# dsh-plugin-git-inspect

[![许可证：MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的只读 Git 检查插件。

> [!NOTE]
> 这是独立的社区插件，不属于 DeepSeek Harness 官方发行版。

[English README](README.md)

## 功能

插件向模型注册三个工具：

| 工具 | 作用 | 可选参数 |
| --- | --- | --- |
| `git_status` | 查看当前分支和工作区状态。 | 无 |
| `git_diff` | 查看工作区 diff 或暂存区 diff。 | `staged`、`path` |
| `git_log` | 以紧凑的一行格式查看最近提交。 | `maxCount`、`path` |

工作目录优先取当前 Harness 会话的 `session.header.cwd`；会话未提供目录时，回退到宿主进程的当前工作目录。

## 安全边界

- 不执行 shell。插件通过 Harness 的 subprocess 服务解析 `git`，并使用固定的 argv 启动进程。
- 用户传入的路径始终放在 Git 的 `--` pathspec 分隔符之后，不经过 shell 展开。
- 关闭 pager、颜色、外部 diff、textconv、可选 Git 锁和终端交互提示，保证自动化输出稳定。
- 只提供检查操作，不提供 `commit`、`push`、`reset`、`stash`、切换分支或文件修改能力。
- 转发 Harness 的取消信号，并限制 stdout/stderr 的捕获大小。
- 输出达到上限时，结果会明确标记为截断。

## 环境要求

- Windows、macOS 或 Linux，且宿主 PATH 中可以找到 `git`。
- Node.js `>=22.19.0`。
- Harness 组合需要提供：
  - `@deepseek-ai/dsh-tools`
  - `@deepseek-ai/dsh-system-prompt`
  - `@deepseek-ai/dsh-subprocess`
- 还需要一个 subprocess 实现，例如 `@deepseek-ai/dsh-subprocess-local`。

当前插件面向 Harness `0.1.0-rc.x` 开发预览版本，并且暂未发布到 npm。

## 从 GitHub 安装

在负责 Harness 组合的项目中安装当前仓库版本：

```sh
npm install github:Wanbinyu/dsh-plugin-git-inspect
```

通过 Git 安装时，插件的 `prepare` 脚本会自动构建 TypeScript 入口，运行时文件会生成在 `dist/` 目录。

## 配置

在已经挂载 Harness 必需服务的 Cordis 组合中加入：

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

仓库中的 [`examples/cordis.yml`](examples/cordis.yml) 提供了 overlay 示例。该示例不会自动安装 subprocess provider，provider 仍由宿主组合负责。

### 配置项

所有限制必须是正整数，且 `defaultLogCount` 不能大于 `maxLogCount`。

| 配置项 | 默认值 | 作用 |
| --- | ---: | --- |
| `timeoutMs` | `30000` | 传递给 Harness 工具的最长执行时间。 |
| `maxOutputBytes` | `200000` | stdout 捕获上限。 |
| `stderrMaxBytes` | `16384` | stderr 捕获上限。 |
| `graceMs` | `1000` | Git 子进程终止时的宽限时间。 |
| `defaultLogCount` | `20` | 未传 `git_log.maxCount` 时的提交数量。 |
| `maxLogCount` | `100` | `git_log.maxCount` 的最大值。 |

## 工具调用示例

```json
{"name":"git_status","arguments":{}}
```

```json
{"name":"git_diff","arguments":{"staged":true,"path":"src/index.ts"}}
```

```json
{"name":"git_log","arguments":{"maxCount":10,"path":"src/index.ts"}}
```

Git 返回非零退出码、目录不是仓库、路径为空、请求被取消或子进程异常终止时，插件会返回结构化工具错误，不会伪装成成功输出。

## 本地开发

```sh
git clone https://github.com/Wanbinyu/dsh-plugin-git-inspect.git
cd dsh-plugin-git-inspect
npm install
npm run verify
npm run build
npm pack --dry-run
```

测试会创建临时 Git 仓库，并通过 Harness 的本地 subprocess provider 调用真实 `git`，覆盖分支状态、工作区和暂存区 diff、路径过滤历史、输出限制、错误路径和 argv 安全性。

## 项目边界

这是一个面向 Agent 工作流的只读检查层。写操作、远程同步、分支切换、worktree 管理和文件编辑均不在范围内，便于宿主组合单独制定审批策略。

## 链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [GitHub 仓库](https://github.com/Wanbinyu/dsh-plugin-git-inspect)
- [Issues](https://github.com/Wanbinyu/dsh-plugin-git-inspect/issues)
- [English README](README.md)

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。
