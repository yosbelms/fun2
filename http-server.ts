import { Runner, createRunner } from './runner'

interface SourceArgsContainer {
  source?: string
  args?: string
}

const defaultDecode = (data: any) => {
  return (
    typeof data === 'string'
      ? JSON.parse(data)
      : void 0
  )
}

const defaultEncode = (data: any) => {
  return JSON.stringify(data)
}

export const handleHttpRequest = async (
  runner: Runner,
  method: string,
  query: SourceArgsContainer = {},
  body: SourceArgsContainer = {},
  encode: Function = defaultEncode,
  decode: Function = defaultDecode,
) => {
  let source = query.source
  let args

  switch (method.toUpperCase()) {
    case 'GET':
      args = query.args
      break
    case 'POST':
      args = body.args
      break
  }

  const decodedArgs = decode(args)
  const result = await (runner as Runner).run(
    source || '',
    decodedArgs
  )

  return encode(result)
}

export const createExpressMiddleware = (
  runner: Runner = createRunner(),
  encode?: Function,
  decode?: Function,
) => {
  return async (request: any, response: any, next: Function) => {
    try {
      const result = await handleHttpRequest(
        runner,
        request.method,
        request.query,
        request.body,
        encode,
        decode,
      )
      response.send(result)
      next()
    } catch (err) {
      response.statusCode = 500
      response.send(err.stack)
      next()
    }
  }
}

export const createKoaMiddleware = (
  runner: Runner = createRunner(),
  encode?: Function,
  decode?: Function,
) => {
  return async (ctx: any, next: Function) => {
    const { request, response } = ctx
    try {
      const result = await handleHttpRequest(
        runner,
        request.method,
        request.query,
        request.body,
        encode,
        decode,
      )
      response.body = result
      next()
    } catch (err) {
      console.log('error http', err.stack)
      ctx.throw(500, err.stack)
      // response.status = 500
      // response.body = err.stack
      // next()
    }
  }
}
