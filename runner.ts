import pDefer from 'p-defer'
import { Pool } from './pool'
import { Worker } from 'worker_threads'
import { MessageType, ErrorType, secs, EvalError, ExitError, RuntimeError, TimeoutError, mins } from './util'
import { serializeInterface, callInInterface } from './interface'

const DEFAULT_TIMEOUT = secs(10)

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
      const { basePath, method, args, id } = message
      const r = callInInterface(iface, basePath, method, args)
      Promise.resolve(r).then((result) => {
        worker.postMessage({ type: MessageType.RESPONSE, id, result })
      })
      break
    case MessageType.RETURN:
      const { result: res } = message
      resolve(res)
      if (pool.isAcquired(worker)) {
        pool.release(worker)
      }
      break
    case MessageType.ERROR:
      const { stack, errorType } = message
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
}

export class Runner {
  private config: Partial<RunnerConfig>
  private pool: Pool<Worker>

  constructor(config: Partial<RunnerConfig>) {
    this.config = {
      timeout: DEFAULT_TIMEOUT,
      allowedModules: [],
      maxWorkers: 5,
      maxWorkersIddleTime: mins(1),
      maxWorkersLifeTime: mins(5),
      interface: Object.create(null),
      ...config,
    }

    const {
      interface: iface,
      maxWorkers,
      filename,
      allowedModules,
      maxWorkersIddleTime,
      maxWorkersLifeTime,
    } = this.config

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
    }))

    const timer = setTimeout(() => {
      const msg = `Timeout after ${_timeout} milliseconds`
      _handleMessageFromWorker({
        type: MessageType.ERROR,
        errorType: ErrorType.TIMEOUT,
        message: msg,
        stack: msg,
      })
    }, _timeout)

    return promise.then((result) => {
      clearTimeout(timer)
      return result
    }).catch((reason) => {
      clearTimeout(timer)
      throw reason
    })
  }

  async run(source: string, args?: any[], timeout?: number) {
    const runResultMapper = this.config.runResultMapper
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
