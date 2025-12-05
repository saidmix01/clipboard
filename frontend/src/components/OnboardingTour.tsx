import { useState } from 'react'
import { motion } from 'framer-motion'
import Portal from './Portal'

type Props = {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

export default function OnboardingTour({ open, onClose, onComplete }: Props) {
  const [step, setStep] = useState<number>(0)
  if (!open) return null

  const steps = [
    {
      title: 'Bienvenido a Copyfy',
      body: (
        <>
          <p className="mt-2">Abre la app desde cualquier ventana con el atajo global <b>Alt + X</b>.</p>
          <p className="mt-1 text-[color:var(--color-muted)]">La ventana se acopla al borde derecho y queda encima de otras apps.</p>
        </>
      )
    },
    {
      title: 'Inicia sesión o regístrate',
      body: (
        <>
          <p className="mt-2">Usa el Dock inferior para <b>Iniciar sesión</b> o <b>Registrarse</b>.</p>
          <p className="mt-1 text-[color:var(--color-muted)]">Así sincronizas tu portapapeles y dispositivos en la nube.</p>
        </>
      )
    },
    {
      title: 'Busca, filtra y marca favoritos',
      body: (
        <>
          <p className="mt-2">Escribe en la barra de búsqueda y usa los filtros de la izquierda.</p>
          <p className="mt-1 text-[color:var(--color-muted)]">Marca con ⭐ para priorizar elementos que usas frecuentemente.</p>
        </>
      )
    },
    {
      title: 'Copia y pega al instante',
      body: (
        <>
          <p className="mt-2">Selecciona con ↑ ↓ y pulsa <b>Enter</b> para copiar y pegar automáticamente.</p>
          <p className="mt-1 text-[color:var(--color-muted)]">Las imágenes también se copian y se pegan en apps compatibles.</p>
        </>
      )
    },
    {
      title: 'Ajustes y sincronización',
      body: (
        <>
          <p className="mt-2">En <b>Ajustes</b> puedes cambiar tema, sincronizar y gestionar dispositivos.</p>
          <p className="mt-1 text-[color:var(--color-muted)]">Si algo falla, usa “Sincronizar ahora” para refrescar tu historial.</p>
        </>
      )
    }
  ]

  const last = step >= steps.length - 1

  return (
    <Portal>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex items-center justify-center no_drag" style={{ zIndex: 10000 }}>
        <div className="absolute inset-0 bg-black/50" onClick={onClose} style={{ zIndex: 1 }} />
        <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }} className="panel w-[640px] max-h-[70vh] overflow-auto p-4" style={{ zIndex: 2 }}>
          <h3 className="text-lg font-semibold">{steps[step].title}</h3>
          <div className="text-[color:var(--color-text)]">{steps[step].body}</div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-[12px] text-[color:var(--color-muted)]">Paso {step + 1} de {steps.length}</div>
            <div className="flex gap-2">
              <button className={`px-3 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition text-sm ${step===0?'opacity-60 cursor-not-allowed':''}`} onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>Atrás</button>
              {!last && (
                <button className="px-3 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition text-sm" onClick={() => setStep(s => Math.min(steps.length - 1, s + 1))}>Siguiente</button>
              )}
              {last && (
                <button className="px-3 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition text-sm" onClick={onComplete}>Entendido</button>
              )}
            </div>
          </div>
          <div className="mt-3 text-[12px] text-[color:var(--color-muted)]">No volverás a ver esta guía al completar.</div>
        </motion.div>
      </motion.div>
    </Portal>
  )
}
