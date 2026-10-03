// Dynamic imports are shared by reports, Excel imports and receipt downloads.
// Vite includes these chunks in offline-assets.json; no CDN globals are needed.
export async function loadExcelLibrary() {
  return import('xlsx')
}

export async function loadPDFLibrary() {
  const { jsPDF } = await import('jspdf')
  return jsPDF
}

export async function loadPDFLibraries() {
  const [jsPDF, { autoTable }] = await Promise.all([
    loadPDFLibrary(), import('jspdf-autotable'),
  ])
  return { jsPDF, autoTable }
}

export async function loadReceiptCapture() {
  const { default: html2canvas } = await import('html2canvas')
  return html2canvas
}
