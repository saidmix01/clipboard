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
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">
            {t('delete.cancel')}
          </button>
          <button onClick={onConfirm} disabled={loading} className="px-3 py-2 rounded-md bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {loading ? t('delete.deleting') : t('delete.delete')}
          </button>
        </div>
      </div>
    </DetailsModal>
  )
}
