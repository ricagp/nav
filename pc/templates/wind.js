(() => {
    const core = window.navCore;
    if (!core) {
        console.error('[wind.js] navCore is required before wind.js');
        return;
    }

    const hasTestSpeed = typeof window.testWindSpeed === 'number';
    const hasTestDir = typeof window.testWindDir === 'number';
    const hasTestWaypoints = Array.isArray(window.testWindWaypoints);
    const hasTestSamples = Array.isArray(window.testWindSamples);

    let windPendingTxId = null;
    let windCurrentHeading = hasTestDir ? (((Math.round(window.testWindDir) % 360) + 360) % 360) : 0;
    let windEspLat = typeof core.state.gps.lat === 'number' ? core.state.gps.lat : null;
    let windEspLon = typeof core.state.gps.lon === 'number' ? core.state.gps.lon : null;

    const windCourseMarks = hasTestWaypoints
        ? window.testWindWaypoints.map(m => ({ ...m }))
        : [];

    const windLocalSamples = hasTestSamples
        ? window.testWindSamples.map((s, idx) => ({
            ...s,
            _seq: idx + 1,
            confirmed: true
        }))
        : [];

    let windSeqCounter = windLocalSamples.length;

    windLocalSamples.forEach(s => {
        if (typeof s.txId === 'number') {
            core.setGlobalTxId(s.txId);
        }
    });

    let windPanX = 0;
    let windPanY = 0;
    let windZoom = 1;
    const WIND_MIN_ZOOM = 0.4;
    const WIND_MAX_ZOOM = 12;

    const windActivePointers = new Map();
    let windLastPanPoint = null;
    let windLastPinchDist = null;

    const spdInput = document.getElementById('wind-spd-input');
    const btnNoAnem = document.getElementById('wind-btn-no-anem');
    const compassDirDisplay = document.getElementById('wind-compass-dir');
    const btnFixWind = document.getElementById('wind-btn-fix');
    const compassHint = document.getElementById('wind-compass-hint');
    const espPosHint = document.getElementById('wind-esp-pos');
    const syncStatus = document.getElementById('wind-sync-status');
    const tableScroll = document.querySelector('.wind-table-scroll');
    const tbody = document.getElementById('wind-log-tbody');
    const localCountEl = document.getElementById('wind-local-count');
    const mapScaleLabel = document.getElementById('wind-map-scale');
    const canvas = document.getElementById('wind-map-canvas');
    const wsStateEl = document.getElementById('test-ws-state');

    if (spdInput) {
        spdInput.value = hasTestSpeed ? window.testWindSpeed : -1;
    }

    function windFormatUtcTime(dateObj = new Date()) {
        return dateObj.toISOString().slice(11, 19);
    }

    function windSetButtonPendingRed(text = 'Sending...') {
        if (!btnFixWind) return;
        btnFixWind.classList.remove('wind-confirmed');
        btnFixWind.classList.add('wind-pending');
        btnFixWind.style.backgroundColor = '#dc2626';
        btnFixWind.style.borderColor = '#b91c1c';
        btnFixWind.style.color = '#ffffff';
        btnFixWind.innerText = text;
    }

    function windSetButtonConfirmedGreen(text = 'Fix Wind Sample') {
        if (!btnFixWind) return;
        btnFixWind.classList.remove('wind-pending');
        btnFixWind.classList.add('wind-confirmed');
        btnFixWind.style.backgroundColor = '#16a34a';
        btnFixWind.style.borderColor = '#15803d';
        btnFixWind.style.color = '#ffffff';
        btnFixWind.innerText = text;
    }

    function windGetSamplesNewestFirst() {
        return [...windLocalSamples].sort((a, b) => {
            const utcA = a.utc || '00:00:00';
            const utcB = b.utc || '00:00:00';
            if (utcA !== utcB) {
                return utcB.localeCompare(utcA);
            }
            const txA = typeof a.txId === 'number' ? a.txId : 0;
            const txB = typeof b.txId === 'number' ? b.txId : 0;
            if (txA !== txB) {
                return txB - txA;
            }
            return (b._seq || 0) - (a._seq || 0);
        });
    }

    function windRefreshCompassDisplay() {
        if (!compassDirDisplay) return;
        compassDirDisplay.innerText = `${windCurrentHeading}°`;
    }

    function windClampZoom(z) {
        return Math.min(WIND_MAX_ZOOM, Math.max(WIND_MIN_ZOOM, z));
    }

    function windSetZoomAt(newZoom, clientX, clientY) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const px = (clientX !== undefined) ? (clientX - rect.left - cx) : 0;
        const py = (clientY !== undefined) ? (clientY - rect.top - cy) : 0;

        const prevZoom = windZoom;
        windZoom = windClampZoom(newZoom);
        const factor = windZoom / prevZoom;

        windPanX = px - (px - windPanX) * factor;
        windPanY = py - (py - windPanY) * factor;
        windDrawMap();
    }

    function windResetMapView() {
        windPanX = 0;
        windPanY = 0;
        windZoom = 1;
        windDrawMap();
    }

    function windUpdateEspPosition(lat, lon) {
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return;
        windEspLat = lat;
        windEspLon = lon;
        if (espPosHint) {
            espPosHint.innerText = `ESP32 GPS: ${windEspLat.toFixed(4)}, ${windEspLon.toFixed(4)}`;
        }
    }

    function windResolveFallbackCoords() {
        if (typeof windEspLat === 'number' && typeof windEspLon === 'number' && !isNaN(windEspLat) && !isNaN(windEspLon)) {
            return { lat: windEspLat, lon: windEspLon };
        }
        if (windLocalSamples.length > 0) {
            const last = windLocalSamples[windLocalSamples.length - 1];
            return { lat: last.lat, lon: last.lon };
        }
        if (windCourseMarks.length > 0) {
            return { lat: windCourseMarks[0].lat, lon: windCourseMarks[0].lon };
        }
        return { lat: null, lon: null };
    }

    function windAddOrUpdateSample(txId, lat, lon, dirDeg, spdVal, utcStr, confirmed = false) {
        const fallback = windResolveFallbackCoords();
        const sampleLat = (typeof lat === 'number' && !isNaN(lat)) ? lat : fallback.lat;
        const sampleLon = (typeof lon === 'number' && !isNaN(lon)) ? lon : fallback.lon;
        if (sampleLat === null || sampleLon === null) return;

        const existing = windLocalSamples.find(item => item.txId === txId);
        if (existing) {
            existing.lat = sampleLat;
            existing.lon = sampleLon;
            existing.dir = dirDeg;
            existing.spd = spdVal;
            if (utcStr) existing.utc = utcStr;
            if (confirmed) existing.confirmed = true;
        } else {
            windSeqCounter += 1;
            windLocalSamples.push({
                _seq: windSeqCounter,
                txId,
                lat: sampleLat,
                lon: sampleLon,
                dir: dirDeg,
                spd: spdVal,
                utc: utcStr || windFormatUtcTime(),
                confirmed
            });
        }

        windRenderTable(true);
        windDrawMap();
    }

    function windRenderTable(scrollToTop = false) {
        if (!tbody) return;
        tbody.innerHTML = '';

        const ordered = windGetSamplesNewestFirst();
        const total = ordered.length;

        ordered.forEach((rec, idx) => {
            const spdText = (rec.spd === -1) ? '-1' : `${rec.spd} kn`;
            const utcText = rec.utc || '--:--:--';
            const displayNum = total - idx;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${displayNum}</td>
                <td>${rec.txId}</td>
                <td>${rec.lat.toFixed(5)}°</td>
                <td>${rec.lon.toFixed(5)}°</td>
                <td>${rec.dir}°</td>
                <td>${spdText}</td>
                <td>${utcText}</td>
            `;
            tbody.appendChild(tr);
        });

        if (localCountEl) {
            localCountEl.innerText = `${windLocalSamples.length} samples`;
        }
        if (syncStatus) {
            syncStatus.innerText = `Last txId: ${core.state.lastGlobalTxId} | ESP ack: ${core.state.lastEspAckTxId} | Local samples: ${windLocalSamples.length}`;
        }
        if (scrollToTop && tableScroll) {
            tableScroll.scrollTop = 0;
        }
    }

    function windDrawMap() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        ctx.clearRect(0, 0, w, h);

        const styles = getComputedStyle(document.body);
        const textColor = styles.getPropertyValue('--text-color').trim() || '#0f172a';
        const mutedColor = styles.getPropertyValue('--text-muted').trim() || '#475569';
        const accentColor = styles.getPropertyValue('--accent').trim() || '#0284c7';
        const gridColor = styles.getPropertyValue('--grid-line').trim() || 'rgba(0,0,0,0.1)';
        const markColor = styles.getPropertyValue('--mark-color').trim() || '#d97706';

        if (mapScaleLabel) {
            mapScaleLabel.innerText = `${windZoom.toFixed(1)}x`;
        }

        const step = Math.max(20, 40 * windZoom);
        const ox = ((w / 2 + windPanX) % step + step) % step;
        const oy = ((h / 2 + windPanY) % step + step) % step;

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        for (let x = ox; x < w; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = oy; y < h; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        ctx.fillStyle = mutedColor;
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('N ↑', w - 28, 16);

        const refCoords = [
            ...windCourseMarks.map(m => ({ lat: m.lat, lon: m.lon })),
            ...windLocalSamples.map(s => ({ lat: s.lat, lon: s.lon }))
        ];
        if (windEspLat !== null && windEspLon !== null) {
            refCoords.push({ lat: windEspLat, lon: windEspLon });
        }
        if (refCoords.length === 0) return;

        const avgLat = refCoords.reduce((s, r) => s + r.lat, 0) / refCoords.length;
        const avgLon = refCoords.reduce((s, r) => s + r.lon, 0) / refCoords.length;
        const cosLat = Math.cos(avgLat * Math.PI / 180);
        const metersPerDegLat = 111320;
        const metersPerDegLon = 111320 * cosLat;

        const toMeters = (lat, lon) => ({
            mx: (lon - avgLon) * metersPerDegLon,
            my: (lat - avgLat) * metersPerDegLat
        });

        const pts = windLocalSamples.map((r, idx) => ({
            ...r,
            index: idx + 1,
            ...toMeters(r.lat, r.lon)
        }));
        const marksMeter = windCourseMarks.map(m => ({
            ...m,
            ...toMeters(m.lat, m.lon)
        }));

        const maxExtent = Math.max(
            100,
            ...pts.map(p => Math.abs(p.mx)),
            ...pts.map(p => Math.abs(p.my)),
            ...marksMeter.map(m => Math.abs(m.mx)),
            ...marksMeter.map(m => Math.abs(m.my))
        );

        const pad = 36;
        const usableHalf = Math.min(w, h) / 2 - pad;
        const scale = (usableHalf / maxExtent) * windZoom;

        const centerX = w / 2 + windPanX;
        const centerY = h / 2 + windPanY;

        marksMeter.forEach(m => {
            const mx = centerX + m.mx * scale;
            const my = centerY - m.my * scale;

            ctx.fillStyle = markColor;
            ctx.beginPath();
            ctx.moveTo(mx, my - 7);
            ctx.lineTo(mx + 7, my);
            ctx.lineTo(mx, my + 7);
            ctx.lineTo(mx - 7, my);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = textColor;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(m.name, mx + 10, my + 4);
        });

        if (pts.length > 1) {
            ctx.strokeStyle = mutedColor;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            pts.forEach((p, idx) => {
                const px = centerX + p.mx * scale;
                const py = centerY - p.my * scale;
                if (idx === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.stroke();
            ctx.setLineDash([]);
        }

        pts.forEach((p, idx) => {
            const px = centerX + p.mx * scale;
            const py = centerY - p.my * scale;
            const isLast = (idx === pts.length - 1);

            const rad = (p.dir * Math.PI) / 180;
            const arrowLen = 24;
            const ex = px + Math.sin(rad) * arrowLen;
            const ey = py - Math.cos(rad) * arrowLen;

            ctx.strokeStyle = isLast ? '#16a34a' : accentColor;
            ctx.fillStyle = isLast ? '#16a34a' : accentColor;
            ctx.lineWidth = 2.5;

            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(ex, ey);
            ctx.stroke();

            const headLen = 7;
            const angleToBoat = Math.atan2(py - ey, px - ex);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px - headLen * Math.cos(angleToBoat - Math.PI / 6), py - headLen * Math.sin(angleToBoat - Math.PI / 6));
            ctx.lineTo(px - headLen * Math.cos(angleToBoat + Math.PI / 6), py - headLen * Math.sin(angleToBoat + Math.PI / 6));
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.arc(px, py, isLast ? 5 : 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = textColor;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`#${p.index} (${p.dir}°)`, px + 7, py + 4);
        });
    }

    if (canvas) {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
            windSetZoomAt(windZoom * factor, e.clientX, e.clientY);
        }, { passive: false });

        canvas.addEventListener('pointerdown', (e) => {
            canvas.setPointerCapture(e.pointerId);
            windActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (windActivePointers.size === 1) {
                windLastPanPoint = { x: e.clientX, y: e.clientY };
                windLastPinchDist = null;
            } else if (windActivePointers.size === 2) {
                const pts = [...windActivePointers.values()];
                windLastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                windLastPanPoint = null;
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!windActivePointers.has(e.pointerId)) return;
            windActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (windActivePointers.size === 1 && windLastPanPoint) {
                windPanX += e.clientX - windLastPanPoint.x;
                windPanY += e.clientY - windLastPanPoint.y;
                windLastPanPoint = { x: e.clientX, y: e.clientY };
                windDrawMap();
            } else if (windActivePointers.size === 2) {
                const pts = [...windActivePointers.values()];
                const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                if (windLastPinchDist && windLastPinchDist > 0) {
                    const midX = (pts[0].x + pts[1].x) / 2;
                    const midY = (pts[0].y + pts[1].y) / 2;
                    windSetZoomAt(windZoom * (dist / windLastPinchDist), midX, midY);
                }
                windLastPinchDist = dist;
            }
        });

        function windReleasePointer(e) {
            windActivePointers.delete(e.pointerId);
            if (windActivePointers.size === 1) {
                const remaining = [...windActivePointers.values()][0];
                windLastPanPoint = { x: remaining.x, y: remaining.y };
                windLastPinchDist = null;
            } else if (windActivePointers.size === 0) {
                windLastPanPoint = null;
                windLastPinchDist = null;
            }
        }

        canvas.addEventListener('pointerup', windReleasePointer);
        canvas.addEventListener('pointercancel', windReleasePointer);
    }

    const zoomInBtn = document.getElementById('wind-zoom-in');
    const zoomOutBtn = document.getElementById('wind-zoom-out');
    const zoomResetBtn = document.getElementById('wind-zoom-reset');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => windSetZoomAt(windZoom * 1.25));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => windSetZoomAt(windZoom / 1.25));
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', windResetMapView);

    function windHandleConfirmed(info = {}) {
        const confirmedTxId = typeof info.espTxId === 'number' ? info.espTxId : info.txId;
        if (windPendingTxId !== null && confirmedTxId >= windPendingTxId) {
            windPendingTxId = null;
            windSetButtonConfirmedGreen('Fix Wind Sample');
        }
        if (typeof info.txId === 'number') {
            windAddOrUpdateSample(
                info.txId,
                info.lat,
                info.lon,
                info.dir,
                info.spd,
                windFormatUtcTime(),
                true
            );
        } else {
            windRenderTable(false);
        }
    }

    function windFixAndSend() {
        const rawSpd = spdInput ? parseInt(spdInput.value, 10) : -1;
        const normalizedSpd = (isNaN(rawSpd) || rawSpd < 0) ? -1 : rawSpd;
        if (spdInput) spdInput.value = normalizedSpd;

        const utcNow = windFormatUtcTime();
        const fallback = windResolveFallbackCoords();
        const sampleLat = typeof windEspLat === 'number' ? windEspLat : fallback.lat;
        const sampleLon = typeof windEspLon === 'number' ? windEspLon : fallback.lon;

        const pendingSample = {
            txId: null,
            lat: sampleLat,
            lon: sampleLon,
            dir: windCurrentHeading,
            spd: normalizedSpd,
            utc: utcNow
        };

        const result = core.sendWindConfig(windCurrentHeading, normalizedSpd, {
            onRetry: () => {
                windSetButtonPendingRed(`Retrying #${result.txId}...`);
                windRenderTable(false);
            },
            onConfirmed: (ackInfo) => {
                windHandleConfirmed({
                    ...ackInfo,
                    txId: result.txId,
                    lat: sampleLat,
                    lon: sampleLon,
                    dir: result.dir,
                    spd: result.spd
                });
            }
        });

        pendingSample.txId = result.txId;
        windPendingTxId = result.txId;
        windAddOrUpdateSample(
            result.txId,
            sampleLat,
            sampleLon,
            result.dir,
            result.spd,
            utcNow,
            false
        );

        if (core.state.lastEspAckTxId >= result.txId) {
            windHandleConfirmed({
                txId: result.txId,
                espTxId: core.state.lastEspAckTxId,
                lat: sampleLat,
                lon: sampleLon,
                dir: result.dir,
                spd: result.spd
            });
        } else {
            windSetButtonPendingRed(`Sending #${result.txId}...`);
        }
    }

    if (btnNoAnem && spdInput) {
        btnNoAnem.addEventListener('click', () => { spdInput.value = -1; });
    }
    if (btnFixWind) {
        btnFixWind.addEventListener('click', windFixAndSend);
    }
    window.addEventListener('resize', windDrawMap);

    function windHandleOrientation(event) {
        let heading = null;
        if (event.webkitCompassHeading !== undefined) heading = event.webkitCompassHeading;
        else if (event.alpha !== null) heading = 360 - event.alpha;
        if (heading !== null && !isNaN(heading)) {
            windCurrentHeading = Math.round(heading) % 360;
            if (windCurrentHeading < 0) windCurrentHeading += 360;
            if (compassHint) compassHint.innerText = `Live compass: ${windCurrentHeading}°`;
            windRefreshCompassDisplay();
        }
    }

    if (!window.isSecureContext) {
        if (compassHint) compassHint.innerText = 'Live compass: Insecure (HTTP)';
    } else if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', windHandleOrientation, true);
    } else if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', windHandleOrientation, true);
    }

    core.on('wsStatus', (status) => {
        if (wsStateEl && status && status.text) {
            wsStateEl.innerText = status.text;
        }
    });

    core.on('telemetry', (data) => {
        windUpdateEspPosition(data.lat, data.lon);
        windDrawMap();
    });

    core.on('ackUpdate', (ack) => {
        if (windPendingTxId !== null && ack.espTxId >= windPendingTxId) {
            windHandleConfirmed({
                espTxId: ack.espTxId,
                lat: ack.lat,
                lon: ack.lon,
                dir: ack.dir,
                spd: ack.spd
            });
        } else if (syncStatus) {
            windRenderTable(false);
        }
    });

    windRefreshCompassDisplay();
    windRenderTable(true);
    windDrawMap();
})();