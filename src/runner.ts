import Pool from './pool'
import pDefer from 'p-defer'
import pTimeout from 'p-timeout'
import { Worker } from 'worker_threads'
import { createInterface, serializeInterface, callInInterface } from './interface'

const handleWorkerMessage = (
  pool: Pool<Worker>,
  worker: Worker,
  iface: any,
  resolve: Function,
  reject: Function,
) => (message: any) => {
  // console.log(message)
  switch (message.type) {
    case 'REQUEST':
      const { basePath, method, args, id } = message
      const r = callInInterface(iface, basePath, method, args)
      Promise.resolve(r).then((result) => {
        worker.postMessage({ type: 'RESPONSE', id, result })
      })
      break;
    case 'RETURN':
      const { result: res } = message
      resolve(res)
      if (pool.contains(worker)) {
        pool.release(worker)
      }
      break;
    case 'ERROR':
      const { message: msg } = message
      handleWorkerError(pool, worker, reject)(msg)
      break;
  }
}

const handleWorkerError = (
  pool: Pool<Worker>,
  worker: Worker,
  reject: Function,
) => (message: any) => {
  reject(message)
  if (pool.contains(worker)) {
    pool.release(worker)
  }
}

const handleWorkerExit = (
  pool: Pool<Worker>,
  worker: Worker,
  reject: Function,
) => (code: number) => {
  reject(`Worker has ended with code ${code}`)
  if (pool.contains(worker)) {
    pool.release(worker)
  }
}

export interface RunnerConfig {
  interface: any
  maxWorkers: number
  timeout: number
  filename: string
  allowedModules: string[]
  knownSources: { [key: string]: string }
  allowUnknownSources: boolean
  runResultMapper: Function
}

export class Runner {
  config: Partial<RunnerConfig>
  pool: Pool<Worker>

  constructor(config: Partial<RunnerConfig>) {
    this.config = {
      allowedModules: [],
      knownSources: {},
      allowUnknownSources: true,
      maxWorkers: 5,
      interface: createInterface({}),
      ...config,
    }
    const {
      interface: iface,
      maxWorkers,
      filename,
      allowedModules
    } = this.config

    this.pool = new Pool({
      maxResorces: maxWorkers,
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
      }

    })
  }

  private async runInWorker(source: string, args: any[] = [], timeout?: number) {
    const _timeout = timeout || this.config.timeout || 1000
    const worker = await this.pool.acquire() as Worker
    const { promise, resolve, reject } = pDefer()
    if (this.pool.contains(worker)) {
      worker.postMessage({ type: 'EXECUTE', source, args })
      worker.on('message', handleWorkerMessage(this.pool, worker, this.config.interface, resolve, reject))
      worker.on('error', handleWorkerError(this.pool, worker, reject))
      worker.on('exit', handleWorkerExit(this.pool, worker, reject))
      pTimeout(promise, _timeout).catch(handleWorkerError(this.pool, worker, reject))
    }
    return promise
  }

  async run(source: string, args?: any[], timeout?: number) {
    let _source = source
    try {
      const { knownSources, allowUnknownSources } = this.config
      if (!allowUnknownSources && knownSources) {
        _source = knownSources[source]
        if (!knownSources.hasOwnProperty(source) || typeof _source !== 'string') {
          throw new Error(`unknown source \n'${source}'`)
        }
      }
      const runResultMapper = this.config.runResultMapper
      const result = await this.runInWorker(_source, args, timeout)
      return typeof runResultMapper === 'function' ? runResultMapper(result) : result
    } catch (err) {
      throw new Error(`invalid source \n'${source}', ${err.stack}`)
    }
  }

  createFunction(source: string, timeout?: number) {
    return (...args: any[]) => this.run(source, args, timeout)
  }

  destroy() {
    return this.pool.destroy()
  }
}

export const createRunner = (config: Partial<RunnerConfig> = {}) => {
  return new Runner(config)
}