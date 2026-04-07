import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaperAirplaneIcon, XMarkIcon, UserIcon } from '@heroicons/react/24/outline';
import DetailsModal from './DetailsModal';

interface ClipboardItem {
  id?: string;
  type?: 'text' | 'image' | 'html' | 'code' | 'file';
  value: string;
  meta?: any;
  createdAt?: string;
}

interface ShareItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: ClipboardItem;
  onShare: (receiverEmail: string, metadata?: any) => Promise<void | string>;
  currentUserEmail?: string;
}

export default function ShareItemModal({
  isOpen,
  onClose,
  item,
  onShare,
  currentUserEmail
}: ShareItemModalProps) {
  const { t } = useTranslation();
  const [receiverEmail, setReceiverEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const itemType = item.type ?? 'text';
  const normalizedReceiverEmail = receiverEmail.trim().toLowerCase();
  const normalizedCurrentUserEmail = currentUserEmail?.trim().toLowerCase();
  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!normalizedReceiverEmail) {
      setError(t('sharing.error_receiver_required') || 'Correo del destinatario requerido');
      return;
    }

    if (!isValidEmail(normalizedReceiverEmail)) {
      setError(t('sharing.error_receiver_required') || 'Correo inválido');
      return;
    }

    if (normalizedCurrentUserEmail && normalizedReceiverEmail === normalizedCurrentUserEmail) {
      setError(t('sharing.error_self_share') || 'No puedes enviarte a ti mismo');
      return;
    }

    setIsSharing(true);
    setError(null);

    try {
      const metadata = {
        senderId: currentUserEmail,
        senderName: 'User', // TODO: Get actual user name
        message: message.trim() || undefined,
        sharedAt: new Date().toISOString()
      };

      await onShare(normalizedReceiverEmail, metadata);
      
      setSuccess(true);
      setTimeout(() => {
        onClose();
        resetForm();
      }, 2000);
    } catch (err: any) {
      setError(err.message || t('sharing.error_share_failed') || 'Failed to share item');
    } finally {
      setIsSharing(false);
    }
  };

  const resetForm = () => {
    setReceiverEmail('');
    setMessage('');
    setError(null);
    setSuccess(false);
    setIsSharing(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Format item preview
  const getItemPreview = () => {
    if (itemType === 'text') {
      return item.value.length > 100 
        ? item.value.substring(0, 100) + '...' 
        : item.value;
    } else if (itemType === 'image') {
      return t('sharing.image_item') || 'Image';
    } else if (itemType === 'html') {
      return t('sharing.html_item') || 'HTML content';
    } else if (itemType === 'code') {
      return t('sharing.code_item') || 'Code snippet';
    } else if (itemType === 'file') {
      return item.meta?.filename || t('sharing.file_item') || 'File';
    }
    
    return t('sharing.unknown_item') || 'Unknown item';
  };

  // Get item type icon/color
  const getItemTypeInfo = () => {
    switch (itemType) {
      case 'text':
        return { color: 'text-blue-500', icon: '📝' };
      case 'image':
        return { color: 'text-green-500', icon: '🖼️' };
      case 'html':
        return { color: 'text-purple-500', icon: '🌐' };
      case 'code':
        return { color: 'text-yellow-500', icon: '💻' };
      case 'file':
        return { color: 'text-gray-500', icon: '📎' };
      default:
        return { color: 'text-gray-500', icon: '❓' };
    }
  };

  const itemTypeInfo = getItemTypeInfo();
  const itemPreview = getItemPreview();

  return (
    <DetailsModal open={isOpen} onClose={handleClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <PaperAirplaneIcon className="w-5 h-5 text-[color:var(--color-primary)]" />
          <h3 className="m-0 text-[color:var(--color-text)]">
            {t('sharing.share_item') || 'Share Clipboard Item'}
          </h3>
          <button
            onClick={handleClose}
            className="ml-auto p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100"
            title={t('sharing.close') || 'Close'}
            aria-label={t('sharing.close') || 'Close'}
          >
            <XMarkIcon className="w-5 h-5 text-[color:var(--color-muted)]" />
          </button>
        </div>

        <div className="p-3 bg-black/5 dark:bg-white/5 rounded-[var(--radius-button)] border border-[color:var(--color-border)]">
          <div className="flex items-start gap-3">
            <div className={`text-lg ${itemTypeInfo.color}`}>{itemTypeInfo.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 text-xs rounded-full bg-[color:var(--color-primary)] text-white">
                  {itemType.toUpperCase()}
                </span>
                {item.createdAt && (
                  <span className="text-xs text-[color:var(--color-muted)]">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <p className="m-0 text-sm text-[color:var(--color-text)] break-words">{itemPreview}</p>
            </div>
          </div>
        </div>

        {success && (
          <p className="text-sm text-center" style={{ color: 'var(--color-primary)' }}>
            {t('sharing.success_message') || 'Item shared successfully!'}
          </p>
        )}

        {error && (
          <p className="text-sm" style={{ color: 'var(--color-accent)' }}>
            {error}
          </p>
        )}

        {!success && (
          <form onSubmit={handleSubmit} className="space-y-3 pt-1">
            <div>
              <div className="text-sm opacity-80 mb-1 flex items-center gap-2">
                <UserIcon className="w-4 h-4" />
                <span>{t('sharing.receiver_id') || 'Correo del destinatario'}</span>
              </div>
              <input
                type="email"
                value={receiverEmail}
                onChange={(e) => setReceiverEmail(e.target.value)}
                placeholder={t('sharing.receiver_placeholder') || 'Ingresa el correo...'}
                className="w-full px-3 h-[36px] rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm"
                disabled={isSharing}
                autoFocus
              />
              <p className="m-0 mt-1 text-xs text-[color:var(--color-muted)]">
                {t('sharing.receiver_hint') || 'Ingresa el correo de la persona con quien quieres compartir'}
              </p>
            </div>

            <div>
              <div className="text-sm opacity-80 mb-1">{t('sharing.message') || 'Message (optional)'}</div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('sharing.message_placeholder') || 'Add a message...'}
                className="w-full px-3 py-2 rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm resize-none"
                rows={3}
                disabled={isSharing}
              />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSharing}
                className="px-4 h-[36px] rounded-[var(--radius-button)] border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100 text-sm font-medium disabled:opacity-50"
              >
                {t('sharing.cancel') || 'Cancel'}
              </button>

              <button
                type="submit"
                disabled={isSharing || !normalizedReceiverEmail || !isValidEmail(normalizedReceiverEmail)}
                className="px-4 h-[36px] rounded-[var(--radius-button)] text-white transition-colors duration-100 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
                style={{ backgroundColor: 'var(--color-primary)', opacity: isSharing || !normalizedReceiverEmail || !isValidEmail(normalizedReceiverEmail) ? 0.7 : 1 }}
              >
                {isSharing ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-r-transparent" />
                    <span>{t('sharing.sharing') || 'Sharing...'}</span>
                  </>
                ) : (
                  <>
                    <PaperAirplaneIcon className="w-4 h-4" />
                    <span>{t('sharing.share') || 'Share'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </DetailsModal>
  );
}
