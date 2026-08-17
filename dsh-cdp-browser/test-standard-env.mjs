// Verify plugin.js works in the STANDARD Cordis environment (profile bundle):
// no `harness` global — tools go through ctx.get('tools').register.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const plugin = require(new URL('./plugin.js', import.meta.url).pathname)

const registered = []
const disposed = []
const ctx = {
  get(name) {
    if (name === 'subprocess') {
      return {
        async resolveExecutable() {
          return '/usr/local/bin/node'
        },
        spawn() {
          return {
            pid: 1,
            done: new Promise(() => {}),
            terminate() {},
            stdin: { on() {}, write() {} },
            stdout: { on() {} },
            collected: { stderr: { readFrom() { return { text: '' } } } },
          }
        },
      }
    }
    if (name === 'tools') {
      return {
        register(def) {
          registered.push(def.name)
          return () => disposed.push(def.name)
        },
      }
    }
    return undefined
  },
  effect(fn) {
    const disposer = fn()
    if (typeof disposer === 'function') disposed.push('effect-disposer')
    return () => {}
  },
}

const result = plugin.apply(ctx)
console.log('apply returned:', result === undefined ? 'undefined (ok)' : typeof result)
console.log('registered tools:', registered.length)
console.log('first 5:', registered.slice(0, 5).join(', '))
console.log('has browser_close:', registered.includes('browser_close'))
console.log('has browser_open:', registered.includes('browser_open'))
if (registered.length !== 16) {
  console.error('EXPECTED 16 tools, got', registered.length)
  process.exit(1)
}
console.log('STANDARD-ENV VERIFICATION PASSED')
