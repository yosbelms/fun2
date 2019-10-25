const maxUrlLength = 2000

export interface ClientConfig {
  request: Function
  url: string
  encode: Function
  decode: Function
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
  return fetch(url, { method, headers, body, }).then(resp => resp.text())
}

const defaultEncode = (data: any) => {
  return encodeURIComponent(JSON.stringify(data))
}

const defaultDecode = (str: string) => {
  try {
    return typeof str === 'string' ? JSON.parse(str) : str
  } catch (err) {
    //
  }
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
      encode: defaultEncode,
      decode: defaultDecode,
      ...config,
    }
  }

  request(method: string, source: string, args: any[]) {
    let { url, encode, decode } = this.config
    let body
    let headers

    const sourceUrlFragment = `source=${encodeURIComponent(source)}`

    switch (method.toUpperCase()) {
      case 'GET':
        const argsUrlFragment = (
          Array.isArray(args) && args.length
            ? `args=${encode(args)}`
            : ``)
        url = `${url}?${sourceUrlFragment}${argsUrlFragment.length ? `&${argsUrlFragment}` : ``}`
        break
      case 'POST':
        url = `${url}?${sourceUrlFragment}`
        body = encode(args)
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

    return (this.config
      .request(request)
      .then((result: any) => decode(result))
    )
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

const stringifyTemplateLiteral = (statics: TemplateStringsArray) => {
  return statics.join('')
}

export const createRemoteFunc = (source: string, method: string): RemoteFunction => {
  const remoteFunction: RemoteFunction = (...args: any[]): any => {
    const client = remoteFunction.client || getClient()
    return client.request(method, source, args)
  }
  remoteFunction.source = source
  return remoteFunction
}

export const get = (statics: TemplateStringsArray) => {
  const source = stringifyTemplateLiteral(statics)
  return createRemoteFunc(source, 'GET')
}

export const post = (statics: TemplateStringsArray) => {
  const source = stringifyTemplateLiteral(statics)
  return createRemoteFunc(source, 'POST')
}
