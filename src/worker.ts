import pDefer from 'p-defer'
import deepFreeze from 'deep-freeze'
import path from 'path'
import { parentPort, workerData, MessagePort } from 'worker_threads'
import { Script } from 'vm'
import { createConsole } from './util'
import { createContextClient } from './context'

let requestIdSeed = 0
const pendingRequestsDeferredPromises = new Map()
const scriptCache = new Map()
const _console = createConsole()
const sendMessage = (msg: any) => (parentPort as MessagePort).postMessage(msg)
const filename = typeof workerData.filename === 'string' ? workerData.filename : ''
const dirname = path.dirname(filename)

const createContextClientFunctionCaller = (method: string, basePath: string) => {
  return (...args: any[]) => {
    const id = requestIdSeed++
    const deferredPromise = pDefer()
    pendingRequestsDeferredPromises.set(id, deferredPromise)
    sendMessage({ type: 'REQUEST', basePath, method, args, id })
    return deferredPromise.promise
  }
}

const injectedContext = deepFreeze(
  createContextClient(
    workerData.serializedContext,
    createContextClientFunctionCaller,
  )
)

const handleMainThreadMessage = (message: any) => {
  // console.log(message)
  switch (message.type) {
    case 'RESPONSE':
      const { id, result } = message
      pendingRequestsDeferredPromises.get(id).resolve(result)
      pendingRequestsDeferredPromises.delete(id)
      break;
    case 'EXECUTE':
      const { source, args = [] } = message
      pendingRequestsDeferredPromises.forEach((_, p) => p.reject())
      pendingRequestsDeferredPromises.clear()

      let script = scriptCache.get(source)
      if (!script) {
        script = _eval(source)
        scriptCache.set(source, script)
      }

      runScript(script, args).then(res => {
        sendMessage({ type: 'RETURN', result: res })
      }).catch(err => {
        console.log(err, err.stack)
        const { message, stack } = err
        sendMessage({ type: 'ERROR', message, stack })
      })
      break;
  }
}

const runScript = async (script: any, args: any[]) => {
  const ctx = {
    console: _console,
    ...injectedContext,
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

  if (!~allowedModules.indexOf(modulePath)) throw new Error(`'${modulePath}' module not allowed`)

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
