import { deepMap, getProp, isFunction, identity } from './util'

const functionToken = '@@token/function'
const contextualResultMapperToken = '@@token/contextual-result-mapper'

export const createContextClient = (serializedContext: any, createClient: Function) => {
  return deepMap(serializedContext, (value: any, key: any, basePath: string[]) => {
    return (value === functionToken
      ? createClient(key, basePath)
      : value
    )
  })
}

export const createContext = (ctx: Object = {}, resultMapper?: Function) => {
  (ctx as any)[contextualResultMapperToken] = resultMapper
  return ctx
}

export const callInContext = (ctx: Object, basePath: string[], method: string, args = []) => {
  let resultMapper = identity
  const prop = getProp(ctx, basePath, (value: any) => {
    if (value && typeof value[contextualResultMapperToken] === 'function') {
      resultMapper = value[contextualResultMapperToken]
    }
  }) as any
  const fn = prop[method]
  if (typeof fn === 'function') return resultMapper(fn.apply(prop, args))
  throw new TypeError(`${basePath.join('.')}.${method} is not a function`)
}

export const serializeContext = (ctx: Object) => {
  return deepMap(ctx, (value: any, key: string) => {
    if (key === contextualResultMapperToken) return void 0
    if (isFunction(value)) return functionToken
    return value
  })
}
