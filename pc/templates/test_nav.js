// Datos de prueba para la vista de navegación (nav.html / nav.js)

window.testNavHeading = 68;     // Rumbo actual del barco en grados (0..359)
window.testNavSog = 6.4;        // Velocidad sobre el fondo (SOG) en nudos
window.testNavWindDir = 45;     // Dirección del viento en grados
window.testNavWindSpd = 12;     // Velocidad del viento en nudos (-1 si no hay anemómetro)

window.testNavWaypoints = [
    { id: 1, name: 'Barlovento', lat: 36.7185, lon: -4.4160 },
    { id: 2, name: 'Sotavento',  lat: 36.7110, lon: -4.4195 },
    { id: 3, name: 'Llegada',    lat: 36.7152, lon: -4.4125 }
];