import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import Tesseract from 'tesseract.js'
import { DocumentTextIcon, XMarkIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { notifySuccess, notifyError } from '../utils/notify'

type Props = {
  isOpen: boolean
  imageUrl: string | null
  onClose: () => void
}

export default function OCRModal({ isOpen, imageUrl, onClose }: Props) {
  const [processing, setProcessing] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  // Reset state when opening new image
  useEffect(() => {
    if (isOpen) {
        setText(null)
        setProcessing(false)
        setProgress(0)
    }
  }, [isOpen, imageUrl])

  const handleExtract = async () => {
    if (!imageUrl) return
    
    setProcessing(true)
    setProgress(0)
    setText(null)

    try {
        // Use local-image protocol url directly or convert if needed
        // Tesseract.js loads image via XHR/fetch, so it needs access.
        // Electron 'local-image://' might be tricky for Tesseract worker which runs in blob/worker.
        // Ideally we pass a blob or base64.
        // If imageUrl is local-image://, fetch it first to get blob?
        
        let imageSource = imageUrl
        
        // Try fetching blob if it's a custom protocol to ensure worker access
        if (imageUrl.startsWith('local-image://')) {
             try {
                 const res = await fetch(imageUrl)
                 const blob = await res.blob()
                 imageSource = URL.createObjectURL(blob)
             } catch (e) {
                 console.error("Error fetching local image for OCR", e)
             }
        }

        const result = await Tesseract.recognize(
            imageSource,
            'eng+spa', // Multilingual support
            {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        setProgress(m.progress)
                    }
                }
            }
        )
        
        setText(result.data.text)
    } catch (err) {
        console.error(err)
        notifyError('Error al extraer texto')
    } finally {
        setProcessing(false)
    }
  }

  const handleCopy = () => {
      if (text) {
          ;(window as any).electronAPI?.copyText?.(text)
          notifySuccess('Texto copiado')
          onClose()
      }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-[color:var(--color-border)] flex justify-between items-center bg-[color:var(--color-bg)]">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <DocumentTextIcon className="w-5 h-5" />
                OCR - Extraer Texto
              </h3>
              <button onClick={onClose} className="p-1 hover:bg-black/10 rounded-full transition">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex flex-col md:flex-row h-full overflow-hidden">
                {/* Image Preview */}
                <div className="flex-1 bg-black/5 p-4 flex items-center justify-center overflow-auto border-b md:border-b-0 md:border-r border-[color:var(--color-border)] min-h-[300px]">
                    {imageUrl ? (
                        <img 
                            src={imageUrl} 
                            alt="OCR Target" 
                            className="max-w-full max-h-full object-contain shadow-sm" 
                        />
                    ) : (
                        <span className="text-muted">No imagen</span>
                    )}
                </div>

                {/* Controls & Result */}
                <div className="w-full md:w-1/3 p-4 flex flex-col gap-4 bg-[color:var(--color-surface)]">
                    {!text && !processing && (
                        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                            <p className="text-sm text-[color:var(--color-muted)]">
                                Haz clic en el botón para extraer texto de esta imagen.
                            </p>
                            <button 
                                onClick={handleExtract}
                                className="px-6 py-2 bg-[color:var(--color-primary)] text-white rounded-lg shadow hover:opacity-90 transition font-medium w-full"
                            >
                                Iniciar Escaneo OCR
                            </button>
                        </div>
                    )}

                    {processing && (
                         <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                            <div className="w-10 h-10 border-4 border-[color:var(--color-primary)] border-t-transparent rounded-full animate-spin"></div>
                            <div>
                                <p className="font-medium">Procesando...</p>
                                <p className="text-xs text-[color:var(--color-muted)]">{Math.round(progress * 100)}%</p>
                            </div>
                         </div>
                    )}

                    {text && (
                        <div className="flex-1 flex flex-col gap-2 overflow-hidden">
                            <label className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">Texto Detectado</label>
                            <textarea 
                                className="flex-1 w-full p-3 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[color:var(--color-primary)]"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                            />
                            <button 
                                onClick={handleCopy}
                                className="mt-2 px-4 py-2 bg-[color:var(--color-primary)] text-white rounded-lg shadow hover:opacity-90 transition font-medium flex items-center justify-center gap-2"
                            >
                                <ClipboardDocumentIcon className="w-4 h-4" />
                                Copiar Texto
                            </button>
                        </div>
                    )}
                </div>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
