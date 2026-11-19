// Datos de prueba para la vista de waypoints (waypoints.html / waypoints.js)

window.testWaypBoat = {
    lat: 36.7142,
    lon: -4.4158,
    heading: 68,
    sog: 6.4
};

window.testWaypOrientation = {
    heading: 214,
    available: true
};

window.testWaypoints = [
    { id: 0, name: 'Port',     symbol: 'square', lat: 36.7130, lon: -4.4172 },
    { id: 1, name: 'Cometee',  symbol: 'boat',   lat: 36.7145, lon: -4.4175 },
    { id: 2, name: 'Pin',      symbol: 'flag',   lat: 36.7120, lon: -4.4162 },
    { id: 3, name: 'Windward', symbol: 'circle', lat: 36.7185, lon: -4.4152 },
    { id: 4, name: 'Gate',     symbol: 'ring',   lat: 36.7105, lon: -4.4148 },
    { id: 5, name: 'Aux',      symbol: 'cross',  lat: 36.7155, lon: -4.4125 }
];

// Observaciones de ejemplo para probar la triangulación rápidamente
window.testWaypTriangleSeed = {
    obs1: {
        lat: 36.7142,
        lon: -4.4158,
        angle: 214
    },
    obs2: {
        lat: 36.7175,
        lon: -4.4110,
        angle: 182
    }
};