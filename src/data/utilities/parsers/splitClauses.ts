import { arraySource, placeholderSource } from './maskStrings'

/**
 * The clauses each command allows, in the order they must come. create, drop, describe and show have their own
 * parsers and never get here.
 */
export const clauseOrder: { [command: string]: string[] } = {
  read: ['select', 'on', 'merge', 'where', 'group by', 'sort', 'limit', 'offset'],
  insert: ['values'],
  update: ['set', 'where'],
  delete: ['where'],
}

const clauseWords: string[] = [...new Set(Object.values(clauseOrder).flat())]

// The command, the record name and an optional joined record (`read workouts.exercises`, or `read workouts .exercises`)
const headMatch: RegExp = /^\s*(delete|insert|read|update)\s+([a-z0-9_-]+(\s*\.[a-z0-9_-]+)?)/i

// Placeholders (see maskStrings) as one token each, so their hex can't read as a word; words; then the two-character
// comparators before any other single character
const tokenMatch: RegExp = new RegExp(`${placeholderSource}|${arraySource}|[a-z0-9_.-]+|<>|!=|>=|<=|\\S`, 'gi')

// What can follow a field in a condition: a clause word followed by one of these is a field (`where limit = 1`)
const conditionWords: string[] = ['=', '!=', '<>', '>', '<', '>=', '<=', 'in', 'between', 'like', 'is', 'exists', 'does']

// `and on` carries on the on clause instead of starting another; so does a merge straight after another
// (`merge a.x with b.y merge c.z with d.w`, with or without `and`)
const continues: { [clause: string]: (previous: string) => boolean } = {
  on: previous => previous === 'and',
  merge: () => true,
}

// What a second where clause should have been: its conditions joined with and / or inside the first
export const whereHint = 'use and / or inside one where clause (where a = 1 and b = 2)'

export type SplitClause = {
  // The clause word(s), lowercase (`group by`)
  keyword: string
  // The text after the clause word(s), up to the next clause, trimmed (strings and arrays still placeholders)
  body: string
}

export type SplitQuery = {
  command: string
  // The command and record name(s), as written
  head: string
  // Any text between the head and the first clause, trimmed (parseQuery refuses it)
  leading: string
  clauses: SplitClause[]
}

/**
 * Split a masked query (see maskStrings) into its clauses, reading its top-level words once, left to right. A clause
 * word counts only as a whole word outside brackets, and not where it must be a name: as a clause's first word
 * (`sort limit`), after a comma or `as`, or before a comparator (`where limit = 1`).
 * @param query
 * @returns undefined when the query doesn't start with read, insert, update or delete (left to the find* steps).
 * @throws {Error} For a joined record outside read, a clause the command doesn't allow, a repeated clause, a clause out
 * of order, or the 2.x forms of a second where (`and where`, `or where`, or a plain repeat).
 */
export const splitClauses = (query: string): SplitQuery | undefined => {
  const head = query.match(headMatch)
  if (!head) {
    return undefined
  }
  const command = head[1].toLowerCase()
  const allowed = clauseOrder[command]
  const article = /^[aeiou]/.test(command) ? 'an' : 'a'
  if (head[3] && command !== 'read') {
    throw new Error(`A joined record (${head[2]}) isn't allowed in ${article} ${command} query`)
  }
  const tokens = [...query.slice(head[0].length).matchAll(tokenMatch)]
    .map(({ 0: text, index }) => ({ text, lower: text.toLowerCase(), start: head[0].length + index }))

  const found: { keyword: string, start: number, end: number }[] = []
  let depth = 0
  let bodyStarts = false
  for (let index = 0; index < tokens.length; index++) {
    const { lower, start } = tokens[index]
    const previous = tokens[index - 1]?.lower
    const next = tokens[index + 1]?.lower
    if (lower === '(' || lower === ')') {
      depth += lower === '(' ? 1 : -1
    }
    const keyword = lower === 'group' && next === 'by' ? 'group by' : lower
    const isName = bodyStarts || previous === ',' || previous === 'as' || conditionWords.includes(next)
    bodyStarts = false
    if (depth > 0 || keyword === 'by' || !clauseWords.includes(keyword) || isName) {
      continue
    }
    const current = found[found.length - 1]?.keyword
    if (current === keyword && continues[keyword]?.(previous)) {
      continue
    }
    // 2.x read `and where` / `or where` as `and` / `or`, and a second where as `and`
    const hasWhere = found.some(clause => clause.keyword === 'where')
    if (keyword === 'where' && hasWhere && (previous === 'and' || previous === 'or')) {
      throw new Error(`"${previous} where" is no longer supported: ${whereHint}`)
    }
    if (!allowed.includes(keyword)) {
      throw new Error(`"${keyword}" isn't allowed in ${article} ${command} query (allowed: ${allowed.join(', ')})`)
    }
    if (current && allowed.indexOf(keyword) < allowed.indexOf(current)) {
      throw new Error(`"${keyword}" can't come after "${current}" (order: ${allowed.join(', ')})`)
    }
    if (found.some(clause => clause.keyword === keyword)) {
      throw new Error(`Only one "${keyword}" clause is allowed${keyword === 'where' ? `: ${whereHint}` : ''}`)
    }
    if (keyword === 'group by') {
      index++
    }
    found.push({ keyword, start, end: tokens[index].start + tokens[index].text.length })
    bodyStarts = true
  }

  return {
    command,
    head: head[0].trim(),
    leading: query.slice(head[0].length, found[0]?.start ?? query.length).trim(),
    clauses: found.map(({ keyword, end }, index) => ({
      keyword,
      body: query.slice(end, found[index + 1]?.start ?? query.length).trim()
    })),
  }
}
