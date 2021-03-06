import pDefer from 'p-defer'
import { Pool } from './pool'
import { Worker as NodeWorker } from 'worker_threads'
import { secs, mins, genericMiddleware } from './util'
import { ErrorType, EvalError, ExitError, RuntimeError, TimeoutError } from './error'
import { MessageType, RequestMessage, ReturnMessage, ErrorMessage, ExitMessage, ExecuteMessage, } from './message'
import { serializeApi, callInApi, getApiFromApiModule } from './api'

class WorkerWrapper<T> {
  private nodeWorker: NodeWorker
  private context?: T

  constructor(nodeWorker: NodeWorker) {
    this.nodeWorker = nodeWorker
  }

  setContext(ctx: T) {
    this.context = ctx
  }

  getContext() {
    return this.context
  }

  getWorker() {
    return this.nodeWorker
  }
}

const handleMessageFromWorker = (
  pool: Pool<WorkerWrapper<any>>,
  workerWrapper: WorkerWrapper<any>,
  api: any,
  resolve: Function,
  reject: Function,
) => (message: any) => {
  // console.log('RUNNER', message)
  const worker = workerWrapper.getWorker()
  switch (message.type) {
    case MessageType.REQUEST:
      const { basePath, method, args, id } = message as RequestMessage
      const r = callInApi(api, basePath, method, args, workerWrapper.getContext())
      Promise.resolve(r).then((result) => {
        worker.postMessage({ type: MessageType.RESPONSE, id, result })
      })
      break
    case MessageType.RETURN:
      const { result: res } = message as ReturnMessage
      resolve(res)
      if (pool.isAcquired(workerWrapper)) {
        pool.release(workerWrapper)
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
      if (pool.isAcquired(workerWrapper)) {
        pool.release(workerWrapper)
      }
      break
    case MessageType.EXIT:
      const { code } = message
      reject(new ExitError(`Worker has ended with code ${code}`))
      pool.remove(workerWrapper)
      break
  }
}

export interface RunnerConfig {
  apiModule: any
  api: any
  middleware: typeof genericMiddleware
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
  private pool: Pool<WorkerWrapper<any>>
  private hashMap: Map<string, string>

  constructor(config: Partial<RunnerConfig>) {
    this.config = {
      timeout: secs(10),
      allowedModules: [],
      maxWorkers: 5,
      maxWorkersIddleTime: mins(1),
      maxWorkersLifeTime: mins(5),
      api: Object.create(null),
      hashMap: {},
      ...config,
    }

    const {
      api,
      maxWorkers,
      filename,
      allowedModules,
      maxWorkersIddleTime,
      maxWorkersLifeTime,
      hashMap
    } = this.config

    this.hashMap = new Map(Object.entries(hashMap || {}))

    this.pool = new Pool<WorkerWrapper<any>>({
      maxResorces: maxWorkers,
      maxIddleTime: maxWorkersIddleTime,
      maxLifeTime: maxWorkersLifeTime,

      create() {
        const nodeWorker = new NodeWorker(`${__dirname}/worker.js`, {
          workerData: {
            serializedApi: serializeApi(api),
            filename,
            allowedModules,
          }
        })
        return new WorkerWrapper(nodeWorker)
      },

      beforeAvailable(workerWrapper: WorkerWrapper<any>) {
        workerWrapper.getWorker().removeAllListeners()
      },

      destroy(workerWrapper: WorkerWrapper<any>) {
        const worker = workerWrapper.getWorker()
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

  private async runInWorker(source: string, args: any[] = [], context?: any, timeout?: number) {
    const _timeout = timeout || this.config.timeout
    const middleware = this.config.middleware || genericMiddleware
    const workerWrapper = await this.pool.acquire() as WorkerWrapper<any>
    const worker = workerWrapper.getWorker()
    const { promise, resolve, reject } = pDefer()

    workerWrapper.setContext(context)

    worker.postMessage({
      type: MessageType.EXECUTE,
      source,
      args,
    } as ExecuteMessage)

    const _handleMessageFromWorker = handleMessageFromWorker(
      this.pool,
      workerWrapper,
      this.config.api,
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

  async run(sourceOrHash: string, args?: any[], context?: any, timeout?: number) {
    let source = sourceOrHash
    const { runResultMapper } = this.config

    if (this.hashMap.size > 0) {
      if (this.hashMap.has(sourceOrHash)) {
        source = this.hashMap.get(sourceOrHash) || ''
      } else {
        throw new EvalError(`unknown source: ${sourceOrHash}`)
      }
    }
    const result = await this.runInWorker(source, args, context, timeout)
    return typeof runResultMapper === 'function' ? runResultMapper(result) : result
  }

  destroy() {
    return this.pool.destroy()
  }
}

export const createRunner = (config: Partial<RunnerConfig> = {}): Runner => {
  const { apiModule } = config
  if (apiModule) {
    config.api = getApiFromApiModule(apiModule)

    // const entryName = Object.keys(apiModule).find(key => key !== 'default')
    // if (entryName !== void 0) {
    //   config.api = { [entryName]: apiModule[entryName] }
    // }
  }
  return new Runner(config)
}
