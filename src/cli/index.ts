#!/usr/bin/env node
import { Command, Option } from 'commander'
import { DatabaseOptions } from './chooseDatabase'
import { Session, startInteractive } from './interactive'
import { OutputFormat, outputFormats, OutputSettings } from './output'
import { runDirect } from './runDirect'

type CliOptions = DatabaseOptions & {
  query?: string
  output: OutputFormat
  null?: string
  missing?: string
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
  .addOption(new Option('-o, --output <format>', 'how results print (at the prompt: /output <format>)').choices(outputFormats).default('table'))
  .option('--null <text>', 'how a table shows null (default NULL; at the prompt: /null <text>)')
  .option('--missing <text>', 'how a table shows a missing field (default —; at the prompt: /missing <text>)')
  .helpOption('-h, --help', 'print this help')
  .addHelpText('after', `
Examples:
  jfsq                                         open the prompt on database/
  jfsq -d tasks-db -q "read tasks where done = false"
  jfsq --databases dbs -d real -q "show records"
  jfsq -o json -q "read tasks" | jq .
  jfsq -o csv -q "read tasks" > tasks.csv

At the prompt, type /help for its commands and the query syntax (/help read, /help create, ...).`)
  .parse(process.argv)

const options: CliOptions = program.opts()

// Shared with the prompt, whose /output, /null and /missing commands change it
const settings: OutputSettings = {
  format: options.output,
  markers: {
    ...(typeof options.null === 'string' ? { null: options.null } : {}),
    ...(typeof options.missing === 'string' ? { missing: options.missing } : {})
  }
}

// With -q the query runs straight away and the exit code says whether it worked; otherwise the prompt opens
const session: Session = typeof options.query === 'string'
  ? (() => {
      const done: Promise<void> = runDirect(options.query, options, settings).then((code: number): void => {
        // exitCode rather than exit(): process.exit can cut off output still being written to a pipe
        process.exitCode = code
      })
      return { whenIdle: () => done }
    })()
  : startInteractive(options, settings)

/**
 * Resolves once the session is idle: every line handled (the prompt), or the query finished (-q).
 * @returns {Promise<void>}
 */
export const whenIdle = (): Promise<void> => session.whenIdle()
