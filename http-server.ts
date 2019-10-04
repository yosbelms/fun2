import { Runner, createRunner } from './runner'

interface SourceArgsContainer {
  source?: string
  args?: string
}

const parseJson = (args: any) => {
  return (
    typeof args === 'string'
      ? JSON.parse(args)
      : void 0
  )
}

export const handleHttpRequest = async (
  runner: Runner,
  method: string,
  query: SourceArgsContainer = {},
  body: SourceArgsContainer = {},
  parseArgs: Function = parseJson
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

  const parsedArgs = parseArgs(args)

  return await (runner as Runner).run(
    source || '',
    parsedArgs
  )
}

export const createExpressMiddleware = (
  runner: Runner = createRunner(),
  parseArgs?: Function
) => {
  return async (request: any, response: any, next: Function) => {
    const result = await handleHttpRequest(
      runner,
      request.method,
      request.query,
      request.body,
      parseArgs,
    )
    response.send(result)
    next()
  }
}

export const createKoaMiddleware = (
  runner: Runner = createRunner(),
  parseArgs?: Function
) => {
  return async (ctx: any, next: Function) => {
    const { request, response } = ctx
    const result = await handleHttpRequest(
      runner,
      request.method,
      request.query,
      request.body,
      parseArgs
    )
    response.body = result
    next()
  }
}
