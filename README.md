# Demon

A deno file watcher and command executor. Inspired by [nodemon](https://www.npmjs.com/package/nodemon)


## Installation
```sh
deno install --allow-read --allow-run jsr:@andykais/demon
```

## Usage

```
Usage:   demon <executable>
Version: v0.1.0

Description:

  A simple tool for watching files and executing commands

Options:

  -h, --help                             - Show this help.                                                              
  -V, --version                          - Show the version number for this program.                                    
  --watch                     <watch>    - A comma separated list of files and directories to watch                     
  --ext, --extensions         <ext>      - A regex file pattern to filter down files                                    
  --pattern                   <pattern>  - A regex file pattern to filter down files                                    
  --disable-queued-execution             - By default, if a file watch event happens while a command is executing, demon
                                           will execute the command again after it completes. Use this flag to disable  
                                           that behavior                                                                
```
