import React, { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  BatteryCharging,
  Clock,
  Navigation,
  PhoneCall,
  Radio,
  Search,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Timer,
  Wifi,
} from "lucide-react";
import { UserNavbar } from "../../components/UserNavbar";
import { useThreat } from "../../context/ThreatContext";
import { useAudioEvidence } from "../../hooks/useAudioEvidence";
import { useUserWebSocket } from "../../hooks/useUserWebSocket";
import { apiFetch, getUserToken } from "../../lib/api";

interface SafeHaven {
  id: string;
  name: string;
  category: "POLICE" | "HOSPITAL" | "PHARMACY";
  lat: number;
  lng: number;
  is_24_7: boolean;
  distance_m: number;
  phone: string;
}

interface GeoLineFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: {
    safety_score?: number;
    eta_minutes?: number;
    distance_km?: number;
    [key: string]: unknown;
  };
}

interface SafeRouteResponse {
  fastest_route: GeoLineFeature;
  safest_route: GeoLineFeature;
  safe_havens: SafeHaven[];
}

const QUICK_HELPLINES = [
  { label: "National Emergency", num: "112", desc: "Police / PCR" },
  { label: "Women Helpline", num: "1091", desc: "24x7 Response" },
  { label: "Women Distress", num: "181", desc: "Crisis Support" },
  { label: "Ambulance", num: "108", desc: "Medical Aid" },
];

export const SafetyHubPage: React.FC = () => {
  const token = getUserToken();
  if (!token) return <Navigate to="/login" replace />;

  const { threatLevel, setThreatLevel } = useThreat();
  const { connected, dispatchNotice, sendLocationPing } = useUserWebSocket();
  const { isRecording, chunks, startRecording, stopRecording } = useAudioEvidence();

  // MapLibre & Real GPS / Battery state
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const havenMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
    speed?: number | null;
  } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [batteryPct, setBatteryPct] = useState<number | null>(null);

  // Nominatim SafeRoute search
  const [destQuery, setDestQuery] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<SafeRouteResponse | null>(null);

  // SOS Ring hold state (2000ms)
  const [sosProgress, setSosProgress] = useState(0);
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);

  // Dead-Man's Switch state
  const [deadmanSeconds, setDeadmanSeconds] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinFeedback, setPinFeedback] = useState<string | null>(null);

  // Real browser Battery Status API
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        addEventListener: (ev: string, cb: () => void) => void;
        removeEventListener: (ev: string, cb: () => void) => void;
      }>;
    };
    if (!nav.getBattery) return;

    let batteryObj: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    const updateLevel = () => {
      if (batteryObj) setBatteryPct(Math.round(batteryObj.level * 100));
    };

    nav.getBattery()
      .then((b) => {
        batteryObj = b;
        updateLevel();
        b.addEventListener("levelchange", updateLevel);
      })
      .catch(() => {});

    return () => {
      batteryObj?.removeEventListener("levelchange", updateLevel);
    };
  }, []);

  // Real browser Geolocation watchPosition()
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by this browser.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsError(null);
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
        };
        setCoords(next);

        if (activeIncidentId) {
          sendLocationPing({
            lat: next.lat,
            lng: next.lng,
            incident_id: activeIncidentId,
            battery: batteryPct ?? undefined,
            speed: next.speed ?? undefined,
          });
        }
      },
      (err) => {
        setGpsError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeIncidentId, batteryPct, sendLocationPing]);

  // Initialize MapLibre GL 2.5D dark map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm-tiles-layer",
            type: "raster",
            source: "osm-tiles",
          },
        ],
      },
      center: [77.632, 12.957],
      zoom: 12.6,
      pitch: 45,
      bearing: -12,
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Center map on user's real GPS when first acquired (if no route yet)
  useEffect(() => {
    if (coords && mapRef.current && !routeData) {
      mapRef.current.flyTo({ center: [coords.lng, coords.lat], zoom: 14 });
    }
  }, [coords, routeData]);

  // Render / update real OSRM routes & OSM Safe Haven markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeData) return;

    const renderRoutes = () => {
      const fastSrc = map.getSource("fastest-route") as maplibregl.GeoJSONSource | undefined;
      if (fastSrc) {
        fastSrc.setData(routeData.fastest_route as never);
      } else {
        map.addSource("fastest-route", {
          type: "geojson",
          data: routeData.fastest_route as never,
        });
        map.addLayer({
          id: "fastest-route-line",
          type: "line",
          source: "fastest-route",
          paint: {
            "line-color": "#E84C3D",
            "line-width": 4,
            "line-dasharray": [2, 1.5],
            "line-opacity": 0.85,
          },
        });
      }

      const safeSrc = map.getSource("safest-route") as maplibregl.GeoJSONSource | undefined;
      if (safeSrc) {
        safeSrc.setData(routeData.safest_route as never);
      } else {
        map.addSource("safest-route", {
          type: "geojson",
          data: routeData.safest_route as never,
        });
        map.addLayer({
          id: "safest-route-glow",
          type: "line",
          source: "safest-route",
          paint: {
            "line-color": "#10B981",
            "line-width": 10,
            "line-opacity": 0.25,
          },
        });
        map.addLayer({
          id: "safest-route-line",
          type: "line",
          source: "safest-route",
          paint: {
            "line-color": "#10B981",
            "line-width": 4.5,
          },
        });
      }

      havenMarkersRef.current.forEach((m) => m.remove());
      havenMarkersRef.current = [];

      routeData.safe_havens.forEach((haven) => {
        const el = document.createElement("div");
        el.className =
          "w-3.5 h-3.5 rounded-full border-2 border-white shadow-lg cursor-pointer";
        el.style.backgroundColor =
          haven.category === "POLICE"
            ? "#38BDF8"
            : haven.category === "HOSPITAL"
            ? "#10B981"
            : "#F59E0B";

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([haven.lng, haven.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 14 }).setHTML(
              `<div style="color:#0A0809;font-size:12px;"><strong>${haven.name}</strong><br/>${haven.category} (${haven.distance_m}m)</div>`
            )
          )
          .addTo(map);
        havenMarkersRef.current.push(marker);
      });

      const allCoords = routeData.safest_route.geometry.coordinates;
      if (allCoords.length > 1) {
        const bounds = new maplibregl.LngLatBounds(allCoords[0], allCoords[0]);
        allCoords.forEach((c) => bounds.extend(c));
        map.fitBounds(bounds, { padding: 50, pitch: 45 });
      }
    };

    if (map.isStyleLoaded()) {
      renderRoutes();
    } else {
      map.once("load", renderRoutes);
    }
  }, [routeData]);

  const handleCalculateSafeRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destQuery.trim()) return;
    setRouteError(null);
    setRouteLoading(true);
    try {
      const originPayload = coords
        ? { origin: { lat: coords.lat, lng: coords.lng } }
        : { origin_address: "Bengaluru, India" };

      const res = await apiFetch<SafeRouteResponse>("/api/saferoute/calculate", {
        method: "POST",
        body: JSON.stringify({
          ...originPayload,
          destination_address: destQuery.trim(),
          hour_of_day: new Date().getHours(),
        }),
      });
      setRouteData(res);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Failed to calculate SafeRoute");
    } finally {
      setRouteLoading(false);
    }
  };

  const triggerSosIncident = async (
    triggerType: "SOS" | "DEADMAN_SWITCH" | "DURESS_PIN"
  ) => {
    if (!coords) {
      setGpsError("Waiting for live GPS fix before triggering incident.");
      return;
    }
    try {
      const res = await apiFetch<{
        incident?: { id: string };
        incident_id?: string;
      }>("/api/incidents/trigger", {
        method: "POST",
        body: JSON.stringify({
          trigger_type: triggerType,
          lat: coords.lat,
          lng: coords.lng,
          battery_pct: batteryPct ?? 100,
          notes: `Triggered from Safety Hub (${triggerType})`,
        }),
      });
      const id = res.incident?.id || res.incident_id || null;
      if (id) {
        if (triggerType !== "DURESS_PIN") {
          setActiveIncidentId(id);
          setThreatLevel("SOS_ACTIVE");
        }
        startRecording(id);
        sendLocationPing({
          lat: coords.lat,
          lng: coords.lng,
          incident_id: id,
          battery: batteryPct ?? undefined,
          speed: coords.speed ?? undefined,
        });
      }
    } catch {
      // ignore
    }
  };

  // Tactile 2-second SOS Hold handlers
  const startSosHold = () => {
    if (holdTimerRef.current !== null) return;
    navigator.vibrate?.(40);
    const start = Date.now();
    holdTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / 2000) * 100);
      setSosProgress(pct);
      if (pct >= 100) {
        clearInterval(holdTimerRef.current!);
        holdTimerRef.current = null;
        navigator.vibrate?.([100, 50, 220]);
        void triggerSosIncident("SOS");
      }
    }, 30);
  };

  const cancelSosHold = () => {
    if (holdTimerRef.current !== null) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (!activeIncidentId) {
      setSosProgress(0);
    }
  };

  // Dead-Man's Switch countdown
  useEffect(() => {
    if (deadmanSeconds === null) return;
    if (deadmanSeconds <= 0) {
      setDeadmanSeconds(null);
      void triggerSosIncident("DEADMAN_SWITCH");
      return;
    }
    if (deadmanSeconds < 120 && threatLevel !== "SOS_ACTIVE") {
      setThreatLevel("DEADMAN_WARNING");
    }
    const timer = window.setTimeout(() => {
      setDeadmanSeconds((s) => (s !== null ? s - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [deadmanSeconds, threatLevel, setThreatLevel]);

  const handleDisarmDeadman = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinFeedback(null);
    try {
      const res = await apiFetch<{ pin_type: "SAFE" | "DURESS" }>(
        "/api/user/verify-pin",
        {
          method: "POST",
          body: JSON.stringify({ pin: pinInput }),
        }
      );
      setDeadmanSeconds(null);
      setPinInput("");
      if (res.pin_type === "SAFE") {
        setThreatLevel("SAFE");
        setPinFeedback("Timer disarmed safely.");
      } else {
        setPinFeedback("Timer disarmed safely.");
        await triggerSosIncident("DURESS_PIN");
      }
    } catch {
      setPinFeedback("Invalid PIN.");
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const circumference = 2 * Math.PI * 52;

  return (
    <div className="min-h-[calc(100vh-2.25rem)] bg-[#0A0809] flex flex-col">
      <UserNavbar />

      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {dispatchNotice && (
          <div className="bento-card p-4 border-emerald-500/40 bg-emerald-950/30 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Siren className="w-6 h-6 text-emerald-400 animate-pulse" />
              <div>
                <div className="text-sm font-bold text-white">
                  Police PCR Dispatched ({dispatchNotice.dispatch_unit || "PCR-01"})
                </div>
                <div className="text-xs text-emerald-200 font-mono">
                  ETA: {dispatchNotice.dispatch_eta_minutes ?? 5} mins • Live tracking active
                </div>
              </div>
            </div>
            <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              DISPATCHED
            </span>
          </div>
        )}

        {/* Top Real Telemetry Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Citizen Safety Hub</h1>
            <p className="text-xs text-white/60 font-mono">
              {coords
                ? `GPS: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                : gpsError
                ? `GPS Error: ${gpsError}`
                : "Acquiring live GPS fix…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {batteryPct !== null && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-white/5 border border-white/10 text-white/80">
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                {batteryPct}%
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${
                connected
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-300"
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              {connected ? "WS LIVE" : "OFFLINE"}
            </span>
            {isRecording && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-red-500/20 border border-red-500/40 text-red-200">
                <Radio className="w-3.5 h-3.5 animate-pulse text-[#E84C3D]" />
                REC ({chunks.length} chunks)
              </span>
            )}
          </div>
        </div>

        {/* Main Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* MapLibre 2.5D SafeRoute Map + Nominatim Search */}
          <div className="lg:col-span-8 bento-card overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-bold text-white">
                    SafeRoute OSRM + Overpass Corridor
                  </span>
                </div>
                {routeData && (
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <span className="text-emerald-400">
                      ● Safest: {routeData.safest_route.properties?.safety_score}/100
                    </span>
                    <span className="text-[#E84C3D]">
                      --- Fastest: {routeData.fastest_route.properties?.safety_score}/100
                    </span>
                  </div>
                )}
              </div>

              <form onSubmit={handleCalculateSafeRoute} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={destQuery}
                    onChange={(e) => setDestQuery(e.target.value)}
                    placeholder="Search destination (Nominatim OSM, e.g. Koramangala, Bengaluru)…"
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/45 border border-white/15 text-xs text-white focus:outline-none focus:border-[#E84C3D]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={routeLoading}
                  className="px-4 py-2 rounded-xl bg-white text-[#0A0809] font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>{routeLoading ? "Routing…" : "Find SafeRoute"}</span>
                </button>
              </form>
              {routeError && (
                <p className="text-xs text-red-300 font-mono">{routeError}</p>
              )}
            </div>

            <div ref={mapContainerRef} className="w-full h-[360px] sm:h-[410px]" />
          </div>

          {/* Right Column: Radial SOS Ring + Dead-Man's Switch */}
          <div className="lg:col-span-4 space-y-5">
            <div className="bento-card p-6 flex flex-col items-center text-center">
              <span className="font-mono text-[11px] uppercase tracking-wider text-white/55 mb-3">
                Hold 2 Seconds to Trigger SOS
              </span>

              <button
                type="button"
                onPointerDown={startSosHold}
                onPointerUp={cancelSosHold}
                onPointerLeave={cancelSosHold}
                className="relative w-36 h-36 rounded-full flex items-center justify-center select-none touch-none focus:outline-none group"
              >
                <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="8"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke="#E84C3D"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={
                      circumference - (sosProgress / 100) * circumference
                    }
                  />
                </svg>
                <div
                  className={`absolute inset-4 rounded-full flex flex-col items-center justify-center transition-all ${
                    activeIncidentId
                      ? "bg-[#E84C3D] shadow-[0_0_35px_rgba(232,76,61,0.65)]"
                      : "bg-[#E84C3D]/90 group-hover:bg-[#E84C3D]"
                  }`}
                >
                  <ShieldAlert className="w-7 h-7 text-white mb-1" />
                  <span className="text-sm font-extrabold tracking-wider text-white">
                    {activeIncidentId ? "SOS LIVE" : "HOLD SOS"}
                  </span>
                </div>
              </button>

              {activeIncidentId && (
                <button
                  type="button"
                  onClick={() => {
                    stopRecording();
                    setActiveIncidentId(null);
                    setSosProgress(0);
                    setThreatLevel("SAFE");
                  }}
                  className="mt-3 text-xs font-mono text-white/60 hover:text-white underline"
                >
                  Stop Local Telemetry
                </button>
              )}
            </div>

            <div className="bento-card p-5 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Timer className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-bold text-white">Dead-Man&apos;s Switch</h2>
                </div>
                {deadmanSeconds !== null && (
                  <span className="font-mono text-lg font-bold text-amber-300">
                    {formatTimer(deadmanSeconds)}
                  </span>
                )}
              </div>

              {deadmanSeconds === null ? (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "1 min", sec: 60 },
                    { label: "15 min", sec: 900 },
                    { label: "30 min", sec: 1800 },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        setPinFeedback(null);
                        setDeadmanSeconds(opt.sec);
                      }}
                      className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono text-white flex items-center justify-center gap-1"
                    >
                      <Clock className="w-3 h-3 text-amber-400" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <form onSubmit={handleDisarmDeadman} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="password"
                      maxLength={6}
                      placeholder="Enter Safe PIN"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/15 font-mono text-sm text-white"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white"
                    >
                      Disarm
                    </button>
                  </div>
                </form>
              )}

              {pinFeedback && (
                <p className="text-xs font-mono text-emerald-300">{pinFeedback}</p>
              )}
            </div>
          </div>
        </div>

        {/* One-Tap Helpline Quick-Dial Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {QUICK_HELPLINES.map((h) => (
            <a
              key={h.num}
              href={`tel:${h.num}`}
              className="bento-card p-4 hover:border-red-500/40 transition-colors flex items-center justify-between group"
            >
              <div>
                <div className="text-xs font-semibold text-white/80">{h.label}</div>
                <div className="font-mono text-xl font-bold text-white mt-0.5">{h.num}</div>
                <div className="text-[11px] text-white/50">{h.desc}</div>
              </div>
              <div className="w-9 h-9 rounded-xl bg-[#E84C3D]/15 border border-[#E84C3D]/30 flex items-center justify-center group-hover:bg-[#E84C3D] transition-colors">
                <PhoneCall className="w-4 h-4 text-[#E84C3D] group-hover:text-white" />
              </div>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
};
