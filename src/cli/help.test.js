import { helpText } from './help'

describe('helpText', () => {
  test('without a topic: the commands, then a line per topic, lined up', () => {
    const lines = helpText().split('\n')
    const topics = lines.slice(lines.indexOf('Topics (/help <topic>):') + 1)
    expect(topics.map(line => line.trim().split(/\s+/)[0])).toEqual(
      ['read', 'insert', 'update', 'delete', 'where', 'join', 'create', 'alter', 'drop', 'describe', 'show', 'database']
    )
    // Every summary starts in the same column
    const summaryColumn = line => line.match(/^ {2}\S+ +/)[0].length
    expect(new Set(topics.map(summaryColumn)).size).toBe(1)
  })

  test('a topic in any case, with space around it', () => {
    expect(helpText('  CREATE ')).toMatch(/^create \[if not exists\]/)
  })

  test('other words lead to the topic that covers them', () => {
    expect(helpText('sort')).toBe(helpText('read'))
    expect(helpText('on')).toBe(helpText('join'))
    expect(helpText('use')).toBe(helpText('database'))
  })

  test('an unknown topic is an error naming the topics', () => {
    expect(() => helpText('nope')).toThrow('No help for "nope": try read, insert, update, delete, where, join, create, alter, drop, describe, show, database')
  })
})
