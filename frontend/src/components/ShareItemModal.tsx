import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaperAirplaneIcon, XMarkIcon, UserIcon } from '@heroicons/react/24/outline';
import DetailsModal from './DetailsModal';

interface ClipboardItem {
  id: string;
  type: 'text' | 'image' | 'html' | 'code' | 'file';
  value: string;
  meta?: any;
  createdAt?: string;
}

interface ShareItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: ClipboardItem;
  onShare: (receiverId: string, metadata?: any) => Promise<void>;
  currentUserId?: string;
}

export default function ShareItemModal({
  isOpen,
  onClose,
  item,
  onShare,
  currentUserId
}: ShareItemModalProps) {
  const { t } = useTranslation();
  const [receiverId, setReceiverId] = useState('');
  const [message, setMessage] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!receiverId.trim()) {
      setError(t('sharing.error_receiver_required') || 'Receiver ID is required');
      return;
    }

    if (receiverId === currentUserId) {
      setError(t('sharing.error_self_share') || 'Cannot share with yourself');
      return;
    }

    setIsSharing(true);
    setError(null);

    try {
      const metadata = {
        senderId: currentUserId,
        senderName: 'User', // TODO: Get actual user name
        message: message.trim() || undefined,
        sharedAt: new Date().toISOString()
      };

      await onShare(receiverId.trim(), metadata);
      
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
    setReceiverId('');
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
    if (item.type === 'text') {
      return item.value.length > 100 
        ? item.value.substring(0, 100) + '...' 
        : item.value;
    } else if (item.type === 'image') {
      return t('sharing.image_item') || 'Image';
    } else if (item.type === 'html') {
      return t('sharing.html_item') || 'HTML content';
    } else if (item.type === 'code') {
      return t('sharing.code_item') || 'Code snippet';
    } else if (item.type === 'file') {
      return item.meta?.filename || t('sharing.file_item') || 'File';
    }
    
    return t('sharing.unknown_item') || 'Unknown item';
  };

  // Get item type icon/color
  const getItemTypeInfo = () => {
    switch (item.type) {
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
    <DetailsModal isOpen={isOpen} onClose={handleClose}>
      <div className="p-6 max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            <PaperAirplaneIcon className="w-5 h-5 text-[color:var(--color-primary)]" />
            <h3 className="text-lg font-medium text-[color:var(--color-text)]">
              {t('sharing.share_item') || 'Share Clipboard Item'}
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title={t('sharing.close') || 'Close'}
          >
            <XMarkIcon className="w-5 h-5 text-[color:var(--color-muted)]" />
          </button>
        </div>

        {/* Item preview */}
        <div className="mb-6 p-4 bg-black/5 dark:bg-white/5 rounded-lg border border-[color:var(--color-border)]">
          <div className="flex items-start space-x-3">
            <div className={`text-lg ${itemTypeInfo.color}`}>
              {itemTypeInfo.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2 mb-1">
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${itemTypeInfo.color} bg-opacity-20`}>
                  {item.type.toUpperCase()}
                </span>
                {item.createdAt && (
                  <span className="text-xs text-[color:var(--color-muted)]">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <p className="text-sm text-[color:var(--color-text)] break-words">
                {itemPreview}
              </p>
            </div>
          </div>
        </div>

        {/* Success message */}
        {success && (
          <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-600 dark:text-green-400 text-center">
              {t('sharing.success_message') || 'Item shared successfully!'}
            </p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          </div>
        )}

        {/* Share form */}
        {!success && (
          <form onSubmit={handleSubmit}>
            {/* Receiver ID */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-[color:var(--color-text)] mb-2">
                <div className="flex items-center space-x-2">
                  <UserIcon className="w-4 h-4" />
                  <span>{t('sharing.receiver_id') || "Receiver's User ID"}</span>
                </div>
              </label>
              <input
                type="text"
                value={receiverId}
                onChange={(e) => setReceiverId(e.target.value)}
                placeholder={t('sharing.receiver_placeholder') || 'Enter user ID...'}
                className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm"
                disabled={isSharing}
                autoFocus
              />
              <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                {t('sharing.receiver_hint') || 'Enter the user ID of the person you want to share with'}
              </p>
            </div>

            {/* Optional message */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-[color:var(--color-text)] mb-2">
                {t('sharing.message') || 'Message (optional)'}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('sharing.message_placeholder') || 'Add a message...'}
                className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm resize-none"
                rows={3}
                disabled={isSharing}
              />
            </div>

            {/* Actions */}
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSharing}
                className="flex-1 px-4 py-2 border border-[color:var(--color-border)] text-[color:var(--color-text)] rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {t('sharing.cancel') || 'Cancel'}
              </button>
              
              <button
                type="submit"
                disabled={isSharing || !receiverId.trim()}
                className="flex-1 px-4 py-2 bg-[color:var(--color-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                {isSharing ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-r-transparent"></div>
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