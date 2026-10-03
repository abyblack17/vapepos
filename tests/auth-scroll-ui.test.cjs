const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8')

test('registration and login use a dedicated scroll container', () => {
  for (const page of ['Register', 'Login']) {
    const source = fs.readFileSync(path.join(root, `src/pages/auth/${page}.jsx`), 'utf8')
    assert.match(source, /className="auth-screen bg-\[#080d18\]"/)
    assert.doesNotThrow(() => require('esbuild').transformSync(source, { loader: 'jsx' }))
  }
})

test('auth scroll stays bounded, touch-enabled and safe for tall forms', () => {
  const screen = css.match(/\.auth-screen\s*\{([^}]+)\}/)?.[1]
  const content = css.match(/\.auth-screen > div\s*\{([^}]+)\}/)?.[1]
  assert.ok(screen && content)
  for (const rule of ['height: 100vh', 'height: 100dvh', 'overflow-y: auto', 'touch-action: pan-y', '-webkit-overflow-scrolling: touch']) {
    assert.ok(screen.includes(rule), rule)
  }
  assert.ok(!screen.includes('justify-content: center'))
  assert.ok(content.includes('flex-shrink: 0'))
  assert.ok(content.includes('margin-top: auto'))
  assert.ok(content.includes('margin-bottom: auto'))
})
