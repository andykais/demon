# demon

A command line file watcher and shell executor. Inspired by [nodemon](https://www.npmjs.com/package/nodemon)


## Installation
```sh
deno install --allow-read --allow-run jsr:@andykais/demon
```

## Usage

```
Usage:   demon <executable>
Version: 0.2.4

Description:

  A simple tool for watching files and executing commands

Options:

  -h, --help                             - Show this help.
  -V, --version                          - Show the version number for this program.
  -l, --log-level             <level>    - The log level demon will output.                                                 (Default: "info", Values: "debug", "info", "error")
  -q, --quiet                            - Shorthand for --log-level=error
  --level                     <level>    - The log level demon will output.
  --watch                     <watch>    - A comma separated list of files and directories to watch
  --ext, --extensions         <ext>      - A comma separated list of file extensions to watch
  --pattern                   <pattern>  - A regex file pattern to filter down files
  --disable-queued-execution             - By default, if a file watch event happens while a command is executing, demon
                                           will execute the command again after it completes. Use this flag to disable
                                           that behavior
  --disable-clear-screen                 - By default, demon will clear the terminal screen before retriggering a command.
                                           Use this flag to disable that behavior
```

### Simple Example
```sh
# this will execute foobar.sh and re-execute it any time foobar.sh is changed
demon ./script/foobar.sh
```

### Complex Example
```sh
demon "python main.py" --watch src,lib --ext py --pattern 'config_*\.yml'
```
