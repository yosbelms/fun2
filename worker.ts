import pDefer from 'p-defer'
import deepFreeze from 'deep-freeze'
import path from 'path'
import minimatch from 'minimatch'
import { parentPort, workerData, MessagePort } from 'worker_threads'
import { Script } from 'vm'
import { createConsole, MessageType, ErrorType } from './util'
import { createInterfaceClient } from './interface'

let requestIdSeed = 0
const pendingRequestsDeferredPromises = new Map()
const scriptCache = new Map()
const _console = createConsole()
const sendMessage = (msg: any) => (parentPort as MessagePort).postMessage(msg)
const filename = (
  typeof workerData.filename === 'string'
    ? workerData.filename
    : '<fun2:worker>'
)
const dirname = path.dirname(filename)

const createInterfaceClientFunctionCaller = (method: string, basePath: string) => {
  return (...args: any[]) => {
    const id = requestIdSeed++
    const deferredPromise = pDefer()
    pendingRequestsDeferredPromises.set(id, deferredPromise)
    sendMessage({
      type: MessageType.REQUEST,
      basePath,
      method,
      args,
      id,
    })
    return deferredPromise.promise
  }
}

const injectedInterface = deepFreeze(
  createInterfaceClient(
    workerData.serializedInterface,
    createInterfaceClientFunctionCaller,
  )
)

const handleMainThreadMessage = (message: any) => {
  // console.log('WORKER', message)
  switch (message.type) {
    case MessageType.RESPONSE:
      const { id, result } = message
      pendingRequestsDeferredPromises.get(id).resolve(result)
      pendingRequestsDeferredPromises.delete(id)
      break
    case MessageType.EXECUTE:
      const { source, args = [] } = message
      pendingRequestsDeferredPromises.forEach((_, p) => p.reject())
      pendingRequestsDeferredPromises.clear()

      let script = scriptCache.get(source)
      if (!script) {
        try {
          script = _eval(source)
          scriptCache.set(source, script)
        } catch (err) {
          const { message, stack } = err
          sendMessage({
            type: MessageType.ERROR,
            errorType: ErrorType.EVAL,
            message,
            stack,
          })
          break
        }
      }

      runScript(script, args).then(res => {
        sendMessage({
          type: MessageType.RETURN,
          result: res,
        })
      }).catch(err => {
        const { message, stack } = err
        sendMessage({
          type: MessageType.ERROR,
          errorType: ErrorType.RUNTIME,
          message,
          stack,
        })
      })
      break
  }
}

const runScript = async (script: any, args: any[]) => {
  const ctx = {
    console: _console,
    ...injectedInterface,
    isWorker: true,
    require: _require,
    __filename: filename,
    __dirname: dirname,
    exports: Object.create(null),
  }
  script.runInNewContext(ctx, { displayErrors: true })
  const mainfn = ctx.exports.__mainfn
  if (typeof mainfn !== 'function') throw new Error('invalid function')
  return mainfn.apply(null, args)
}

const _eval = (source: string) => {
  return new Script(`'use strict'; exports.__mainfn = ${source}`, {
    filename,
  })
}

const _require = (modulePath: string) => {
  const { allowedModules } = workerData
  const isRelative = ~modulePath.indexOf(path.sep)
  let realPath = modulePath

  // if (!~allowedModules.indexOf(modulePath)) {
  //   throw new Error(`'${modulePath}' module not allowed`)
  // }

  if (!allowedModules.some((pattern: string) => minimatch(modulePath, pattern))) {
    throw new Error(`'${modulePath}' module not allowed`)
  }

  if (isRelative) {
    if (filename === '') throw new Error(`empty module filename`)
    realPath = path.resolve(dirname, modulePath)
  }

  return require(realPath)
}

  ; (parentPort as MessagePort).on(
    'message',
    handleMainThreadMessage
  )
