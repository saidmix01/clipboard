import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface SharingItem {
  sharingId: string;
  senderId: string;
  receiverId: string;
  item: {
    type: 'text' | 'image' | 'html' | 'code' | 'file';
    value: string;
    meta?: any;
  };
  metadata?: any;
  status: 'pending';
}

interface SharingNotificationProps {
  item: SharingItem;
  onAccept: (sharingId: string) => Promise<void>;
  onReject: (sharingId: string) => Promise<void>;
  onClose: () => void;
  autoCloseDelay?: number; // milliseconds
}

export default function SharingNotification({
  item,
  onAccept,
  onReject,
  onClose,
  autoCloseDelay = 30000 // 30 seconds default
}: SharingNotificationProps) {
  const { t } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(Math.floor(autoCloseDelay / 1000));

  // Auto-close timer
  useEffect(() => {
    if (autoCloseDelay <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoCloseDelay, onClose]);

  const handleAccept = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    try {
      await onAccept(item.sharingId);
      onClose();
    } catch (error) {
      console.error('Error accepting shared item:', error);
      // Optionally show error to user
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    try {
      await onReject(item.sharingId);
      onClose();
    } catch (error) {
      console.error('Error rejecting shared item:', error);
      // Optionally show error to user
    } finally {
      setIsProcessing(false);
    }
  };

  // Format item preview
  const getItemPreview = () => {
    const { type, value, meta } = item.item;
    
    if (type === 'text') {
      return value.length > 100 ? value.substring(0, 100) + '...' : value;
    } else if (type === 'image') {
      return t('sharing.image_item') || 'Image';
    } else if (type === 'html') {
      return t('sharing.html_item') || 'HTML content';
    } else if (type === 'code') {
      return t('sharing.code_item') || 'Code snippet';
    } else if (type === 'file') {
      return meta?.filename || t('sharing.file_item') || 'File';
    }
    
    return t('sharing.unknown_item') || 'Unknown item';
  };

  // Get item type icon/color
  const getItemTypeInfo = () => {
    const { type } = item.item;
    
    switch (type) {
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
  const senderName = item.metadata?.senderName || item.senderId;

  return (
    <div className="fixed bottom-4 right-4 w-96 max-w-full bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-lg shadow-lg z-50 animate-in slide-in-from-bottom-5">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[color:var(--color-border)] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-lg">{itemTypeInfo.icon}</span>
          <h3 className="font-medium text-[color:var(--color-text)]">
            {t('sharing.notification_title') || 'Clipboard Shared'}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={t('sharing.close') || 'Close'}
        >
          <XMarkIcon className="w-4 h-4 text-[color:var(--color-muted)]" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Sender info */}
        <div className="mb-3">
          <p className="text-sm text-[color:var(--color-muted)]">
            {t('sharing.from') || 'From'}:{' '}
            <span className="font-medium text-[color:var(--color-text)]">
              {senderName}
            </span>
          </p>
        </div>

        {/* Item preview */}
        <div className="mb-4 p-3 bg-black/5 dark:bg-white/5 rounded border border-[color:var(--color-border)]">
          <div className="flex items-start space-x-2">
            <span className={`text-sm font-medium ${itemTypeInfo.color}`}>
              {item.item.type.toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[color:var(--color-text)] break-words">
                {itemPreview}
              </p>
            </div>
          </div>
        </div>

        {/* Auto-close timer */}
        {autoCloseDelay > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-[color:var(--color-muted)]">
              <span>{t('sharing.auto_close') || 'Auto-close in'}:</span>
              <span className="font-mono">{timeLeft}s</span>
            </div>
            <div className="h-1 bg-[color:var(--color-border)] rounded-full overflow-hidden mt-1">
              <div 
                className="h-full bg-[color:var(--color-primary)] transition-all duration-1000"
                style={{ width: `${(timeLeft / (autoCloseDelay / 1000)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex space-x-2">
          <button
            onClick={handleAccept}
            disabled={isProcessing}
            className="flex-1 px-4 py-2 bg-[color:var(--color-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            <CheckIcon className="w-4 h-4" />
            <span>{t('sharing.accept') || 'Accept'}</span>
          </button>
          
          <button
            onClick={handleReject}
            disabled={isProcessing}
            className="flex-1 px-4 py-2 border border-[color:var(--color-border)] text-[color:var(--color-text)] rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            <XMarkIcon className="w-4 h-4" />
            <span>{t('sharing.reject') || 'Reject'}</span>
          </button>
        </div>

        {/* Processing indicator */}
        {isProcessing && (
          <div className="mt-3 text-center">
            <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-[color:var(--color-primary)] border-r-transparent"></div>
            <span className="ml-2 text-sm text-[color:var(--color-muted)]">
              {t('sharing.processing') || 'Processing...'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}