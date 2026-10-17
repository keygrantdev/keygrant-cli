import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import type { CredentialStore, Deps } from './deps.js'
import { readAll, saveFile } from './files.js'

/** Node's side of everything run.ts reaches, for the npm package's entry (main.ts) and the single binary's (binary.ts). */

function readStdinBytes(): Promise<Uint8Array> {
  return readAll(process.stdin)
}

async function readStdin(): Promise<string> {
  return Buffer.from(await readStdinBytes()).toString('utf8')
}

/** Asks on the terminal, echoing nothing of what is typed. Ctrl-C there ends the command, exit 130, as a shell's interrupt does; Ctrl-D answers nothing. */
function promptSecret(question: string): Promise<string> {
  process.stderr.write(question)
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() })
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true })
  // Closing ends the prompt's line (the close listener below writes it), then the command.
  rl.on('SIGINT', () => {
    rl.close()
    process.exit(130)
  })
  return new Promise((resolve) => {
    let answered = false
    rl.question('', (answer) => {
      answered = true
      rl.close()
      process.stderr.write('\n')
      resolve(answer)
    })
    // Ctrl-D, or standard input ending, answers nothing: login then says no key was given.
    rl.on('close', () => {
      if (answered) return
      process.stderr.write('\n')
      resolve('')
    })
  })
}

/** Output piped into a command that stops reading (`| head`) ends this one quietly, as other commands do. */
export function quietOnClosedPipe(): void {
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0)
    throw error
  })
}

/** The command's dependencies on this process, with `credentials` as its credential store. */
export function nodeDeps(credentials: CredentialStore): Deps {
  return {
    fetch: (url, init) => fetch(url, init),
    env: process.env,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    readStdin,
    readStdinBytes,
    stdinIsTerminal: process.stdin.isTTY === true,
    promptSecret,
    readFile: (path) => readFile(path, 'utf8'),
    readFileBytes: (path) => readFile(path),
    writeFile: saveFile,
    credentials,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    randomId: () => randomUUID(),
  }
}
