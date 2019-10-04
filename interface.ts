import { deepMap, getProp, isFunction, identity } from './util'

const functionToken = '@@token/function'
const interfaceResultMapperToken = '@@token/interface-result-mapper'

export const createInterfaceClient = (serializedInterface: any, createClient: Function) => {
  return deepMap(serializedInterface, (value: any, key: any, basePath: string[]) => {
    return (value === functionToken
      ? createClient(key, basePath)
      : value
    )
  })
}

export const createInterface = (iface: Object = {}, resultMapper?: Function) => {
  (iface as any)[interfaceResultMapperToken] = resultMapper
  return iface
}

export const callInInterface = (iface: Object, basePath: string[], method: string, args = []) => {
  let resultMapper = identity
  const prop = getProp(iface, basePath, (value: any) => {
    if (value && typeof value[interfaceResultMapperToken] === 'function') {
      resultMapper = value[interfaceResultMapperToken]
    }
  }) as any
  const fn = prop[method]
  if (typeof fn === 'function') return resultMapper(fn.apply(prop, args))
  throw new TypeError(`${basePath.join('.')}.${method} is not a function`)
}

export const serializeInterface = (iface: Object) => {
  return deepMap(iface, (value: any, key: string) => {
    if (key === interfaceResultMapperToken) return void 0
    if (isFunction(value)) return functionToken
    return value
  })
}
