'use client'

import { useRef, useState, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Adjuntar comprobante: pegando desde el portapapeles (Ctrl+V o botón) o eligiendo
// un archivo. Sube al endpoint indicado (FormData 'file') y devuelve el path por
// onChange. Muestra preview (miniatura para imágenes). Reutilizable.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  uploadUrl: string
  onChange: (path: string | null) => void
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void
  disabled?: boolean
}

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = ['image/', 'application/pdf']

export default function ComprobanteInput({ uploadUrl, onChange, notify, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [nombre, setNombre] = useState<string>('')
  const [esImagen, setEsImagen] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  const subir = useCallback(async (file: File) => {
    if (subiendo || disabled) return
    if (!ACCEPT.some(a => file.type.startsWith(a))) { notify('Solo se aceptan imágenes o PDF', 'error'); return }
    if (file.size === 0) { notify('El archivo está vacío', 'error'); return }
    if (file.size > MAX_BYTES) { notify('El archivo supera los 10 MB', 'error'); return }

    setSubiendo(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(uploadUrl, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al subir')

      // Preview local (no requiere URL firmada)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const isImg = file.type.startsWith('image/')
      setEsImagen(isImg)
      setPreviewUrl(isImg ? URL.createObjectURL(file) : null)
      setNombre(file.name || 'comprobante')
      setPath(data.path)
      onChange(data.path)
      notify('Comprobante adjuntado ✓', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo subir', 'error')
    } finally {
      setSubiendo(false)
    }
  }, [subiendo, disabled, uploadUrl, previewUrl, onChange, notify])

  async function pegarDelPortapapeles() {
    if (disabled) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clip = (navigator as any).clipboard
      if (!clip?.read) { notify('Tu navegador no permite leer el portapapeles. Usá Ctrl+V o adjuntá un archivo.', 'error'); return }
      const items = await clip.read()
      for (const item of items) {
        const tipo = (item.types as string[]).find(t => t.startsWith('image/'))
        if (tipo) {
          const blob: Blob = await item.getType(tipo)
          const ext = tipo.split('/')[1] || 'png'
          await subir(new File([blob], `pegado-${Date.now()}.${ext}`, { type: tipo }))
          return
        }
      }
      notify('No hay ninguna imagen en el portapapeles', 'error')
    } catch {
      notify('No se pudo leer el portapapeles. Usá Ctrl+V sobre el recuadro o adjuntá un archivo.', 'error')
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    if (disabled) return
    const file = Array.from(e.clipboardData?.items || [])
      .find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
      || e.clipboardData?.files?.[0]
    if (file) { e.preventDefault(); subir(file) }
  }

  function quitar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setPath(null); setNombre(''); setEsImagen(false)
    onChange(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div>
      <input ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf" disabled={disabled}
        onChange={e => { const f = e.target.files?.[0]; if (f) subir(f) }} />

      {!path ? (
        <div
          tabIndex={0}
          onPaste={onPaste}
          className="rounded-xl p-4 text-center transition-all outline-none"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px dashed rgba(0,212,255,0.35)', cursor: disabled ? 'not-allowed' : 'text' }}
        >
          <p className="text-xs mb-3" style={{ color: 'rgba(148,163,184,0.7)' }}>
            {subiendo ? 'Subiendo comprobante…' : 'Pegá una captura (Ctrl+V acá) o adjuntá un archivo. Obligatorio.'}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button type="button" onClick={pegarDelPortapapeles} disabled={disabled || subiendo}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', cursor: disabled || subiendo ? 'not-allowed' : 'pointer' }}>
              📋 Pegar del portapapeles
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled || subiendo}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.2)', color: 'rgba(226,232,240,0.85)', cursor: disabled || subiendo ? 'not-allowed' : 'pointer' }}>
              📎 Adjuntar archivo
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3 flex items-center gap-3"
          style={{ background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.3)' }}>
          {esImagen && previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="comprobante" className="rounded-lg object-cover" style={{ width: 48, height: 48 }} />
          ) : (
            <div className="flex items-center justify-center rounded-lg text-lg" style={{ width: 48, height: 48, background: 'rgba(0,0,0,0.3)' }}>📄</div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold" style={{ color: '#00ff88' }}>✓ Comprobante adjuntado</div>
            <div className="text-[11px] truncate" style={{ color: 'rgba(148,163,184,0.7)' }}>{nombre}</div>
          </div>
          <button type="button" onClick={quitar} disabled={disabled}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
            style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', cursor: 'pointer' }}>
            Quitar
          </button>
        </div>
      )}
    </div>
  )
}
