import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
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
    callId: ToolCallId(`git-test-${++calls}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: agent(),
  })
}

describe('dsh-plugin-git-inspect', () => {
  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(join(tmpdir(), 'dsh-git-inspect-')))
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

  it('registers the read-only tools and prompt guidance', async () => {
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'git_blame', 'git_conflicts', 'git_diff', 'git_diff_stat', 'git_log',
      'git_refs', 'git_show', 'git_stash_list', 'git_status', 'git_worktree_list',
    ])
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('git_conflicts, git_blame, git_stash_list, and git_worktree_list')
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

  it('returns a bounded diff summary, revision output, and refs', async () => {
    await writeFile(join(workspace, 'tracked.txt'), 'after\n')
    const stat = await call('git_diff_stat')
    expect(stat.isError).toBe(false)
    expect(text(stat)).toContain('tracked.txt')

    const shown = await call('git_show', { revision: 'HEAD', path: 'tracked.txt' })
    expect(shown.isError).toBe(false)
    expect(text(shown)).toContain('initial fixture')
    expect(text(shown)).toContain('before')

    const refs = await call('git_refs', { maxCount: 1 })
    expect(refs.isError).toBe(false)
    expect(text(refs)).toMatch(/(main|master)\s+[0-9a-f]+/)
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

  it('shows bounded blame, stash entries, and registered worktrees without changing them', async () => {
    const blame = await call('git_blame', { path: 'tracked.txt', startLine: 1, lineCount: 1_000 })
    expect(blame.isError).toBe(false)
    expect(text(blame)).toContain('Harness Test')
    expect(text(blame)).toContain('before')

    await writeFile(join(workspace, 'tracked.txt'), 'stashed\n')
    await git(['stash', 'push', '-m', 'fixture stash'])
    const stashes = await call('git_stash_list', { maxCount: 1 })
    expect(stashes.isError).toBe(false)
    expect(text(stashes)).toContain('stash@{0}')
    expect(text(stashes)).toContain('fixture stash')

    const worktrees = await call('git_worktree_list')
    expect(worktrees.isError).toBe(false)
    expect(text(worktrees)).toContain(`worktree ${workspace.replaceAll('\\', '/')}`)
    expect(text(worktrees)).toContain('HEAD ')
  })

  it('lists unresolved conflict paths without resolving or modifying them', async () => {
    await git(['checkout', '-q', '-b', 'conflict-base'])
    await git(['checkout', '-q', '-b', 'incoming'])
    await writeFile(join(workspace, 'tracked.txt'), 'incoming\n')
    await git(['add', 'tracked.txt'])
    await git(['commit', '-q', '-m', 'incoming change'])
    await git(['checkout', '-q', 'conflict-base'])
    await writeFile(join(workspace, 'tracked.txt'), 'base\n')
    await git(['add', 'tracked.txt'])
    await git(['commit', '-q', '-m', 'base change'])

    await expect(git(['merge', 'incoming'])).rejects.toThrow()
    const conflicts = await call('git_conflicts')
    expect(conflicts.isError).toBe(false)
    expect(text(conflicts)).toContain('tracked.txt')
    expect(await readFile(join(workspace, 'tracked.txt'), 'utf8')).toContain('<<<<<<<')
  })

  it('rejects blank paths and reports a missing repository as an error', async () => {
    const invalid = await call('git_diff', { path: '  ' })
    expect(invalid.isError).toBe(true)
    expect(text(invalid)).toContain('path must be a non-empty string')

    const missing = await mkdtemp(join(tmpdir(), 'dsh-git-no-repo-'))
    try {
      const result = await ctx.tools.execute({
        callId: ToolCallId(`git-test-${++calls}`),
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
    expect(GitInspect.buildDiffStatArgs(false, '--danger.txt').at(-2)).toBe('--')
    expect(GitInspect.buildShowArgs('--danger-revision', '--danger.txt')).toEqual(expect.arrayContaining([
      '--end-of-options', '--danger-revision', '--', '--danger.txt',
    ]))
    expect(GitInspect.buildConflictsArgs('--danger.txt').at(-2)).toBe('--')
    expect(GitInspect.buildConflictsArgs('--danger.txt').at(-1)).toBe('--danger.txt')
    expect(GitInspect.buildBlameArgs('--danger.txt', 2, 5)).toEqual(expect.arrayContaining([
      '-L', '2,+5', '--', '--danger.txt',
    ]))
  })

  it('caps requested log count in the tool presenter', () => {
    expect(GitInspect.buildLogArgs(100, 'src/file.ts')).toEqual(expect.arrayContaining(['-n', '100', '--', 'src/file.ts']))
  })
})
