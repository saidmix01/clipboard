import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE } from '../config';

interface SharingSocketOptions {
  userId?: string;
  token?: string;
  autoConnect?: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: any) => void;
}

interface SharingItem {
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

interface UseSharingSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  isRegistered: boolean;
  registerUser: (userId: string) => void;
  sendClipboardItem: (receiverEmail: string, item: SharingItem['item'], metadata?: any) => Promise<string>;
  acceptClipboardItem: (sharingId: string) => Promise<void>;
  rejectClipboardItem: (sharingId: string) => Promise<void>;
  disconnect: () => void;
}

/**
 * Custom hook for clipboard sharing WebSocket functionality
 */
export function useSharingSocket({
  userId,
  token,
  autoConnect = true,
  onConnected,
  onDisconnected,
  onError
}: SharingSocketOptions = {}): UseSharingSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onConnectedRef.current = onConnected;
    onDisconnectedRef.current = onDisconnected;
    onErrorRef.current = onError;
  }, [onConnected, onDisconnected, onError]);

  // Initialize socket connection
  useEffect(() => {
    if (!autoConnect) return;

    const url = `${API_BASE}/sharing`;
    const socket = io(url, {
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('[SharingSocket] Connected to server');
      setIsConnected(true);
      onConnectedRef.current?.();
    });

    socket.on('disconnect', (reason) => {
      console.log('[SharingSocket] Disconnected:', reason);
      setIsConnected(false);
      setIsRegistered(false);
      onDisconnectedRef.current?.();
    });

    socket.on('connect_error', (error) => {
      console.error('[SharingSocket] connect_error:', error?.message || error);
      onErrorRef.current?.(error);
    });

    socket.on('error', (error) => {
      console.error('[SharingSocket] Socket error:', error);
      onErrorRef.current?.(error);
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      console.log('[SharingSocket] reconnect_attempt:', attempt);
    });
    socket.io.on('reconnect_error', (error) => {
      console.error('[SharingSocket] reconnect_error:', error?.message || error);
    });
    socket.io.on('reconnect_failed', () => {
      console.error('[SharingSocket] reconnect_failed');
    });

    // Registration events
    socket.on('registered', (data) => {
      console.log('[SharingSocket] User registered:', data);
      setIsRegistered(true);
    });

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [autoConnect, token]);

  // Register user with server
  const registerUser = useCallback((userId: string) => {
    if (!socketRef.current || !isConnected) {
      console.error('[SharingSocket] Cannot register: socket not connected');
      return;
    }

    console.log(`[SharingSocket] Registering user: ${userId}`);
    socketRef.current.emit('register_user', userId);
  }, [isConnected]);

  // Send clipboard item to another user
  const sendClipboardItem = useCallback(async (
    receiverEmail: string,
    item: SharingItem['item'],
    metadata?: any
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !isConnected) {
        reject(new Error('Socket not connected'));
        return;
      }

      if (!isRegistered) {
        reject(new Error('User not registered'));
        return;
      }

      console.log(`[SharingSocket] Sending item to ${receiverEmail}`);

      socketRef.current.emit('send_clipboard_item', {
        receiverEmail,
        item,
        metadata
      }, (response: any) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else if (response?.sharingId) {
          resolve(response.sharingId);
        } else {
          reject(new Error('Invalid response from server'));
        }
      });

      // Fallback timeout
      setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }, [isConnected, isRegistered]);

  // Accept received clipboard item
  const acceptClipboardItem = useCallback(async (sharingId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !isConnected) {
        reject(new Error('Socket not connected'));
        return;
      }

      console.log(`[SharingSocket] Accepting item: ${sharingId}`);

      socketRef.current.emit('accept_clipboard_item', {
        sharingId
      }, (response: any) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      });

      // Fallback timeout
      setTimeout(() => {
        reject(new Error('Accept timeout'));
      }, 10000);
    });
  }, [isConnected]);

  // Reject received clipboard item
  const rejectClipboardItem = useCallback(async (sharingId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !isConnected) {
        reject(new Error('Socket not connected'));
        return;
      }

      console.log(`[SharingSocket] Rejecting item: ${sharingId}`);

      socketRef.current.emit('reject_clipboard_item', {
        sharingId
      }, (response: any) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      });

      // Fallback timeout
      setTimeout(() => {
        reject(new Error('Reject timeout'));
      }, 10000);
    });
  }, [isConnected]);

  // Manual disconnect
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setIsRegistered(false);
    }
  }, []);

  // Auto-register when userId changes
  useEffect(() => {
    if (userId && isConnected && !isRegistered) {
      registerUser(userId);
    }
  }, [userId, isConnected, isRegistered, registerUser]);

  return {
    socket: socketRef.current,
    isConnected,
    isRegistered,
    registerUser,
    sendClipboardItem,
    acceptClipboardItem,
    rejectClipboardItem,
    disconnect
  };
}

/**
 * Hook for receiving shared clipboard items
 */
export function useSharedItemsListener(
  socket: Socket | null,
  onItemReceived: (item: SharingItem) => void,
  onItemAccepted?: (sharingId: string) => void,
  onItemRejected?: (sharingId: string) => void
) {
  useEffect(() => {
    if (!socket) return;

    const handleItemReceived = (item: SharingItem) => {
      console.log('[SharingSocket] Item received:', item);
      onItemReceived(item);
    };

    const handleItemAccepted = (data: { sharingId: string }) => {
      console.log('[SharingSocket] Item accepted:', data.sharingId);
      onItemAccepted?.(data.sharingId);
    };

    const handleItemRejected = (data: { sharingId: string }) => {
      console.log('[SharingSocket] Item rejected:', data.sharingId);
      onItemRejected?.(data.sharingId);
    };

    socket.on('receive_clipboard_item', handleItemReceived);
    socket.on('clipboard_item_accepted', handleItemAccepted);
    socket.on('clipboard_item_rejected', handleItemRejected);

    return () => {
      socket.off('receive_clipboard_item', handleItemReceived);
      socket.off('clipboard_item_accepted', handleItemAccepted);
      socket.off('clipboard_item_rejected', handleItemRejected);
    };
  }, [socket, onItemReceived, onItemAccepted, onItemRejected]);
}
