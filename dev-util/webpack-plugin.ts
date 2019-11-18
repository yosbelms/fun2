import { Compiler } from 'webpack'
import fs from 'fs'
import path from 'path'
import makeDir from 'make-dir'
import globby from 'globby'
import { compile } from './ts-compiler'
import { hashMap, mapToJson, workDirName, hashMapFileName, interfacesDirName } from './util'

const pluginName = 'Fun2WebpackPlugin'

interface InterfaceReference {
  path: string
  name: string
}

interface Fun2WebpackPluginConfig {
  rootPath?: string
  interfaces?: InterfaceReference[]
}

class Fun2WebpackPlugin {
  config: Fun2WebpackPluginConfig

  constructor(config: Fun2WebpackPluginConfig = {}) {
    this.config = {
      rootPath: './',
      interfaces: [],
      ...config
    }
  }

  apply(compiler: Compiler) {
    compiler.hooks.beforeCompile.tap(pluginName, () => {
      hashMap.clear()
    })

    compiler.hooks.afterCompile.tap(pluginName, () => {
      const { rootPath } = this.config
      if (rootPath) {
        makeDir(path.join(rootPath, workDirName)).then(dir => {
          fs.writeFileSync(path.join(dir, hashMapFileName), mapToJson(hashMap))
        })
      }
    })

    compiler.hooks.beforeRun.tapPromise(pluginName, async () => {
      const ifaces = this.config.interfaces as InterfaceReference[]
      const rootPath = this.config.rootPath as string
      const workDir = path.join(rootPath, workDirName)
      const interfacesDir = path.join(workDir, interfacesDirName)

      for (const ifaceRef of ifaces) {
        const outDir = await makeDir(path.join(interfacesDir, ifaceRef.name))
        const ifacePath = ifaceRef.path

        compile([ifacePath], {
          declaration: true,
          allowJs: true,
          emitDeclarationOnly: true,
          noEmitOnError: true,
          declarationDir: outDir,
        })

        const relativeInterfaceFileName = (
          `./${interfacesDirName}/${path.basename(outDir)}/${path.basename(ifacePath, path.extname(ifacePath))}`
        )

        fs.writeFileSync(`${path.join(workDir, path.basename(outDir))}.d.ts`, [
          `export { default } from '${relativeInterfaceFileName}'`,
          `export * from '${relativeInterfaceFileName}'`
        ].join('\n'))
      }

      const dTsPaths = await globby([path.join(workDir, '/**/*.d.ts')])

      dTsPaths.forEach(file => {
        const filename = path.join(
          path.dirname(file),
          path.basename(file, '.d.ts')) + '.js'
        // @TODO: check if exists first
        fs.writeFileSync(filename, '')
      })
    })
  }
}

module.exports = Fun2WebpackPlugin
