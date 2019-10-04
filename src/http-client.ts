
const maxUrlLength = 2000

export interface ClientConfig {
  request: Function
  url: string
}

export interface ClientRequest {
  url: string
  method: string
  headers: { [key: string]: string }
  body: any
  source: string
  args: any[]
}

interface RemoteFunction extends Function {
  (...args: any[]): any
  client?: Client
  source?: string
}

const defaultRequest = (req: ClientRequest) => {
  let { url, method, headers, body } = req
  return fetch(url, {
    method,
    headers,
    body,
  })
}

export class Client {
  config: ClientConfig
  constructor(config: Partial<ClientConfig> = {}) {
    let url = 'http://localhost/'
    if (global && (global as any).location) {
      url = (global as any).location
    }
    this.config = {
      url,
      request: defaultRequest,
      ...config,
    }

  }

  request(method: string, source: string, args: any[]) {
    let url = this.config.url
    let body
    let headers

    const sourceUrlFragment = `source=${encodeURIComponent(source)}`
    const argsUrlFragment = (
      Array.isArray(args) && args.length
        ? `args=${encodeURIComponent(JSON.stringify(args))}`
        : ``)

    switch (method.toUpperCase()) {
      case 'GET':
        url = `${url}?${sourceUrlFragment}${argsUrlFragment.length ? `&${argsUrlFragment}` : ``}`
        break
      case 'POST':
        url = `${url}?${sourceUrlFragment}`
        headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
        body = argsUrlFragment
        break
    }

    if (url.length > maxUrlLength) throw new Error(`url exceeds max length of ${maxUrlLength}, '${url}'`)

    const request = {
      url,
      method,
      headers,
      body,
      source,
      args,
    }

    return this.config.request(request)
  }

  call(fn: RemoteFunction, ...args: any[]) {
    const client = fn.client
    fn.client = this
    const result = fn.apply(null, args)
    fn.client = client
    return result
  }

}

let defaultClient: Client = new Client()
export const getClient = () => defaultClient
export const setClient = (client: Client) => {
  defaultClient = client
}

const stringifyTemplateLiteral = (statics: TemplateStringsArray, dynamics: any[] = []) => {
  return statics.reduce((acc, seg, idx) => {
    let result = acc + seg

    if (idx < dynamics.length) {
      const dynamic = dynamics[idx]
      if (typeof dynamic === 'string') {
        result += String(dynamic)
      }
    }

    return result
  }, '')
}

export const createRemoteFunc = (source: string, method: string): RemoteFunction => {
  const remoteFunction: RemoteFunction = (...args: any[]): any => {
    const client = remoteFunction.client || getClient()
    return client.request(method, source, args)
  }
  remoteFunction.source = source
  return remoteFunction
}

export const get = (statics: TemplateStringsArray, dynamics: string[] = []) => {
  const source = stringifyTemplateLiteral(statics, dynamics)
  return createRemoteFunc(source, 'GET')
}

export const post = (statics: TemplateStringsArray, dynamics: string[] = []) => {
  const source = stringifyTemplateLiteral(statics, dynamics)
  return createRemoteFunc(source, 'POST')
}

// export const func = (statics: TemplateStringsArray, dynamics: string[] = []) => {
//   const source = stringifyTemplateLiteral(statics, dynamics)
//   return (...args: any[]) => ({
//     source,
//     args,
//   })
// }

// export const get = (statics: TemplateStringsArray, dynamics: string[] = []) => {
//   const source = stringifyTemplateLiteral(statics, dynamics)
//   const requester = (...args: any[]) => {
//     return getClient().request('GET', source, args)
//   }
//   requester.source = source
//   return requester
// }

// export const post = (statics: TemplateStringsArray, dynamics: string[] = []) => {
//   const source = stringifyTemplateLiteral(statics, dynamics)
//   const requester = (...args: any[]) => {
//     return getClient().request('POST', source, args)
//   }
//   requester.source = source
//   return requester
// }