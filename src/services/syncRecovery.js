export const LIQUID_MOVEMENT_FIELDS = ['activeSaldo', 'hasActive', 'activeSessionIds', 'openBottleCount', 'activeTotalCapacity', 'totalOpenedCapacity', 'totalOpenedBottles', 'totalRechargesAllTime', 'totalRevenueAllTime', 'totalPointsConsumedAllTime']
export function isRejectedLegacyLiquid(operation) {
  return operation.name === 'applyBusinessMutation' && operation.payload?.collection === 'liquids'
    && ['set', 'update'].includes(operation.payload.action)
    && LIQUID_MOVEMENT_FIELDS.some(field => field in (operation.payload.data || {}))
    && /Usa los movimientos de líquidos para cambiar el saldo/.test(operation.error || '')
}
export function withLoadDeadline(promise, milliseconds = 15000) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('La descarga está tardando demasiado. Reintenta sin borrar los datos locales.')), milliseconds) })]).finally(() => clearTimeout(timer))
}
// Only a confirmed missing liquid UPDATE superseded by an explicit later deletion
// can leave the active queue automatically. Never infer deletion for sales/movements.
export function isMissingLiquidSuperseded(operation, error, queue) {
  if (operation.name !== 'applyBusinessMutation' || operation.payload?.collection !== 'liquids' || operation.payload.action !== 'update'
    || !operation.payload.documentId || !Number.isFinite(operation.sequence)
    || !(error?.code === 'functions/not-found' || /^El registro ya no existe\.(?: \[404\])?$/.test(error?.message || ''))) return false
  const sameScope = item => item.businessId === operation.businessId && item.uid === operation.uid && item.epoch === operation.epoch
  const later = queue.filter(item => sameScope(item) && Number.isFinite(item.sequence) && item.sequence > operation.sequence).sort((a, b) => a.sequence - b.sequence)
  for (const item of later) {
    const payload = item.payload || {}
    if (item.name === 'applyBusinessMutation' && payload.collection === 'liquids' && payload.documentId === operation.payload.documentId) {
      if (payload.action === 'delete') return true
      if (payload.action !== 'update') return false
    }
    if (payload.liquidId === operation.payload.documentId || [...(payload.sale?.refills || []), ...(payload.sale?.bottleSales || [])].some(line => line.liquidId === operation.payload.documentId)) return false
  }
  return false
}
