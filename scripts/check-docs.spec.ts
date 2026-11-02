// The documentation check reads the repository's own documents, never what a harness or the System
// writes into a worktree beside them (docs/engineering/testing.md#ci-gates).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { checkDocs } from './check-docs.ts'

const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

describe('checkDocs', () => {
  it('reads no link in the files the System writes into a run\'s worktree (.system), which quote the change from elsewhere, but still finds a broken link in the tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-docs-'))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    put(join(dir, 'docs/README.md'), '# Docs\n')
    // A review quoted into the task's dossier: its relative link resolves from docs/design, not from .system.
    put(join(dir, '.system/DOSSIER.md'), '# Dossier\nevidence: \'[ADR-0032](../decisions/adr/README.md)\'\n')
    expect(checkDocs(dir)).toEqual([])
    put(join(dir, 'docs/design.md'), '# Design\n[gone](missing.md)\n')
    expect(checkDocs(dir)).toEqual([{ kind: 'broken-link', file: 'docs/design.md', detail: 'missing.md' }])
  })
})
