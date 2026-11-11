#!/usr/bin/env node
import * as readline from 'readline'
import { styleText } from 'util'
import { QueryStatus, queryStatus } from '../data/queries/queryStatus'
import { query } from '../data/queries/query'
import { formatResult } from './formatResult'

const promptPrefix: string = 'JSON-Query> '

// Continuation prompt, padded to line up with the first line and dimmed so it reads as secondary
const continuePrefix = (waitingFor: string): string => styleText('dim', `${waitingFor}> `.padStart(promptPrefix.length))

// Create the interface for reading from standard input/output
const rl: readline.Interface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: promptPrefix
})

// Buffer to store multi-line inputs
let inputBuffer: string = ''

// Set once readline closes. Piped input closes it as soon as stdin ends, while queued lines may still be running, and
// readline throws if prompted after that
let closed: boolean = false

/**
 * Show the prompt, unless the session has already closed.
 */
const showPrompt = (): void => {
  if (!closed) {
    rl.prompt()
  }
}

// Lines are handled one at a time, in order: readline does not wait for an async 'line' handler, so without this
// queue a line typed (or piped) while a query runs would be appended to the buffer before that query finished.
let lineQueue: Promise<void> = Promise.resolve()

/**
 * Resolves once every line received so far has been handled (including any query it ran).
 * @returns {Promise<void>}
 */
export const whenIdle = async (): Promise<void> => {
  // A handled line can queue more work (e.g. /exit queues the goodbye), so wait until the queue stops growing
  let current: Promise<void>
  do {
    current = lineQueue
    await current
  } while (current !== lineQueue)
}

console.log('JSON Filesystem Query CLI')
console.log('Type your command. End it with a semicolon (;) and press Enter to execute.')
console.log('Type "/exit" or press Ctrl+C to quit.\n')

// Open the session by displaying the initial prompt
rl.prompt()

// Dim the markers only on a terminal, and never with NO_COLOR set (https://no-color.org)
const color: boolean = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

/**
 * Print each query's result as a table (see formatResult), each followed by a blank line (as psql does) so results
 * stay apart when several print in a row.
 * @param {Array<*>} results One result per query in the buffer
 */
const printResults = (results: Array<unknown>): void => {
  for (const result of results) {
    console.log(`${formatResult(result, { color })}\n`)
  }
}

/**
 * Print an error in red, without its stack.
 * @param {*} error
 */
const printError = (error: unknown): void => {
  console.error(styleText('red', `Error: ${error instanceof Error ? error.message : String(error)}`))
}

/**
 * Run a completed buffer through the query parser. A parse or runtime error is printed and the session carries on.
 * @param {string} input The completed query buffer (one or more queries)
 * @returns {Promise<void>}
 */
const processInput = async (input: string): Promise<void> => {
  try {
    printResults(await query(input))
  } catch (error) {
    printError(error)
  }
}

/**
 * Handle one line of input: exit, skip, add to the buffer, or run the buffer once the query is complete.
 * @param {string} line The line as typed, without its line ending
 * @returns {Promise<void>}
 */
const handleLine = async (line: string): Promise<void> => {
  const trimmedLine: string = line.trim()

  // Check if the user wants to exit
  if (!inputBuffer && trimmedLine.toLowerCase() === '/exit') {
    rl.close()
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
    rl.setPrompt(promptPrefix)
    await processInput(input)
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
  rl.setPrompt(promptPrefix)
  showPrompt()
})

// Handle graceful exit on Ctrl+C, /exit or the end of piped input, after any queued lines have run
rl.on('close', (): void => {
  closed = true
  lineQueue = lineQueue.then((): void => {
    console.log('\nGoodbye!')
    process.exit(0)
  })
})
