(() => {
    const core = window.navCore;
    if (!core) {
        console.error('[nav.js] navCore is required before nav.js');
        return;
    }

    const hasTestHeading = typeof window.testNavHeading === 'number';
    const hasTestSog = typeof window.testNavSog === 'number';
    const hasTestWindDir = typeof window.testNavWindDir === 'number'
        ? true
        : typeof window.testWindDir === 'number';
    const hasTestWindSpd = typeof window.testNavWindSpd === 'number'
        ? true
        : typeof window.testWindSpeed === 'number';
    const hasTestWaypoints = Array.isArray(window.testNavWaypoints)
        ? true
        : Array.isArray(window.testWindWaypoints);

    const rawWaypoints = Array.isArray(window.testNavWaypoints)
        ? window.testNavWaypoints
        : (Array.isArray(window.testWindWaypoints) ? window.testWindWaypoints : []);

    let navHeading = hasTestHeading ? navNormalizeDeg(window.testNavHeading) : null;
    let navSog = hasTestSog ? window.testNavSog : null;
    let navWindDir = typeof window.testNavWindDir === 'number'
        ? navNormalizeDeg(window.testNavWindDir)
        : (typeof window.testWindDir === 'number' ? navNormalizeDeg(window.testWindDir) : core.state.wind.dir);
    let navWindSpd = typeof window.testNavWindSpd === 'number'
        ? window.testNavWindSpd
        : (typeof window.testWindSpeed === 'number' ? window.testWindSpeed : core.state.wind.spd);

    let navLat = typeof core.state.gps.lat === 'number' ? core.state.gps.lat : null;
    let navLon = typeof core.state.gps.lon === 'number' ? core.state.gps.lon : null;

    const navWaypoints = rawWaypoints.map((m, idx) => ({
        id: m.id ?? idx + 1,
        name: m.name || `MK${idx + 1}`,
        lat: Number(m.lat),
        lon: Number(m.lon)
    })).filter(m => !isNaN(m.lat) && !isNaN(m.lon));

    let navActiveMarkIdx = navWaypoints.length > 0 ? 0 : -1;
    let navFollowBoat = true;

    let navPanX = 0;
    let navPanY = 0;
    let navZoom = 1;
    const NAV_MIN_ZOOM = 0.4;
    const NAV_MAX_ZOOM = 15;

    const navActivePointers = new Map();
    let navLastPanPoint = null;
    let navLastPinchDist = null;

    const elHeading = document.getElementById('nav-heading');
    const elSog = document.getElementById('nav-sog');
    const elWind = document.getElementById('nav-wind');
    const elGps = document.getElementById('nav-gps');
    const elTargetSummary = document.getElementById('nav-target-summary');
    const elMarksList = document.getElementById('nav-marks-list');
    const elScaleLabel = document.getElementById('nav-map-scale');
    const canvas = document.getElementById('nav-map-canvas');
    const wsStateEl = document.getElementById('test-ws-state');

    function navNormalizeDeg(deg) {
        const n = Number(deg);
        if (isNaN(n)) return 0;
        return ((Math.round(n) % 360) + 360) % 360;
    }

    function navDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function navBearingDeg(lat1, lon1, lat2, lon2) {
        const toRad = d => d * Math.PI / 180;
        const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
        return navNormalizeDeg(Math.atan2(y, x) * 180 / Math.PI);
    }

    function navGetReferencePosition() {
        if (typeof navLat === 'number' && typeof navLon === 'number' && !isNaN(navLat) && !isNaN(navLon)) {
            return { lat: navLat, lon: navLon };
        }
        if (navWaypoints.length > 0) {
            return { lat: navWaypoints[0].lat, lon: navWaypoints[0].lon };
        }
        return null;
    }

    function navClampZoom(z) {
        return Math.min(NAV_MAX_ZOOM, Math.max(NAV_MIN_ZOOM, z));
    }

    function navSetZoomAt(newZoom, clientX, clientY) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const px = (clientX !== undefined) ? (clientX - rect.left - cx) : 0;
        const py = (clientY !== undefined) ? (clientY - rect.top - cy) : 0;

        const prevZoom = navZoom;
        navZoom = navClampZoom(newZoom);
        const factor = navZoom / prevZoom;

        navPanX = px - (px - navPanX) * factor;
        navPanY = py - (py - navPanY) * factor;
        navDrawMap();
    }

    function navResetMapView() {
        navPanX = 0;
        navPanY = 0;
        navZoom = 1;
        navDrawMap();
    }

    function navSelectWaypoint(index) {
        if (index < 0 || index >= navWaypoints.length) return;
        navActiveMarkIdx = index;
        navRenderWaypoints();
        navUpdateReadouts();
        navDrawMap();
    }

    function navUpdateReadouts() {
        if (elHeading) {
            elHeading.innerText = typeof navHeading === 'number' ? `${navHeading}°` : '---°';
        }
        if (elSog) {
            elSog.innerText = typeof navSog === 'number' ? `${navSog.toFixed(1)} kn` : '--.- kn';
        }
        if (elWind) {
            const dirTxt = typeof navWindDir === 'number' ? `${navWindDir}°` : '---°';
            const spdTxt = (typeof navWindSpd === 'number' && navWindSpd >= 0) ? `${navWindSpd} kn` : 'N/A';
            elWind.innerText = `${dirTxt} / ${spdTxt}`;
        }
        if (elGps) {
            elGps.innerText = (typeof navLat === 'number' && typeof navLon === 'number')
                ? `GPS: ${navLat.toFixed(5)}, ${navLon.toFixed(5)}`
                : 'GPS: --.-----, --.-----';
        }
        if (elTargetSummary) {
            const target = navWaypoints[navActiveMarkIdx];
            const pos = navGetReferencePosition();
            if (!target) {
                elTargetSummary.innerText = 'Target: None';
            } else if (!pos) {
                elTargetSummary.innerText = `Target: ${target.name}`;
            } else {
                const distMeters = navDistanceMeters(pos.lat, pos.lon, target.lat, target.lon);
                const distNm = distMeters / 1852;
                const btw = navBearingDeg(pos.lat, pos.lon, target.lat, target.lon);
                const distLabel = distMeters < 1000
                    ? `${Math.round(distMeters)} m (${distNm.toFixed(2)} NM)`
                    : `${distNm.toFixed(2)} NM`;
                elTargetSummary.innerText = `Target ${target.name}: BTW ${btw}° · ${distLabel}`;
            }
        }
    }

    function navRenderWaypoints() {
        if (!elMarksList) return;
        elMarksList.innerHTML = '';

        if (navWaypoints.length === 0) {
            elMarksList.innerHTML = '<div class="nav-unit">No waypoints loaded</div>';
            return;
        }

        const pos = navGetReferencePosition();

        navWaypoints.forEach((wp, idx) => {
            const row = document.createElement('div');
            row.className = `nav-mark-row${idx === navActiveMarkIdx ? ' is-target' : ''}`;

            let metricText = `${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}`;
            if (pos) {
                const dNm = navDistanceMeters(pos.lat, pos.lon, wp.lat, wp.lon) / 1852;
                const brg = navBearingDeg(pos.lat, pos.lon, wp.lat, wp.lon);
                metricText = `${brg}° · ${dNm.toFixed(2)} NM`;
            }

            const info = document.createElement('span');
            info.innerText = `${wp.name} (${metricText})`;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `nav-btn${idx === navActiveMarkIdx ? ' active' : ''}`;
            btn.innerText = idx === navActiveMarkIdx ? 'Target' : 'Select';
            btn.addEventListener('click', () => navSelectWaypoint(idx));

            row.appendChild(info);
            row.appendChild(btn);
            elMarksList.appendChild(row);
        });
    }

    function navDrawMap() {
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

        if (elScaleLabel) {
            elScaleLabel.innerText = `${navZoom.toFixed(1)}x`;
        }

        const step = Math.max(20, 40 * navZoom);
        const ox = ((w / 2 + navPanX) % step + step) % step;
        const oy = ((h / 2 + navPanY) % step + step) % step;

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

        const refCoords = [...navWaypoints.map(m => ({ lat: m.lat, lon: m.lon }))];
        if (typeof navLat === 'number' && typeof navLon === 'number') {
            refCoords.push({ lat: navLat, lon: navLon });
        }
        if (refCoords.length === 0) return;

        const avgLat = refCoords.reduce((s, r) => s + r.lat, 0) / refCoords.length;
        const avgLon = refCoords.reduce((s, r) => s + r.lon, 0) / refCoords.length;
        const metersPerDegLat = 111320;
        const metersPerDegLon = 111320 * Math.cos(avgLat * Math.PI / 180);

        const toMeters = (lat, lon) => ({
            mx: (lon - avgLon) * metersPerDegLon,
            my: (lat - avgLat) * metersPerDegLat
        });

        const marksMeter = navWaypoints.map((m, idx) => ({
            ...m,
            idx,
            ...toMeters(m.lat, m.lon)
        }));

        const boatMeter = (typeof navLat === 'number' && typeof navLon === 'number')
            ? toMeters(navLat, navLon)
            : null;

        const maxExtent = Math.max(
            120,
            ...marksMeter.map(m => Math.abs(m.mx)),
            ...marksMeter.map(m => Math.abs(m.my)),
            boatMeter ? Math.abs(boatMeter.mx) : 0,
            boatMeter ? Math.abs(boatMeter.my) : 0
        );

        const pad = 38;
        const usableHalf = Math.min(w, h) / 2 - pad;
        const scale = (usableHalf / maxExtent) * navZoom;

        const centerX = w / 2 + navPanX;
        const centerY = h / 2 + navPanY;

        if (marksMeter.length > 1) {
            ctx.strokeStyle = mutedColor;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            marksMeter.forEach((m, idx) => {
                const px = centerX + m.mx * scale;
                const py = centerY - m.my * scale;
                if (idx === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.stroke();
            ctx.setLineDash([]);
        }

        marksMeter.forEach((m) => {
            const px = centerX + m.mx * scale;
            const py = centerY - m.my * scale;
            const isTarget = m.idx === navActiveMarkIdx;

            ctx.fillStyle = isTarget ? '#16a34a' : markColor;
            ctx.beginPath();
            ctx.moveTo(px, py - 8);
            ctx.lineTo(px + 8, py);
            ctx.lineTo(px, py + 8);
            ctx.lineTo(px - 8, py);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = textColor;
            ctx.font = isTarget ? 'bold 12px sans-serif' : 'bold 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(isTarget ? `▶ ${m.name}` : m.name, px + 11, py + 4);
        });

        if (boatMeter) {
            const bx = centerX + boatMeter.mx * scale;
            const by = centerY - boatMeter.my * scale;

            const target = marksMeter[navActiveMarkIdx];
            if (target) {
                const tx = centerX + target.mx * scale;
                const ty = centerY - target.my * scale;
                ctx.strokeStyle = '#16a34a';
                ctx.setLineDash([6, 4]);
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(tx, ty);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            if (typeof navHeading === 'number') {
                const rad = (navHeading * Math.PI) / 180;
                const len = 26;
                const hx = bx + Math.sin(rad) * len;
                const hy = by - Math.cos(rad) * len;

                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(hx, hy);
                ctx.stroke();
            }

            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.arc(bx, by, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = textColor;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('BOAT', bx + 9, by - 4);
        }
    }

    if (canvas) {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
            navSetZoomAt(navZoom * factor, e.clientX, e.clientY);
        }, { passive: false });

        canvas.addEventListener('pointerdown', (e) => {
            canvas.setPointerCapture(e.pointerId);
            navActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (navActivePointers.size === 1) {
                navLastPanPoint = { x: e.clientX, y: e.clientY };
                navLastPinchDist = null;
            } else if (navActivePointers.size === 2) {
                const pts = [...navActivePointers.values()];
                navLastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                navLastPanPoint = null;
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!navActivePointers.has(e.pointerId)) return;
            navActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (navActivePointers.size === 1 && navLastPanPoint) {
                navPanX += e.clientX - navLastPanPoint.x;
                navPanY += e.clientY - navLastPanPoint.y;
                navLastPanPoint = { x: e.clientX, y: e.clientY };
                navDrawMap();
            } else if (navActivePointers.size === 2) {
                const pts = [...navActivePointers.values()];
                const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                if (navLastPinchDist && navLastPinchDist > 0) {
                    const midX = (pts[0].x + pts[1].x) / 2;
                    const midY = (pts[0].y + pts[1].y) / 2;
                    navSetZoomAt(navZoom * (dist / navLastPinchDist), midX, midY);
                }
                navLastPinchDist = dist;
            }
        });

        function navReleasePointer(e) {
            navActivePointers.delete(e.pointerId);
            if (navActivePointers.size === 1) {
                const remaining = [...navActivePointers.values()][0];
                navLastPanPoint = { x: remaining.x, y: remaining.y };
                navLastPinchDist = null;
            } else if (navActivePointers.size === 0) {
                navLastPanPoint = null;
                navLastPinchDist = null;
            }
        }

        canvas.addEventListener('pointerup', navReleasePointer);
        canvas.addEventListener('pointercancel', navReleasePointer);
    }

    const zoomInBtn = document.getElementById('nav-zoom-in');
    const zoomOutBtn = document.getElementById('nav-zoom-out');
    const zoomResetBtn = document.getElementById('nav-zoom-reset');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => navSetZoomAt(navZoom * 1.25));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => navSetZoomAt(navZoom / 1.25));
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', navResetMapView);

    window.addEventListener('resize', navDrawMap);

    core.on('wsStatus', (status) => {
        if (wsStateEl && status && status.text) {
            wsStateEl.innerText = status.text;
        }
    });

    core.on('telemetry', (data) => {
        if (typeof data.lat === 'number') navLat = data.lat;
        if (typeof data.lon === 'number') navLon = data.lon;
        if (typeof data.windDir === 'number') navWindDir = navNormalizeDeg(data.windDir);
        if (typeof data.windSpd === 'number') navWindSpd = data.windSpd;
        navUpdateReadouts();
        navRenderWaypoints();
        navDrawMap();
    });

    core.on('windUpdate', (upd) => {
        if (typeof upd.dir === 'number') navWindDir = navNormalizeDeg(upd.dir);
        if (typeof upd.spd === 'number') navWindSpd = upd.spd;
        navUpdateReadouts();
        navDrawMap();
    });

    navUpdateReadouts();
    navRenderWaypoints();
    navDrawMap();
})();