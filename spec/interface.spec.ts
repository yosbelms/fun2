import { createInterfaceClient, serializeInterface, callInInterface, SERIALIZED_FUNCTION_TOKEN } from '../interface'
import 'jasmine'

const iface = {
  val: 5,
  func: () => true
}

describe('interface', () => {

  describe('serializeInterface', () => {
    it('should transform functions to function token', () => {
      const serializedIface = serializeInterface(iface)
      expect(serializedIface.func).toBe(SERIALIZED_FUNCTION_TOKEN)
    })

    it('should transform copy values other that functions', () => {
      const serializedIface = serializeInterface(iface)
      expect(serializedIface.val).toBe(iface.val)
    })
  })

  describe('createInterfaceClient', () => {
    it('should transform function tokens to a custom function', () => {
      const serializedIface = serializeInterface(iface)
      const createFn = (method: string, basePath: string[]) => () => [basePath, method]
      const ifaceClient = createInterfaceClient(serializedIface, createFn)
      const result = ifaceClient.func()
      expect(result).toEqual([[], 'func'])
    })

    it('should clone values other that functions', () => {
      const serializedIface = serializeInterface(iface)
      const ifaceClient = createInterfaceClient(serializedIface, () => { })
      expect(ifaceClient.val).toEqual(iface.val)
    })
  })

  describe('callInInterface', () => {
    it('should call the specified function', () => {
      const result = callInInterface(iface, [], 'func')
      expect(result).toBe(true)
    })

    it('should throw if doesn\'t find a function to call', () => {
      const tryToCall = () => callInInterface(iface, [], 'non-exixtent-func')
      expect(tryToCall).toThrow()
    })
  })

})
