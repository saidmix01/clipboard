"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeClient = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const db = require('../db');
class RealtimeClient {
    constructor() {
        this.supabase = null;
        this.channel = null;
        this.userId = null;
        this.reconnectTimer = null;
        this.isConnected = false;
    }
    static getInstance() {
        if (!RealtimeClient.instance) {
            RealtimeClient.instance = new RealtimeClient();
        }
        return RealtimeClient.instance;
    }
    /**
     * Start listening for realtime clipboard notifications.
     * Call this after the user logs in and we have their userId.
     */
    connect(userId) {
        let supabaseUrl;
        let supabaseAnonKey;
        try {
            const config = require('../config');
            supabaseUrl = config.SUPABASE_URL || process.env.SUPABASE_URL || '';
            supabaseAnonKey = config.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
        }
        catch (e) {
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
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseAnonKey, {
            realtime: {
                heartbeatIntervalMs: 25000,
            },
        });
        this.subscribeToChannel();
    }
    subscribeToChannel() {
        if (!this.supabase || !this.userId)
            return;
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
            }
            else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                console.warn(`[RealtimeClient] Channel status: ${status}`);
                this.isConnected = false;
                this.scheduleReconnect();
            }
        });
    }
    onClipboardChanged(payload) {
        // Trigger a sync to pull the new data from the backend
        try {
            const { SyncEngine } = require('./SyncEngine');
            const engine = SyncEngine.getInstance();
            // Only sync if not already running
            if (!engine.getStats().isRunning) {
                engine.syncNow().catch((err) => {
                    console.error('[RealtimeClient] Sync triggered by realtime failed:', err.message);
                });
            }
        }
        catch (err) {
            console.error('[RealtimeClient] Failed to trigger sync:', err.message);
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
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
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    cleanupChannel() {
        if (this.channel && this.supabase) {
            this.supabase.removeChannel(this.channel);
            this.channel = null;
        }
    }
    /**
     * Disconnect from realtime. Call on logout or app quit.
     */
    disconnect() {
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
    getStatus() {
        return {
            connected: this.isConnected,
            userId: this.userId,
        };
    }
    destroy() {
        this.disconnect();
    }
}
exports.RealtimeClient = RealtimeClient;
