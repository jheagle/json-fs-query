#!/usr/bin/env node
import { Command } from 'commander'
import { DatabaseOptions } from './chooseDatabase'
import { Session, startInteractive } from './interactive'
import { runDirect } from './runDirect'

type CliOptions = DatabaseOptions & {
  query?: string
}

// The package's own version (package.json sits two folders up from both src/cli and dist/cli)
const { version } = require('../../package.json')

// Command-line options (commander exits with a message for an unknown option, and prints --help and --version)
const program: Command = new Command()
  .name('jfsq')
  .description('Query a json-fs-query database from the command line: with -q, run the query and exit; without it, open the prompt.')
  .version(version, '-v, --version', 'print the version')
  .option('-q, --query <query>', 'run this query (or several, separated by ;), print the results and exit')
  .option('-d, --database <path>', 'the database folder (default database/); with --databases, the name of a database in that folder')
  .option('--databases <folder>', 'a folder holding several databases (create database, use, show databases)')
  .helpOption('-h, --help', 'print this help')
  .addHelpText('after', `
Examples:
  jfsq                                         open the prompt on database/
  jfsq -d tasks-db -q "read tasks where done = false"
  jfsq --databases dbs -d real -q "show records"`)
  .parse(process.argv)

const options: CliOptions = program.opts()

// With -q the query runs straight away and the exit code says whether it worked; otherwise the prompt opens
const session: Session = typeof options.query === 'string'
  ? (() => {
      const done: Promise<void> = runDirect(options.query, options).then((code: number): void => {
        // exitCode rather than exit(): process.exit can cut off output still being written to a pipe
        process.exitCode = code
      })
      return { whenIdle: () => done }
    })()
  : startInteractive(options)

/**
 * Resolves once the session is idle: every line handled (the prompt), or the query finished (-q).
 * @returns {Promise<void>}
 */
export const whenIdle = (): Promise<void> => session.whenIdle()
