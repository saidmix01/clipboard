import { useState, forwardRef, useImperativeHandle } from 'react';
import type { ReactNode } from 'react';
import { useSharingSocket, useSharedItemsListener } from '../hooks/useSharingSocket';
import SharingNotification from './SharingNotification';
import ShareItemModal from './ShareItemModal';

interface SharingManagerProps {
  children: ReactNode;
  currentUserId?: string;
  currentUserEmail?: string;
  currentUserToken?: string | null;
  onItemAdded?: (item: any) => void;
}

export interface SharingManagerRef {
  sendClipboardItem: (receiverEmail: string, item: any, metadata?: any) => Promise<string>;
}

interface SharedItem {
  sharingId: string;
  senderId: string;
  receiverEmail: string;
  item: {
    type: 'text' | 'image' | 'html' | 'code' | 'file';
    value: string;
    meta?: any;
  };
  metadata?: any;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

const SharingManager = forwardRef<SharingManagerRef, SharingManagerProps>(({
  children,
  currentUserId,
  currentUserEmail,
  currentUserToken,
  onItemAdded
}: SharingManagerProps, ref) => {
  // State for sharing
  const [pendingShares, setPendingShares] = useState<SharedItem[]>([]);
  const [currentNotification, setCurrentNotification] = useState<SharedItem | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [itemToShare, setItemToShare] = useState<any>(null);

  // WebSocket connection
  const {
    socket,
    isConnected,
    isRegistered,
    sendClipboardItem,
    acceptClipboardItem,
    rejectClipboardItem
  } = useSharingSocket({
    userId: currentUserEmail ?? currentUserId,
    token: currentUserToken ?? undefined,
    autoConnect: true,
    onConnected: () => console.log('[SharingManager] WebSocket connected'),
    onDisconnected: () => console.log('[SharingManager] WebSocket disconnected'),
    onError: (error) => console.error('[SharingManager] WebSocket error:', error)
  });

  // Expose sendClipboardItem function via ref
  useImperativeHandle(ref, () => ({
    sendClipboardItem: async (receiverEmail: string, item: any, metadata?: any) => {
      return await sendClipboardItem(receiverEmail, item, metadata);
    }
  }));

  // Listen for incoming shared items
  useSharedItemsListener(
    socket,
    (item: SharedItem) => {
      console.log('[SharingManager] New item received:', item);
      setPendingShares(prev => [...prev, item]);
      
      // Show notification if no other notification is active
      if (!currentNotification) {
        setCurrentNotification(item);
      }
    },
    (sharingId: string) => {
      console.log('[SharingManager] Item accepted by receiver:', sharingId);
      // Handle acceptance notification if needed
    },
    (sharingId: string) => {
      console.log('[SharingManager] Item rejected by receiver:', sharingId);
      // Handle rejection notification if needed
    }
  );

  // Handle accepting a shared item
  const handleAcceptItem = async (sharingId: string) => {
    try {
      await acceptClipboardItem(sharingId);
      
      // Find the item in pending shares
      const acceptedItem = pendingShares.find(item => item.sharingId === sharingId);
      if (acceptedItem) {
        // Notify parent component about new item
        onItemAdded?.({
          ...acceptedItem.item,
          meta: {
            ...acceptedItem.item.meta,
            shared: true,
            sharedFrom: acceptedItem.senderId,
            sharingId: acceptedItem.sharingId
          }
        });
      }
      
      // Remove from pending shares
      setPendingShares(prev => prev.filter(item => item.sharingId !== sharingId));
      
      // Show next notification if available
      const nextItem = pendingShares.find(item => item.sharingId !== sharingId);
      setCurrentNotification(nextItem || null);
      
    } catch (error) {
      console.error('[SharingManager] Error accepting item:', error);
      throw error;
    }
  };

  // Handle rejecting a shared item
  const handleRejectItem = async (sharingId: string) => {
    try {
      await rejectClipboardItem(sharingId);
      
      // Remove from pending shares
      setPendingShares(prev => prev.filter(item => item.sharingId !== sharingId));
      
      // Show next notification if available
      const nextItem = pendingShares.find(item => item.sharingId !== sharingId);
      setCurrentNotification(nextItem || null);
      
    } catch (error) {
      console.error('[SharingManager] Error rejecting item:', error);
      throw error;
    }
  };

  // Handle sharing an item
  const handleShareItem = async (receiverEmail: string, metadata?: any) => {
    if (!itemToShare) {
      throw new Error('No item to share');
    }

    try {
      const sharingId = await sendClipboardItem(receiverEmail, {
        type: itemToShare.type,
        value: itemToShare.value,
        meta: itemToShare.meta
      }, metadata);

      console.log('[SharingManager] Item shared successfully:', sharingId);
      return sharingId;
    } catch (error) {
      console.error('[SharingManager] Error sharing item:', error);
      throw error;
    }
  };

  // Close share modal
  const closeShareModal = () => {
    setShareModalOpen(false);
    setItemToShare(null);
  };

  // Close notification
  const closeNotification = () => {
    setCurrentNotification(null);
    
    // Show next notification if available
    const nextItem = pendingShares.find(item => item !== currentNotification);
    setCurrentNotification(nextItem || null);
  };

  const statusDotClass = isConnected && isRegistered ? 'bg-green-500' : 'bg-red-500';

  return (
    <>
      {/* Render children with sharing context */}
      {children}

      {/* WebSocket connection status (debug) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-3 left-3 z-40 pointer-events-none">
          <span className={`block h-3 w-3 rounded-full ${statusDotClass} shadow-md ring-1 ring-black/20`} />
        </div>
      )}

      {/* Sharing notification */}
      {currentNotification && (
        <SharingNotification
          item={currentNotification}
          onAccept={handleAcceptItem}
          onReject={handleRejectItem}
          onClose={closeNotification}
          autoCloseDelay={30000}
        />
      )}

      {/* Share item modal */}
      {shareModalOpen && itemToShare && (
        <ShareItemModal
          isOpen={shareModalOpen}
          onClose={closeShareModal}
          item={itemToShare}
          onShare={handleShareItem}
          currentUserEmail={currentUserEmail}
        />
      )}

      {/* Pending shares badge (optional) */}
      {pendingShares.length > 0 && !currentNotification && (
        <button
          onClick={() => setCurrentNotification(pendingShares[0])}
          className="fixed bottom-20 right-4 px-3 py-1 bg-[color:var(--color-primary)] text-white text-sm rounded-full shadow-lg z-40 hover:opacity-90 transition-opacity"
        >
          📋 {pendingShares.length} pending share{pendingShares.length !== 1 ? 's' : ''}
        </button>
      )}
    </>
  );
});

export default SharingManager;

/**
 * Hook to get sharing functions for use in other components
 */
export function useSharing() {
  const [sharingManager] = useState(() => ({
    openShareModal: (item: any) => {
      // This would be implemented by the parent component
      console.log('Share item:', item);
    }
  }));

  return sharingManager;
}
