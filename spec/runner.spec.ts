import { createRunner } from '../runner'
import 'jasmine'
import { EvalError, RuntimeError, TimeoutError, secs } from '../util'

describe('runner', () => {

  it('should run javascript function', async () => {
    const value = 1
    const runner = createRunner()
    const result = await runner.run('(a) => a', [value])
    expect(result).toBe(value)
  })

  it('should throw EvalError if source is not a function', (done) => {
    const value = 1
    const runner = createRunner()
    runner.run('const a', [value]).catch(err => {
      expect(err instanceof EvalError).toBeTruthy()
      done()
    })
  })

  it('should throw EvalError if there is an error while evaluating', (done) => {
    const value = 1
    const runner = createRunner()
    runner.run('() => #', [value]).catch(err => {
      expect(err instanceof EvalError).toBeTruthy()
      done()
    })
  })

  it('should throw RuntimeError if there is an error while executing', (done) => {
    const runner = createRunner()
    runner.run('() => {throw new Error()}').catch(err => {
      expect(err instanceof RuntimeError).toBeTruthy()
      done()
    })
  })

  it('should throw RuntimeError if there is an error while executing', (done) => {
    const runner = createRunner({ timeout: secs(1) })
    runner.run('() => {while (true) {}}').catch(err => {
      expect(err instanceof TimeoutError).toBeTruthy()
      done()
    })
  })

  

})
