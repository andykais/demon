import * as fs from 'jsr:@std/fs@0.229.3'
import * as std_async from 'jsr:@std/async@0.224.2'
import * as log from 'jsr:@std/log@0.224.2'
import * as std_colors from 'jsr:@std/fmt@0.225.4/colors'
import * as cliffy from 'jsr:@cliffy/command@1.0.0-rc.4'
import deno_jsonc from './deno.json' with { type: "json" };


// deno-lint-ignore no-explicit-any
type CliOptions<T> = T extends cliffy.Command<any, any, infer A>
  ? cliffy.CommandOptions<A>
  : never


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

interface StatefulExecutorContext {
  executor: Executor
  file_watchlist: string[]
  file_pattern_regexes: RegExp[]
  opts:  CliOptions<typeof cli>
}
class StatefulExecutor {
  #ctx: StatefulExecutorContext
  #atomic_execution = false
  #queued_execution = false
  #execution_error?: Error

  constructor(ctx: StatefulExecutorContext) {
    this.#ctx = ctx
  }

  file_watch_event = (event: Deno.FsEvent) => {
    if (this.#execution_error) {
      throw this.#execution_error
    }

    // if we set up file regexes, skip any events that do not match one of the file patterns
    if (this.#ctx.file_pattern_regexes.length) {
      const matched_file_pattern = this.#ctx.file_pattern_regexes.some(file_pattern_regex => {
        return event.paths.some(path => file_pattern_regex.test(path))
      })
      if (!matched_file_pattern) {
        return
      }
    }
    this.#debounced_command_execution()
  }

  #debounced_command_execution = std_async.debounce(() => {
    this.execute()
  }, FS_EVENT_DEBOUNCE)

  async execute() {
    // in case one is already executing (tracked w/ atomic_execution) then we queue up a future one
    if (!this.#atomic_execution || !this.#ctx.opts.disableQueuedExecution) {
      this.#queued_execution = true
    }

    // if execution is happening elsewhere, lets trust that to handle it
    if (this.#atomic_execution) {
      return
    }

    // errors should get bubbled up elsewhere
    if (this.#execution_error) {
      return
    }

    try {
      this.#atomic_execution = true
      this.#queued_execution = false

      if (!this.#ctx.opts.disableClearScreen) {
        console.clear()
      }

      await this.#ctx.executor.execute()
      this.#atomic_execution = false

      if (this.#queued_execution) {
        await this.execute()
      }
    } catch (e) {
      this.#execution_error = e
    }
  }
}

const cli = new cliffy.Command()
  .name("demon")
  .description("A simple tool for watching files and executing commands")
  .version(deno_jsonc.version)
  .arguments('<executable:string>')
  .option('--watch <watch:string>', 'A comma separated list of files and directories to watch')
  .option('--ext, --extensions <ext:string>', 'A comma separated list of file extensions to watch')
  .option('--pattern <pattern:string>', 'A regex file pattern to filter down files')
  .option('--disable-queued-execution', 'By default, if a file watch event happens while a command is executing, demon will execute the command again after it completes. Use this flag to disable that behavior')
  .option('--disable-clear-screen', 'By default, demon will clear the terminal screen before retriggering a command. Use this flag to disable that behavior')
  .action(async (opts, executable) => {
    const file_watchlist: string[] = []
    const file_pattern_regexes: RegExp[] = []

    // TODO handle file globs: current plan is to read in a watchlist, and if an item is not an existing file/directory attempt to read it as a glob (which I still need a library for)
    if (opts.pattern) {
      file_pattern_regexes.push(new RegExp(opts.pattern))
    }

    if (opts.watch) {
      file_watchlist.push(...opts.watch.split(','))
    }
    if (opts.ext) {
      for (const ext of opts.ext.split(',')) {
        file_pattern_regexes.push(new RegExp(`\.${ext}$`))
      }
      if (file_watchlist.length === 0) {
        file_watchlist.push('.')
      }
    }

    if (await fs.exists(executable)) {
      file_watchlist.push(executable)
    }

    const executor = new Executor(executable)

    const stateful_executor = new StatefulExecutor({
      file_pattern_regexes,
      file_watchlist,
      executor,
      opts,
    })

    await stateful_executor.execute()

    while (true) {
      const watcher = Deno.watchFs(file_watchlist)
      for await (const event of watcher) {
        stateful_executor.file_watch_event(event)

        // editors like neovim swap out files when they write them. The OS watcher (linux at least w/ inotifywait) cant track files after that swap happens so we restart the watcher when we see one
        if (event.kind === 'remove') {
          watcher.close()
        }
      }
    }
  })

await cli.parse()
