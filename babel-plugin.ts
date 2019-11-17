import crypto from 'crypto'

const defaultTestRegex = /\.fun2\.(js|mjs|jsx|ts|tsx)$/

const filenamePassTest = (regex: RegExp, filename: string) => {
  return filename && regex.test(filename)
}

const sha1 = (txt: string) => {
  const shasum = crypto.createHash('sha1')
  shasum.update(txt)
  return shasum.digest('hex')
}

const defaultTypescriptTranspile = (source: string) => {
  try {
    const ts = require('typescript')
    const transpileOutput = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2017,
      }
    })
    return transpileOutput.outputText
  } catch (e) {
    throw new Error(`${__filename}: invalid 'ts' option. ${e.stack}`)
  }
}

export default ({ types: t }: { types: any }) => {
  return {
    visitor: {
      CallExpression: (path: any, state: any) => {
        const file = state.file
        const filename = file.opts.filename
        const {
          transpile = defaultTypescriptTranspile,
          test = defaultTestRegex,
          hashSource,
          hashMap,
        } = state.opts

        if (!filenamePassTest(test, filename)) return

        const fnNames = ['get', 'post']
        const calleePath = path.get('callee')
        if (fnNames.includes(calleePath.node.name)) {
          const firstArgPath = path.get('arguments.0')

          if (t.isFunctionExpression(firstArgPath) || t.isArrowFunctionExpression(firstArgPath)) {
            const source = firstArgPath.getSource()
            const transpiled = transpile(source).trim()

            let sourceOutput = hashSource ? sha1(transpiled) : transpiled
            if (hashMap) {
              hashMap[sourceOutput] = transpiled
            }

            // transform
            firstArgPath.replaceWith(t.stringLiteral(sourceOutput))
          }
        }
      }
    }
  }
}
