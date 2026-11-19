(() => {
    const MSG_TELEMETRY = 1;
    const MSG_WIND_CONFIG = 20;

    const state = {
        lastGlobalTxId: 0,
        lastEspAckTxId: 0,
        wsConnected: false,
        gps: {
            lat: null,
            lon: null
        },
        wind: {
            dir: null,
            spd: null
        }
    };

    const listeners = {
        wsStatus: [],
        telemetry: [],
        windUpdate: [],
        ackUpdate: []
    };

    let ws = null;
    let retryTimer = null;
    let activeSync = null; // { txId, fields, onRetry, onConfirmed }

    function on(eventName, callback) {
        if (!listeners[eventName]) {
            listeners[eventName] = [];
        }
        listeners[eventName].push(callback);
    }

    function emit(eventName, payload) {
        (listeners[eventName] || []).forEach(fn => {
            try {
                fn(payload);
            } catch (err) {
                console.error(`[core.js] Error in ${eventName} listener:`, err);
            }
        });
    }

    function setGlobalTxId(txId) {
        if (typeof txId === 'number' && !isNaN(txId) && txId > state.lastGlobalTxId) {
            state.lastGlobalTxId = txId;
        }
    }

    function getNextTxId() {
        return Math.max(state.lastGlobalTxId, state.lastEspAckTxId) + 1;
    }

    function sendInt32Packet(fields) {
        if (!Array.isArray(fields) || fields.length === 0) return false;
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;

        const buffer = new ArrayBuffer(fields.length * 4);
        const view = new DataView(buffer);

        fields.forEach((val, idx) => {
            view.setInt32(idx * 4, Number(val) | 0, true);
        });

        ws.send(buffer);
        return true;
    }

    function stopRetryLoop() {
        if (retryTimer !== null) {
            clearInterval(retryTimer);
            retryTimer = null;
        }
    }

    function checkEspAck(espTxId, payload = {}) {
        if (typeof espTxId !== 'number' || isNaN(espTxId)) return;

        if (espTxId > state.lastEspAckTxId) {
            state.lastEspAckTxId = espTxId;
        }
        setGlobalTxId(espTxId);

        emit('ackUpdate', {
            espTxId,
            lastEspAckTxId: state.lastEspAckTxId,
            ...payload
        });

        if (activeSync && espTxId >= activeSync.txId) {
            const syncRef = activeSync;
            activeSync = null;
            stopRetryLoop();
            if (typeof syncRef.onConfirmed === 'function') {
                syncRef.onConfirmed({
                    txId: syncRef.txId,
                    espTxId,
                    ...payload
                });
            }
        }
    }

    function startSyncWithRetry(txId, fields, callbacks = {}) {
        stopRetryLoop();
        activeSync = {
            txId,
            fields,
            onRetry: callbacks.onRetry || null,
            onConfirmed: callbacks.onConfirmed || null
        };

        const sentNow = sendInt32Packet(fields);

        retryTimer = setInterval(() => {
            if (!activeSync) {
                stopRetryLoop();
                return;
            }
            if (state.lastEspAckTxId >= activeSync.txId) {
                checkEspAck(state.lastEspAckTxId);
                return;
            }
            const res = sendInt32Packet(activeSync.fields);
            if (typeof activeSync.onRetry === 'function') {
                activeSync.onRetry({
                    txId: activeSync.txId,
                    sent: res,
                    espTxId: state.lastEspAckTxId
                });
            }
        }, 1000);

        return sentNow;
    }

    function sendWindConfig(dirDeg, spdVal, callbacks = {}) {
        const txId = getNextTxId();
        setGlobalTxId(txId);

        const normalizedDir = ((Math.round(Number(dirDeg) || 0) % 360) + 360) % 360;
        const normalizedSpd = (isNaN(Number(spdVal)) || Number(spdVal) < 0) ? -1 : Math.round(Number(spdVal));
        const fields = [MSG_WIND_CONFIG, txId, normalizedDir, normalizedSpd];

        const sent = startSyncWithRetry(txId, fields, callbacks);

        return {
            sent,
            txId,
            dir: normalizedDir,
            spd: normalizedSpd
        };
    }

    function handleBinaryMessage(arrayBuffer) {
        if (!(arrayBuffer instanceof ArrayBuffer)) return;
        const view = new DataView(arrayBuffer);
        if (view.byteLength < 8) return;

        const msgType = view.getInt32(0, true);
        const txId = view.getInt32(4, true);

        if (msgType === MSG_TELEMETRY && view.byteLength >= 36) {
            const lat = view.getInt32(20, true) / 1e7;
            const lon = view.getInt32(24, true) / 1e7;
            const wDir = view.getInt32(view.byteLength - 8, true);
            const wSpd = view.getInt32(view.byteLength - 4, true);

            state.gps.lat = lat;
            state.gps.lon = lon;
            state.wind.dir = wDir;
            state.wind.spd = wSpd;

            emit('telemetry', {
                txId,
                lat,
                lon,
                windDir: wDir,
                windSpd: wSpd
            });

            checkEspAck(txId, {
                lat,
                lon,
                dir: wDir,
                spd: wSpd
            });

            emit('windUpdate', {
                txId,
                lat,
                lon,
                dir: wDir,
                spd: wSpd
            });
        }
    }

    function connectWebSocket(url) {
        const targetUrl = url || (window.location.hostname ? `ws://${window.location.hostname}:81/` : null);
        if (!targetUrl) {
            state.wsConnected = false;
            emit('wsStatus', { connected: false, text: 'WS: Local file' });
            return;
        }

        try {
            ws = new WebSocket(targetUrl);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                state.wsConnected = true;
                emit('wsStatus', { connected: true, text: 'WS: Online' });
            };

            ws.onclose = () => {
                state.wsConnected = false;
                emit('wsStatus', { connected: false, text: 'WS: Offline' });
            };

            ws.onerror = () => {
                state.wsConnected = false;
                emit('wsStatus', { connected: false, text: 'WS: Error' });
            };

            ws.onmessage = (event) => {
                handleBinaryMessage(event.data);
            };
        } catch (_) {
            state.wsConnected = false;
            emit('wsStatus', { connected: false, text: 'WS: Unavailable' });
        }
    }

    window.navCore = {
        MSG_TELEMETRY,
        MSG_WIND_CONFIG,
        state,
        on,
        emit,
        setGlobalTxId,
        getNextTxId,
        sendInt32Packet,
        startSyncWithRetry,
        stopRetryLoop,
        checkEspAck,
        sendWindConfig,
        connectWebSocket
    };

    connectWebSocket();
})();