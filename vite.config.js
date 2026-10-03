import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export default defineConfig({
  resolve: { alias: [
    { find: /^firebase\/firestore$/, replacement: path.resolve('src/services/supportFirestore.js') },
    { find: /^firebase\/functions$/, replacement: path.resolve('src/services/supportFunctions.js') },
    { find: /^firebase\/storage$/, replacement: path.resolve('src/services/supportStorage.js') },
  ] },
  plugins: [react(), {
    name: 'offline-assets',
    apply: 'build',
    closeBundle() {
      const root = path.resolve('dist')
      const files = readdirSync(root, { recursive: true }).filter(name => statSync(path.join(root, name)).isFile() && !name.startsWith('downloads') && !['desktop-update.json', 'sw.js'].includes(name)).sort().map(name => {
        const data = readFileSync(path.join(root, name))
        return { path: name.replaceAll('\\', '/'), sha256: createHash('sha256').update(data).digest('hex'), size: data.length }
      })
      writeFileSync(path.join(root, 'desktop-update.json'), JSON.stringify({ schema: 1, minDesktopVersion: '1.1.3', version: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files }))
    },
    generateBundle(options, bundle) {
      const assets = Object.keys(bundle).filter(name => name.startsWith('assets/'))
      const version = createHash('sha256').update(assets.sort().join(',')).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'offline-assets.json', source: JSON.stringify(assets) })
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8').replace("'vapepos-offline-v1'", JSON.stringify(`vapepos-offline-${version}`)) })
    },
  }],
})
