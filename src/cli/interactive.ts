import * as readline from 'readline'
import { styleText } from 'util'
import { QueryStatus, queryStatus } from '../data/queries/queryStatus'
import { query } from '../data/queries/query'
import { getSetting } from '../data/utilities/config'
import { chooseDatabase, DatabaseOptions } from './chooseDatabase'
import { defaultMarkers } from './formatResult'
import { assertPrintable, OutputSettings, outputFormats, OutputFormat, printError, printResults } from './output'

export type Session = {
  // Resolves once every line received so far has been handled (including any query it ran)
  whenIdle: () => Promise<void>
}

const defaultPrompt: string = 'JSON-Query> '

// A CLI command: a slash and a word, then its value (a query never starts like this; a `/*` comment has no word)
const commandMatch: RegExp = /^\/([a-z]+)(?:\s+(.*))?$/i

/**
 * Whether text holds anything to run: something other than whitespace and comments.
 * @param text
 * @returns {boolean}
 */
const hasQuery = (text: string): boolean => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--[^\n]*/g, '')
  .trim() !== ''

/**
 * The main prompt: the name of the database in use when there is one (it changes with `use`), otherwise JSON-Query.
 * @returns {string}
 */
const mainPrompt = (): string => {
  const database: string | undefined = getSetting('database', undefined)
  return database ? `${database}> ` : defaultPrompt
}

// Continuation prompt, padded to line up with the first line and dimmed so it reads as secondary
const continuePrefix = (waitingFor: string): string => styleText('dim', `${waitingFor}> `.padStart(mainPrompt().length))

/**
 * Open the prompt: read queries line by line, run each one once it is complete, until /exit, Ctrl+C or the end of
 * piped input. Piped input (`jfsq < seed.txt`, stdin not a terminal) runs the same way, but quietly: no banner, no
 * prompts and no goodbye, only the results and errors, and the exit code is 1 when any query failed.
 * @param options The database options
 * @param settings The output format and markers (the /output, /null and /missing commands change them)
 * @returns {Session}
 */
export const startInteractive = (options: DatabaseOptions, settings: OutputSettings): Session => {
  // Reading a file or a pipe rather than a person typing
  const piped: boolean = !process.stdin.isTTY

  // Create the interface for reading from standard input/output
  const rl: readline.Interface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: defaultPrompt
  })

  // 1 when the session can't start (a bad option), so a script can tell
  let exitCode: number = 0

  // Set when a query fails: piped input then exits 1, so a seed script can tell (the prompt carries on regardless)
  let failed: boolean = false

  // Buffer to store multi-line inputs
  let inputBuffer: string = ''

  // Set once readline closes. Piped input closes it as soon as stdin ends, while queued lines may still be running,
  // and readline throws if prompted after that
  let closed: boolean = false

  /**
   * Show the prompt, unless the session has already closed.
   */
  const showPrompt = (): void => {
    if (!closed && !piped) {
      rl.prompt()
    }
  }

  // Lines are handled one at a time, in order: readline does not wait for an async 'line' handler, so without this
  // queue a line typed (or piped) while a query runs would be appended to the buffer before that query finished.
  let lineQueue: Promise<void> = Promise.resolve()

  const whenIdle = async (): Promise<void> => {
    // A handled line can queue more work (e.g. /exit queues the goodbye), so wait until the queue stops growing
    let current: Promise<void>
    do {
      current = lineQueue
      await current
    } while (current !== lineQueue)
  }

  if (!piped) {
    console.log('JSON Filesystem Query CLI')
    console.log('Type your command. End it with a semicolon (;) and press Enter to execute.')
    console.log('Type "/exit" or press Ctrl+C to quit.')
  }

  /**
   * Print a confirmation for a person typing; piped input stays quiet, so its output is only results (e.g. for jq).
   * @param {string} message
   */
  const say = (message: string): void => {
    if (!piped) {
      console.log(message)
    }
  }

  /**
   * Run one CLI command. Without a value each one says what it is set to now.
   * @param {string} line The trimmed line, e.g. `/output csv` or `/null (null)`
   */
  const runCommand = (line: string): void => {
    const [, name, value = ''] = line.match(commandMatch)
    switch (name.toLowerCase()) {
      case 'output': {
        const outputFormat = value.toLowerCase() as OutputFormat
        if (value && !outputFormats.includes(outputFormat)) {
          failed = true
          printError(`Unknown output "${value}": use ${outputFormats.join(', ')}`)
          return
        }
        if (value) {
          settings.format = outputFormat
        }
        say(`Output: ${settings.format}`)
        return
      }
      case 'null':
      case 'missing': {
        const marker = name.toLowerCase() as 'null' | 'missing'
        if (value) {
          settings.markers = { ...settings.markers, [marker]: value }
        }
        say(`${marker === 'null' ? 'Null' : 'Missing'} shows as: ${settings.markers[marker] ?? defaultMarkers[marker]}`)
        return
      }
      default:
        failed = true
        printError(`Unknown command /${name}: use /output <${outputFormats.join('|')}>, /null <text>, /missing <text> or /exit`)
    }
  }

  /**
   * Run a completed buffer through the query parser. A parse or runtime error is printed and the session carries on.
   * @param {string} input The completed query buffer (one or more queries)
   * @returns {Promise<void>}
   */
  const processInput = async (input: string): Promise<void> => {
    try {
      assertPrintable(settings)
      printResults(await query(input), settings)
    } catch (error) {
      failed = true
      printError(error)
    }
  }

  /**
   * Handle one line of input: exit, skip, add to the buffer, or run the buffer once the query is complete.
   * @param {string} line The line as typed, without its line ending
   * @returns {Promise<void>}
   */
  const handleLine = async (line: string): Promise<void> => {
    // The session didn't start (a bad option): lines piped after it must not run against the wrong database
    if (exitCode) {
      return
    }
    const trimmedLine: string = line.trim()

    // Check if the user wants to exit
    if (!inputBuffer && trimmedLine.toLowerCase() === '/exit') {
      rl.close()
      return
    }

    // A CLI command (/output, /null, /missing) at the start of a query: never sent to the query parser
    if (!inputBuffer && commandMatch.test(trimmedLine)) {
      runCommand(trimmedLine)
      showPrompt()
      return
    }

    // Skip blank lines on their own, accept them mid-query
    if (!inputBuffer && !trimmedLine) {
      showPrompt()
      return
    }

    // Append current line to the buffer
    inputBuffer += (inputBuffer ? '\n' : '') + line

    const status: QueryStatus = queryStatus(inputBuffer)

    // Check if the line ends the query (closed query and semicolon present)
    if (status.complete) {
      // Take the buffer before running, so the next query starts empty even if this one fails
      const input: string = inputBuffer
      inputBuffer = ''
      await processInput(input)
      // After the query, so a `use` in it shows in the prompt
      rl.setPrompt(mainPrompt())
    } else {
      // Change prompt visually to show it is expecting continuation
      rl.setPrompt(continuePrefix(status.waitingFor))
    }

    showPrompt()
  }

  // Handle line-by-line input, queued so each line waits for the one before it
  rl.on('line', (line: string): void => {
    lineQueue = lineQueue
      .then(() => handleLine(line))
      // Never let one failed line stop the queue (query errors are already handled in processInput)
      .catch((error: unknown): void => {
        printError(error)
        showPrompt()
      })
  })

  rl.on('SIGINT', (): void => {
    if (!inputBuffer && !rl.line) {
      rl.close()
      return
    }
    rl.write(null, { ctrl: true, name: 'u' })
    inputBuffer = ''
    rl.setPrompt(mainPrompt())
    showPrompt()
  })

  // Handle graceful exit on Ctrl+C, /exit or the end of piped input, after any queued lines have run
  rl.on('close', (): void => {
    closed = true
    lineQueue = lineQueue.then(async (): Promise<void> => {
      // A file whose last query has no closing `;` still runs it (unless all that's left is comments or space)
      if (piped && !exitCode && hasQuery(inputBuffer)) {
        const input: string = inputBuffer
        inputBuffer = ''
        await processInput(input)
      }
      if (!exitCode && !piped) {
        console.log('\nGoodbye!')
      }
      process.exit(exitCode || (piped && failed ? 1 : 0))
    })
  })

  /**
   * Point the session at the database the options name, then open the prompt. A bad option (an invalid name, a
   * database that doesn't exist) prints the error and ends the session with exit code 1.
   * @returns {Promise<void>}
   */
  const start = async (): Promise<void> => {
    try {
      const database: string = await chooseDatabase(options)
      if (!piped) {
        console.log(`${database}\n`)
      }
    } catch (error) {
      printError(error)
      exitCode = 1
      rl.close()
      return
    }
    rl.setPrompt(mainPrompt())
    showPrompt()
  }

  // Lines typed before the session is ready wait for it
  lineQueue = start()

  return { whenIdle }
}
