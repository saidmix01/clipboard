/**
 * RealtimeClient — Subscribes to Supabase Realtime broadcast channel
 * to receive instant clipboard change notifications from other devices.
 * 
 * When a notification arrives, triggers SyncEngine.syncNow() to pull
 * the latest changes. This gives us sub-second sync between devices.
 * 
 * Falls back gracefully: if Supabase credentials are not configured or
 * the connection fails, the polling fallback in SyncEngine still works.
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

const db = require('../db');

export class RealtimeClient {
  private static instance: RealtimeClient;
  private supabase: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private userId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;

  private constructor() {}

  public static getInstance(): RealtimeClient {
    if (!RealtimeClient.instance) {
      RealtimeClient.instance = new RealtimeClient();
    }
    return RealtimeClient.instance;
  }

  /**
   * Start listening for realtime clipboard notifications.
   * Call this after the user logs in and we have their userId.
   */
  public connect(userId: string): void {
    let supabaseUrl: string;
    let supabaseAnonKey: string;

    try {
      const config = require('../config');
      supabaseUrl = config.SUPABASE_URL || process.env.SUPABASE_URL || '';
      supabaseAnonKey = config.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    } catch (e) {
      supabaseUrl = process.env.SUPABASE_URL || '';
      supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      console.log('[RealtimeClient] Supabase credentials not configured — realtime disabled');
      return;
    }

    // Disconnect previous subscription if userId changed
    if (this.userId && this.userId !== userId) {
      this.disconnect();
    }

    this.userId = userId;

    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        heartbeatIntervalMs: 25000,
      },
    });

    this.subscribeToChannel();
  }

  private subscribeToChannel(): void {
    if (!this.supabase || !this.userId) return;

    const channelTopic = `clipboard:${this.userId}`;

    console.log(`[RealtimeClient] Subscribing to channel: ${channelTopic}`);

    this.channel = this.supabase.channel(channelTopic);

    this.channel
      .on('broadcast', { event: 'clipboard:changed' }, (payload) => {
        console.log('[RealtimeClient] Received clipboard change notification:', payload.payload);
        this.onClipboardChanged(payload.payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[RealtimeClient] Connected and subscribed');
          this.isConnected = true;
          this.clearReconnectTimer();
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn(`[RealtimeClient] Channel status: ${status}`);
          this.isConnected = false;
          this.scheduleReconnect();
        }
      });
  }

  private onClipboardChanged(payload: any): void {
    // Trigger a sync to pull the new data from the backend
    try {
      const { SyncEngine } = require('./SyncEngine');
      const engine = SyncEngine.getInstance();

      // Only sync if not already running
      if (!engine.getStats().isRunning) {
        engine.syncNow().catch((err: any) => {
          console.error('[RealtimeClient] Sync triggered by realtime failed:', err.message);
        });
      }
    } catch (err: any) {
      console.error('[RealtimeClient] Failed to trigger sync:', err.message);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    // Reconnect after 5 seconds
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected && this.userId) {
        console.log('[RealtimeClient] Attempting reconnect...');
        this.cleanupChannel();
        this.subscribeToChannel();
      }
    }, 5000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupChannel(): void {
    if (this.channel && this.supabase) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  /**
   * Disconnect from realtime. Call on logout or app quit.
   */
  public disconnect(): void {
    this.clearReconnectTimer();
    this.cleanupChannel();

    if (this.supabase) {
      this.supabase.removeAllChannels();
      this.supabase = null;
    }

    this.userId = null;
    this.isConnected = false;
    console.log('[RealtimeClient] Disconnected');
  }

  public getStatus(): { connected: boolean; userId: string | null } {
    return {
      connected: this.isConnected,
      userId: this.userId,
    };
  }

  public destroy(): void {
    this.disconnect();
  }
}
