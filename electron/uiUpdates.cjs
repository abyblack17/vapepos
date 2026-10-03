const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const ORIGIN = 'https://vape-pos.store'
const hash = data => createHash('sha256').update(data).digest('hex')
function assetPath(root, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..') || name.includes('\\')) throw Error('Ruta de actualización inválida')
  const file = path.resolve(root, name)
  if (!file.startsWith(path.resolve(root) + path.sep)) throw Error('Ruta fuera de la actualización')
  return file
}
function validateManifest(manifest, nativeVersion) {
  if (manifest?.schema !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 200 || !/^[a-f0-9]{64}$/.test(manifest.version)) throw Error('Manifiesto inválido')
  if (!/^\d+\.\d+\.\d+$/.test(manifest.minDesktopVersion || '')) throw Error('Compatibilidad inválida')
  const current = nativeVersion.split('.').map(Number), required = manifest.minDesktopVersion.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if (current[i] > required[i]) break; if (current[i] < required[i]) throw Error('Esta interfaz necesita actualizar el motor de escritorio') }
  const seen = new Set(); let total = 0
  for (const file of manifest.files) {
    assetPath('/ui', file.path)
    if (seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 32 * 1024 * 1024) throw Error('Archivo inválido')
    seen.add(file.path); total += file.size
  }
  if (!seen.has('index.html') || total > 128 * 1024 * 1024 || hash(JSON.stringify(manifest.files)) !== manifest.version) throw Error('Integridad del manifiesto inválida')
  return manifest
}
async function verifiedRoot(store, nativeVersion) {
  try {
    const active = JSON.parse(await fs.readFile(path.join(store, 'active.json'), 'utf8'))
    const manifest = validateManifest(active, nativeVersion)
    const root = path.join(store, manifest.version)
    for (const file of manifest.files) {
      const data = await fs.readFile(assetPath(root, file.path))
      if (data.length !== file.size || hash(data) !== file.sha256) return null
    }
    return { root, manifest }
  } catch { return null }
}
async function downloadResponse(fetcher, url, maxBytes) {
  const response = await fetcher(url, { bypassCustomProtocolHandlers: true, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw Error('No se pudo descargar la interfaz')
  const parts = []; let length = 0
  for await (const part of response.body) { length += part.length; if (length > maxBytes) throw Error('Descarga demasiado grande'); parts.push(Buffer.from(part)) }
  return Buffer.concat(parts)
}
async function stageUIUpdate({ store, packagedRoot, nativeVersion, fetcher }) {
  const raw = await downloadResponse(fetcher, ORIGIN + '/desktop-update.json', 256 * 1024)
  const manifest = validateManifest(JSON.parse(raw.toString()), nativeVersion)
  const active = await verifiedRoot(store, nativeVersion)
  if (active?.manifest.version === manifest.version) return false
  await fs.mkdir(store, { recursive: true })
  const staging = path.join(store, 'staging-' + randomUUID())
  await fs.mkdir(staging)
  for (const file of manifest.files) {
    let data
    for (const root of [active?.root, packagedRoot].filter(Boolean)) {
      try { const cached = await fs.readFile(assetPath(root, file.path)); if (cached.length === file.size && hash(cached) === file.sha256) { data = cached; break } } catch {}
    }
    if (!data) data = await downloadResponse(fetcher, ORIGIN + '/' + file.path, file.size)
    if (data.length !== file.size || hash(data) !== file.sha256) throw Error('Descarga incompleta; se conserva la interfaz anterior')
    const target = assetPath(staging, file.path)
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data)
  }
  // Publish only after EVERY file is verified. Never modify the running application's root.
  const ready = path.join(store, manifest.version)
  try { await fs.rename(staging, ready) } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error
    // A prior interrupted attempt may have this version; verify it rather than overwriting it.
    for (const file of manifest.files) if (hash(await fs.readFile(assetPath(ready, file.path))) !== file.sha256) throw Error('Versión guardada dañada')
  }
  const pointer = path.join(store, 'active-' + randomUUID() + '.json')
  await fs.writeFile(pointer, JSON.stringify(manifest)); await fs.rename(pointer, path.join(store, 'active.json'))
  return true
}
module.exports = { stageUIUpdate, verifiedRoot, validateManifest, assetPath }
