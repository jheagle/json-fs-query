import { compareAs, comparableTypes, sameValue } from './compareAs'
import { indexEntry } from './updateIndex'

const unkeyed = Symbol('unkeyed')

/**
 * The key a value is found by in a Map, so that two values share a key exactly when sameValue says they're the same:
 * compareAs gives that for the comparable types (a Map compares keys like ===). Other types compare with ==, and a
 * value compareAs leaves as an object compares by identity, so those are searched in turn instead.
 * @param type
 * @param value
 */
const keyOf = (type: string | undefined, value: any): any => {
  if (!comparableTypes.includes(type)) {
    return unkeyed
  }
  const key = compareAs(type, value)
  return typeof key === 'object' && key !== null ? unkeyed : key
}

/**
 * One index file held in memory while a statement changes it many times: values are found through a Map instead of a
 * search of the whole index each time, and the file is written once at the end (see insertEntity). It holds and
 * changes the index exactly as updateIndex would, one row after another: a new value is added at the end, a file
 * already listed for its value isn't listed twice.
 */
export class IndexBuffer {
  readonly entries: indexEntry[]
  private readonly type: string | undefined
  private readonly byKey: Map<any, indexEntry> = new Map()
  // The files each entry lists, built when a file is first added to it: a value shared by every row (a foreign key to
  // one parent) would otherwise be searched once per row, which grows with the square of the rows
  private readonly listed: WeakMap<indexEntry, Set<string>> = new WeakMap()

  /**
   * @param entries - The index as read from its file ([] when there's none yet).
   * @param type - The key's value type (see keyValueType).
   */
  constructor (entries: indexEntry[], type: string | undefined) {
    this.entries = entries
    this.type = type
    for (const entry of entries) {
      const key = keyOf(type, entry.value)
      // The first entry for a value is the one updateIndex's find() would give
      if (key !== unkeyed && !this.byKey.has(key)) {
        this.byKey.set(key, entry)
      }
    }
  }

  /**
   * The entry for `value`, as updateIndex finds it.
   * @param value
   */
  find (value: any): indexEntry | undefined {
    const key = keyOf(this.type, value)
    return key === unkeyed
      ? this.entries.find(entry => sameValue(this.type, entry.value, value))
      : this.byKey.get(key)
  }

  /**
   * Whether a row holds `value`, as indexHas answers it: an entry for it lists a file (never for null or undefined).
   * @param value
   */
  has (value: any): boolean {
    // where's = never matches null or a missing value (an index entry for a row without the field has no value)
    if (value === null || typeof value === 'undefined') {
      return false
    }
    const listsFiles = (entry: indexEntry | undefined): boolean => Boolean(entry && Array.isArray(entry.record) && entry.record.length)
    const first = this.find(value)
    if (!first || listsFiles(first)) {
      // No entry at all for the value (the Map holds the first of each), or one that lists a file
      return listsFiles(first)
    }
    // indexHas looks at every entry for the value; an index edited by hand can hold more than one
    return this.entries.some(entry => sameValue(this.type, entry.value, value) && listsFiles(entry))
  }

  /**
   * List `fileName` under `value`, as updateIndex does.
   * @param value
   * @param fileName
   */
  add (value: any, fileName: string): void {
    const existing = this.find(value)
    if (existing) {
      if (!this.listed.has(existing)) {
        this.listed.set(existing, new Set(existing.record))
      }
      const files = this.listed.get(existing)
      if (!files.has(fileName)) {
        files.add(fileName)
        existing.record.push(fileName)
      }
      return
    }
    const entry = { value, record: [fileName] }
    this.entries.push(entry)
    this.listed.set(entry, new Set(entry.record))
    const key = keyOf(this.type, value)
    if (key !== unkeyed) {
      this.byKey.set(key, entry)
    }
  }
}
