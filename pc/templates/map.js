// Lógica de la vista especializada de mapa (map.html / map.js)

(function () {
    const EARTH_RADIUS_M = 6371000;
    const METERS_PER_NM = 1852;
    const DEFAULT_VIEW_RADIUS_NM = 1.0;
    const DEG_TO_RAD = Math.PI / 180;
    const RAD_TO_DEG = 180 / Math.PI;
    const HIT_RADIUS_PX = 18;
    const RING_STEPS_NM = [0.05, 0.1, 0.25, 0.5, 1, 2, 5];
    const GRID_STEPS_ARCMIN = [0.1, 0.25, 0.5, 1, 2, 5];

    const state = {
        zoom: 1.0,
        minZoom: 0.05,
        maxZoom: 20.0,
        panX: 0,
        panY: 0,
        dragging: false,
        pointerMoved: false,
        lastPointerX: 0,
        lastPointerY: 0,
        hoverX: null,
        hoverY: null,
        layers: {
            samples: true,
            waypoints: true,
            boat: true
        },
        boat: {
            lat: null,
            lon: null,
            heading: 0,
            sog: 0
        },
        wind: {
            dir: 0,
            spd: -1
        },
        waypoints: [],
        samples: []
    };

    const els = {
        canvas: document.getElementById('map-canvas'),
        zoomLabel: document.getElementById('map-zoom-label'),
        zoomIn: document.getElementById('map-zoom-in'),
        zoomOut: document.getElementById('map-zoom-out'),
        zoomReset: document.getElementById('map-zoom-reset'),
        toggleSamples: document.getElementById('map-toggle-samples'),
        toggleWaypoints: document.getElementById('map-toggle-waypoints'),
        toggleBoat: document.getElementById('map-toggle-boat')
    };

    if (!els.canvas) return;
    const ctx = els.canvas.getContext('2d');

    function isFiniteNum(v) {
        return typeof v === 'number' && Number.isFinite(v);
    }

    function normalizeAngle(deg) {
        if (!isFiniteNum(deg)) return 0;
        return ((deg % 360) + 360) % 360;
    }

    // Formatea coordenada en grados, minutos y décimas de minuto (DD°MM.m' N/S/E/W)
    function formatDmm(val, isLat) {
        if (!isFiniteNum(val)) return '—';
        const hemi = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
        const absVal = Math.abs(val);
        let deg = Math.floor(absVal);
        let minutes = (absVal - deg) * 60;
        let minStr = minutes.toFixed(1);

        if (parseFloat(minStr) >= 60) {
            deg += 1;
            minStr = '0.0';
        }

        const degWidth = isLat ? 2 : 3;
        const degPad = String(deg).padStart(degWidth, '0');
        const [mInt, mDec] = minStr.split('.');
        const minPad = `${mInt.padStart(2, '0')}.${mDec}`;
        return `${degPad}°${minPad}'${hemi}`;
    }

    function formatLatLonDmm(lat, lon) {
        return `${formatDmm(lat, true)}, ${formatDmm(lon, false)}`;
    }

    // Distancia en metros (Haversine) y marcación verdadera (0..359°) desde punto 1 a punto 2
    function computeBearingAndDistance(lat1, lon1, lat2, lon2) {
        if (!isFiniteNum(lat1) || !isFiniteNum(lon1) || !isFiniteNum(lat2) || !isFiniteNum(lon2)) {
            return null;
        }

        const phi1 = lat1 * DEG_TO_RAD;
        const phi2 = lat2 * DEG_TO_RAD;
        const dPhi = (lat2 - lat1) * DEG_TO_RAD;
        const dLambda = (lon2 - lon1) * DEG_TO_RAD;

        const sinDPhi = Math.sin(dPhi * 0.5);
        const sinDLambda = Math.sin(dLambda * 0.5);
        const a = sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
        const distanceM = EARTH_RADIUS_M * c;

        const y = Math.sin(dLambda) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
        const bearingDeg = normalizeAngle(Math.atan2(y, x) * RAD_TO_DEG);

        return {
            bearingDeg,
            distanceNm: distanceM / METERS_PER_NM,
            distanceKm: distanceM / 1000
        };
    }

    // Conversión local en metros respecto a un punto de referencia (lat0, lon0)
    function latLonToMeters(lat, lon, lat0, lon0) {
        const dLat = (lat - lat0) * DEG_TO_RAD;
        const dLon = (lon - lon0) * DEG_TO_RAD;
        const meanLat = ((lat + lat0) * 0.5) * DEG_TO_RAD;
        const x = dLon * EARTH_RADIUS_M * Math.cos(meanLat);
        const y = dLat * EARTH_RADIUS_M;
        return { x, y };
    }

    function getReferenceOrigin() {
        if (isFiniteNum(state.boat.lat) && isFiniteNum(state.boat.lon)) {
            return { lat: state.boat.lat, lon: state.boat.lon };
        }
        for (const wp of state.waypoints) {
            if (isFiniteNum(wp.lat) && isFiniteNum(wp.lon)) {
                return { lat: wp.lat, lon: wp.lon };
            }
        }
        for (const s of state.samples) {
            if (isFiniteNum(s.lat) && isFiniteNum(s.lon)) {
                return { lat: s.lat, lon: s.lon };
            }
        }
        return { lat: 36.7142, lon: -4.4158 };
    }

    // Escala base al 1.0x: muestra 1 NM de radio a la redonda del barco
    function computeBaseScale(width, height) {
        const halfMinSide = Math.max(80, Math.min(width, height) * 0.5 - 24);
        const defaultRadiusMeters = DEFAULT_VIEW_RADIUS_NM * METERS_PER_NM;
        return halfMinSide / defaultRadiusMeters;
    }

    function worldToScreen(wx, wy, centerX, centerY, totalScale) {
        return {
            x: centerX + state.panX + wx * totalScale,
            y: centerY + state.panY - wy * totalScale // +Y es Norte hacia arriba
        };
    }

    function screenToWorld(sx, sy, centerX, centerY, totalScale) {
        return {
            wx: (sx - centerX - state.panX) / totalScale,
            wy: (centerY + state.panY - sy) / totalScale
        };
    }

    function resizeCanvas() {
        const rect = els.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));

        if (els.canvas.width !== w * dpr || els.canvas.height !== h * dpr) {
            els.canvas.width = w * dpr;
            els.canvas.height = h * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        render();
    }

    function setZoom(nextZoom, anchorX, anchorY) {
        const clamped = Math.max(state.minZoom, Math.min(state.maxZoom, nextZoom));
        if (clamped === state.zoom) return;

        const rect = els.canvas.getBoundingClientRect();
        const cx = rect.width * 0.5;
        const cy = rect.height * 0.5;
        const ax = isFiniteNum(anchorX) ? anchorX : cx;
        const ay = isFiniteNum(anchorY) ? anchorY : cy;

        const ratio = clamped / state.zoom;
        state.panX = (ax - cx) - ratio * ((ax - cx) - state.panX);
        state.panY = (ay - cy) - ratio * ((ay - cy) - state.panY);
        state.zoom = clamped;

        updateZoomLabel();
        render();
    }

    function resetView() {
        state.zoom = 1.0;
        state.panX = 0;
        state.panY = 0;
        state.hoverX = null;
        state.hoverY = null;
        updateZoomLabel();
        render();
    }

    function updateZoomLabel() {
        if (els.zoomLabel) {
            const label = state.zoom < 0.1 ? state.zoom.toFixed(2) : state.zoom.toFixed(1);
            els.zoomLabel.textContent = `${label}x`;
        }
    }

    function updateLayerButtons() {
        const pairs = [
            [els.toggleSamples, state.layers.samples],
            [els.toggleWaypoints, state.layers.waypoints],
            [els.toggleBoat, state.layers.boat]
        ];
        for (const [btn, active] of pairs) {
            if (!btn) continue;
            btn.classList.toggle('is-active', Boolean(active));
            btn.setAttribute('aria-pressed', String(Boolean(active)));
        }
    }

    function toggleLayer(key) {
        if (!(key in state.layers)) return;
        state.layers[key] = !state.layers[key];
        updateLayerButtons();
        render();
    }

    function getWindColor(spd) {
        if (!isFiniteNum(spd) || spd < 0) return '#64748b';
        if (spd < 8) return '#0284c7';
        if (spd < 14) return '#16a34a';
        if (spd < 20) return '#d97706';
        return '#dc2626';
    }

    function getWaypointColor(wp) {
        switch (wp.id) {
            case 0:
            case 5:
                return '#475569';
            case 1:
            case 2:
                return '#0f766e';
            case 3:
            case 4:
                return '#d97706';
            default:
                return '#2563eb';
        }
    }

    function drawWaypointSymbol(symbol, x, y, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2.2;

        switch (symbol) {
            case 'square': {
                const s = 11;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
                ctx.strokeRect(x - s * 0.5, y - s * 0.5, s, s);
                break;
            }
            case 'boat': {
                ctx.beginPath();
                ctx.moveTo(x, y - 9);
                ctx.lineTo(x + 8, y + 5);
                ctx.lineTo(x - 8, y + 5);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(x, y - 9);
                ctx.lineTo(x, y - 14);
                ctx.stroke();
                break;
            }
            case 'flag': {
                ctx.beginPath();
                ctx.moveTo(x - 4, y + 8);
                ctx.lineTo(x - 4, y - 10);
                ctx.lineTo(x + 8, y - 5);
                ctx.lineTo(x - 4, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x - 4, y + 8, 3, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'ring': {
                ctx.beginPath();
                ctx.arc(x, y, 7.5, 0, Math.PI * 2);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'cross': {
                const r = 6.5;
                ctx.beginPath();
                ctx.moveTo(x - r, y);
                ctx.lineTo(x + r, y);
                ctx.moveTo(x, y - r);
                ctx.lineTo(x, y + r);
                ctx.stroke();
                break;
            }
            case 'circle':
            default: {
                ctx.beginPath();
                ctx.arc(x, y, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                break;
            }
        }
        ctx.restore();
    }

    function pickStepForPx(metersPerStep, totalScale, targetPx) {
        const px = metersPerStep * totalScale;
        return px >= targetPx;
    }

    // 1. Cuadrícula geográfica (Lat/Lon) en minutos y décimas de minuto (1' = 1 NM)
    function drawGeographicGrid(width, height, centerX, centerY, totalScale, origin) {
        const meanLatRad = origin.lat * DEG_TO_RAD;
        const metersPerArcMinLat = METERS_PER_NM;

        let chosenMin = GRID_STEPS_ARCMIN[GRID_STEPS_ARCMIN.length - 1];
        for (const stepMin of GRID_STEPS_ARCMIN) {
            if (pickStepForPx(stepMin * metersPerArcMinLat, totalScale, 65)) {
                chosenMin = stepMin;
                break;
            }
        }

        const stepDeg = chosenMin / 60;
        const topLeft = screenToWorld(0, 0, centerX, centerY, totalScale);
        const botRight = screenToWorld(width, height, centerX, centerY, totalScale);

        const latMax = origin.lat + topLeft.wy / EARTH_RADIUS_M * RAD_TO_DEG;
        const latMin = origin.lat + botRight.wy / EARTH_RADIUS_M * RAD_TO_DEG;
        const lonMin = origin.lon + (topLeft.wx / (EARTH_RADIUS_M * Math.cos(meanLatRad))) * RAD_TO_DEG;
        const lonMax = origin.lon + (botRight.wx / (EARTH_RADIUS_M * Math.cos(meanLatRad))) * RAD_TO_DEG;

        ctx.save();
        ctx.strokeStyle = 'rgba(124, 58, 237, 0.24)';
        ctx.fillStyle = 'rgba(109, 40, 217, 0.78)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.font = '600 10.5px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        const startLatIdx = Math.floor(Math.min(latMin, latMax) / stepDeg);
        const endLatIdx = Math.ceil(Math.max(latMin, latMax) / stepDeg);
        for (let idx = startLatIdx; idx <= endLatIdx; idx++) {
            const latVal = idx * stepDeg;
            const m = latLonToMeters(latVal, origin.lon, origin.lat, origin.lon);
            const pt = worldToScreen(m.x, m.y, centerX, centerY, totalScale);
            if (pt.y < 14 || pt.y > height - 6) continue;

            ctx.beginPath();
            ctx.moveTo(0, pt.y);
            ctx.lineTo(width, pt.y);
            ctx.stroke();

            ctx.fillText(formatDmm(latVal, true), 8, pt.y - 3);
        }

        const startLonIdx = Math.floor(Math.min(lonMin, lonMax) / stepDeg);
        const endLonIdx = Math.ceil(Math.max(lonMin, lonMax) / stepDeg);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let idx = startLonIdx; idx <= endLonIdx; idx++) {
            const lonVal = idx * stepDeg;
            const m = latLonToMeters(origin.lat, lonVal, origin.lat, origin.lon);
            const pt = worldToScreen(m.x, m.y, centerX, centerY, totalScale);
            if (pt.x < 36 || pt.x > width - 36) continue;

            ctx.beginPath();
            ctx.moveTo(pt.x, 0);
            ctx.lineTo(pt.x, height);
            ctx.stroke();

            ctx.fillText(formatDmm(lonVal, false), pt.x, 8);
        }

        ctx.restore();
    }

    // 2. Círculos equidistantes en millas náuticas (NM) centrados en el barco
    function drawBoatRangeRings(width, height, centerX, centerY, totalScale, origin) {
        if (!state.layers.boat) return;
        if (!isFiniteNum(state.boat.lat) || !isFiniteNum(state.boat.lon)) return;

        let ringStepNm = RING_STEPS_NM[RING_STEPS_NM.length - 1];
        for (const stepNm of RING_STEPS_NM) {
            if (pickStepForPx(stepNm * METERS_PER_NM, totalScale, 55)) {
                ringStepNm = stepNm;
                break;
            }
        }

        const boatM = latLonToMeters(state.boat.lat, state.boat.lon, origin.lat, origin.lon);
        const boatPt = worldToScreen(boatM.x, boatM.y, centerX, centerY, totalScale);
        const maxDiag = Math.hypot(width, height);
        const stepPx = ringStepNm * METERS_PER_NM * totalScale;

        if (stepPx <= 8) return;

        const maxRings = Math.min(12, Math.ceil((maxDiag + Math.hypot(boatPt.x - centerX, boatPt.y - centerY)) / stepPx));

        ctx.save();
        ctx.strokeStyle = 'rgba(2, 132, 199, 0.34)';
        ctx.fillStyle = 'rgba(3, 105, 161, 0.85)';
        ctx.lineWidth = 1.1;
        ctx.font = '600 10.5px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        for (let i = 1; i <= maxRings; i++) {
            const rPx = i * stepPx;
            const distNm = +(i * ringStepNm).toFixed(2);

            ctx.beginPath();
            ctx.arc(boatPt.x, boatPt.y, rPx, 0, Math.PI * 2);
            ctx.stroke();

            const labelX = boatPt.x + rPx * Math.cos(-Math.PI * 0.25);
            const labelY = boatPt.y + rPx * Math.sin(-Math.PI * 0.25);
            if (labelX > 6 && labelX < width - 52 && labelY > 14 && labelY < height - 6) {
                ctx.fillText(`${distNm} NM`, labelX + 4, labelY - 2);
            }
        }

        ctx.restore();
    }

    function drawNorthIndicator(width) {
        ctx.save();
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-color').trim() || '#0f172a';
        ctx.font = '700 13px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('N ↑', width - 14, 24);
        ctx.restore();
    }

    function findHoveredTarget(screenWaypoints, screenSamples) {
        if (!isFiniteNum(state.hoverX) || !isFiniteNum(state.hoverY)) return null;

        let best = null;
        let bestDistSq = HIT_RADIUS_PX * HIT_RADIUS_PX;

        if (state.layers.samples) {
            for (const item of screenSamples) {
                const dx = item.x - state.hoverX;
                const dy = item.y - state.hoverY;
                const d2 = dx * dx + dy * dy;
                if (d2 <= bestDistSq) {
                    bestDistSq = d2;
                    best = { kind: 'sample', data: item.sample, x: item.x, y: item.y };
                }
            }
        }

        if (state.layers.waypoints) {
            for (const item of screenWaypoints) {
                const dx = item.x - state.hoverX;
                const dy = item.y - state.hoverY;
                const d2 = dx * dx + dy * dy;
                if (d2 <= bestDistSq) {
                    bestDistSq = d2;
                    best = { kind: 'waypoint', data: item.wp, x: item.x, y: item.y };
                }
            }
        }

        return best;
    }

    function drawWaypoints(centerX, centerY, totalScale, origin, outScreenWaypoints) {
        if (!state.layers.waypoints) return;

        const textColor = getComputedStyle(document.body).getPropertyValue('--text-color').trim() || '#0f172a';

        for (const wp of state.waypoints) {
            if (!isFiniteNum(wp.lat) || !isFiniteNum(wp.lon)) continue;
            const m = latLonToMeters(wp.lat, wp.lon, origin.lat, origin.lon);
            const pt = worldToScreen(m.x, m.y, centerX, centerY, totalScale);
            const color = getWaypointColor(wp);

            outScreenWaypoints.push({ wp, x: pt.x, y: pt.y });

            drawWaypointSymbol(wp.symbol, pt.x, pt.y, color);

            ctx.save();
            ctx.font = '600 12px sans-serif';
            ctx.fillStyle = textColor;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${wp.id}: ${wp.name}`, pt.x + 12, pt.y);
            ctx.restore();
        }
    }

    function drawWindSamples(centerX, centerY, totalScale, origin, outScreenSamples) {
        if (!state.layers.samples) return;

        for (const s of state.samples) {
            if (!isFiniteNum(s.lat) || !isFiniteNum(s.lon)) continue;
            const m = latLonToMeters(s.lat, s.lon, origin.lat, origin.lon);
            const pt = worldToScreen(m.x, m.y, centerX, centerY, totalScale);

            outScreenSamples.push({ sample: s, x: pt.x, y: pt.y });

            const cogRad = normalizeAngle(s.cog) * DEG_TO_RAD;
            const dirRad = normalizeAngle(s.dir) * DEG_TO_RAD;
            const windColor = getWindColor(s.spd);

            const vecLen = 28;
            const vx = Math.sin(dirRad) * vecLen;
            const vy = -Math.cos(dirRad) * vecLen;

            ctx.save();
            ctx.strokeStyle = windColor;
            ctx.lineWidth = 2.6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(pt.x + vx, pt.y + vy);
            ctx.stroke();

            const triSize = 8.5;
            ctx.save();
            ctx.translate(pt.x, pt.y);
            ctx.rotate(cogRad);
            ctx.fillStyle = '#cbd5e1';
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(0, -triSize);
            ctx.lineTo(triSize * 0.74, triSize * 0.72);
            ctx.lineTo(-triSize * 0.74, triSize * 0.72);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            ctx.restore();
        }
    }

    function drawBoat(centerX, centerY, totalScale, origin) {
        if (!state.layers.boat) return;
        if (!isFiniteNum(state.boat.lat) || !isFiniteNum(state.boat.lon)) return;

        const m = latLonToMeters(state.boat.lat, state.boat.lon, origin.lat, origin.lon);
        const pt = worldToScreen(m.x, m.y, centerX, centerY, totalScale);
        const hdgRad = normalizeAngle(state.boat.heading) * DEG_TO_RAD;
        const boatBlack = '#09090b';

        ctx.save();
        ctx.translate(pt.x, pt.y);

        ctx.strokeStyle = boatBlack;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.sin(hdgRad) * 44, -Math.cos(hdgRad) * 44);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.rotate(hdgRad);
        ctx.fillStyle = boatBlack;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(9, 10);
        ctx.lineTo(0, 6);
        ctx.lineTo(-9, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    function drawTooltip(target, width, height) {
        if (!target) return;

        const lines = [];
        if (target.kind === 'waypoint') {
            const wp = target.data;
            const nav = computeBearingAndDistance(
                state.boat.lat,
                state.boat.lon,
                wp.lat,
                wp.lon
            );

            lines.push(`${wp.id}: ${wp.name}`);
            lines.push(`Pos: ${formatLatLonDmm(wp.lat, wp.lon)}`);
            if (nav) {
                lines.push(`Marcación: ${String(Math.round(nav.bearingDeg)).padStart(3, '0')}°`);
                lines.push(`Dist: ${nav.distanceNm.toFixed(2)} NM · ${nav.distanceKm.toFixed(2)} km`);
            } else {
                lines.push('Marcación: —');
                lines.push('Dist: — NM · — km');
            }
        } else if (target.kind === 'sample') {
            const s = target.data;
            const spdText = isFiniteNum(s.spd) && s.spd >= 0 ? `${s.spd} kn` : 'Sin anemómetro';
            const dirText = isFiniteNum(s.dir) ? `${Math.round(normalizeAngle(s.dir))}°` : '—';
            const cogText = isFiniteNum(s.cog) ? `${Math.round(normalizeAngle(s.cog))}°` : '—';
            lines.push(`Muestra #${s.txId ?? '—'}${s.utc ? ` (${s.utc})` : ''}`);
            lines.push(`Pos: ${formatLatLonDmm(s.lat, s.lon)}`);
            lines.push(`Viento: ${dirText} · ${spdText}`);
            lines.push(`COG: ${cogText}`);
        }

        if (lines.length === 0) return;

        ctx.save();
        ctx.font = '600 12px sans-serif';
        const lineHeight = 17;
        const padX = 10;
        const padY = 8;

        let maxW = 0;
        for (const line of lines) {
            maxW = Math.max(maxW, ctx.measureText(line).width);
        }

        const boxW = Math.ceil(maxW + padX * 2);
        const boxH = Math.ceil(lines.length * lineHeight + padY * 2 - 3);

        let boxX = target.x + 14;
        let boxY = target.y - boxH - 10;

        if (boxX + boxW > width - 8) {
            boxX = Math.max(8, target.x - boxW - 14);
        }
        if (boxY < 8) {
            boxY = Math.min(height - boxH - 8, target.y + 16);
        }

        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((line, idx) => {
            ctx.font = idx === 0 ? '700 12px sans-serif' : '500 11.5px sans-serif';
            ctx.fillText(line, boxX + padX, boxY + padY + idx * lineHeight);
        });

        ctx.restore();
    }

    function render() {
        const rect = els.canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const centerX = width * 0.5;
        const centerY = height * 0.5;

        ctx.clearRect(0, 0, width, height);

        const origin = getReferenceOrigin();
        const baseScale = computeBaseScale(width, height);
        const totalScale = baseScale * state.zoom;

        const screenWaypoints = [];
        const screenSamples = [];

        drawGeographicGrid(width, height, centerX, centerY, totalScale, origin);
        drawBoatRangeRings(width, height, centerX, centerY, totalScale, origin);
        drawNorthIndicator(width);
        drawWaypoints(centerX, centerY, totalScale, origin, screenWaypoints);
        drawWindSamples(centerX, centerY, totalScale, origin, screenSamples);
        drawBoat(centerX, centerY, totalScale, origin);

        const hovered = findHoveredTarget(screenWaypoints, screenSamples);
        drawTooltip(hovered, width, height);
    }

    function loadTestDataIfPresent() {
        if (window.testMapBoat) {
            state.boat = { ...state.boat, ...window.testMapBoat };
        }
        if (window.testMapWind) {
            state.wind = { ...state.wind, ...window.testMapWind };
        }
        if (Array.isArray(window.testMapWaypoints)) {
            state.waypoints = window.testMapWaypoints.slice();
        }
        if (Array.isArray(window.testMapWindSamples)) {
            state.samples = window.testMapWindSamples.slice();
        }
    }

    function updatePointerCoords(e) {
        const rect = els.canvas.getBoundingClientRect();
        state.hoverX = e.clientX - rect.left;
        state.hoverY = e.clientY - rect.top;
    }

    function bindEvents() {
        window.addEventListener('resize', resizeCanvas);

        if (els.zoomIn) {
            els.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.5));
        }
        if (els.zoomOut) {
            els.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.5));
        }
        if (els.zoomReset) {
            els.zoomReset.addEventListener('click', resetView);
        }

        if (els.toggleSamples) {
            els.toggleSamples.addEventListener('click', () => toggleLayer('samples'));
        }
        if (els.toggleWaypoints) {
            els.toggleWaypoints.addEventListener('click', () => toggleLayer('waypoints'));
        }
        if (els.toggleBoat) {
            els.toggleBoat.addEventListener('click', () => toggleLayer('boat'));
        }

        els.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = els.canvas.getBoundingClientRect();
            const ax = e.clientX - rect.left;
            const ay = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.35 : 1 / 1.35;
            setZoom(state.zoom * factor, ax, ay);
        }, { passive: false });

        els.canvas.addEventListener('pointerdown', (e) => {
            state.dragging = true;
            state.pointerMoved = false;
            state.lastPointerX = e.clientX;
            state.lastPointerY = e.clientY;
            updatePointerCoords(e);
            els.canvas.setPointerCapture(e.pointerId);
            els.canvas.classList.add('is-dragging');
            render();
        });

        els.canvas.addEventListener('pointermove', (e) => {
            updatePointerCoords(e);

            if (!state.dragging) {
                render();
                return;
            }

            const dx = e.clientX - state.lastPointerX;
            const dy = e.clientY - state.lastPointerY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                state.pointerMoved = true;
            }
            state.lastPointerX = e.clientX;
            state.lastPointerY = e.clientY;
            state.panX += dx;
            state.panY += dy;
            render();
        });

        const endDrag = (e) => {
            if (!state.dragging) return;
            state.dragging = false;
            if (e && els.canvas.hasPointerCapture(e.pointerId)) {
                els.canvas.releasePointerCapture(e.pointerId);
            }
            els.canvas.classList.remove('is-dragging');
            render();
        };

        els.canvas.addEventListener('pointerup', endDrag);
        els.canvas.addEventListener('pointercancel', endDrag);
        els.canvas.addEventListener('pointerleave', () => {
            if (!state.dragging) {
                state.hoverX = null;
                state.hoverY = null;
                render();
            }
        });
    }

    loadTestDataIfPresent();
    updateLayerButtons();
    updateZoomLabel();
    bindEvents();
    resizeCanvas();
})();