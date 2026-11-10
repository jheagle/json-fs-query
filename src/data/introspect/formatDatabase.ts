import { jsonText, listFiles, readText, writeJson } from '../storage'
import { getSetting } from '../utilities/config'
import { requireNode } from '../utilities/requireNode'

export type formatResult = {
  files: number
  rewritten: number
}

/**
 * Rewrite every JSON file of the configured database (records, entries, indexes, `__RECORDS.json`) in one format:
 * 'compact' or 'pretty' (see configure). Files already in that format are left alone, so running it twice changes
 * nothing the second time. Writing in one format never stops the other from being read; this is for making a whole
 * database match, for example after changing `format` on a database written before.
 *
 * Every file is read and checked before any is written: one that isn't valid JSON fails the whole call with its path,
 * and nothing is changed (the public version runs as one statement, see withWriteSet). Node only.
 * @param format - Defaults to the configured format.
 * @throws {Error} When format is neither 'compact' nor 'pretty', when a file isn't valid JSON, or in a browser.
 */
export const formatDatabase = async (format: 'compact' | 'pretty' = getSetting('format', 'compact')): Promise<formatResult> => {
  requireNode('formatDatabase')
  if (format !== 'compact' && format !== 'pretty') {
    throw new Error(`Unknown format "${format}": use 'compact' or 'pretty'`)
  }
  const paths = (await listFiles()).filter(path => path.endsWith('.json'))
  const changes: Array<{ path: string, content: any }> = []
  for (const path of paths) {
    const text = await readText(path)
    let content: any
    try {
      content = JSON.parse(text)
    } catch (error) {
      throw new Error(`Could not format ${path}: ${(error as Error).message}`)
    }
    if (jsonText(content, format) !== text) {
      changes.push({ path, content })
    }
  }
  for (const { path, content } of changes) {
    await writeJson(path, content, format)
  }
  return { files: paths.length, rewritten: changes.length }
}
