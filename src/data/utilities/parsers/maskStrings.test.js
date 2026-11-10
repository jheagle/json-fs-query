import { arraySource, fromPlaceholder, maskArrays, maskStrings, placeholderSource, unmaskStrings } from './maskStrings'

const placeholders = text => [...text.matchAll(new RegExp(placeholderSource, 'g'))].map(match => fromPlaceholder(match[1]))

describe('maskStrings', () => {
  test('replaces each string with a placeholder holding its value, leaving the rest of the query as it was', () => {
    const masked = maskStrings('read t where a = \'x\' and b = "y"')
    expect(masked).toMatch(new RegExp(`^read t where a = ${placeholderSource} and b = ${placeholderSource}$`))
    expect(placeholders(masked)).toEqual(['x', 'y'])
  })

  test('puts nothing a parser looks for inside a placeholder: no keyword, space, quote or bracket', () => {
    const masked = maskStrings('a = \'where b = "c" sort [1]\'')
    expect(masked.slice(4)).toMatch(new RegExp(`^${placeholderSource}$`))
  })

  test('holds the value with its escapes applied', () => {
    expect(placeholders(maskStrings('a = \'it\\\'s\', b = \'\\\\\\\'\''))).toEqual(['it\'s', '\\\''])
  })

  test('round-trips any text, including non-Latin letters, emoji and an empty string', () => {
    expect(placeholders(maskStrings('a = \'Ça va? 你好 🏃\', b = \'\''))).toEqual(['Ça va? 你好 🏃', ''])
  })

  test('rejects an SOH character (the array placeholder\'s marker) outside a string too', () => {
    expect(() => maskStrings('a = \u00010078\u0001')).toThrow('Unexpected SOH character at position 4')
  })

  test('rejects a NUL character outside a string, which could pass for a placeholder, but keeps one inside', () => {
    expect(() => maskStrings('a = \u00000078\u0000')).toThrow('Unexpected NUL character at position 4')
    expect(placeholders(maskStrings('a = \'x\u0000y\''))).toEqual(['x\u0000y'])
  })

  test('throws for an unclosed string', () => {
    expect(() => maskStrings('a = \'abc"')).toThrow('Unclosed string')
  })
})

describe('unmaskStrings', () => {
  test('puts placeholders back as JSON strings by default, for array literals', () => {
    expect(unmaskStrings(maskStrings('[\'x\', "it\'s"]'))).toBe('["x", "it\'s"]')
  })

  test('puts placeholders back as single-quoted strings, escaped as they would be written', () => {
    const text = 'a = \'it\\\'s\' and \'C:\\\\temp\''
    expect(unmaskStrings(maskStrings(text), '\'')).toBe(text)
  })
})

describe('maskArrays', () => {
  const arrays = text => [...text.matchAll(new RegExp(arraySource, 'g'))].map(match => JSON.parse(fromPlaceholder(match[1])))
  const mask = text => maskArrays(maskStrings(text))

  test('replaces each outermost array with a placeholder holding its JSON, nested arrays inside it', () => {
    const masked = mask('a in [1, [2, 3]] and b in [4]')
    expect(masked).toMatch(new RegExp(`^a in ${arraySource} and b in ${arraySource}$`))
    expect(arrays(masked)).toEqual([[1, [2, 3]], [4]])
  })

  test('reads strings in an array with either quote and escapes, and ignores a ] inside one', () => {
    expect(arrays(mask('a in [\'x]\', "it\'s", \'\\\'\']'))).toEqual([['x]', 'it\'s', '\'']])
  })

  test('keeps numbers as JSON reads them', () => {
    expect(arrays(mask('a in [1.5, -2, 1e3, null, true]'))).toEqual([[1.5, -2, 1000, null, true]])
  })

  test('throws for an array which is not valid JSON, showing it as written', () => {
    expect(() => mask('a in [1, \'x\',, 2]')).toThrow("Invalid array [1, 'x',, 2]:")
  })

  test('refuses a number too large to hold, rather than turning it into null', () => {
    expect(() => mask('a in [1, 1e999]')).toThrow('Invalid array [1, 1e999]: Infinity is too large')
    expect(() => mask('a in [-1e999]')).toThrow('-Infinity is too large')
  })

  test('refuses a whole number too large to store exactly, rather than rounding it', () => {
    // The message shows the value JSON read, already rounded
    expect(() => mask('a in [1, 9007199254740993]')).toThrow('Invalid array [1, 9007199254740993]: 9007199254740992 is too large to store exactly')
    expect(() => mask('a in [[-9007199254740993]]')).toThrow('-9007199254740992 is too large to store exactly')
    expect(() => mask('a in [9007199254740993.0, 1]')).toThrow('is too large to store exactly')
    expect(() => mask('a in [9007199254740993e0]')).toThrow('is too large to store exactly')
    expect(() => mask('a in [1e20]')).toThrow('is too large to store exactly')
    expect(arrays(mask('a in [9007199254740991, -9007199254740991, 1.5e3]'))).toEqual([[9007199254740991, -9007199254740991, 1500]])
  })

  test('leaves digits inside strings alone: they are text, not numbers', () => {
    expect(arrays(mask('a in [\'9007199254740993\', "12345678901234567890"]'))).toEqual([['9007199254740993', '12345678901234567890']])
  })

  test('puts arrays back as JSON when unmasking', () => {
    expect(unmaskStrings(mask('a in [\'x\', 1]'), '\'')).toBe('a in ["x",1]')
  })
})
