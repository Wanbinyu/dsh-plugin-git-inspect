# dsh-plugin-git-inspect

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的只读 Git 检查插件。

插件提供三个工具：

- `git_status`：查看当前分支和工作区状态。
- `git_diff`：查看工作区或暂存区 diff，也可以限制到指定路径。
- `git_log`：查看紧凑格式的最近提交，也可以限制到指定路径。

插件不会运行 shell，而是通过 `ctx.subprocess` 解析 `git`，使用固定 argv 启动进程，转发工具取消信号，关闭 pager 和 Git 可选锁，并限制输出大小。第一版刻意不提供 `commit`、`push`、`reset`、`stash` 等写操作。

## 安装

```sh
npm install dsh-plugin-git-inspect
```

宿主组合需要已经提供 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt` 和 `@deepseek-ai/dsh-subprocess`。

## 配置

在 Cordis 组合中加入：

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

宿主还需要挂载 `@deepseek-ai/dsh-subprocess-local` 等子进程实现。可参考 [`examples/cordis.yml`](examples/cordis.yml) 的 overlay 示例。

## 开发

```sh
npm install
npm run verify
```

测试会创建临时 Git 仓库，并通过 Harness 的本地 subprocess provider 调用真实 `git`。

## 兼容性

DeepSeek Harness 目前处于 developer preview，可能发生破坏性变更。插件 peer 依赖当前面向 `0.1.0-rc.x`，正式使用时应将插件与 Harness 依赖一起固定版本。

## 上游状态

DeepSeek Harness 当前建议社区作者创建独立插件仓库、添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic，并在 Discussions 分享。官方贡献指南目前仍说明暂不接受外部 Pull Request。

## 许可证

MIT
