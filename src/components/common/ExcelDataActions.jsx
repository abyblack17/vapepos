import React, { useRef, useState } from 'react'
import { downloadImportTemplate, exportEntityToExcel, parseEntityExcelFile } from '../../services/excelDataService'
import toast from 'react-hot-toast'

export default function ExcelDataActions({ entity, rows, onImport, disabled = false, importLabel = 'Importar', exportLabel = 'Excel' }) {
  const fileRef = useRef(null)
  const [loading, setLoading] = useState(false)

  const handleDownload = async (action) => {
    setLoading(true)
    try {
      await action()
    } catch (error) {
      console.error('Error descargando Excel:', error)
      toast.error('No se pudo descargar el Excel. Intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setLoading(true)
    try {
      const parsedRows = await parseEntityExcelFile(entity, file)
      if (!parsedRows.length) {
        toast.error('El archivo no tiene filas válidas para importar')
        return
      }
      await onImport(parsedRows)
    } catch (error) {
      console.error('Error importando Excel:', error)
      toast.error(error?.message || 'No se pudo importar el Excel')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={disabled || loading}
        onClick={() => handleDownload(() => exportEntityToExcel(entity, rows))}
      >
        📊 {exportLabel}
      </button>
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={disabled || loading}
        onClick={() => fileRef.current?.click()}
      >
        ⬆ {loading ? 'Importando...' : importLabel}
      </button>
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={disabled || loading}
        onClick={() => handleDownload(() => downloadImportTemplate(entity))}
      >
        🧾 Plantilla
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />
    </div>
  )
}
