import { Runner, createRunner } from './runner'

interface SourceArgsContainer {
  source?: string
  args?: string
}

export const handleHttpRequest = async (
  runner: Runner,
  method: string,
  query: SourceArgsContainer = {},
  body: SourceArgsContainer = {}
) => {
  let source
  let args

  switch (method.toUpperCase()) {
    case 'GET':
      source = query.source
      args = query.args
      break
    case 'POST':
      source = query.source
      args = body.args
      break
  }

  const parsedArgs = (
    typeof args === 'string'
      ? JSON.parse(args)
      : void 0
  )

  return await (runner as Runner).run(
    source || '',
    parsedArgs
  )
}

export const createExpressMiddleware = (runner: Runner = createRunner()) => {
  return async (request: any, response: any, next: Function) => {
    const result = await handleHttpRequest(
      runner,
      request.method,
      request.query,
      request.body
    )
    response.send(result)
    next()
  }
}

export const createKoaMiddleware = (runner: Runner = createRunner()) => {
  return async (ctx: any, next: Function) => {
    const { request, response } = ctx
    const result = await handleHttpRequest(
      runner,
      request.method,
      request.query,
      request.body
    )
    response.body = result
    next()
  }
}
