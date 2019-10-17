import { deepMap, getProp, isFunction } from './util'

export const SERIALIZED_FUNCTION_TOKEN = '@@token/function'

export const serializeInterface = (iface: Object) => {
  return deepMap(iface, (value: any) => {
    if (isFunction(value)) return SERIALIZED_FUNCTION_TOKEN
    return value
  })
}

export const createInterfaceClient = (iface: any, createClient: Function) => {
  return deepMap(iface, (value: any, key: any, basePath: string[]) => {
    return (value === SERIALIZED_FUNCTION_TOKEN
      ? createClient(key, basePath)
      : value
    )
  })
}

export const callInInterface = (iface: Object, basePath: string[], method: string, args = []) => {
  const prop = getProp(iface, basePath)
  const fn = prop[method]
  if (typeof fn === 'function') return fn.apply(prop, args)
  throw new TypeError(`${basePath.join('.')}.${method} is not a function`)
}
