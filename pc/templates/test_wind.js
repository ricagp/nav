(() => {
    // Valores iniciales de prueba para la vista Wind
    const testWindSpeed = -1; // -1 si no hay anemómetro / dinamómetro
    const testWindDir = 45;   // Dirección inicial en grados (0..359)
    const testWindWaypoints = [
        { name: 'Windward (M1)', lat: 36.7245, lon: -4.4200 },
        { name: 'Leeward (M2)',  lat: 36.7185, lon: -4.4225 },
        { name: 'Pin End',       lat: 36.7195, lon: -4.4192 }
    ];
    const testWindSamples = [
        { txId: 1, lat: 36.7198, lon: -4.4218, dir: 38, spd: -1, utc: '10:05:12' },
        { txId: 2, lat: 36.7214, lon: -4.4205, dir: 46, spd: -1, utc: '10:12:40' },
        { txId: 3, lat: 36.7231, lon: -4.4216, dir: 52, spd: -1, utc: '10:19:05' }
    ];

    window.testWindSpeed = testWindSpeed;
    window.testWindDir = testWindDir;
    window.testWindWaypoints = testWindWaypoints;
    window.testWindSamples = testWindSamples;
})();