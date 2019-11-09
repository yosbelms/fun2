import pDefer from 'p-defer'
import deepFreeze from 'deep-freeze'
import path from 'path'
import minimatch from 'minimatch'
import { parentPort, workerData, MessagePort, isMainThread } from 'worker_threads'
import { Script } from 'vm'
import { createConsole, MessageType, ErrorType } from './util'
import { createInterfaceClient } from './interface'

const defaultFileName = '<fun2:worker>'

export class Worker {
  parentPort: MessagePort | null
  requestIdSeed: number
  pendingRequestsDeferredPromises: Map<number, any>
  scriptCache: Map<string, any>
  console: Partial<Console>
  filename: string
  dirname: string
  workerData: any
  injectedInterface: any

  constructor(
    parentPort: MessagePort | null,
    workerData?: any
  ) {
    this.workerData = workerData
    this.requestIdSeed = 0
    this.parentPort = parentPort
    this.filename = defaultFileName
    this.console = createConsole()
    this.scriptCache = new Map()
    this.pendingRequestsDeferredPromises = new Map()
    this.injectedInterface = {}

    if (workerData) {
      if (typeof workerData.filename === 'string') {
        this.filename = workerData.filename
      }
      this.injectedInterface = deepFreeze(
        createInterfaceClient(
          workerData.serializedInterface,
          this.createInterfaceClientFunction,
        )
      )
    }

    this.dirname = path.dirname(this.filename)

    if (parentPort) {
      parentPort.on('message', this.handleMainThreadMessage)
    }
  }

  sendMessage = (msg: any) => {
    return this.parentPort ? this.parentPort.postMessage(msg) : void 0
  }

  createInterfaceClientFunction = (method: string, basePath: string) => {
    return (...args: any[]) => {
      const id = this.requestIdSeed++
      const deferredPromise = pDefer()
      this.pendingRequestsDeferredPromises.set(id, deferredPromise)
      this.sendMessage({
        type: MessageType.REQUEST,
        basePath,
        method,
        args,
        id,
      })
      return deferredPromise.promise
    }
  }

  handleMainThreadMessage = (message: any) => {
    // console.log('WORKER', message)
    switch (message.type) {
      case MessageType.RESPONSE:
        const { id, result } = message
        this.pendingRequestsDeferredPromises.get(id).resolve(result)
        this.pendingRequestsDeferredPromises.delete(id)
        break
      case MessageType.EXECUTE:
        const { source, args = [] } = message
        this.pendingRequestsDeferredPromises.forEach(p => p.reject())
        this.pendingRequestsDeferredPromises.clear()

        let script = this.scriptCache.get(source)
        if (!script) {
          try {
            script = this.compile(source)
            this.scriptCache.set(source, script)
          } catch (err) {
            const { message, stack } = err
            this.sendMessage({
              type: MessageType.ERROR,
              errorType: ErrorType.EVAL,
              message,
              stack,
            })
            break
          }
        }

        this.runScript(script, args).then(res => {
          this.sendMessage({
            type: MessageType.RETURN,
            result: res,
          })
        }).catch(err => {
          const { message, stack } = err
          this.sendMessage({
            type: MessageType.ERROR,
            errorType: ErrorType.RUNTIME,
            message,
            stack,
          })
        })
        break
    }
  }

  async runScript(script: any, args: any[]) {
    const ctx = {
      console: this.console,
      ...this.injectedInterface,
      isWorker: true,
      require: this.require,
      __filename: this.filename,
      __dirname: this.dirname,
      exports: Object.create(null),
    }
    script.runInNewContext(ctx, { displayErrors: true })
    const mainfn = ctx.exports.__mainfn
    if (typeof mainfn !== 'function') throw new Error('invalid function')
    return mainfn.apply(null, args)
  }

  compile(source: string) {
    return new Script(`'use strict'; exports.__mainfn = ${source}`, {
      filename: this.filename,
    })
  }

  require = (modulePath: string) => {
    const { allowedModules } = this.workerData
    const isRelative = ~modulePath.indexOf(path.sep)
    let realPath = modulePath

    if (!allowedModules.some((pattern: string) => minimatch(modulePath, pattern))) {
      throw new Error(`'${modulePath}' module not allowed`)
    }

    if (isRelative) {
      if (this.filename === '') throw new Error(`empty module filename`)
      realPath = path.resolve(this.dirname, modulePath)
    }

    return require(realPath)
  }
}

// bootstrap
if (!isMainThread) {
  new Worker(parentPort, workerData)
}
