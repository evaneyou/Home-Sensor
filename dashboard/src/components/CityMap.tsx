import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const CITY_ZOOM = 8;
const CITY_MAX_ZOOM = 9;

export default function CityMap({
  latitude,
  longitude,
  label,
  className = "",
  zoomControl = true,
}: {
  latitude: number;
  longitude: number;
  label: string;
  className?: string;
  zoomControl?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const map = L.map(node, {
      minZoom: 4,
      maxZoom: CITY_MAX_ZOOM,
      zoomControl,
      attributionControl: true,
    }).setView([latitude, longitude], CITY_ZOOM);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      {
        className: "map-base",
        maxZoom: CITY_MAX_ZOOM,
        attribution: "Tiles &copy; Esri",
      },
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      {
        className: "map-borders",
        maxZoom: CITY_MAX_ZOOM,
      },
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      {
        className: "map-labels",
        maxZoom: CITY_MAX_ZOOM,
      },
    ).addTo(map);
    L.circleMarker([latitude, longitude], {
      radius: 6,
      color: "var(--ink)",
      weight: 1,
      fillColor: "var(--accent)",
      fillOpacity: 1,
    }).addTo(map);
    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => {
      window.cancelAnimationFrame(frame);
      map.remove();
    };
  }, [latitude, longitude, zoomControl]);

  return <div ref={ref} className={`monitor-map ${className}`.trim()} role="img" aria-label={`City map of ${label}`} />;
}
