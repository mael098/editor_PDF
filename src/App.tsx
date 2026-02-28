import { useState } from 'react'
import { GlobalWorkerOptions, getDocument, Util } from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'

GlobalWorkerOptions.workerSrc = workerSrc

type Tool = 'draw' | 'text' | 'edit-pdf-text'

type Point = {
  x: number
  y: number
}

type DrawAnnotation = {
  id: string
  kind: 'draw'
  pageNumber: number
  points: Point[]
  color: string
  size: number
}

type TextAnnotation = {
  id: string
  kind: 'text'
  pageNumber: number
  x: number
  y: number
  text: string
  color: string
  size: number
}

type ReplaceTextAnnotation = {
  id: string
  kind: 'replace-text'
  blockId: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
  size: number
}

type Annotation = DrawAnnotation | TextAnnotation | ReplaceTextAnnotation

type PdfTextBlock = {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

type PdfPage = {
  pageNumber: number
  imageData: string
  width: number
  height: number
  textBlocks: PdfTextBlock[]
}

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo preparar la imagen para exportar.'))
    image.src = src
  })

const dataUrlToUint8Array = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1]
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function App() {
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState<PdfPage[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const [tool, setTool] = useState<Tool>('draw')
  const [strokeColor, setStrokeColor] = useState('#ff3b30')
  const [strokeSize, setStrokeSize] = useState(3)
  const [textSize, setTextSize] = useState(18)

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draftLine, setDraftLine] = useState<{ pageNumber: number; points: Point[] } | null>(null)

  const getRelativePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
    }
  }

  const loadPdfFile = async (file: File) => {
    try {
      setLoading(true)
      setError('')

      const bytes = new Uint8Array(await file.arrayBuffer())
      const pdf = await getDocument({ data: bytes }).promise
      const renderedPages: PdfPage[] = []

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1.35 })
        const textContent = await page.getTextContent()
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (!context) {
          throw new Error('No se pudo crear el contexto de render del PDF.')
        }

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)

        await page.render({ canvas, canvasContext: context, viewport }).promise

        const textBlocks: PdfTextBlock[] = textContent.items.flatMap((item, index) => {
          if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) {
            return []
          }

          const transformed = Util.transform(viewport.transform, item.transform)
          const fontSize = Math.max(8, Math.hypot(transformed[2], transformed[3]))
          const width = Math.max(8, item.width * viewport.scale)
          const x = transformed[4]
          const y = transformed[5] - fontSize

          return [
            {
              id: `${pageNumber}-${index}`,
              text: item.str,
              x,
              y,
              width,
              height: fontSize * 1.25,
              fontSize,
            },
          ]
        })

        renderedPages.push({
          pageNumber,
          imageData: canvas.toDataURL('image/png'),
          width: viewport.width,
          height: viewport.height,
          textBlocks,
        })
      }

      setFileName(file.name)
      setPages(renderedPages)
      setAnnotations([])
      setDraftLine(null)
    } catch {
      setError('No se pudo abrir el PDF. Revisa que el archivo sea válido.')
      setPages([])
      setFileName('')
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    await loadPdfFile(file)
  }

  const onDrawStart = (event: React.PointerEvent<SVGSVGElement>, pageNumber: number) => {
    if (tool !== 'draw') {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    const point = getRelativePoint(event)
    setDraftLine({ pageNumber, points: [point] })
  }

  const onDrawMove = (event: React.PointerEvent<SVGSVGElement>, pageNumber: number) => {
    if (tool !== 'draw' || !draftLine || draftLine.pageNumber !== pageNumber) {
      return
    }
    const point = getRelativePoint(event)
    setDraftLine((current) => {
      if (!current || current.pageNumber !== pageNumber) {
        return current
      }
      return {
        pageNumber,
        points: [...current.points, point],
      }
    })
  }

  const onDrawEnd = (event: React.PointerEvent<SVGSVGElement>, pageNumber: number) => {
    if (tool !== 'draw' || !draftLine || draftLine.pageNumber !== pageNumber) {
      return
    }

    event.currentTarget.releasePointerCapture(event.pointerId)

    if (draftLine.points.length > 1) {
      setAnnotations((current) => [
        ...current,
        {
          id: makeId(),
          kind: 'draw',
          pageNumber,
          points: draftLine.points,
          color: strokeColor,
          size: strokeSize,
        },
      ])
    }

    setDraftLine(null)
  }

  const onAddText = (event: React.MouseEvent<SVGSVGElement>, pageNumber: number) => {
    if (tool !== 'text') {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
    const text = window.prompt('Escribe el texto que quieres agregar:')

    if (!text || !text.trim()) {
      return
    }

    setAnnotations((current) => [
      ...current,
      {
        id: makeId(),
        kind: 'text',
        pageNumber,
        x,
        y,
        text: text.trim(),
        color: strokeColor,
        size: textSize,
      },
    ])
  }

  const onReplacePdfText = (pageNumber: number, block: PdfTextBlock) => {
    if (tool !== 'edit-pdf-text') {
      return
    }

    const latestReplacement = [...annotations].reverse().find(
      (item): item is ReplaceTextAnnotation =>
        item.kind === 'replace-text' && item.pageNumber === pageNumber && item.blockId === block.id,
    )

    const replacement = window.prompt('Editar texto del PDF:', latestReplacement?.text ?? block.text)

    if (!replacement || !replacement.trim()) {
      return
    }

    setAnnotations((current) => [
      ...current,
      {
        id: makeId(),
        kind: 'replace-text',
        blockId: block.id,
        pageNumber,
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        text: replacement.trim(),
        color: strokeColor,
        size: Math.max(10, Math.round(block.fontSize)),
      },
    ])
  }

  const undoLast = () => {
    setAnnotations((current) => current.slice(0, -1))
  }

  const clearAnnotations = () => {
    setAnnotations([])
    setDraftLine(null)
  }

  const getVisibleAnnotationsByPage = (pageNumber: number) => {
    const pageAnnotations = annotations.filter((item) => item.pageNumber === pageNumber)
    const latestReplaceByBlock = new Map<string, ReplaceTextAnnotation>()

    pageAnnotations.forEach((item) => {
      if (item.kind === 'replace-text') {
        latestReplaceByBlock.set(item.blockId, item)
      }
    })

    return pageAnnotations.filter((item) => {
      if (item.kind !== 'replace-text') {
        return true
      }
      return latestReplaceByBlock.get(item.blockId)?.id === item.id
    })
  }

  const exportPdf = async () => {
    if (pages.length === 0) {
      return
    }

    try {
      setExporting(true)

      const pdfDoc = await PDFDocument.create()

      for (const page of pages) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(page.width)
        canvas.height = Math.floor(page.height)

        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('No se pudo crear un canvas para exportar.')
        }

        const pageImage = await loadImage(page.imageData)
        context.drawImage(pageImage, 0, 0, canvas.width, canvas.height)

        const visibleAnnotations = getVisibleAnnotationsByPage(page.pageNumber)

        visibleAnnotations.forEach((item) => {
          if (item.kind === 'draw') {
            if (item.points.length < 2) {
              return
            }

            context.beginPath()
            context.strokeStyle = item.color
            context.lineWidth = item.size
            context.lineJoin = 'round'
            context.lineCap = 'round'
            context.moveTo(item.points[0].x, item.points[0].y)

            for (let index = 1; index < item.points.length; index += 1) {
              context.lineTo(item.points[index].x, item.points[index].y)
            }

            context.stroke()
            return
          }

          context.fillStyle = item.color
          context.font = `${item.size}px system-ui, sans-serif`

          if (item.kind === 'text') {
            context.fillText(item.text, item.x, item.y)
            return
          }

          context.fillText(item.text, item.x + 1, item.y + Math.min(item.height - 2, item.size))
        })

        const pngBytes = dataUrlToUint8Array(canvas.toDataURL('image/png'))
        const pngImage = await pdfDoc.embedPng(pngBytes)
        const pdfPage = pdfDoc.addPage([page.width, page.height])
        pdfPage.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: page.width,
          height: page.height,
        })
      }

      const pdfBytes = await pdfDoc.save()
      const normalizedPdfBytes = new Uint8Array(pdfBytes.length)
      normalizedPdfBytes.set(pdfBytes)
      const blob = new Blob([normalizedPdfBytes.buffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const outputName = fileName.toLowerCase().endsWith('.pdf')
        ? `${fileName.slice(0, -4)}-editado.pdf`
        : 'documento-editado.pdf'

      link.href = url
      link.download = outputName
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('No se pudo exportar el PDF. Intenta nuevamente.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1>Editor PDF (MVP)</h1>
        <p>Carga un PDF, dibuja, agrega texto o reemplaza texto existente.</p>
      </header>

      <section className="toolbar">
        <label className="file-input">
          <span>Abrir PDF</span>
          <input type="file" accept="application/pdf" onChange={handleFileChange} />
        </label>

        <div className="controls">
          <button
            className={tool === 'draw' ? 'active' : ''}
            type="button"
            onClick={() => setTool('draw')}
          >
            Dibujar
          </button>
          <button
            className={tool === 'text' ? 'active' : ''}
            type="button"
            onClick={() => setTool('text')}
          >
            Texto
          </button>
          <button
            className={tool === 'edit-pdf-text' ? 'active' : ''}
            type="button"
            onClick={() => setTool('edit-pdf-text')}
          >
            Editar texto PDF
          </button>
          <button type="button" onClick={undoLast} disabled={annotations.length === 0}>
            Deshacer
          </button>
          <button type="button" onClick={clearAnnotations} disabled={annotations.length === 0}>
            Limpiar
          </button>
          <button type="button" onClick={exportPdf} disabled={pages.length === 0 || loading || exporting}>
            {exporting ? 'Exportando...' : 'Exportar PDF'}
          </button>
        </div>

        <div className="controls compact">
          <label>
            Color
            <input
              type="color"
              value={strokeColor}
              onChange={(event) => setStrokeColor(event.target.value)}
            />
          </label>
          <label>
            Grosor
            <input
              type="range"
              min={1}
              max={12}
              value={strokeSize}
              onChange={(event) => setStrokeSize(Number(event.target.value))}
            />
          </label>
          <label>
            Tamaño texto
            <input
              type="range"
              min={10}
              max={48}
              value={textSize}
              onChange={(event) => setTextSize(Number(event.target.value))}
            />
          </label>
        </div>
      </section>

      {loading && <p className="status">Cargando PDF...</p>}
      {error && <p className="status error">{error}</p>}
      {fileName && !loading && <p className="status">Archivo: {fileName}</p>}

      <section className="viewer">
        {pages.length === 0 && !loading ? (
          <p className="placeholder">Selecciona un PDF para empezar.</p>
        ) : (
          pages.map((page) => {
            const pageAnnotations = annotations.filter((item) => item.pageNumber === page.pageNumber)
            const latestReplaceByBlock = new Map<string, ReplaceTextAnnotation>()

            pageAnnotations.forEach((item) => {
              if (item.kind === 'replace-text') {
                latestReplaceByBlock.set(item.blockId, item)
              }
            })

            const visibleAnnotations = getVisibleAnnotationsByPage(page.pageNumber)

            const currentDraft =
              draftLine && draftLine.pageNumber === page.pageNumber ? draftLine.points : undefined

            return (
              <article className="page" key={page.pageNumber}>
                <img
                  src={page.imageData}
                  alt={`Página ${page.pageNumber}`}
                  width={page.width}
                  height={page.height}
                />

                {tool === 'edit-pdf-text' && (
                  <div className="pdf-text-layer">
                    {page.textBlocks.map((block) => {
                      const latestReplacement = latestReplaceByBlock.get(block.id)
                      const currentText = latestReplacement?.text ?? block.text

                      return (
                        <button
                          key={block.id}
                          className="pdf-text-hitbox"
                          type="button"
                          title={`Editar: ${currentText}`}
                          style={{
                            left: `${(block.x / page.width) * 100}%`,
                            top: `${(block.y / page.height) * 100}%`,
                            width: `${(block.width / page.width) * 100}%`,
                            height: `${(block.height / page.height) * 100}%`,
                          }}
                          onClick={() => onReplacePdfText(page.pageNumber, block)}
                        />
                      )
                    })}
                  </div>
                )}

                <svg
                  className={`annotation-layer ${tool === 'edit-pdf-text' ? 'blocked' : ''}`}
                  viewBox={`0 0 ${page.width} ${page.height}`}
                  onPointerDown={(event) => onDrawStart(event, page.pageNumber)}
                  onPointerMove={(event) => onDrawMove(event, page.pageNumber)}
                  onPointerUp={(event) => onDrawEnd(event, page.pageNumber)}
                  onPointerLeave={(event) => onDrawEnd(event, page.pageNumber)}
                  onClick={(event) => onAddText(event, page.pageNumber)}
                >
                  {visibleAnnotations.map((item) => {
                    if (item.kind === 'draw') {
                      const points = item.points.map((point) => `${point.x},${point.y}`).join(' ')
                      return (
                        <polyline
                          key={item.id}
                          points={points}
                          fill="none"
                          stroke={item.color}
                          strokeWidth={item.size}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )
                    }

                    if (item.kind === 'text') {
                      return (
                        <text
                          key={item.id}
                          x={item.x}
                          y={item.y}
                          fill={item.color}
                          fontSize={item.size}
                          fontFamily="system-ui, sans-serif"
                        >
                          {item.text}
                        </text>
                      )
                    }

                    return (
                      <text
                        key={item.id}
                        x={item.x + 1}
                        y={item.y + Math.min(item.height - 2, item.size)}
                        fill={item.color}
                        fontSize={item.size}
                        fontFamily="system-ui, sans-serif"
                      >
                        {item.text}
                      </text>
                    )
                  })}

                  {currentDraft && currentDraft.length > 1 && (
                    <polyline
                      points={currentDraft.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeSize}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
              </article>
            )
          })
        )}
      </section>
    </main>
  )
}

export default App
