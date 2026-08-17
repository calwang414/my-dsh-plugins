/**
 * dsh-cdp-browser — Host-half Cordis plugin.
 *
 * Lets the agent directly control a dedicated Chrome instance through CDP and
 * reuse the user's login state: the controlled Chrome runs on a copy of the
 * user's real Chrome profile (cookies / local storage / login data), so
 * logged-in sessions carry over without a Chrome extension and without
 * touching the real browser.
 *
 * The plugin owns one long-lived bridge helper process (bridge.mjs, zero
 * dependencies, Node built-in WebSocket) and exposes browser_* tools to the
 * model. Every tool call is a JSON-lines request over the helper's stdio.
 */
const path = require('path')
const os = require('os')

// Resolve the helper relative to this installed package (works for the
// file-installed copy and the pnpm link: mount alike).
const HELPER_PATH = path.join(__dirname, 'bridge.mjs')
const WORKSPACE = os.homedir()
const NODE_FALLBACKS = [
  '/Applications/DeepSeek Harness.app/Contents/Resources/resources/node/bin/node',
  '/usr/local/bin/node',
]

const textRender = (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

module.exports = {
  // Hard dependencies: Cordis activates this plugin only after the
  // subprocess and tools services exist (at static boot they mount
  // asynchronously, so an eager apply() would find them missing).
  inject: ['subprocess', 'tools'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) {
      console.error('dsh-cdp-browser: subprocess service not available; browser_* tools disabled')
      return
    }

    let proc = null
    let procExited = true
    let nextId = 1
    const pending = new Map()
    let lineBuffer = ''

    async function ensureHelper() {
      if (proc && !procExited) return
      let node = null
      try {
        node = await subprocess.resolveExecutable('node')
      } catch {
        node = null
      }
      if (!node) node = NODE_FALLBACKS[0]
      if (!node) throw new Error('dsh-cdp-browser: cannot resolve a node executable')
      const handle = subprocess.spawn({
        argv: [node, HELPER_PATH],
        cwd: WORKSPACE,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } },
        graceMs: 3000,
      })
      proc = handle
      procExited = false
      lineBuffer = ''
      handle.done
        .then(() => {
          procExited = true
          for (const [id, q] of pending) {
            pending.delete(id)
            q.reject(new Error('browser bridge process exited'))
          }
        })
        .catch(() => {})
      handle.stdout.on('data', (chunk) => {
        lineBuffer += String(chunk)
        let nl
        while ((nl = lineBuffer.indexOf('\n')) >= 0) {
          const line = lineBuffer.slice(0, nl)
          lineBuffer = lineBuffer.slice(nl + 1)
          if (!line.trim()) continue
          let msg
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          const q = pending.get(msg.id)
          if (!q) continue
          pending.delete(msg.id)
          if (msg.ok) q.resolve(msg.result)
          else q.reject(new Error(msg.error || 'browser bridge error'))
        }
      })
      handle.stdin.on('error', () => {})
      console.log('dsh-cdp-browser: bridge helper started (pid ' + handle.pid + ')')
    }

    async function call(cmd, args, signal) {
      await ensureHelper()
      const id = nextId++
      const result = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
      proc.stdin.write(JSON.stringify({ id, cmd, args: args || {} }) + '\n')
      const aborted = new Promise((_, reject) => {
        if (signal) {
          if (signal.aborted) reject(new Error('call aborted'))
          else signal.addEventListener('abort', () => reject(new Error('call aborted')), { once: true })
        }
      })
      const exited = proc.done.then(() => {
        throw new Error('browser bridge process exited')
      })
      try {
        return await Promise.race([result, aborted, exited])
      } catch (e) {
        pending.delete(id)
        let detail = ''
        try {
          if (proc && proc.collected && proc.collected.stderr) {
            const tail = proc.collected.stderr.readFrom(0).text
            if (tail) detail = '\nbridge stderr: ' + tail.slice(-800)
          }
        } catch {}
        e.message = e.message + detail
        throw e
      }
    }

    function tool(name, description, properties, timeoutMs) {
      const definition = {
        name,
        description,
        parameters: { type: 'object', properties, required: [] },
        output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
        timeoutMs,
        async execute(args, exec) {
          return call(name.replace(/^browser_/, ''), args, exec.signal)
        },
      }
      if (typeof harness !== 'undefined') {
        // Dynamic-plugin sandbox: `harness` normalizes the definition.
        return harness.defineTool(definition)
      }
      return definition
    }

    function registerTool(ctx, definition) {
      if (typeof harness !== 'undefined') {
        return harness.registerTool(ctx, definition)
      }
      // Profile bundle (standard Cordis environment): register via the tools service.
      const tools = ctx.get('tools')
      if (tools === undefined) throw new Error('dsh-cdp-browser: tools service unavailable')
      return tools.register(definition)
    }

    const disposers = []
    const register = (definition) => disposers.push(registerTool(ctx, definition))
    try {
      register(
        tool(
          'browser_open',
          'Launch the controlled Chrome instance (a copy of the user\'s real Chrome profile, so login state and cookies are reused) and open an optional URL. Call this before any other browser_* tool. profile: "reuse" keeps the previous copy (default), "fresh" re-copies from the real profile, "clean" starts with no login state. headless: true runs without a visible window.',
          {
            url: { type: 'string', description: 'URL to open (optional; about:blank otherwise)' },
            headless: { type: 'boolean', description: 'Run without a visible window (default false)' },
            profile: { type: 'string', description: 'reuse | fresh | clean (default reuse)' },
          },
          90000,
        ),
      )
      register(
        tool(
          'browser_status',
          'Report whether the controlled browser is running, plus the current page URL/title and the profile directory.',
          {},
          15000,
        ),
      )
      register(
        tool(
          'browser_snapshot',
          'Read the current page as structured text: URL, title, main text, and a numbered list of interactive elements (links, buttons, inputs, checkboxes, selects). Element indexes are stable across snapshots of the same page; use them with browser_click / browser_type / browser_press. Password and sensitive field values are masked as ••••.',
          {
            maxChars: { type: 'number', description: 'Maximum characters of page text to return (default 12000)' },
          },
          30000,
        ),
      )
      register(
        tool(
          'browser_navigate',
          'Navigate the controlled browser to the given URL. The page keeps the copied profile\'s cookies, so logged-in sessions work.',
          { url: { type: 'string', description: 'Full URL to navigate to (e.g. https://example.com)' } },
          45000,
        ),
      )
      register(
        tool(
          'browser_click',
          'Click the interactive element with the given snapshot index (from browser_snapshot).',
          { index: { type: 'number', description: 'Element index from the latest browser_snapshot' } },
          30000,
        ),
      )
      register(
        tool(
          'browser_type',
          'Type text into the input element with the given snapshot index. Works with React/Vue controlled inputs. replace: true clears the field first.',
          {
            index: { type: 'number', description: 'Element index from the latest browser_snapshot' },
            text: { type: 'string', description: 'Text to type' },
            replace: { type: 'boolean', description: 'Clear the field before typing (default false)' },
          },
          30000,
        ),
      )
      register(
        tool(
          'browser_press',
          'Send a keyboard key to the focused element (after browser_click / browser_type). Supported: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space.',
          { key: { type: 'string', description: 'Key name, e.g. Enter, Tab, Escape, ArrowDown' } },
          15000,
        ),
      )
      register(
        tool(
          'browser_scroll',
          'Scroll the page viewport. direction: up | down | top | bottom. amount: pixels for up/down (default 400).',
          {
            direction: { type: 'string', description: 'up | down | top | bottom (default down)' },
            amount: { type: 'number', description: 'Pixels to scroll for up/down (default 400)' },
          },
          15000,
        ),
      )
      register(
        tool(
          'browser_back',
          'Go back one page in the controlled browser history.',
          {},
          30000,
        ),
      )
      register(
        tool(
          'browser_forward',
          'Go forward one page in the controlled browser history.',
          {},
          30000,
        ),
      )
      register(
        tool(
          'browser_reload',
          'Reload the current page of the controlled browser.',
          {},
          30000,
        ),
      )
      register(
        tool(
          'browser_get_text',
          'Extract visible text of the element matching a CSS selector (lazy-loaded content, specific regions).',
          { selector: { type: 'string', description: 'CSS selector, e.g. "#main" or ".article" or "h1"' } },
          15000,
        ),
      )
      register(
        tool(
          'browser_eval',
          'Run a JavaScript expression in the controlled page and return its JSON value. Powerful: use for reading page state or triggering complex interactions the other tools cannot express.',
          { expression: { type: 'string', description: 'JavaScript expression; the last evaluated value is returned' } },
          20000,
        ),
      )
      register(
        tool(
          'browser_screenshot',
          'Capture a PNG screenshot of the controlled browser and save it to the given path (default browser-screenshot.png in the workspace). Returns the saved path.',
          { path: { type: 'string', description: 'Where to save the PNG (absolute or workspace-relative)' } },
          20000,
        ),
      )
      register(
        tool(
          'browser_cookies',
          'List cookie names/domains currently in the controlled browser (values are deliberately withheld). Use to verify that login state was carried over. domain: filter to one domain.',
          { domain: { type: 'string', description: 'Optional domain filter (e.g. "github.com")' } },
          15000,
        ),
      )
      register(
        tool(
          'browser_close',
          'Close the controlled Chrome instance and its bridge. Call when browser work is done.',
          {},
          15000,
        ),
      )
    } catch (e) {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
      throw e
    }

    ctx.effect(() => {
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
        if (proc && !procExited) {
          proc.terminate()
          procExited = true
        }
        console.log('dsh-cdp-browser: stopped')
      }
    })
  },
}
