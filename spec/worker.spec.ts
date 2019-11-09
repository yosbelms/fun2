import 'jasmine'
import { Worker } from '../worker'
import { MessageChannel } from 'worker_threads'
import { MessageType } from '../util'

describe('worker', () => {
  it('should run javascript function', (done) => {
    const result = 1
    const { port1, port2 } = new MessageChannel()

    new Worker(port1)

    port2.on('message', (msg) => {
      expect(msg).toEqual({ type: MessageType.RETURN, result: result })
      done()
    })

    port2.postMessage({
      type: MessageType.EXECUTE,
      source: `() => ${result}`
    })
  })
})
