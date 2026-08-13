import { useEffect, useRef, useState } from 'react'

const PaperclipIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
)

const FileIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)

const SendIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4z" />
  </svg>
)

const ACCEPT = '.txt,.md,.markdown,.csv,.json,.log,.ts,.js,.tsx,.jsx,.py,.html,.css,.xml,.yml,.yaml,.pdf'

export default function Composer({ onSend, busy }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const inputRef = useRef(null)

  const canSend = !busy && text.trim().length > 0

  // Al elegir un archivo, la ingesta arranca de inmediato (sin esperar a "Enviar").
  function handleFiles(e) {
    const chosen = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (chosen.length === 0) return
    setFiles((prev) => [...prev, ...chosen])
    onSend({ text: '', files: chosen })
  }

  // Cuando termina la ingesta, se limpian los chips de archivos ya procesados.
  useEffect(() => {
    if (!busy) setFiles([])
  }, [busy])

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function send() {
    if (!canSend) return
    onSend({ text: text.trim() })
    setText('')
  }

  return (
    <div className="composer-wrap">
      {files.length > 0 && (
        <div className="file-list">
          {files.map((f, i) => (
            <div className="file-chip" key={`${f.name}-${i}`}>
              <FileIcon size={14} />
              <span className="file-chip-name">{f.name}</span>
              <button
                className="file-chip-x"
                title="Quitar"
                onClick={() => removeFile(i)}
                disabled={busy}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer">
        <textarea
          rows={1}
          value={text}
          disabled={busy}
          placeholder="Pregunta algo…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="composer-actions">
          <button
            className="icon-btn"
            title="Adjuntar archivos"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <PaperclipIcon size={18} />
          </button>
          <button className="send-btn" title="Enviar" disabled={!canSend} onClick={send}>
            {busy ? <span className="spinner" /> : <SendIcon size={16} />}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          onChange={handleFiles}
        />
      </div>

      <div className="composer-foot">
        Selecciona un PDF o archivo de texto y se indexará al instante.
        Podrás preguntar apenas termine la carga. El sistema responde solo con el contenido de tus documentos.
      </div>
    </div>
  )
}
