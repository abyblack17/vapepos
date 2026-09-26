import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeBluetoothPrinter = registerPlugin('NativeBluetoothPrinter')

const COMMON_PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
]

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const money = value => `RD$${Number(value || 0).toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export function isNativeAndroid() {
  return typeof Capacitor !== 'undefined' && Capacitor.getPlatform?.() === 'android'
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
}

function line(char = '-', width = 32) { return char.repeat(width) }

function leftRight(left, right, width = 32) {
  const l = normalizeText(left)
  const r = normalizeText(right)
  const maxLeft = Math.max(0, width - r.length - 1)
  const cleanLeft = l.length > maxLeft ? `${l.slice(0, Math.max(0, maxLeft - 1))}.` : l
  return `${cleanLeft}${' '.repeat(Math.max(1, width - cleanLeft.length - r.length))}${r}`
}

function center(text, width = 32) {
  const value = normalizeText(text)
  if (value.length >= width) return value.slice(0, width)
  const pad = Math.floor((width - value.length) / 2)
  return `${' '.repeat(pad)}${value}`
}
function wrapText(text, width = 32) {
  const clean = normalizeText(text).trim()
  if (!clean) return ['']
  const words = clean.split(/\s+/)
  const lines = []
  let current = ''
  words.forEach(word => {
    if (!current) current = word.slice(0, width)
    else if ((current + ' ' + word).length <= width) current += ' ' + word
    else { lines.push(current); current = word.slice(0, width) }
  })
  if (current) lines.push(current)
  return lines
}

function smartLeftRight(label, value, width = 32) {
  const l = normalizeText(label)
  const r = normalizeText(value)
  if ((l.length + 1 + r.length) <= width) return [leftRight(l, r, width)]
  return [l, ...wrapText(r, width).map(v => `  ${v}`.slice(0, width))]
}


function getTicketWidth(settings = {}) {
  const size = settings.paperSize || '58mm'
  if (size === '48mm') return 24
  if (size === '58mm') return 32
  return 42
}

function addItems(lines, title, items = [], mapper, width) {
  if (!items?.length) return
  lines.push(title.toUpperCase())
  items.forEach(item => {
    const { name, amount } = mapper(item)
    lines.push(leftRight(name, money(amount), width))
  })
}

export function buildEscPosTicketText(sale, settings = {}) {
  const width = getTicketWidth(settings)
  const lines = []
  const biz = settings.businessName || 'VapePOS'

  lines.push(center(biz, width))
  if (settings.printRNC !== false && settings.rnc) lines.push(center(`RNC: ${settings.rnc}`, width))
  if (settings.printAddress !== false && settings.address) lines.push(center(settings.address, width))
  if (settings.printPhone !== false && settings.phone) lines.push(center(`Tel: ${settings.phone}`, width))
  if (settings.printEmail !== false && settings.email) lines.push(center(settings.email, width))
  if (settings.legalName && settings.legalName !== biz) lines.push(center(`Razon social: ${settings.legalName}`, width))

  lines.push(line('-', width))
  if (sale.fiscal?.ncf) {
    lines.push(center(sale.fiscal.typeLabel || 'Comprobante fiscal', width))
    lines.push(center(`NCF: ${sale.fiscal.ncf}`, width))
    if (sale.fiscal.expiresAt) lines.push(center(`Vence NCF: ${sale.fiscal.expiresAt}`, width))
    lines.push(line('-', width))
  }

  lines.push(...smartLeftRight('Factura', sale.saleNumber || '', width))
  lines.push(...smartLeftRight('Fecha', `${sale.date || ''} ${sale.time || ''}`.trim(), width))
  if (sale.customerName) lines.push(...smartLeftRight('Cliente', sale.customerName, width))
  if (sale.fiscal?.customer?.rnc || sale.customerRnc) lines.push(...smartLeftRight('RNC cliente', sale.fiscal?.customer?.rnc || sale.customerRnc, width))
  if (sale.user) lines.push(...smartLeftRight('Cajero', sale.user, width))
  lines.push(line('-', width))

  addItems(lines, 'Productos', sale.items, i => ({ name: `${i.name} x${i.qty}`, amount: Number(i.price || 0) * Number(i.qty || 0) }), width)
  addItems(lines, 'Recargas', sale.refills, r => ({ name: `${r.liquidName} ${r.type || ''}`.trim(), amount: r.price }), width)
  addItems(lines, 'Frascos', sale.bottleSales, b => ({ name: `${b.liquidName} x${b.qty}`, amount: Number(b.price || 0) * Number(b.qty || 0) }), width)
  addItems(lines, 'Servicios', sale.services, s => ({ name: `${s.name} x${s.qty}`, amount: Number(s.price || 0) * Number(s.qty || 0) }), width)

  if (sale.discounts?.length) {
    lines.push('DESCUENTOS')
    sale.discounts.forEach(d => lines.push(leftRight(d.name, `-${money(d.amount)}`, width)))
  }

  lines.push(line('-', width))
  lines.push(leftRight('Subtotal', money(sale.subtotal), width))
  if (sale.discountTotal > 0) lines.push(leftRight('Descuento', `-${money(sale.discountTotal)}`, width))
  if (settings.printTax !== false && sale.tax > 0) lines.push(leftRight(`ITBIS ${settings.taxRate || 18}%`, money(sale.tax), width))
  lines.push(line('-', width))
  lines.push(leftRight('TOTAL', money(sale.total), width))
  lines.push(leftRight('Pago', sale.payment || '', width))
  if (sale.amountReceived > sale.total) {
    lines.push(leftRight('Recibido', money(sale.amountReceived), width))
    lines.push(leftRight('Cambio', money(sale.change), width))
  }
  if (sale.creditAdded > 0) lines.push(leftRight('A credito', money(sale.creditAdded), width))

  lines.push(line('-', width))
  lines.push(center(settings.invoiceFooter || 'Gracias por su compra!', width))
  lines.push('\n\n')
  return `${lines.join('\n')}\n`
}

function encodeEscPos(text, copies = 1) {
  const encoder = new TextEncoder()
  const bytes = []
  const add = arr => bytes.push(...arr)
  for (let i = 0; i < copies; i++) {
    add([0x1b, 0x40])
    add([0x1b, 0x61, 0x00])
    add(Array.from(encoder.encode(text)))
    add([0x0a, 0x0a, 0x0a])
    add([0x1d, 0x56, 0x42, 0x00])
  }
  return new Uint8Array(bytes)
}

async function findWritableCharacteristic(server) {
  const services = await server.getPrimaryServices()
  for (const service of services) {
    const characteristics = await service.getCharacteristics()
    const writable = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse)
    if (writable) return writable
  }
  throw new Error('No se encontro un canal de escritura Bluetooth compatible en esta impresora.')
}

async function writeInChunks(characteristic, payload, chunkSize = 20) {
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    const chunk = payload.slice(offset, offset + chunkSize)
    if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk)
    } else {
      await characteristic.writeValue(chunk)
    }
    await sleep(25)
  }
}

export function isBluetoothPrinterSupported() {
  return isNativeAndroid() || (typeof navigator !== 'undefined' && Boolean(navigator.bluetooth?.requestDevice))
}

export async function requestAppPermissions() {
  if (!isNativeAndroid()) return { granted: true, platform: 'web' }
  return NativeBluetoothPrinter.requestAppPermissions()
}

export async function getSavedBluetoothDevices() {
  if (isNativeAndroid()) return []
  if (!isBluetoothPrinterSupported() || !navigator.bluetooth.getDevices) return []
  return navigator.bluetooth.getDevices()
}

export async function requestBluetoothPrinter() {
  if (isNativeAndroid()) {
    const printer = await NativeBluetoothPrinter.selectPrinter()
    if (!printer?.address) throw new Error('No se pudo vincular la impresora Bluetooth.')
    return { id: printer.address, address: printer.address, name: printer.name || 'Impresora Bluetooth', type: 'bluetooth-native' }
  }

  if (!navigator.bluetooth?.requestDevice) {
    throw new Error('Este navegador no permite Bluetooth. En APK usa Bluetooth nativo o prueba Chrome/Edge Android.')
  }

  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: COMMON_PRINTER_SERVICE_UUIDS })
  if (!device?.id) throw new Error('No se pudo vincular la impresora Bluetooth.')
  return { id: device.id, name: device.name || 'Impresora Bluetooth', type: 'bluetooth' }
}

async function resolveBluetoothDevice(settings = {}) {
  const savedId = settings.bluetoothPrinter?.id || settings.bluetoothPrinterId
  if (savedId && navigator.bluetooth.getDevices) {
    const devices = await navigator.bluetooth.getDevices()
    const savedDevice = devices.find(device => device.id === savedId)
    if (savedDevice) return savedDevice
  }
  return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: COMMON_PRINTER_SERVICE_UUIDS })
}

async function writeTicketToDevice(device, ticket, copies = 1) {
  if (!device?.gatt) throw new Error('No se pudo acceder al Bluetooth de la impresora.')
  const server = await device.gatt.connect()
  try {
    const characteristic = await findWritableCharacteristic(server)
    const payload = encodeEscPos(ticket, copies)
    await writeInChunks(characteristic, payload)
    return device.name || 'Impresora Bluetooth'
  } finally {
    if (device.gatt.connected) device.gatt.disconnect()
  }
}

export async function printBluetoothText(text, settings = {}) {
  const copies = Math.max(1, parseInt(settings.printCopies || '1', 10) || 1)
  const cleanText = `${normalizeText(text)}\n\n`

  if (isNativeAndroid()) {
    const printer = settings.bluetoothPrinter || {}
    if (!printer.address && !printer.id) throw new Error('Primero agrega una impresora Bluetooth en Configuracion.')
    const result = await NativeBluetoothPrinter.printText({
      address: printer.address || printer.id,
      name: printer.name || 'Impresora Bluetooth',
      text: cleanText,
      copies,
      paperSize: settings.paperSize || '58mm',
      logoUrl: settings.printLogo !== false ? (settings.logoUrl || '') : '',
    })
    return result?.name || printer.name || 'Impresora Bluetooth'
  }

  if (!navigator.bluetooth?.requestDevice) {
    throw new Error('Este navegador no permite impresion por Bluetooth. Usa Chrome/Edge Android o instala la app nativa con Capacitor.')
  }
  const device = await resolveBluetoothDevice(settings)
  return writeTicketToDevice(device, cleanText, copies)
}

export async function printBluetoothTest(settings = {}) {
  const width = getTicketWidth(settings)
  const lines = [
    center(settings.businessName || 'VapePOS', width),
    line('-', width),
    center('PRUEBA DE IMPRESORA', width),
    line('-', width),
    leftRight('Tipo', isNativeAndroid() ? 'Bluetooth Android' : 'Web Bluetooth', width),
    leftRight('Papel', settings.paperSize || '80mm', width),
    leftRight('Fecha', new Date().toLocaleString('es-DO'), width),
    line('-', width),
    center('Configuracion correcta', width),
    '\n\n',
  ]
  return printBluetoothText(lines.join('\n'), { ...settings, printCopies: 1 })
}

export async function printSaleByBluetooth(sale, settings = {}) {
  const ticket = buildEscPosTicketText(sale, settings)
  return printBluetoothText(ticket, settings)
}
