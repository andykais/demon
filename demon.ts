import * as fs from 'jsr:@std/fs@0.229.3'
import * as std_async from 'jsr:@std/async@0.224.2'
import * as log from 'jsr:@std/log@0.224.2'
import * as std_colors from 'jsr:@std/fmt@0.225.4/colors'
import * as cliffy from 'jsr:@cliffy/command@1.0.0-rc.4'


const FS_EVENT_DEBOUNCE = 50 // in milliseconds


class Executor {
  #encoder: TextEncoder
  #decoder: TextDecoder
  #command: string
  #cmd: Deno.Command

  constructor(command: string) {
    this.#encoder = new TextEncoder()
    this.#decoder = new TextDecoder()
    this.#command = command
    this.#cmd = new Deno.Command('sh', {
      args: ['-c', command],
      stdout: 'piped',
      stderr: 'piped',
    })
  }

  async execute() {
    const start_time = performance.now()
    log.info(`Executing "${this.#command}"`)
    const proc = this.#cmd.spawn()
    await Promise.all([
      (async () => {
        for await (const line of proc.stdout) {
          Deno.stdout.write(this.#encoder.encode(this.#decoder.decode(line)))
        }
      })(),
      (async () => {
        for await (const line of proc.stderr) {
          const formatted_error_line = std_colors.red(this.#decoder.decode(line))
          Deno.stderr.write(this.#encoder.encode(formatted_error_line))
        }
      })(),
    ])
    const result = await proc.status
    const execution_duration_ms = performance.now() - start_time
    const duration_pretty = `${(execution_duration_ms / 1000).toFixed(2)} seconds`
    if (result.success) {
      log.info(`Command exited with code ${result.code} after ${duration_pretty}`)
    } else {
      let exit_code_description = `${result.code}`
      if (result.signal) exit_code_description += `- ${result.signal}`
      log.warn(`Command exited with code ${exit_code_description} after ${duration_pretty}`)
    }
  }
}


const cli = new cliffy.Command()
  .name("demon")
  .description("A simple tool for watching files and executing commands")
  .version("v0.1.0")
  .arguments('<executable:string>')
  .option(`--watch <watch:string>`, 'A comma separated list of files and directories to watch')
  .option(`--ext, --extensions <ext:string>`, 'A regex file pattern to filter down files')
  .option(`--pattern <pattern:string>`, 'A regex file pattern to filter down files')
  .option(`--disable-queued-execution`, 'By default, if a file watch event happens while a command is executing, demon will execute the command again after it completes. Use this flag to disable that behavior')
  .action(async (opts, executable) => {
    const file_watchlist: string[] = []

    if (opts.watch) {
      file_watchlist.push(...opts.watch.split(','))
    }

    const file_pattern_regex = opts.pattern ? new RegExp(opts.pattern) : null
    // TODO handle file globs: current plan is to read in a watchlist, and if an item is not an existing file/directory attempt to read it as a glob (which I still need a library for)

    if (await fs.exists(executable)) {
      file_watchlist.push(executable)
    }

    const executor = new Executor(executable)
    await executor.execute()

    let atomic_execution = false
    let queued_execution = false
    let error: Error | undefined
    async function try_execution() {
      try {
        atomic_execution = true
        queued_execution = false
        await executor.execute()

        if (queued_execution) {
          await try_execution()
        }
      } catch (e) {
        error = e
      }
      atomic_execution = false
    }
    const debounce_execute_command = std_async.debounce((_event: Deno.FsEvent) => {
      // in case one is already executing (tracked w/ atomic_execution) then we queue up a future one
      if (!atomic_execution || !opts.disableQueuedExecution) {
        queued_execution = true
      }

      // if execution is happening elsewhere, lets trust that to handle it
      if (atomic_execution) {
        return
      }
      // errors should get bubbled up elsewhere
      if (error) {
        return
      }
      try_execution()
    }, FS_EVENT_DEBOUNCE)

    while (true) {
      const watcher = Deno.watchFs(file_watchlist)
      for await (const event of watcher) {
        if (error) {
          throw error
        }

        if (file_pattern_regex) {
          const matches_at_least_one = event.paths.some(path => file_pattern_regex.test(path))
          if (!matches_at_least_one) {
            continue
          }
        }


        debounce_execute_command(event)

        // editors like neovim swap out files when they write them. The OS watcher (linux at least w/ inotifywait) cant track files after that swap happens so we restart the watcher when we see one
        if (event.kind === 'remove') {
          watcher.close()
        }
      }
    }
  })

await cli.parse()
