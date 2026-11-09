export type RuntimeSettings = {
  databasePath: string
  relativePath: string
  enforceForeignKeys: boolean
  readConcurrency: number
  format: 'compact' | 'pretty'
  // No fixed default: true in a browser, false in Node (see usesPackedReads)
  packedReads?: boolean
  // The folder holding several databases, and the one in use (see activeDatabasePath)
  databasesPath?: string
  database?: string
}

const defaults: RuntimeSettings = {
  databasePath: 'database/',
  relativePath: '',
  enforceForeignKeys: true,
  readConcurrency: 16,
  format: 'compact'
}

let settings: RuntimeSettings = { ...defaults }

let activeCalls = 0

const databaseNameMatch: RegExp = /^[a-z0-9_-]+$/i

const withSlash = (path: string): string => path.endsWith('/') ? path : `${path}/`

/**
 * The folder of the database in use: `<databasesPath>/<database>/` once both are configured (see configure and the
 * `use` statement), otherwise databasePath, as before there could be several.
 */
export const activeDatabasePath = (): string => settings.databasesPath && settings.database
  ? `${withSlash(settings.databasesPath)}${settings.database}/`
  : getSetting('databasePath', 'database/')

/**
 * The folder whose calls are queued together (see withDatabaseLock): with several databases, all of them, since a
 * call can switch between them (`use`) part way; otherwise the one database.
 */
export const lockPath = (): string => settings.databasesPath ? withSlash(settings.databasesPath) : activeDatabasePath()

/**
 * The folder holding the databases, for create database, drop database, use and show databases.
 * @throws {Error} When databasesPath isn't configured.
 */
export const databasesFolder = (): string => {
  if (!settings.databasesPath) {
    throw new Error("Several databases need a folder to hold them: configure({ databasesPath: 'databases/' }) first")
  }
  return withSlash(settings.databasesPath)
}

/**
 * Switch the database in use, from inside a call (the `use` statement, which holds the lock for every database in
 * databasesPath, so no other call is running): configure() refuses to while calls run.
 * @param name
 */
export const switchDatabase = (name: string): void => {
  settings = { ...settings, database: name }
}

/**
 * The folder a databasePath points to, so that `database/`, `./database` and its absolute path count as one database.
 * Node only (only Node calls are counted, see trackDatabaseCall).
 * @param databasePath
 */
export const resolveDatabasePath = (databasePath: string): string => require('path').resolve(databasePath)

/**
 * Count a database call (taken by withDatabaseLock as soon as a call is queued) until the returned function is called.
 * While any call is counted, configure() refuses to point databasePath somewhere else: every step of a call reads
 * databasePath again, so a change halfway would write part of the call to one folder and the rest to another.
 */
export const trackDatabaseCall = (): (() => void) => {
  activeCalls++
  let ended = false
  return () => {
    if (!ended) {
      ended = true
      activeCalls--
    }
  }
}

/**
 * Set where this package's data lives: databasePath (a filesystem path, used in Node) and/or
 * relativePath (a URL prefix prepended to databasePath, used when reading over fetch() in a
 * browser). Call this once before using create()/drop()/query() - a fresh consumer has no other
 * way to point this package at their own data directory.
 *
 * enforceForeignKeys (default true) controls whether deleteEntity/updateEntity block an operation
 * that would leave another record's foreign key pointing at a value that no longer exists -
 * mirroring MySQL's own foreign_key_checks setting, which is also toggleable rather than always
 * on, since strict enforcement isn't always what every consumer wants.
 *
 * readConcurrency (default 16) is how many entry files a read has in flight at once (see retrieveFiles): in a browser,
 * how many requests run together.
 *
 * format (default 'compact') is how files are written: 'compact' (no whitespace: smaller files that parse faster) or
 * 'pretty' (indented by 2 spaces, for reading data in diffs). Either is read; formatDatabase rewrites a whole database
 * in one.
 *
 * packedReads (default: true in a browser, false in Node) is whether reads use a record's packed file (see
 * packDatabase) when it has one that matches the record, instead of reading each entry file.
 *
 * Changing databasePath while calls are still running or queued throws (see trackDatabaseCall): await them first.
 * @param newSettings
 * @throws {Error} When databasePath would point to another folder while database calls are in progress.
 * @throws {Error} When format is neither 'compact' nor 'pretty'.
 */
export const configure = (newSettings: Partial<RuntimeSettings>): void => {
  if (typeof newSettings.format !== 'undefined' && newSettings.format !== 'compact' && newSettings.format !== 'pretty') {
    throw new Error(`Unknown format "${newSettings.format}": use 'compact' or 'pretty'`)
  }
  if (typeof newSettings.database !== 'undefined' && newSettings.database !== null && !databaseNameMatch.test(newSettings.database)) {
    throw new Error(`Invalid database name ${JSON.stringify(newSettings.database)}: names use letters, digits, _ and - only`)
  }
  const next = { ...settings, ...newSettings }
  if (next.database && !next.databasesPath) {
    throw new Error("A database name needs the folder that holds the databases: configure({ databasesPath: 'databases/', database: '...' })")
  }
  if (activeCalls > 0) {
    const before = { active: resolveDatabasePath(activeDatabasePath()), lock: resolveDatabasePath(lockPath()) }
    const previous = settings
    settings = next
    const changed = resolveDatabasePath(activeDatabasePath()) !== before.active || resolveDatabasePath(lockPath()) !== before.lock
    settings = previous
    if (changed) {
      const named = ['databasePath', 'databasesPath', 'database'].filter(key => typeof newSettings[key] !== 'undefined').join(' / ')
      throw new Error(`Can't change ${named} while ${activeCalls} database call(s) are still running or queued: await them first`)
    }
  }
  settings = next
}

/**
 * Read one runtime setting, falling back to the given default if it was never configured. This is
 * the package's own lightweight replacement for reading settings via js-build-tools/gulp.config -
 * that module is a dev-time build tool, not something a published package should require at
 * runtime, and it isn't available at all once a consumer installs this package on its own.
 * @param key
 * @param defaultValue
 */
export const getSetting = <K extends keyof RuntimeSettings>(key: K, defaultValue: RuntimeSettings[K]): RuntimeSettings[K] => {
  return typeof settings[key] !== 'undefined' ? settings[key] : defaultValue
}
