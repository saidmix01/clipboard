import { useState, useRef, useEffect } from 'react'
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import Tesseract from 'tesseract.js'
import { ClipboardDocumentIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { Toaster, toast } from 'react-hot-toast'
import WindowShell from './WindowShell'
import { useTranslation } from 'react-i18next'

export default function OCRWindow() {
  const { t } = useTranslation()
  const [imgSrc, setImgSrc] = useState<string>('')
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const imgRef = useRef<HTMLImageElement>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Check URL params
    const params = new URLSearchParams(window.location.search)
    const imgParam = params.get('img')
    if (imgParam) {
        setImgSrc(decodeURIComponent(imgParam))
    }

    // Listen for IPC updates (if window is reused)
    if ((window as any).electronAPI?.onOCRLoadImage) {
        (window as any).electronAPI.onOCRLoadImage((path: string) => {
            setImgSrc(path)
            setText('')
            setCrop(undefined)
            setCompletedCrop(undefined)
        })
    }
  }, [])

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    const initialCrop = centerCrop(
        makeAspectCrop(
            {
                unit: '%',
                width: 90,
            },
            16 / 9,
            width,
            height
        ),
        width,
        height
    )
    setCrop(initialCrop)
  }

  const runOCR = async () => {
    if (!imgRef.current) return
    
    // If no crop, use full image
    if (!completedCrop?.width || !completedCrop?.height) {
         doOCR(imgRef.current.src)
         return
    }

    const image = imgRef.current
    const canvas = document.createElement('canvas')
    const scaleX = image.naturalWidth / image.width
    const scaleY = image.naturalHeight / image.height
    canvas.width = completedCrop.width * scaleX
    canvas.height = completedCrop.height * scaleY
    const ctx = canvas.getContext('2d')

    if (!ctx) return

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
    )

    canvas.toBlob((blob) => {
        if (blob) {
            const url = URL.createObjectURL(blob)
            doOCR(url)
        }
    }, 'image/png')
  }

  const doOCR = async (url: string) => {
      setLoading(true)
      setProgress(0)
      try {
        const result = await Tesseract.recognize(
            url,
            'eng+spa',
            {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        setProgress(m.progress)
                    }
                }
            }
        )
        setText(result.data.text)
        if (result.data.text) {
             navigator.clipboard.writeText(result.data.text)
             toast.success(t('ocr.copied'))
        } else {
             toast(t('ocr.no_text_detected'))
        }
      } catch (e) {
          console.error(e)
          toast.error(t('ocr.ocr_error'))
      } finally {
          setLoading(false)
      }
  }

  return (
    <WindowShell title={t('ocr.title')}>
      <Toaster />
      <div className="flex h-full">
          {/* Image Area */}
          <div className="flex-1 bg-[color:var(--color-bg)] overflow-auto flex items-center justify-center p-8 border-r border-[color:var(--color-border)] relative">
              <div className="absolute top-4 left-4 z-10 px-3 py-1 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border)] shadow-sm text-xs text-[color:var(--color-text)] opacity-80">
                  {t('ocr.select_area')}
              </div>
              
              {imgSrc ? (
                  <ReactCrop 
                    crop={crop} 
                    onChange={c => setCrop(c)} 
                    onComplete={c => setCompletedCrop(c)}
                    className="shadow-md border border-[color:var(--color-border)] rounded-[var(--radius-modal)] overflow-hidden"
                  >
                      <img 
                        ref={imgRef} 
                        src={imgSrc} 
                        onLoad={onImageLoad}
                        alt="Target"
                        style={{ maxWidth: '100%', maxHeight: '70vh' }}
                      />
                  </ReactCrop>
              ) : (
                  <div className="text-[color:var(--color-muted)] flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-full border-2 border-[color:var(--color-border)] border-t-[color:var(--color-primary)] animate-spin"></div>
                      <span>{t('ocr.loading_image')}</span>
                  </div>
              )}
          </div>

          {/* Sidebar */}
          <div className="w-80 bg-[color:var(--color-surface)] flex flex-col z-10">
              <div className="p-4 border-b border-[color:var(--color-border)]">
                  <button
                    onClick={runOCR}
                    disabled={loading || !imgSrc}
                    className="w-full h-[36px] bg-[color:var(--color-primary)] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-[var(--radius-button)] font-medium text-white transition-colors duration-100 shadow-sm flex justify-center items-center gap-2 text-sm"
                  >
                      {loading ? (
                          <>
                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            <span>{Math.round(progress * 100)}%</span>
                          </>
                      ) : (
                          t('ocr.extract_text')
                      )}
                  </button>
              </div>

              <div className="flex-1 flex flex-col p-4 gap-2 min-h-0">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">{t('ocr.result')}</label>
                  <textarea 
                    value={text}
                    onChange={e => setText(e.target.value)}
                    className="flex-1 bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-[var(--radius-input)] p-3 text-sm resize-none outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] font-mono text-[color:var(--color-text)]"
                    placeholder={t('ocr.placeholder')}
                  />
              </div>
              
              <div className="p-4 border-t border-[color:var(--color-border)] bg-[color:var(--color-bg)]">
                   <button
                    onClick={() => {
                        navigator.clipboard.writeText(text)
                        toast.success(t('ocr.copied'))
                    }}
                    disabled={!text}
                    className="w-full h-[36px] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:bg-black/5 dark:hover:bg-white/5 rounded-[var(--radius-button)] text-sm font-medium text-[color:var(--color-text)] transition-colors duration-100 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                      <ClipboardDocumentIcon className="w-4 h-4" />
                      {t('ocr.copy_clipboard')}
                  </button>
              </div>
          </div>
      </div>
    </WindowShell>
  )
}
