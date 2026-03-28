import DetailsModal from './DetailsModal'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading: boolean
}

export default function DeleteModal({ open, onClose, onConfirm, loading }: Props) {
  const { t } = useTranslation()

  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="space-y-4">
        <h3 className="m-0 text-[color:var(--color-text)]">{t('delete.title')}</h3>
        <p className="text-[color:var(--color-muted)] text-sm">
          {t('delete.message')}
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 h-[32px] rounded-[var(--radius-button)] border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100 text-sm font-medium">
            {t('delete.cancel')}
          </button>
          <button onClick={onConfirm} disabled={loading} className="px-4 h-[32px] rounded-[var(--radius-button)] bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 transition-colors duration-100 text-sm font-medium">
            {loading ? t('delete.deleting') : t('delete.delete')}
          </button>
        </div>
      </div>
    </DetailsModal>
  )
}
