import { Compiler } from 'webpack'
import fs from 'fs'
import path from 'path'
import makeDir from 'make-dir'
import { importApi } from './import-api'
import { hashMap, mapToJson, hashMapFileName } from './util'

const pluginName = 'Fun2WebpackPlugin'

interface ApiConfig {
  sourcePath: string
  destinationDir: string
}

interface PluginConfig {
  hashMapDir?: string
  apis?: ApiConfig[]
}

class Fun2WebpackPlugin {
  config: PluginConfig

  constructor(config: PluginConfig = {}) {
    this.config = {
      apis: [],
      ...config
    }
  }

  apply(compiler: Compiler) {
    compiler.hooks.beforeCompile.tap(pluginName, () => {
      hashMap.clear()
    })

    compiler.hooks.afterCompile.tap(pluginName, () => {
      const { hashMapDir } = this.config
      if (hashMapDir) {
        makeDir(path.resolve(hashMapDir)).then(dir => {
          fs.writeFileSync(path.join(dir, hashMapFileName), mapToJson(hashMap))
        })
      }
    })

    compiler.hooks.beforeRun.tapPromise(pluginName, async () => {
      const apis = this.config.apis as ApiConfig[]
      for (const api of apis) {
        await importApi(api.sourcePath, api.destinationDir)
      }
    })
  }
}

module.exports = Fun2WebpackPlugin
