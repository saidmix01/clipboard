import DetailsModal from './DetailsModal'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onClose: () => void
}

export default function AboutModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const appVersion = '2.1.0'

  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 py-4">
        <img src="/icon.png" alt="CopyFy Logo" className="w-16 h-16" />
        <div className="text-center">
          <h2 className="text-xl font-bold text-[color:var(--color-text)] m-0">{t('about.title')}</h2>
          <p className="text-[color:var(--color-muted)] text-sm m-0 mt-1">{t('about.version')} {appVersion}</p>
        </div>
        <div className="flex gap-4 text-sm text-[color:var(--color-primary)]">
          <a href="#" onClick={(e) => { e.preventDefault(); try { (window as any).electronAPI?.openExternalUrl?.('https://github.com/tu-repo/releases') } catch {} }}>{t('about.whats_new')}</a>
          <a href="#" onClick={(e) => { e.preventDefault(); try { (window as any).electronAPI?.openExternalUrl?.('https://github.com/tu-repo') } catch {} }}>{t('about.github')}</a>
        </div>
      </div>
    </DetailsModal>
  )
}
