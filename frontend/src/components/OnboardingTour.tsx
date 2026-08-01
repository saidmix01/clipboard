import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Portal from './Portal'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

export default function OnboardingTour({ open, onClose, onComplete }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<number>(0)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  if (!open) return null

  const steps = [
    {
      title: t('onboarding.step_1_title'),
      body: t('onboarding.step_1_body'),
      hint: t('onboarding.step_1_hint')
    },
    {
      title: t('onboarding.step_2_title'),
      body: t('onboarding.step_2_body'),
      hint: t('onboarding.step_2_hint')
    },
    {
      title: t('onboarding.step_3_title'),
      body: t('onboarding.step_3_body'),
      hint: t('onboarding.step_3_hint')
    },
    {
      title: t('onboarding.step_4_title'),
      body: t('onboarding.step_4_body'),
      hint: t('onboarding.step_4_hint')
    },
    {
      title: t('onboarding.step_5_title'),
      body: t('onboarding.step_5_body'),
      hint: t('onboarding.step_5_hint')
    },
    {
      title: t('onboarding.step_6_title'),
      body: t('onboarding.step_6_body'),
      hint: t('onboarding.step_6_hint')
    },
    {
      title: t('onboarding.step_7_title'),
      body: t('onboarding.step_7_body'),
      hint: t('onboarding.step_7_hint')
    },
    {
      title: t('onboarding.step_8_title'),
      body: t('onboarding.step_8_body'),
      hint: t('onboarding.step_8_hint')
    }
  ]

  const last = step >= steps.length - 1

  return (
    <Portal>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex items-center justify-center no_drag" style={{ zIndex: 10000 }}>
        <div className="absolute inset-0 bg-black/50" onClick={onClose} style={{ zIndex: 1 }} />
        <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }} className="panel w-[640px] max-h-[70vh] overflow-auto p-4" style={{ zIndex: 2 }}>
          <h3 className="text-lg font-semibold text-[color:var(--color-text)]">{steps[step].title}</h3>
          <div className="text-[color:var(--color-text)] mt-2">
            <p dangerouslySetInnerHTML={{ __html: steps[step].body }} />
            <p className="mt-1 text-[color:var(--color-muted)]" dangerouslySetInnerHTML={{ __html: steps[step].hint }} />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-[12px] text-[color:var(--color-muted)]">
              {t('onboarding.step_of', { current: step + 1, total: steps.length })}
            </div>
            <div className="flex gap-2">
              <button
                className={`px-3 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition text-sm ${step === 0 ? 'opacity-60 cursor-not-allowed' : ''}`}
                onClick={() => setStep(s => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                {t('onboarding.back')}
              </button>
              {!last && (
                <button
                  className="px-3 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition text-sm"
                  onClick={() => setStep(s => Math.min(steps.length - 1, s + 1))}
                >
                  {t('onboarding.next')}
                </button>
              )}
              {last && (
                <button
                  className="px-3 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition text-sm"
                  onClick={onComplete}
                >
                  {t('onboarding.done')}
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 text-[12px] text-[color:var(--color-muted)]">{t('onboarding.no_show_again')}</div>
        </motion.div>
      </motion.div>
    </Portal>
  )
}
