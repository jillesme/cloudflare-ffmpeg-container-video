import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const SUPPORTED_TYPES = ['image/jpeg', 'image/png']

type Conversion = { blob: Blob; elapsed: number }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function useObjectUrl(source: Blob | null) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!source) {
      setUrl(null)
      return
    }
    const created = URL.createObjectURL(source)
    setUrl(created)
    return () => URL.revokeObjectURL(created)
  }, [source])

  return url
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [conversion, setConversion] = useState<Conversion | null>(null)
  const [error, setError] = useState('')
  const [isConverting, setIsConverting] = useState(false)

  const originalUrl = useObjectUrl(file)
  const convertedUrl = useObjectUrl(conversion?.blob ?? null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]

    setError('')
    setFile(null)
    setConversion(null)

    if (!selected) return

    if (!SUPPORTED_TYPES.includes(selected.type)) {
      setError('Choose a JPEG or PNG image.')
      event.target.value = ''
      return
    }

    if (selected.size > MAX_FILE_BYTES) {
      setError('Choose an image no larger than 10 MiB.')
      event.target.value = ''
      return
    }

    setFile(selected)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || isConverting) return

    setError('')
    setConversion(null)
    setIsConverting(true)
    const startedAt = performance.now()

    try {
      const response = await fetch('/convert', {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `Conversion failed (${response.status})`)
      }

      setConversion({
        blob: await response.blob(),
        elapsed: Math.round(performance.now() - startedAt),
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Conversion failed.')
    } finally {
      setIsConverting(false)
    }
  }

  const sizeChange =
    file && conversion
      ? `${Math.abs(((file.size - conversion.blob.size) / file.size) * 100).toFixed(1)}% ${
          conversion.blob.size <= file.size ? 'smaller' : 'larger'
        }`
      : null

  return (
    <main className="app-shell">
      <header className="intro">
        <p className="eyebrow">Cloudflare Containers + FFmpeg</p>
        <h1>Stream an image. Get a smaller WebP.</h1>
        <p>
          Upload a JPEG or PNG. The Worker streams it into FFmpeg, resizes it to
          960 pixels wide, and streams the converted image back.
        </p>
      </header>

      <form className="upload-card" onSubmit={handleSubmit}>
        <label className="file-picker">
          <span>{file ? 'Choose another image' : 'Choose an image'}</span>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            onChange={handleFileChange}
            disabled={isConverting}
          />
        </label>
        <p className="hint">JPEG or PNG, up to 10 MiB</p>
        <button type="submit" disabled={!file || isConverting}>
          {isConverting ? 'Converting…' : 'Convert to WebP'}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {originalUrl && file && (
        <section className="results" aria-label="Image previews">
          <article className="preview-card">
            <div className="image-frame">
              <img src={originalUrl} alt="Original upload preview" />
            </div>
            <div className="preview-details">
              <h2>Original</h2>
              <p>{formatBytes(file.size)}</p>
            </div>
          </article>

          <article className="preview-card">
            <div className="image-frame converted-frame">
              {convertedUrl ? (
                <img src={convertedUrl} alt="Converted WebP preview" />
              ) : (
                <p>{isConverting ? 'Streaming conversion…' : 'Your WebP will appear here'}</p>
              )}
            </div>
            <div className="preview-details">
              <h2>Converted WebP</h2>
              {conversion ? (
                <p>
                  {formatBytes(conversion.blob.size)} · {conversion.elapsed} ms ·{' '}
                  <strong>{sizeChange}</strong>
                </p>
              ) : (
                <p>960 px wide · quality 80</p>
              )}
            </div>
          </article>
        </section>
      )}

      <footer>
        API: <code>POST /convert</code> with a raw JPEG or PNG request body.
      </footer>
    </main>
  )
}

export default App
