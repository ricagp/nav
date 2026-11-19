// Lógica de la vista de gestión de waypoints (wayp.html / wayp.js)

(function () {
    const EARTH_RADIUS_M = 6371000;
    const METERS_PER_NM = 1852;
    const DEG_TO_RAD = Math.PI / 180;
    const RAD_TO_DEG = 180 / Math.PI;

    const DEFAULT_WAYPOINTS = [
        { id: 0, name: 'Port',     symbol: 'square', lat: 36.7130, lon: -4.4172 },
        { id: 1, name: 'Cometee',  symbol: 'boat',   lat: 36.7145, lon: -4.4175 },
        { id: 2, name: 'Pin',      symbol: 'flag',   lat: 36.7120, lon: -4.4162 },
        { id: 3, name: 'Windward', symbol: 'circle', lat: 36.7185, lon: -4.4152 },
        { id: 4, name: 'Gate',     symbol: 'ring',   lat: 36.7105, lon: -4.4148 },
        { id: 5, name: 'Aux',      symbol: 'cross',  lat: 36.7155, lon: -4.4125 }
    ];

    const state = {
        selectedId: 2,
        boat: {
            lat: 36.7142,
            lon: -4.4158,
            heading: 68,
            sog: 6.4
        },
        liveHeading: 214,
        waypoints: [],
        tri: {
            activeSlot: null, // 1, 2 o null
            obs1: { lat: null, lon: null, angle: null, locked: false },
            obs2: { lat: null, lon: null, angle: null, locked: false },
            computed: null
        },
        statusMessage: ''
    };

    const els = {
        numButtons: Array.from(document.querySelectorAll('.wayp-num-btn[data-wp-id]')),
        summaryTitle: document.getElementById('wayp-summary-title'),
        summaryPos: document.getElementById('wayp-summary-pos'),
        summaryBrg: document.getElementById('wayp-summary-brg'),
        summaryDist: document.getElementById('wayp-summary-dist'),
        currentPos: document.getElementById('wayp-current-pos'),
        btnCurrent: document.getElementById('wayp-btn-current'),
        inputLat: document.getElementById('wayp-input-lat'),
        inputLon: document.getElementById('wayp-input-lon'),
        btnSet: document.getElementById('wayp-btn-set'),
        inputDist: document.getElementById('wayp-input-dist'),
        selectUnit: document.getElementById('wayp-select-unit'),
        liveDir: document.getElementById('wayp-live-dir'),
        btnEstimate: document.getElementById('wayp-btn-estimate'),
        obs1Text: document.getElementById('wayp-obs1-text'),
        btnObs1: document.getElementById('wayp-btn-obs1'),
        obs2Text: document.getElementById('wayp-obs2-text'),
        btnObs2: document.getElementById('wayp-btn-obs2'),
        triCalcText: document.getElementById('wayp-tri-calc-text'),
        btnTriangle: document.getElementById('wayp-btn-triangle'),
        status: document.getElementById('wayp-status')
    };

    function isFiniteNum(v) {
        return typeof v === 'number' && Number.isFinite(v);
    }

    function normalizeAngle(deg) {
        if (!isFiniteNum(deg)) return 0;
        return ((deg % 360) + 360) % 360;
    }

    function formatAngle3(deg) {
        if (!isFiniteNum(deg)) return '—';
        return `${String(Math.round(normalizeAngle(deg))).padStart(3, '0')}°`;
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
        if (!isFiniteNum(lat) || !isFiniteNum(lon)) return '—, —';
        return `${formatDmm(lat, true)}, ${formatDmm(lon, false)}`;
    }

    // Admite tanto DD°MM.m' N/S/E/W como números decimales (p. ej. -4.4158)
    function parseCoordinateInput(raw, isLat) {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim().toUpperCase();
        if (!trimmed) return null;

        // Formato decimal directo
        const plainNum = Number(trimmed.replace(',', '.'));
        if (Number.isFinite(plainNum)) {
            const limit = isLat ? 90 : 180;
            return Math.abs(plainNum) <= limit ? plainNum : null;
        }

        // Formato grados y minutos: ej. 36°42.7'N o 004 25.0 W
        const hemiMatch = trimmed.match(/[NSEW]$/);
        const hemi = hemiMatch ? hemiMatch[0] : null;
        const body = hemi ? trimmed.slice(0, -1).trim() : trimmed;
        const parts = body.split(/[^0-9.]+/).filter(Boolean);

        if (parts.length === 0) return null;
        const deg = Number(parts[0]);
        const min = parts.length > 1 ? Number(parts[1]) : 0;
        if (!Number.isFinite(deg) || !Number.isFinite(min) || min < 0 || min >= 60) {
            return null;
        }

        let value = Math.abs(deg) + min / 60;
        if (hemi === 'S' || hemi === 'W') {
            value = -value;
        } else if (!hemi && deg < 0) {
            value = -value;
        }

        const limit = isLat ? 90 : 180;
        return Math.abs(value) <= limit ? value : null;
    }

    function toMeters(value, unit) {
        if (!isFiniteNum(value) || value <= 0) return null;
        switch (unit) {
            case 'km':
                return value * 1000;
            case 'm':
                return value;
            case 'NM':
            default:
                return value * METERS_PER_NM;
        }
    }

    // Distancia (Haversine) y marcación verdadera desde punto 1 a punto 2
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

    // Punto destino dado un origen, marcación verdadera (grados) y distancia (metros)
    function destinationPoint(lat, lon, bearingDeg, distanceM) {
        const delta = distanceM / EARTH_RADIUS_M;
        const theta = normalizeAngle(bearingDeg) * DEG_TO_RAD;
        const phi1 = lat * DEG_TO_RAD;
        const lambda1 = lon * DEG_TO_RAD;

        const sinPhi2 = Math.sin(phi1) * Math.cos(delta) +
            Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
        const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));

        const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
        const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
        const lambda2 = lambda1 + Math.atan2(y, x);

        let lonDeg = lambda2 * RAD_TO_DEG;
        lonDeg = ((lonDeg + 540) % 360) - 180;

        return {
            lat: phi2 * RAD_TO_DEG,
            lon: lonDeg
        };
    }

    // Intersección de dos semirrectas/líneas definidas por (lat1, lon1, brg1) y (lat2, lon2, brg2)
    function triangulatePoints(obs1, obs2) {
        if (
            !obs1 || !obs2 ||
            !isFiniteNum(obs1.lat) || !isFiniteNum(obs1.lon) || !isFiniteNum(obs1.angle) ||
            !isFiniteNum(obs2.lat) || !isFiniteNum(obs2.lon) || !isFiniteNum(obs2.angle)
        ) {
            return null;
        }

        const meanLatRad = ((obs1.lat + obs2.lat) * 0.5) * DEG_TO_RAD;
        const cosLat = Math.cos(meanLatRad);

        const p1x = obs1.lon * DEG_TO_RAD * EARTH_RADIUS_M * cosLat;
        const p1y = obs1.lat * DEG_TO_RAD * EARTH_RADIUS_M;
        const p2x = obs2.lon * DEG_TO_RAD * EARTH_RADIUS_M * cosLat;
        const p2y = obs2.lat * DEG_TO_RAD * EARTH_RADIUS_M;

        const rad1 = normalizeAngle(obs1.angle) * DEG_TO_RAD;
        const rad2 = normalizeAngle(obs2.angle) * DEG_TO_RAD;

        // Dirección unitaria en plano local (x = Este, y = Norte)
        const d1x = Math.sin(rad1);
        const d1y = Math.cos(rad1);
        const d2x = Math.sin(rad2);
        const d2y = Math.cos(rad2);

        const det = d1x * (-d2y) - d1y * (-d2x);
        if (Math.abs(det) < 1e-4) {
            return null; // Ángulos casi paralelos o colineales
        }

        const rx = p2x - p1x;
        const ry = p2y - p1y;

        const t1 = (rx * (-d2y) - ry * (-d2x)) / det;
        const ix = p1x + d1x * t1;
        const iy = p1y + d1y * t1;

        const lat = (iy / EARTH_RADIUS_M) * RAD_TO_DEG;
        const lon = (ix / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG;

        return { lat, lon };
    }

    function getSelectedWaypoint() {
        return state.waypoints.find((wp) => wp.id === state.selectedId) || state.waypoints[0];
    }

    function setStatus(msg) {
        state.statusMessage = msg || '';
        if (els.status) {
            els.status.textContent = state.statusMessage;
        }
    }

    function syncInputsFromSelectedWaypoint() {
        const wp = getSelectedWaypoint();
        if (!wp) return;
        if (els.inputLat) els.inputLat.value = formatDmm(wp.lat, true);
        if (els.inputLon) els.inputLon.value = formatDmm(wp.lon, false);
    }

    function applyWaypointCoords(lat, lon, sourceLabel) {
        const wp = getSelectedWaypoint();
        if (!wp) return;
        wp.lat = lat;
        wp.lon = lon;
        syncInputsFromSelectedWaypoint();
        setStatus(`${wp.id}: ${wp.name} actualizado (${sourceLabel}): ${formatLatLonDmm(lat, lon)}`);
        render();
    }

    function formatObsSummary(slot, obs) {
        if (state.tri.activeSlot === slot) {
            return `Apuntando... Pos: ${formatLatLonDmm(state.boat.lat, state.boat.lon)} @ ${formatAngle3(state.liveHeading)}`;
        }
        if (obs.locked && isFiniteNum(obs.lat) && isFiniteNum(obs.lon) && isFiniteNum(obs.angle)) {
            return `${formatLatLonDmm(obs.lat, obs.lon)} @ ${formatAngle3(obs.angle)}`;
        }
        return 'Sin fijar';
    }

    function updateObsButton(btn, slot, obs) {
        if (!btn) return;
        const isUnlocking = state.tri.activeSlot === slot;
        btn.textContent = isUnlocking ? 'Lock' : 'Unlock';
        btn.classList.toggle('is-unlocked', isUnlocking);
        btn.classList.toggle('is-locked', !isUnlocking && Boolean(obs.locked));
    }

    function handleToggleObs(slot) {
        const obs = slot === 1 ? state.tri.obs1 : state.tri.obs2;

        if (state.tri.activeSlot === slot) {
            // Estaba desbloqueado apuntando: ahora se pulsa Lock y fija observación
            obs.lat = state.boat.lat;
            obs.lon = state.boat.lon;
            obs.angle = normalizeAngle(state.liveHeading);
            obs.locked = true;
            state.tri.activeSlot = null;
            state.tri.computed = triangulatePoints(state.tri.obs1, state.tri.obs2);
            setStatus(`Obs ${slot} fijada en ${formatAngle3(obs.angle)}`);
        } else {
            // Se pulsa Unlock para orientar el teléfono y capturar este ángulo
            state.tri.activeSlot = slot;
            obs.locked = false;
            state.tri.computed = null;
            setStatus(`Obs ${slot} desbloqueada: orienta el móvil y pulsa Lock`);
        }

        render();
    }

    function render() {
        const wp = getSelectedWaypoint();

        for (const btn of els.numButtons) {
            const id = Number(btn.dataset.wpId);
            btn.classList.toggle('is-active', id === state.selectedId);
        }

        if (wp) {
            if (els.summaryTitle) {
                els.summaryTitle.textContent = `${wp.id}: ${wp.name}`;
            }
            if (els.summaryPos) {
                els.summaryPos.textContent = formatLatLonDmm(wp.lat, wp.lon);
            }

            const nav = computeBearingAndDistance(
                state.boat.lat,
                state.boat.lon,
                wp.lat,
                wp.lon
            );
            if (els.summaryBrg) {
                els.summaryBrg.textContent = nav ? `BRG ${formatAngle3(nav.bearingDeg)}` : 'BRG —';
            }
            if (els.summaryDist) {
                els.summaryDist.textContent = nav
                    ? `${nav.distanceNm.toFixed(2)} NM (${nav.distanceKm.toFixed(2)} km)`
                    : '— NM';
            }
        }

        if (els.currentPos) {
            els.currentPos.textContent = formatLatLonDmm(state.boat.lat, state.boat.lon);
        }

        if (els.liveDir) {
            els.liveDir.textContent = formatAngle3(state.liveHeading);
        }

        if (els.obs1Text) {
            els.obs1Text.textContent = `Obs 1: ${formatObsSummary(1, state.tri.obs1)}`;
        }
        if (els.obs2Text) {
            els.obs2Text.textContent = `Obs 2: ${formatObsSummary(2, state.tri.obs2)}`;
        }

        updateObsButton(els.btnObs1, 1, state.tri.obs1);
        updateObsButton(els.btnObs2, 2, state.tri.obs2);

        state.tri.computed = triangulatePoints(state.tri.obs1, state.tri.obs2);
        if (els.triCalcText) {
            els.triCalcText.textContent = state.tri.computed
                ? `Calc: ${formatLatLonDmm(state.tri.computed.lat, state.tri.computed.lon)}`
                : 'Calc: —';
        }
    }

    function loadTestDataIfPresent() {
        if (window.testWaypBoat) {
            state.boat = { ...state.boat, ...window.testWaypBoat };
        }
        if (window.testWaypOrientation && isFiniteNum(window.testWaypOrientation.heading)) {
            state.liveHeading = normalizeAngle(window.testWaypOrientation.heading);
        }
        if (Array.isArray(window.testWaypoints) && window.testWaypoints.length > 0) {
            state.waypoints = window.testWaypoints.map((w) => ({ ...w }));
        } else {
            state.waypoints = DEFAULT_WAYPOINTS.map((w) => ({ ...w }));
        }
        if (window.testWaypTriangleSeed) {
            const { obs1, obs2 } = window.testWaypTriangleSeed;
            if (obs1 && isFiniteNum(obs1.lat) && isFiniteNum(obs1.lon) && isFiniteNum(obs1.angle)) {
                state.tri.obs1 = { ...obs1, angle: normalizeAngle(obs1.angle), locked: true };
            }
            if (obs2 && isFiniteNum(obs2.lat) && isFiniteNum(obs2.lon) && isFiniteNum(obs2.angle)) {
                state.tri.obs2 = { ...obs2, angle: normalizeAngle(obs2.angle), locked: true };
            }
        }
    }

    function bindEvents() {
        for (const btn of els.numButtons) {
            btn.addEventListener('click', () => {
                state.selectedId = Number(btn.dataset.wpId);
                syncInputsFromSelectedWaypoint();
                setStatus('');
                render();
            });
        }

        if (els.btnCurrent) {
            els.btnCurrent.addEventListener('click', () => {
                if (!isFiniteNum(state.boat.lat) || !isFiniteNum(state.boat.lon)) {
                    setStatus('Posición actual del barco no disponible');
                    return;
                }
                applyWaypointCoords(state.boat.lat, state.boat.lon, 'Current');
            });
        }

        if (els.btnSet) {
            els.btnSet.addEventListener('click', () => {
                const lat = parseCoordinateInput(els.inputLat ? els.inputLat.value : '', true);
                const lon = parseCoordinateInput(els.inputLon ? els.inputLon.value : '', false);
                if (!isFiniteNum(lat) || !isFiniteNum(lon)) {
                    setStatus('Coordenadas no válidas (usa DD°MM.m\' N/S/E/W o decimal)');
                    return;
                }
                applyWaypointCoords(lat, lon, 'Set');
            });
        }

        if (els.btnEstimate) {
            els.btnEstimate.addEventListener('click', () => {
                if (!isFiniteNum(state.boat.lat) || !isFiniteNum(state.boat.lon)) {
                    setStatus('Sin posición del barco para estimar');
                    return;
                }
                const rawDist = els.inputDist ? Number(String(els.inputDist.value).replace(',', '.')) : NaN;
                const unit = els.selectUnit ? els.selectUnit.value : 'NM';
                const distM = toMeters(rawDist, unit);
                if (!isFiniteNum(distM) || distM <= 0) {
                    setStatus('Introduce una distancia válida mayor que 0');
                    return;
                }
                const target = destinationPoint(state.boat.lat, state.boat.lon, state.liveHeading, distM);
                applyWaypointCoords(target.lat, target.lon, `Estimate ${rawDist} ${unit} @ ${formatAngle3(state.liveHeading)}`);
            });
        }

        if (els.btnObs1) {
            els.btnObs1.addEventListener('click', () => handleToggleObs(1));
        }
        if (els.btnObs2) {
            els.btnObs2.addEventListener('click', () => handleToggleObs(2));
        }

        if (els.btnTriangle) {
            els.btnTriangle.addEventListener('click', () => {
                const pt = triangulatePoints(state.tri.obs1, state.tri.obs2);
                if (!pt) {
                    setStatus('Faltan 2 observaciones válidas o los ángulos son casi paralelos');
                    return;
                }
                state.tri.computed = pt;
                applyWaypointCoords(pt.lat, pt.lon, 'Triangle');
            });
        }

        // Lectura de orientación del dispositivo cuando esté disponible en el navegador/móvil
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('deviceorientationabsolute', (e) => {
                if (typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
                    state.liveHeading = normalizeAngle(360 - e.alpha);
                    if (state.tri.activeSlot !== null) render();
                    if (els.liveDir) els.liveDir.textContent = formatAngle3(state.liveHeading);
                }
            }, true);

            window.addEventListener('deviceorientation', (e) => {
                if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
                    state.liveHeading = normalizeAngle(e.webkitCompassHeading);
                    if (els.liveDir) els.liveDir.textContent = formatAngle3(state.liveHeading);
                    if (state.tri.activeSlot !== null) render();
                } else if (e.absolute && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
                    state.liveHeading = normalizeAngle(360 - e.alpha);
                    if (els.liveDir) els.liveDir.textContent = formatAngle3(state.liveHeading);
                    if (state.tri.activeSlot !== null) render();
                }
            }, true);
        }
    }

    loadTestDataIfPresent();
    syncInputsFromSelectedWaypoint();
    bindEvents();
    render();
})();