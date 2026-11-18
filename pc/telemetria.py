import struct
import csv
import argparse
import math
import json
import os

HOURS_OFFSET = 1  # 1 para invierno, 2 para verano en Madrid

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000.0
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def process_bearings(bearings):
    if not bearings:
        return 0.0, 0.0, 0.0
    
    unwrapped = [bearings[0]]
    for b in bearings[1:]:
        diff = b - unwrapped[-1]
        if diff > 180:
            unwrapped.append(b - 360)
        elif diff < -180:
            unwrapped.append(b + 360)
        else:
            unwrapped.append(b)
            
    max_b = max(unwrapped) % 360.0
    min_b = min(unwrapped) % 360.0
    
    sin_sum = sum(math.sin(math.radians(b)) for b in bearings)
    cos_sum = sum(math.cos(math.radians(b)) for b in bearings)
    mean_b = math.degrees(math.atan2(sin_sum, cos_sum)) % 360.0
    
    return max_b, min_b, mean_b

def generate_interactive_html(html_filename, base_filename, blocks_data):
    """Genera un mapa HTML interactivo autocontenido con Leaflet.js, línea de ruta y flechas de rumbo."""
    if not blocks_data:
        return

    json_data = json.dumps(blocks_data)

    html_template = f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telemetría Náutica - {base_filename}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        html, body {{ margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
        #map {{ width: 100%; height: 100%; }}
        .legend {{
            background: rgba(255, 255, 255, 0.92);
            padding: 10px 14px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            font-size: 13px;
            line-height: 1.5;
        }}
        .legend-title {{ font-weight: bold; margin-bottom: 4px; color: #1e293b; }}
        .legend-item {{ display: flex; align-items: center; gap: 8px; }}
        .color-box {{ width: 14px; height: 14px; border-radius: 3px; display: inline-block; }}
        .popup-table {{ border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 4px; }}
        .popup-table td {{ padding: 3px 6px; border-bottom: 1px solid #e2e8f0; }}
        .popup-table td:first-child {{ font-weight: 600; color: #475569; }}
        .popup-header {{ font-size: 14px; font-weight: bold; color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 4px; }}
    </style>
</head>
<body>
<div id="map"></div>
<script>
    const blocks = {json_data};

    const map = L.map('map').setView([blocks[0].init_lat, blocks[0].init_lon], 14);

    const esriStreet = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{{z}}/{{y}}/{{x}}', {{
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012'
    }}).addTo(map);

    const openSeaMap = L.tileLayer('https://tiles.openseamap.org/seamark/{{z}}/{{x}}/{{y}}.png', {{
        maxZoom: 18,
        attribution: '&copy; OpenSeaMap'
    }}).addTo(map);

    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}', {{
        maxZoom: 19,
        attribution: '&copy; Esri'
    }});

    L.control.layers({{ "Esri Calles": esriStreet, "Esri Satélite": satellite }}, {{ "Balizamiento Náutico": openSeaMap }}).addTo(map);

    function getSpeedColor(speed) {{
        if (speed < 2.0) return '#3b82f6';      // Azul
        if (speed < 4.5) return '#10b981';      // Verde
        if (speed < 6.5) return '#f59e0b';      // Naranja
        return '#ef4444';                       // Rojo
    }}

    const routeBounds = [];

    blocks.forEach((b, idx) => {{
        const start = [b.init_lat, b.init_lon];
        const end = [b.final_lat, b.final_lon];
        routeBounds.push(start);
        if (idx === blocks.length - 1) routeBounds.push(end);

        const color = getSpeedColor(b.mean_v);

        L.polyline([start, end], {{
            color: color,
            weight: 4,
            opacity: 0.85
        }}).addTo(map);

        const arrowIcon = L.divIcon({{
            className: 'boat-arrow',
            html: `<svg width="24" height="24" viewBox="0 0 24 24" style="transform: rotate(${{b.mean_b}}deg); filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.45));">
                     <polygon points="12,2 20,21 12,16 4,21" fill="${{color}}" stroke="#ffffff" stroke-width="1.5"/>
                   </svg>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }});

        const popupHtml = `
            <div class="popup-header">Hora Local: ${{b.hora}}</div>
            <table class="popup-table">
                <tr><td>Vel. Media:</td><td><b>${{b.mean_v.toFixed(1)}} nudos</b></td></tr>
                <tr><td>Vel. Máxima:</td><td>${{b.max_v.toFixed(1)}} nudos</td></tr>
                <tr><td>Rumbo Medio:</td><td><b>${{b.mean_b.toFixed(1)}}°</b></td></tr>
                <tr><td>Rango Rumbo:</td><td>${{b.min_b.toFixed(1)}}° – ${{b.max_b.toFixed(1)}}°</td></tr>
                <tr><td>Dist. Tramo:</td><td>${{b.dist_nm.toFixed(4)}} NM</td></tr>
                <tr><td>Dist. Total:</td><td><b>${{b.cum_nm.toFixed(4)}} NM</b></td></tr>
                <tr><td>Pos. Inicial:</td><td>${{b.init_lat.toFixed(6)}}, ${{b.init_lon.toFixed(6)}}</td></tr>
                <tr><td>Pos. Final:</td><td>${{b.final_lat.toFixed(6)}}, ${{b.final_lon.toFixed(6)}}</td></tr>
            </table>
        `;

        L.marker(start, {{ icon: arrowIcon }}).bindPopup(popupHtml).addTo(map);
    }});

    const startBadge = L.divIcon({{
        html: '<div style="background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold;font-size:11px;border:1px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);">INICIO</div>',
        className: '', iconSize: [46, 20], iconAnchor: [23, -8]
    }});
    const endBadge = L.divIcon({{
        html: '<div style="background:#dc2626;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold;font-size:11px;border:1px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);">FIN</div>',
        className: '', iconSize: [34, 20], iconAnchor: [17, -8]
    }});

    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    L.marker([first.init_lat, first.init_lon], {{ icon: startBadge }}).addTo(map);
    L.marker([last.final_lat, last.final_lon], {{ icon: endBadge }}).addTo(map);

    if (routeBounds.length > 0) {{
        map.fitBounds(routeBounds, {{ padding: [30, 30] }});
    }}

    const legend = L.control({{ position: 'bottomright' }});
    legend.onAdd = function() {{
        const div = L.DomUtil.create('div', 'legend');
        div.innerHTML = `
            <div class="legend-title">Velocidad (nudos)</div>
            <div class="legend-item"><span class="color-box" style="background:#3b82f6"></span> &lt; 2.0 kn</div>
            <div class="legend-item"><span class="color-box" style="background:#10b981"></span> 2.0 – 4.5 kn</div>
            <div class="legend-item"><span class="color-box" style="background:#f59e0b"></span> 4.5 – 6.5 kn</div>
            <div class="legend-item"><span class="color-box" style="background:#ef4444"></span> &gt; 6.5 kn</div>
        `;
        return div;
    }};
    legend.addTo(map);
</script>
</body>
</html>
"""
    with open(html_filename, "w", encoding="utf-8") as f_html:
        f_html.write(html_template)


def analyze_and_export_telemetry(base_filename):
    # Limpiar extensión .bin si el usuario la incluyó al llamar al script
    if base_filename.lower().endswith(".bin"):
        base_filename = base_filename[:-4]
    
    # Extraer solo el nombre base si se pasó con ruta previa (ej: "telemetria/archivo" -> "archivo")
    base_filename = os.path.basename(base_filename)
        
    # Definir y asegurar la creación de las carpetas solicitadas
    dir_telemetria = "telemetria"
    dir_resultados = "resultados"
    dir_ghp = "ghp"

    for folder in [dir_telemetria, dir_resultados, dir_ghp]:
        os.makedirs(folder, exist_ok=True)

    # Rutas completas de los archivos organizados en sus respectivas carpetas
    filename         = os.path.join(dir_telemetria, f"{base_filename}.bin")
    calib_csv_name   = os.path.join(dir_resultados, f"{base_filename}_calib.csv")
    imu_csv_name     = os.path.join(dir_resultados, f"{base_filename}_imu.csv")
    gps_raw_csv_name = os.path.join(dir_resultados, f"{base_filename}_gps_raw.csv")
    gps_kml_name     = os.path.join(dir_resultados, f"{base_filename}_gps_clean.kml")
    gps_html_name    = os.path.join(dir_ghp, f"{base_filename}_mapa.html")
    
    print(f"--- ANALIZANDO Y GENERANDO TELEMETRÍA: {filename} ---\n")
    
    packet_count = 0
    calib_count = 0
    imu_count = 0
    gps_count = 0
    gps_clean_count = 0
    
    max_speed = -1.0
    min_speed = float('inf')
    max_speed_time = "N/A"
    min_speed_time = "N/A"
    
    min_lat = float('inf')
    max_lat = float('-inf')
    min_lon = float('inf')
    max_lon = float('-inf')
    
    total_distance_meters = 0.0
    last_timestamp = None
    first_timestamp = None
    last_timestamp_session = None
    
    first_valid_local = None
    last_valid_local = None

    def parse_local_time(gps_time_val):
        try:
            total_centiseconds = int(gps_time_val)
            if total_centiseconds <= 0:
                return None
            total_seconds = (total_centiseconds // 100) + (HOURS_OFFSET * 3600)
            total_seconds %= 86400
            h = total_seconds // 3600
            m = (total_seconds % 3600) // 60
            sec = total_seconds % 60
            return f"{h:02d}:{m:02d}:{sec:02d}"
        except:
            return None

    def process_block(block, current_total_nm, kml_file, blocks_list):
        if not block:
            return current_total_nm
        
        init_lat = block[0]['lat']
        init_lon = block[0]['lon']
        final_lat = block[-1]['lat']
        final_lon = block[-1]['lon']
        
        speeds = [item['speed'] for item in block if item['speed'] < 30.0]
        if not speeds:
            speeds = [0.0]
            
        max_v = max(speeds)
        mean_v = sum(speeds) / len(speeds)
        
        duration_ms = block[-1]['timestamp'] - block[0]['timestamp']
        duration_hours = (duration_ms / 3600000.0) if duration_ms > 0 else (len(block) / 3600.0)
        
        dist_nm = mean_v * duration_hours
        current_total_nm += dist_nm
        
        bearings = [item['course'] for item in block]
        max_b, min_b, mean_b = process_bearings(bearings)
        
        full_time = block[0]['time_str']
        hora_sin_seg = full_time[:5] if full_time and len(full_time) >= 5 else "00:00"
        timestamp = block[0]['timestamp']
        
        kml_content = f"""    <Placemark>
      <name>{hora_sin_seg}</name>
      <description><![CDATA[
        <b>Timestamp (ms):</b> {timestamp}<br/>
        <b>Lat. Inicial:</b> {init_lat:.7f}<br/>
        <b>Lon. Inicial:</b> {init_lon:.7f}<br/>
        <b>Lat. Final:</b> {final_lat:.7f}<br/>
        <b>Lon. Final:</b> {final_lon:.7f}<br/>
        <b>Vel. Máxima:</b> {max_v:.1f} nudos<br/>
        <b>Vel. Media:</b> {mean_v:.1f} nudos<br/>
        <b>Distancia Tramo:</b> {dist_nm:.4f} NM<br/>
        <b>Distancia Acumulada:</b> {current_total_nm:.4f} NM<br/>
        <b>Rumbo Máximo:</b> {max_b:.1f}°<br/>
        <b>Rumbo Mínimo:</b> {min_b:.1f}°<br/>
        <b>Rumbo Medio:</b> {mean_b:.1f}°
      ]]></description>
      <Point>
        <coordinates>{init_lon:.7f},{init_lat:.7f},0</coordinates>
      </Point>
    </Placemark>\n"""
        kml_file.write(kml_content)

        blocks_list.append({
            "timestamp": timestamp,
            "hora": hora_sin_seg,
            "init_lat": round(init_lat, 7),
            "init_lon": round(init_lon, 7),
            "final_lat": round(final_lat, 7),
            "final_lon": round(final_lon, 7),
            "max_v": round(max_v, 1),
            "mean_v": round(mean_v, 1),
            "dist_nm": round(dist_nm, 4),
            "cum_nm": round(current_total_nm, 4),
            "max_b": round(max_b, 1),
            "min_b": round(min_b, 1),
            "mean_b": round(mean_b, 1)
        })

        return current_total_nm

    try:
        blocks_for_html = []

        with open(filename, "rb") as f, \
             open(calib_csv_name, "w", newline="", encoding="utf-8") as f_calib, \
             open(imu_csv_name, "w", newline="", encoding="utf-8") as f_imu, \
             open(gps_raw_csv_name, "w", newline="", encoding="utf-8") as f_raw, \
             open(gps_kml_name, "w", encoding="utf-8") as f_kml:
            
            writer_calib = csv.writer(f_calib)
            writer_calib.writerow(["Tipo", "Firmware", "Muestras", "Val1", "Val2", "Val3", "Val4", "Val5", "Val6"])
            
            writer_imu = csv.writer(f_imu)
            writer_imu.writerow(["Timestamp_ms", "Ax", "Ay", "Az", "Mx", "My", "Mz"])
            
            writer_raw = csv.writer(f_raw)
            writer_raw.writerow(["Timestamp_ms", "Hora_Local", "Latitud", "Longitud", "Velocidad_nudos", "Rumbo", "Valido"])
            
            f_kml.write('<?xml version="1.0" encoding="UTF-8"?>\n')
            f_kml.write('<kml xmlns="http://www.opengis.net/kml/2.2">\n')
            f_kml.write('  <Document>\n')
            f_kml.write(f'    <name>Telemetria - {base_filename}</name>\n')
            
            gps_block = []
            cumulative_nm = 0.0
            
            while True:
                type_byte = f.read(1)
                if not type_byte:
                    break
                
                packet_type = type_byte[0]
                
                if packet_type == 0x01:
                    data = f.read(15)
                    if len(data) < 15: break
                    fw, samples, s_ax, s_ay, s_az = struct.unpack("<B H i i i", data)
                    writer_calib.writerow(["ACCEL", fw, samples, s_ax, s_ay, s_az, "", "", ""])
                    calib_count += 1
                    
                elif packet_type == 0x02:
                    data = f.read(13)
                    if len(data) < 13: break
                    fw, minx, maxx, miny, maxy, minz, maxz = struct.unpack("<B h h h h h h", data)
                    writer_calib.writerow(["MAG", fw, "", minx, maxx, miny, maxy, minz, maxz])
                    calib_count += 1
                    
                elif packet_type == 0x03:
                    data = f.read(16)
                    if len(data) < 16: break
                    timestamp, ax, ay, az, mx, my, mz = struct.unpack("<I h h h h h h", data)
                    writer_imu.writerow([timestamp, ax, ay, az, mx, my, mz])
                    imu_count += 1
                    
                elif packet_type == 0x04:
                    data = f.read(25)
                    if len(data) < 25: break
                    timestamp, gps_time, date, lat, lon, speed, course, valid = struct.unpack("<I I I i i H H B", data)
                    
                    if first_timestamp is None: first_timestamp = timestamp
                    last_timestamp_session = timestamp
                    
                    lat_deg = lat / 10000000.0
                    lon_deg = lon / 10000000.0
                    speed_knots = speed / 10.0
                    course_deg = course / 10.0
                    
                    time_str = parse_local_time(gps_time)
                    display_time = time_str if time_str else "N/A"
                    
                    writer_raw.writerow([timestamp, display_time, f"{lat_deg:.7f}", f"{lon_deg:.7f}", f"{speed_knots:.1f}", f"{course_deg:.1f}", valid])
                    gps_count += 1
                    
                    if valid == 1:
                        if time_str:
                            if first_valid_local is None: first_valid_local = time_str
                            last_valid_local = time_str
                        
                        if speed_knots < 30.0:
                            if speed_knots > max_speed: max_speed, max_speed_time = speed_knots, display_time
                            if speed_knots < min_speed: min_speed, min_speed_time = speed_knots, display_time
                            
                        if lat_deg < min_lat: min_lat = lat_deg
                        if lat_deg > max_lat: max_lat = lat_deg
                        if lon_deg < min_lon: min_lon = lon_deg
                        if lon_deg > max_lon: max_lon = lon_deg
                        
                        if last_timestamp is not None:
                            delta_time_sec = (timestamp - last_timestamp) / 1000.0
                            if 0 < delta_time_sec < 10 and speed_knots < 30.0:
                                total_distance_meters += (speed_knots * 0.514444) * delta_time_sec
                        last_timestamp = timestamp
                        
                        gps_block.append({
                            'timestamp': timestamp,
                            'time_str': display_time,
                            'lat': lat_deg,
                            'lon': lon_deg,
                            'speed': speed_knots,
                            'course': course_deg
                        })
                        
                        if len(gps_block) == 60:
                            cumulative_nm = process_block(gps_block, cumulative_nm, f_kml, blocks_for_html)
                            gps_clean_count += 1
                            gps_block = []
                else:
                    pass
                packet_count += 1

            if len(gps_block) > 0:
                cumulative_nm = process_block(gps_block, cumulative_nm, f_kml, blocks_for_html)
                gps_clean_count += 1

            f_kml.write('  </Document>\n')
            f_kml.write('</kml>\n')

        generate_interactive_html(gps_html_name, base_filename, blocks_for_html)

        elapsed_str = "00:00:00"
        if first_timestamp is not None and last_timestamp_session is not None:
            total_sec = max(0.0, (last_timestamp_session - first_timestamp) / 1000.0)
            elapsed_str = f"{int(total_sec // 3600):02d}:{int((total_sec % 3600) // 60):02d}:{int(total_sec % 60):02d}"

        print("==================================================")
        print("          RESUMEN DE ESTADÍSTICAS DE TRAYECTO     ")
        print("==================================================")
        print(f" Paquetes totales procesados : {packet_count}")
        print(f" Primera hora local válida   : {first_valid_local or 'N/A'}")
        print(f" Última hora local válida    : {last_valid_local or 'N/A'}")
        print(f" Tiempo transcurrido         : {elapsed_str}")
        print(f" Distancia total estimada    : {total_distance_meters / 1000.0:.3f} km ({total_distance_meters:.1f} metros)")
        print("--------------------------------------------------")
        print(f" Velocidad MÁXIMA            : {max_speed:.1f} nudos (a las {max_speed_time} Local)")
        print(f" Velocidad MÍNIMA            : {min_speed:.1f} nudos (a las {min_speed_time} Local)")
        print("==================================================")
        print(" FICHEROS GENERADOS:")
        print(f"  -> {calib_csv_name} ({calib_count} registros)")
        print(f"  -> {imu_csv_name} ({imu_count} registros)")
        print(f"  -> {gps_raw_csv_name} ({gps_count} registros - completo)")
        print(f"  -> {gps_kml_name} ({gps_clean_count} puntos KML)")
        print(f"  -> {gps_html_name} (Mapa interactivo)")
        print("==================================================")

    except FileNotFoundError:
        print(f"[ERROR] No se pudo encontrar el fichero binario en '{filename}'.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analizador y exportador de telemetría marina (CSV, KML y HTML).")
    parser.add_argument("fichero", help="Nombre base del fichero binario (ej: telemetria_17) o ruta relativa")
    args = parser.parse_args()
    analyze_and_export_telemetry(args.fichero)