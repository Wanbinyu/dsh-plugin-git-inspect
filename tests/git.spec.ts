import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as GitInspect from '../src/index.ts'

const execFileAsync = promisify(execFile)
let workspace: string
let ctx: Context
let subprocessFiber: { dispose(): Promise<void> }
let calls = 0

async function git(args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd: workspace,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    windowsHide: true,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

function agent() {
  return { session: { header: { id: 'git-test-session', cwd: workspace } } } as never
}

function call(name: string, args: unknown = {}) {
  return ctx.tools.execute({
    callId: CallId(`git-test-${++calls}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: agent(),
  })
}

describe('dsh-plugin-git-inspect', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dsh-git-inspect-'))
    await writeFile(join(workspace, 'README.md'), '# fixture\n')
    await writeFile(join(workspace, 'tracked.txt'), 'before\n')
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(GitInspect)
    await git(['init', '-q'])
    await git(['config', 'user.name', 'Harness Test'])
    await git(['config', 'user.email', 'harness@example.invalid'])
    await git(['add', 'README.md', 'tracked.txt'])
    await git(['commit', '-q', '-m', 'initial fixture'])
  })

  afterEach(async () => {
    await subprocessFiber.dispose()
    await rm(workspace, { recursive: true, force: true })
  })

  it('registers the three read-only tools and prompt guidance', async () => {
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['git_diff', 'git_log', 'git_status'])
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Use git_status, git_diff, and git_log')
  })

  it('reports branch and untracked changes from the session cwd', async () => {
    await writeFile(join(workspace, 'new.txt'), 'untracked\n')
    const result = await call('git_status')
    expect(result.isError).toBe(false)
    expect(text(result)).toMatch(/## (main|master)/)
    expect(text(result)).toContain('?? new.txt')
    expect(result.value).toMatchObject({ operation: 'status', truncated: false })
  })

  it('returns working-tree and staged diffs without changing files', async () => {
    await writeFile(join(workspace, 'tracked.txt'), 'after\n')
    const working = await call('git_diff', { path: 'tracked.txt' })
    expect(working.isError).toBe(false)
    expect(text(working)).toContain('+after')

    await git(['add', 'tracked.txt'])
    const staged = await call('git_diff', { staged: true, path: 'tracked.txt' })
    expect(staged.isError).toBe(false)
    expect(text(staged)).toContain('+after')
    expect(await readFile(join(workspace, 'tracked.txt'), 'utf8')).toBe('after\n')
  })

  it('returns capped recent history and supports path filtering', async () => {
    await writeFile(join(workspace, 'tracked.txt'), 'second\n')
    await git(['add', 'tracked.txt'])
    await git(['commit', '-q', '-m', 'second fixture'])
    const result = await call('git_log', { maxCount: 1, path: 'tracked.txt' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('second fixture')
    expect(text(result)).not.toContain('initial fixture')
  })

  it('rejects blank paths and reports a missing repository as an error', async () => {
    const invalid = await call('git_diff', { path: '  ' })
    expect(invalid.isError).toBe(true)
    expect(text(invalid)).toContain('path must be a non-empty string')

    const missing = await mkdtemp(join(tmpdir(), 'dsh-git-no-repo-'))
    try {
      const result = await ctx.tools.execute({
        callId: CallId(`git-test-${++calls}`),
        name: 'git_status',
        arguments: {},
        signal: new AbortController().signal,
        agent: { session: { header: { id: 'missing-repo', cwd: missing } } } as never,
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not a git repository')
    } finally {
      await rm(missing, { recursive: true, force: true })
    }
  })
})

describe('argv construction', () => {
  it('keeps user paths after git pathspec separator', () => {
    expect(GitInspect.buildDiffArgs(false, '$(touch pwned)')).toContain('$(touch pwned)')
    const args = GitInspect.buildDiffArgs(false, '--danger.txt')
    expect(args.at(-2)).toBe('--')
    expect(args.at(-1)).toBe('--danger.txt')
  })

  it('caps requested log count in the tool presenter', () => {
    expect(GitInspect.buildLogArgs(100, 'src/file.ts')).toEqual(expect.arrayContaining(['-n', '100', '--', 'src/file.ts']))
  })
})
