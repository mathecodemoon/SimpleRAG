import { useEffect, useRef, useState } from 'react'
import Message from './Message.jsx'
import Composer from './Composer.jsx'
import { insforge, readFileContent } from '../lib/insforge.js'
import { extractPdfText } from '../lib/pdf.js'

const MenuIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </svg>
)

const SparkIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M18.4 5.6l-2.1 2.1m-8.6 8.6-2.1 2.1" />
  </svg>
)

export default function Chat({ onToggleSidebar }) {
  const [messages, setMessages] = useState([])
  const [busyLabel, setBusyLabel] = useState(null)
  const scrollRef = useRef(null)
  const idRef = useRef(0)

  const nextId = () => ++idRef.current
  const empty = messages.length === 0 && !busyLabel

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busyLabel])

  async function handleSend({ text, files = [] }) {
    if (text) {
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', author: 'tú', content: text }])
    }

    try {
      if (files.length > 0) {
        setBusyLabel('Indexando archivos…')
        const results = []
        for (const file of files) {
          setBusyLabel(`Indexando ${file.name}…`)
          try {
            const isPdf = file.name.toLowerCase().endsWith('.pdf')
            const content = isPdf ? await extractPdfText(file) : await readFileContent(file)
            const { data, error } = await insforge.functions.invoke('ingest', {
              body: { text: content, source: file.name },
            })
            if (error) throw new Error(error.message ?? 'Error de ingesta')
            results.push({ name: file.name, chunks: data?.ingested ?? 0 })
          } catch (err) {
            results.push({ name: file.name, error: err.message })
          }
        }

        const lines = []
        const ok = results.filter((r) => !r.error)
        const ko = results.filter((r) => r.error)
        if (ok.length > 0) {
          lines.push(
            `Se indexaron ${ok.length} archivo${ok.length > 1 ? 's' : ''}: ${ok
              .map((r) => `${r.name} (${r.chunks} chunk${r.chunks !== 1 ? 's' : ''})`)
              .join(', ')}.`
          )
        }
        if (ko.length > 0) {
          lines.push(`No se pudieron indexar: ${ko.map((r) => `${r.name} (${r.error})`).join(', ')}.`)
        }
        if (lines.length > 0) {
          setMessages((prev) => [...prev, { id: nextId(), role: 'system', content: lines.join(' ') }])
        }
      }

      if (text) {
        setBusyLabel('Respondiendo…')
        let data, error
        try {
          ;({ data, error } = await insforge.functions.invoke('ask', {
            body: { question: text },
          }))
        } catch (err) {
          error = { message: err.message ?? String(err) }
        }
        if (error) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', author: 'simple-rag', content: `Error al consultar: ${error.message}`, sources: [] },
          ])
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              author: 'simple-rag',
              content: data.answer || 'No tengo esa información en mis documentos',
              sources: data.sources ?? [],
              model: data.model ?? null,
            },
          ])
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', author: 'simple-rag', content: `Error inesperado: ${err.message}`, sources: [] },
      ])
    } finally {
      setBusyLabel(null)
    }
  }

  return (
    <div className="main">
      <header className="topbar">
        <button className="icon-btn" onClick={onToggleSidebar} title="Alternar barra lateral">
          <MenuIcon size={20} />
        </button>
        <div className="topbar-title">Nueva conversación</div>
        <div className="topbar-status">
          <span className="status-dot" />
          conectado
        </div>
      </header>

      <div className="messages" ref={scrollRef}>
        <div className={`messages-inner${empty ? ' centered' : ''}`}>
          {empty && (
            <div className="empty-state">
              <div className="empty-logo">OC</div>
              <div className="empty-title">¿En qué puedo ayudarte?</div>
              <p className="empty-hint">
                Adjunta archivos de texto (.txt, .md, .csv…) o PDFs para indexarlos con embeddings
                y haz preguntas sobre su contenido. El sistema responde únicamente con lo que
                encuentre en tus documentos.
              </p>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'system' ? (
              <div key={m.id} className="system-msg">
                {m.content}
              </div>
            ) : (
              <Message key={m.id} role={m.role} author={m.author}>
                <p className="plain">{m.content}</p>
                {m.sources?.length > 0 && (
                  <div className="sources">
                    <div className="sources-title">Fuentes</div>
                    {m.sources.map((s) => (
                      <details className="source-item" key={s.id}>
                        <summary>
                          <span className="source-name">{s.source}</span>
                          <span className="source-score">{Math.round(s.similarity * 100)}%</span>
                        </summary>
                        <p className="source-text">{s.content}</p>
                      </details>
                    ))}
                  </div>
                )}
              </Message>
            )
          )}

          {busyLabel && (
            <div className="message message-assistant">
              <div className="message-avatar assistant">
                <SparkIcon size={15} />
              </div>
              <div className="message-body">
                <div className="message-author">simple-rag</div>
                <div className="message-content">
                  <span className="typing">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                  <span className="typing-label">{busyLabel}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Composer onSend={handleSend} busy={!!busyLabel} />
    </div>
  )
}
