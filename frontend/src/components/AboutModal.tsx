import { useState, useEffect } from 'react'
import DetailsModal from './DetailsModal'
import { useTranslation } from 'react-i18next'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import logo from '../../media/64x64.png'

type Props = {
  open: boolean
  onClose: () => void
  onBack?: () => void
}

export default function AboutModal({ open, onClose, onBack }: Props) {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState('1.2.5')

  useEffect(() => {
    const loadVersion = async () => {
      try {
        const version = await (window as any).electronAPI?.getAppVersion?.()
        if (version) {
          setAppVersion(version)
        }
      } catch (error) {
        console.error('Error loading app version:', error)
      }
    }
    loadVersion()
  }, [])

  const MouseOver = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'var(--color-primary)'
    e.currentTarget.style.color = '#ffffff'
  }
  const MouseOut = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent'
    e.currentTarget.style.color = 'var(--color-text)'
  }

  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 py-4">
        <button onClick={() => { if (onBack) onBack(); else onClose(); }} className="self-start p-1 rounded-full hover:text-white transition-colors" onMouseEnter={MouseOver} onMouseLeave={MouseOut} title={t('about.back')}>
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <div className="flex flex-col items-center gap-4">
          <img src={logo} alt="CopyFy Logo" className="w-16 h-16" />
        <div className="text-center">
          <h2 className="text-xl font-bold text-[color:var(--color-text)] m-0">{t('about.title')}</h2>
          <p className="text-[color:var(--color-muted)] text-sm m-0 mt-1">{t('about.version')} {appVersion}</p>
        </div>
        <div className="flex gap-4 text-sm text-[color:var(--color-primary)]">
          <a href="#" onClick={(e) => { e.preventDefault(); try { (window as any).electronAPI?.openExternalUrl?.('https://copyfy.lat/novedades/') } catch {} }}>{t('about.whats_new')}</a>
          <a href="#" onClick={(e) => { e.preventDefault(); try { (window as any).electronAPI?.openExternalUrl?.('https://github.com/saidmix01/clipboard') } catch {} }}>{t('about.github')}</a>
        </div>
        </div>
      </div>
    </DetailsModal>
  )
}
