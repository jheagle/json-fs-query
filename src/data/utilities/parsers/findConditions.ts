import { numberSource, parseLiteralValue, LiteralValue } from './parseLiteralValue'
import { ParsedQuery } from './parseQuery'
import { ConditionNode, isCondition } from '../conditionTree'
import { arraySource, placeholderSource, unmaskStrings } from './maskStrings'
import { whereHint } from './splitClauses'

export type ConditionValue = LiteralValue

export type ParsedCondition = {
  property: string
  comparator: string
  value: ConditionValue
  // The field's declared type, resolved from its record when the condition runs (see where)
  type?: string
}

// Keywords count only as whole words: in `on t.x = u.color where ...` the `or` is part of the name `color`
const wordEnd = '(?![a-z0-9_.-])'
const keyword = (words: string): RegExp => new RegExp(`^(?:${words})${wordEnd}`, 'i')

// One condition, at the start of the text: a field, then `is [not] null` / `exists` / `does not exist`, or a comparator
// and a value (strings and arrays are placeholders by then, see maskStrings)
const conditionMatch: RegExp = new RegExp(`^([a-z0-9_-]+\\.?[a-z0-9_-]*)\\s+(?:(is\\s+not\\s+null|is\\s+null|exists|does\\s+not\\s+exist)${wordEnd}|(<>|!=|>=|<=|=|>|<|in|between|like)\\s+(${placeholderSource}|(${numberSource})|${arraySource}|(null)|(true)|(false)))`, 'i')

/**
 * Read one condition from a match of conditionMatch.
 * @param match
 * @throws {Error} For a comparison with null, and a null between bound: they could never match (null equals nothing).
 */
const readCondition = (match: RegExpMatchArray): ParsedCondition => {
  const property = match[1]
  if (typeof match[2] !== 'undefined') {
    return { property, comparator: match[2].toLowerCase().replace(/\s+/g, ' '), value: null }
  }
  const comparator = match[3].toLowerCase()
  const value = parseLiteralValue(match, 5)
  if (value === null) {
    throw new Error(`\`${property} ${comparator} null\` never matches (null equals nothing, as in SQL): use \`${property} is null\` or \`${property} is not null\``)
  }
  if (comparator === 'between' && Array.isArray(value) && value.includes(null)) {
    throw new Error(`\`${property} between\` can't have a null bound: it would never match`)
  }
  return { property, comparator, value }
}

/**
 * Join nodes with `and` or `or`, flattening a child of the same kind into its parent (`a and (b and c)` is one `and` of
 * three), so the conditions every row must meet are all directly under the top-level `and` (see requiredConditions).
 * @param kind
 * @param nodes
 */
const join = (kind: 'and' | 'or', nodes: ConditionNode[]): ConditionNode => {
  const children = nodes.flatMap(node => !isCondition(node) && kind in node ? node[kind] : [node])
  return children.length === 1 ? children[0] : (kind === 'and' ? { and: children } : { or: children })
}

/**
 * Read one where expression from the start of a where clause body (masked, see maskStrings). Precedence, loosest
 * first: `or`, `and`, `not`; brackets group.
 * @param text
 * @returns The expression's tree and where it ends (at the first text that can't carry it on, or the end).
 * @throws {Error} For an unbalanced bracket, empty brackets, an operator with no condition after it, or two conditions
 * with no and/or between them.
 */
const readExpression = (text: string): { node: ConditionNode, end: number } => {
  let at = 0
  const rest = (): string => text.slice(at)
  const skipSpace = (): void => {
    at += rest().length - rest().trimStart().length
  }
  const take = (pattern: RegExp): string | undefined => {
    skipSpace()
    const found = rest().match(pattern)
    if (!found) {
      return undefined
    }
    at += found[0].length
    return found[0]
  }
  const shown = (): string => unmaskStrings(rest().trim(), '\'')

  const factor = (after: string): ConditionNode => {
    skipSpace()
    // A condition first, so a field named like a keyword (`not = 1`, `exists exists`) still reads as a field
    const condition = rest().match(conditionMatch)
    if (condition) {
      at += condition[0].length
      return readCondition(condition)
    }
    // The 2.x `and where` / `or where` inside brackets, where splitClauses doesn't look
    if ((after === 'and' || after === 'or') && keyword('where').test(rest())) {
      throw new Error(`"${after} where" is no longer supported: ${whereHint}`)
    }
    if (take(keyword('not'))) {
      return { not: factor('not') }
    }
    if (take(/^\(/)) {
      skipSpace()
      if (rest().startsWith(')')) {
        throw new Error('Empty brackets in a where clause')
      }
      const node = expression('(')
      // The query scanner already refuses unbalanced brackets (scanQuery); this guards a direct call
      if (!take(/^\)/)) {
        throw new Error(`Missing ) ${rest().trim() ? `before: ${shown()}` : 'at the end of the where clause'}`)
      }
      return node
    }
    throw new Error(`Missing a condition after ${after}${rest().trim() ? `: ${shown()}` : ''}`)
  }

  const term = (after: string): ConditionNode => {
    const nodes = [factor(after)]
    for (;;) {
      const connector = take(keyword('and'))
      if (!connector) {
        break
      }
      nodes.push(factor(connector.toLowerCase().replace(/\s+/g, ' ')))
    }
    return join('and', nodes)
  }

  const expression = (after: string): ConditionNode => {
    const nodes = [term(after)]
    for (;;) {
      const connector = take(keyword('or'))
      if (!connector) {
        break
      }
      nodes.push(term(connector.toLowerCase().replace(/\s+/g, ' ')))
    }
    return join('or', nodes)
  }

  const node = expression('where')
  skipSpace()
  if (rest().startsWith(')')) {
    throw new Error(`Unexpected ) in a where clause: ${shown()}`)
  }
  if (conditionMatch.test(rest())) {
    throw new Error(`Missing and/or before: ${shown()}`)
  }
  return { node, end: at }
}

/**
 * Read a where clause body (see splitClauses) into a tree (see ConditionNode): conditions joined with `and` / `or`,
 * `not`, and brackets, nested to any depth. Each condition is `<field> <comparator> <value>`, or `<field> is null`,
 * `is not null`, `exists` or `does not exist`. A comparison with the literal null (`= null`) is refused: it would never
 * match, as null equals nothing (see where).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the expression.
 * @throws {Error} For the errors readExpression and readCondition describe.
 */
export const findConditions = (parsed: ParsedQuery, body: string): string => {
  const { node, end } = readExpression(body)
  parsed['where'] = node
  return body.slice(end).trim()
}
