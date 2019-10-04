import deepFreeze from 'deep-freeze'

export const isObject = (obj: any) => typeof obj === 'object' && obj !== null
export const isFunction = (fn: any) => typeof fn === 'function'
export const identity = (a: any) => a
export const noop = () => { }
export const secs = (s: number) => s * 1000

export const deepMap = (obj: any, callback: Function, basePath: string[] = []) => {
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (isObject(value) || Array.isArray(value)) {
      result[key] = deepMap(value, callback, [...basePath, key])
    } else {
      result[key] = callback(value, key, [...basePath])
    }
  }
  return result
}

export const getProp = (obj: any, path: string[], forEach: Function = noop) => {
  let current = obj
  for (let i = 0; i < path.length; i++) {
    if (current === void 0) return
    forEach(current)
    current = current[path[i]]
  }
  return current
}

export const createConsole = () => {
  const orignalConsole: any = console
  const _console: { [key: string]: Function } = {}
  for (const [key, value] of Object.entries(console)) {
    if (typeof value === 'function') {
      _console[key] = (...args: any[]) => orignalConsole[key](...args)
    }
  }
  return deepFreeze(_console)
}

export const formatWorkerErrorMessage = (err: Error, source: string) => {
  const match = /at eval.+?(\d+)\:(\d+)\)\n/g.exec(String(err.stack))
  let lineno = match ? Number(match[1]) : 0
  let colno = match ? Number(match[2]) : 0
  const message = err.message
  const marker = new Array(colno - 2).fill('-')
  marker.push('^')
  const lines = source.split('\n')
  lines.splice(lineno + 1, 0, marker.join(''))
  return [`Error (in worker): ${message}:`, '', ...lines, ''].join('\n')
}