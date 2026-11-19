// Datos de prueba para la vista exclusiva de mapa (map.html / map.js)
// Sin dependencias externas: los símbolos de waypoints y muestras se dibujan en Canvas.

window.testMapBoat = {
    lat: 36.7142,
    lon: -4.4158,
    heading: 68,   // Rumbo / COG actual del barco (0..359)
    sog: 6.4       // Velocidad sobre el fondo en nudos
};

window.testMapWind = {
    dir: 45,       // Dirección del viento actual (0..359)
    spd: 12        // Intensidad del viento actual en nudos (-1 si no hay anemómetro)
};

// 6 waypoints fijos (id 0..5)
// symbol: 'square' | 'boat' | 'flag' | 'circle' | 'ring' | 'cross'
window.testMapWaypoints = [
    { id: 0, name: 'Port',     symbol: 'square', lat: 36.7130, lon: -4.4185 },
    { id: 1, name: 'Cometee',  symbol: 'boat',   lat: 36.7145, lon: -4.4180 },
    { id: 2, name: 'Pin',      symbol: 'flag',   lat: 36.7122, lon: -4.4170 },
    { id: 3, name: 'Windward', symbol: 'circle', lat: 36.7185, lon: -4.4160 },
    { id: 4, name: 'Gate',     symbol: 'ring',   lat: 36.7105, lon: -4.4150 },
    { id: 5, name: 'Aux',      symbol: 'cross',  lat: 36.7155, lon: -4.4125 }
];

// Muestras recogidas al inicio de cada bordo:
// - cog: dirección del barco en el momento de la muestra (orienta el triángulo)
// - dir: dirección del viento (orienta la línea de dirección del viento)
// - spd: fuerza del viento en nudos (determina el color de la línea; -1 = sin anemómetro)
window.testMapWindSamples = [
    { txId: 1, lat: 36.7120, lon: -4.4190, cog: 52,  dir: 40, spd: 6,  utc: '14:05:10' },
    { txId: 2, lat: 36.7128, lon: -4.4178, cog: 295, dir: 44, spd: 11, utc: '14:09:40' },
    { txId: 3, lat: 36.7135, lon: -4.4167, cog: 64,  dir: 46, spd: 16, utc: '14:14:15' },
    { txId: 4, lat: 36.7141, lon: -4.4159, cog: 302, dir: 48, spd: 22, utc: '14:19:05' },
    { txId: 5, lat: 36.7146, lon: -4.4152, cog: 68,  dir: 45, spd: -1, utc: '14:23:30' }
];