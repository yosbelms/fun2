import pDefer from 'p-defer'
import { Pool } from './pool'
import { Worker } from 'worker_threads'
import { secs, mins } from './util'
import { ErrorType, EvalError, ExitError, RuntimeError, TimeoutError } from './error'
import { MessageType, RequestMessage, ReturnMessage, ErrorMessage, ExitMessage, } from './message'
import { serializeInterface, callInInterface } from './interface'

const handleMessageFromWorker = (
  pool: Pool<Worker>,
  worker: Worker,
  iface: any,
  resolve: Function,
  reject: Function,
) => (message: any) => {
  // console.log('RUNNER', message)
  switch (message.type) {
    case MessageType.REQUEST:
      const { basePath, method, args, id } = message as RequestMessage
      const r = callInInterface(iface, basePath, method, args)
      Promise.resolve(r).then((result) => {
        worker.postMessage({ type: MessageType.RESPONSE, id, result })
      })
      break
    case MessageType.RETURN:
      const { result: res } = message as ReturnMessage
      resolve(res)
      if (pool.isAcquired(worker)) {
        pool.release(worker)
      }
      break
    case MessageType.ERROR:
      const { stack, errorType } = message as ErrorMessage
      let err: Error = new Error

      switch (errorType) {
        case ErrorType.EVAL:
          err = new EvalError(stack)
          break
        case ErrorType.RUNTIME:
          err = new RuntimeError(stack)
          break
        case ErrorType.TIMEOUT:
          err = new TimeoutError(stack)
          break
      }

      reject(err)
      if (pool.isAcquired(worker)) {
        pool.release(worker)
      }
      break
    case MessageType.EXIT:
      const { code } = message
      reject(new ExitError(`Worker has ended with code ${code}`))
      pool.remove(worker)
      break
  }
}

export interface RunnerConfig {
  interface: any
  maxWorkers: number
  maxWorkersIddleTime: number
  maxWorkersLifeTime: number
  timeout: number
  filename: string
  allowedModules: string[]
  runResultMapper: Function
  hashMap: { [k: string]: string }
}

export class Runner {
  private config: Partial<RunnerConfig>
  private pool: Pool<Worker>
  private hashMap: Map<string, string>

  constructor(config: Partial<RunnerConfig>) {
    this.config = {
      timeout: secs(10),
      allowedModules: [],
      maxWorkers: 5,
      maxWorkersIddleTime: mins(1),
      maxWorkersLifeTime: mins(5),
      interface: Object.create(null),
      hashMap: {},
      ...config,
    }

    const {
      interface: iface,
      maxWorkers,
      filename,
      allowedModules,
      maxWorkersIddleTime,
      maxWorkersLifeTime,
      hashMap
    } = this.config

    this.hashMap = new Map(Object.entries(hashMap || {}))

    this.pool = new Pool({
      maxResorces: maxWorkers,
      maxIddleTime: maxWorkersIddleTime,
      maxLifeTime: maxWorkersLifeTime,

      create() {
        return new Worker(`${__dirname}/worker.js`, {
          workerData: {
            serializedInterface: serializeInterface(iface),
            filename,
            allowedModules,
          }
        })
      },

      beforeAvailable(worker: Worker) {
        worker.removeAllListeners()
      },

      destroy(worker: Worker) {
        return new Promise((resolve, reject) =>
          worker.terminate().then(() => {
            resolve()
            worker.removeAllListeners()
          }).catch((err) => {
            worker.removeAllListeners()
            reject(err)
          })
        )
      },
    })
  }

  private async runInWorker(source: string, args: any[] = [], timeout?: number) {
    const _timeout = timeout || this.config.timeout
    const worker = await this.pool.acquire() as Worker
    const { promise, resolve, reject } = pDefer()

    worker.postMessage({
      type: MessageType.EXECUTE,
      source,
      args,
    })

    const _handleMessageFromWorker = handleMessageFromWorker(
      this.pool,
      worker,
      this.config.interface,
      resolve,
      reject,
    )

    worker.on('message', _handleMessageFromWorker)
    worker.on('error', _handleMessageFromWorker)
    worker.on('exit', (code) => _handleMessageFromWorker({
      type: MessageType.EXIT,
      code
    } as ExitMessage))

    const timer = setTimeout(() => {
      const msg = `Timeout after ${_timeout} milliseconds`
      _handleMessageFromWorker({
        type: MessageType.ERROR,
        errorType: ErrorType.TIMEOUT,
        message: msg,
        stack: msg,
      } as ErrorMessage)
    }, _timeout)

    return promise.then((result) => {
      clearTimeout(timer)
      return result
    }).catch((reason) => {
      clearTimeout(timer)
      throw reason
    })
  }

  async run(sourceOrHash: string, args?: any[], timeout?: number) {
    let source = sourceOrHash
    const { runResultMapper } = this.config

    if (this.hashMap.size > 0) {
      if (this.hashMap.has(sourceOrHash)) {
        source = this.hashMap.get(sourceOrHash) || ''
      } else {
        throw new EvalError(`unknown source: ${sourceOrHash}`)
      }
    }
    const result = await this.runInWorker(source, args, timeout)
    return typeof runResultMapper === 'function' ? runResultMapper(result) : result
  }

  destroy() {
    return this.pool.destroy()
  }
}

export const createRunner = (config: Partial<RunnerConfig> = {}): Runner => {
  return new Runner(config)
}
