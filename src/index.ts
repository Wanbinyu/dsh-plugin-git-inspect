import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SubprocessOutputRead } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'tool-git-inspect'
export const inject = ['tools', 'subprocess', 'systemPrompt']

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_OUTPUT_BYTES = 200_000
export const DEFAULT_STDERR_MAX_BYTES = 16_384
export const DEFAULT_GRACE_MS = 1_000
export const DEFAULT_LOG_COUNT = 20
export const DEFAULT_MAX_LOG_COUNT = 100

export interface Config {
  timeoutMs?: number
  maxOutputBytes?: number
  stderrMaxBytes?: number
  graceMs?: number
  defaultLogCount?: number
  maxLogCount?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxOutputBytes: z.number().default(DEFAULT_MAX_OUTPUT_BYTES),
  stderrMaxBytes: z.number().default(DEFAULT_STDERR_MAX_BYTES),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
  defaultLogCount: z.number().default(DEFAULT_LOG_COUNT),
  maxLogCount: z.number().default(DEFAULT_MAX_LOG_COUNT),
})

type ResolvedConfig = Required<Config>
type GitOperation = 'status' | 'diff' | 'diff_stat' | 'log' | 'show' | 'refs'

export interface GitResult {
  operation: GitOperation
  cwd: string
  stdout: string
  stderr: string
  truncated: boolean
}

const gitOutputSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    operation: { type: 'string' as const, required: true as const },
    cwd: { type: 'string' as const, required: true as const },
    stdout: { type: 'string' as const, required: true as const },
    stderr: { type: 'string' as const, required: true as const },
    truncated: { type: 'boolean' as const, required: true as const },
  },
}

const GIT_PREFIX = [
  '--no-pager',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.quotepath=false',
] as const

export function buildStatusArgs(): string[] {
  return [
    ...GIT_PREFIX,
    'status',
    '--short',
    '--branch',
    '--untracked-files=normal',
  ]
}

export function buildDiffArgs(staged: boolean, path?: string): string[] {
  return [
    ...GIT_PREFIX,
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    ...(staged ? ['--cached'] : []),
    '--',
    ...(path === undefined ? [] : [path]),
  ]
}

export function buildDiffStatArgs(staged: boolean, path?: string): string[] {
  return [
    ...GIT_PREFIX,
    'diff',
    '--stat',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    ...(staged ? ['--cached'] : []),
    '--',
    ...(path === undefined ? [] : [path]),
  ]
}

export function buildLogArgs(maxCount: number, path?: string): string[] {
  return [
    ...GIT_PREFIX,
    'log',
    '--no-color',
    '--decorate=short',
    '--oneline',
    '-n',
    String(maxCount),
    '--',
    ...(path === undefined ? [] : [path]),
  ]
}

export function buildShowArgs(revision: string, path?: string): string[] {
  return [
    ...GIT_PREFIX,
    'show',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--format=fuller',
    '--end-of-options',
    revision,
    '--',
    ...(path === undefined ? [] : [path]),
  ]
}

export function buildRefsArgs(maxCount: number): string[] {
  return [
    ...GIT_PREFIX,
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short) %(objectname:short) %(committerdate:iso-strict)',
    '--count',
    String(maxCount),
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`git-inspect: ${name} must be a positive integer`)
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    stderrMaxBytes: config.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES,
    graceMs: config.graceMs ?? DEFAULT_GRACE_MS,
    defaultLogCount: config.defaultLogCount ?? DEFAULT_LOG_COUNT,
    maxLogCount: config.maxLogCount ?? DEFAULT_MAX_LOG_COUNT,
  }
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  assertPositiveInteger('maxOutputBytes', resolved.maxOutputBytes)
  assertPositiveInteger('stderrMaxBytes', resolved.stderrMaxBytes)
  assertPositiveInteger('graceMs', resolved.graceMs)
  assertPositiveInteger('defaultLogCount', resolved.defaultLogCount)
  assertPositiveInteger('maxLogCount', resolved.maxLogCount)
  if (resolved.defaultLogCount > resolved.maxLogCount) {
    throw new Error('git-inspect: defaultLogCount must not exceed maxLogCount')
  }
  return resolved
}

function optionalPath(path: string | undefined): string | undefined {
  if (path !== undefined && path.trim().length === 0) {
    throw new Error('path must be a non-empty string when given')
  }
  return path
}

function requiredRevision(revision: string): string {
  if (revision.trim().length === 0) throw new Error('revision must be a non-empty string')
  return revision
}

function boundedLogCount(value: number | undefined, config: ResolvedConfig): number {
  const count = value ?? config.defaultLogCount
  assertPositiveInteger('maxCount', count)
  return Math.min(count, config.maxLogCount)
}

function normalize(text: string): string {
  return text.replaceAll('\r\n', '\n')
}

function collected(handle: { collected: { stdout?: { readFrom(fromByte: number): SubprocessOutputRead }; stderr?: { readFrom(fromByte: number): SubprocessOutputRead } } }): {
  stdout: SubprocessOutputRead
  stderr: SubprocessOutputRead
} {
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout === undefined || stderr === undefined) {
    throw new Error('git-inspect: subprocess did not provide collected output streams')
  }
  return { stdout, stderr }
}

async function runGit(
  ctx: Context,
  exec: ToolRunContext,
  operation: GitOperation,
  argv: readonly string[],
  config: ResolvedConfig,
): Promise<GitResult> {
  if (exec.signal.aborted) throw new Error(`git ${operation} was aborted before start`)
  const cwd = exec.agent?.session.header.cwd?.trim() || process.cwd()
  const executable = await ctx.subprocess.resolveExecutable('git', undefined, exec.signal)
  const handle = ctx.subprocess.spawn({
    argv: [executable, ...argv],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: config.maxOutputBytes },
      stderr: { maxBytes: config.stderrMaxBytes },
    },
    graceMs: config.graceMs,
    signal: exec.signal,
    env: {
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
    },
  })

  let outcome: { exitCode: number | null; signal: string | null }
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    throw new Error(`git ${operation} could not start: ${String(error)}`, { cause: error })
  }
  if (exec.signal.aborted) throw new Error(`git ${operation} was aborted`)
  const streams = collected(handle)
  if (outcome.signal !== null || outcome.exitCode === null) {
    throw new Error(`git ${operation} was terminated by ${outcome.signal ?? 'an unknown signal'}`)
  }
  const stdout = normalize(streams.stdout.text)
  const stderr = normalize(streams.stderr.text)
  if (outcome.exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim() || 'no diagnostic output'
    throw new Error(`git ${operation} failed with exit code ${outcome.exitCode}: ${detail}`)
  }
  return {
    operation,
    cwd,
    stdout,
    stderr,
    truncated: streams.stdout.lossy || streams.stderr.lossy,
  }
}

function renderResult(value: Pick<GitResult, 'stdout' | 'stderr' | 'truncated'>): string {
  const body = value.stdout.trimEnd()
  const stderr = value.stderr.trim()
  const sections = [body]
  if (stderr.length > 0) sections.push(`stderr:\n${stderr}`)
  if (value.truncated) sections.push('Output was truncated at the configured limit; narrow the path or reduce the requested history.')
  return sections.filter(section => section.length > 0).join('\n\n') || '(no output)'
}

function callView(title: string, rawInput?: unknown): GenericCallView {
  return {
    card: 'generic',
    title,
    kind: 'read',
    ...(rawInput === undefined ? {} : { rawInput }),
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:git-inspect',
    order: 104,
    text: 'Use git_status, git_diff, git_diff_stat, git_log, git_show, and git_refs for read-only repository inspection. These tools do not commit, push, reset, stash, or modify files.',
  })

  ctx.tools.register(defineTool({
    name: 'git_status',
    description: 'Show the current Git branch and working-tree status. Read-only; does not modify the repository.',
    parameters: {},
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: gitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    execute: (args, exec) => runGit(ctx, exec, 'status', buildStatusArgs(), resolved),
    presentCall: () => callView('Git status'),
  }))

  ctx.tools.register(defineTool({
    name: 'git_diff_stat',
    description: 'Show a compact file-level summary of working-tree or staged changes. Read-only; use staged=true for the index.',
    parameters: {
      staged: { type: 'boolean', description: 'Show the staged index summary instead of the working-tree summary.' },
      path: { type: 'string', description: 'Limit the summary to one repository-relative path.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: gitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    execute: (args, exec) => {
      const path = optionalPath(args.path)
      return runGit(ctx, exec, 'diff_stat', buildDiffStatArgs(args.staged === true, path), resolved)
    },
    presentCall: args => callView(args.staged === true ? 'Git staged diff stat' : 'Git diff stat', args.path),
  }))

  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: 'Show a bounded, no-color Git diff for the working tree or index. Read-only; use staged=true for the index.',
    parameters: {
      staged: { type: 'boolean', description: 'Show the staged index diff instead of the working-tree diff.' },
      path: { type: 'string', description: 'Limit the diff to one repository-relative path.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: gitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    execute: (args, exec) => {
      const path = optionalPath(args.path)
      return runGit(ctx, exec, 'diff', buildDiffArgs(args.staged === true, path), resolved)
    },
    presentCall: args => callView(args.staged === true ? 'Git staged diff' : 'Git diff', args.path),
  }))

  ctx.tools.register(defineTool({
    name: 'git_log',
    description: 'Show recent Git commits in compact one-line form. Read-only and capped by the plugin configuration.',
    parameters: {
      maxCount: { type: 'number', description: `Maximum commits to show, capped at ${resolved.maxLogCount}.` },
      path: { type: 'string', description: 'Limit history to one repository-relative path.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: gitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    execute: (args, exec) => {
      const path = optionalPath(args.path)
      return runGit(ctx, exec, 'log', buildLogArgs(boundedLogCount(args.maxCount, resolved), path), resolved)
    },
    presentCall: args => callView(`Git log (${boundedLogCount(args.maxCount, resolved)} commits)`, args.path),
  }))

  ctx.tools.register(defineTool({
    name: 'git_show',
    description: 'Show one Git revision, optionally limited to a repository-relative path. Read-only and output-bounded.',
    parameters: {
      revision: { type: 'string', required: true, description: 'Commit, tag, or other Git revision to display.' },
      path: { type: 'string', description: 'Limit the revision output to one repository-relative path.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: gitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    execute: (args, exec) => {
      const revision = requiredRevision(args.revision)
      const path = optionalPath(args.path)
      return runGit(ctx, exec, 'show', buildShowArgs(revision, path), resolved)
    },
    presentCall: args => callView(`Git show ${args.revision}`, args.path),
  }))

  ctx.tools.register(defineTool({
    name: 'git_refs',
    description: 'List recent local branches, remote-tracking branches, and tags. Read-only and capped by the plugin configuration.',
    parameters: {
      maxCount: { type: 'number', description: `Maximum refs to show, capped at ${resolved.maxLogCount}.` },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: gitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    execute: (args, exec) => runGit(ctx, exec, 'refs', buildRefsArgs(boundedLogCount(args.maxCount, resolved)), resolved),
    presentCall: args => callView(`Git refs (${boundedLogCount(args.maxCount, resolved)} refs)`, args.maxCount),
  }))
}
