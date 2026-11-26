import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  BatteryWarning,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Command,
  Cpu,
  LogOut,
  MapPin,
  Radio,
  Search,
  ShieldAlert,
  Siren,
  Volume2,
  X,
} from "lucide-react";
import {
  apiFetch,
  clearAdminToken,
  getAdminToken,
  WS_BASE_URL,
} from "../../lib/api";

interface AudioChunk {
  id?: string;
  chunk_id?: string;
  chunk_index: number;
  sha256_hash?: string;
  sha256?: string;
  size_bytes: number;
  storage_key?: string;
  created_at?: string;
}

interface Incident {
  id: string;
  user_id: string;
  trigger_type: "SOS" | "DURESS_PIN" | "DEADMAN_SWITCH" | "AI_ANOMALY";
  status: "ACTIVE" | "DISPATCHED" | "RESOLVED";
  is_covert: boolean;
  lat: number;
  lng: number;
  notes?: string;
  ai_confidence?: number;
  ai_reasoning?: string;
  dispatch_unit?: string;
  dispatch_eta_minutes?: number;
  created_at: string;
  user?: {
    id: string;
    phone: string;
    full_name: string;
    emergency_contacts: { name: string; phone: string; relation?: string }[];
  } | null;
  audio_chunks?: AudioChunk[];
}

interface ThoughtEvent {
  incident_id?: string;
  step_index?: number;
  stage?: string;
  tool_name?: string;
  thought: string;
  timestamp: string;
}

interface OsmPoliceStation {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

const SEVERITY_RANK: Record<string, number> = {
  DURESS_PIN: 0,
  SOS: 1,
  DEADMAN_SWITCH: 2,
  AI_ANOMALY: 3,
};

export const AdminCommandCenterPage: React.FC<{ embedded?: boolean }> = ({
  embedded = false,
}) => {
  const navigate = useNavigate();
  const token = getAdminToken();
  if (!token && !embedded) return <Navigate to="/admin/login" replace />;

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [batteryByUser, setBatteryByUser] = useState<Record<string, number>>({});
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({});
  const [thoughts, setThoughts] = useState<ThoughtEvent[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const policeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [policeStations, setPoliceStations] = useState<OsmPoliceStation[]>([]);

  // Live 1s clock for elapsed timers
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Ctrl + K Command Palette shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load initial incidents
  const fetchIncidents = useCallback(async () => {
    if (!getAdminToken()) return;
    try {
      const res = await apiFetch<{ incidents: Incident[] }>(
        "/api/admin/incidents",
        {},
        "ADMIN"
      );
      setIncidents(res.incidents);
      if (res.incidents.length > 0 && !selectedId) {
        setSelectedId(res.incidents[0].id);
      }
      setTrails((prev) => {
        const next = { ...prev };
        res.incidents.forEach((inc) => {
          if (!next[inc.id]) next[inc.id] = [[inc.lng, inc.lat]];
        });
        return next;
      });
    } catch {
      // ignore
    }
  }, [selectedId]);

  useEffect(() => {
    void fetchIncidents();
  }, [fetchIncidents]);

  // Connect to Admin WebSocket
  useEffect(() => {
    const activeToken = getAdminToken();
    if (!activeToken) return;

    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/admin?token=${encodeURIComponent(activeToken)}`
    );
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, data, timestamp } = msg;

        if (type === "NEW_INCIDENT" && data) {
          setIncidents((prev) => [data as Incident, ...prev.filter((i) => i.id !== data.id)]);
          setSelectedId((cur) => cur || data.id);
          setTrails((prev) => ({
            ...prev,
            [data.id]: [[data.lng, data.lat]],
          }));
        } else if (type === "SOS_LOCATION_UPDATE" && data) {
          if (typeof data.battery === "number" && data.user_id) {
            setBatteryByUser((prev) => ({ ...prev, [data.user_id]: data.battery }));
          }
          if (data.incident_id) {
            setIncidents((prev) =>
              prev.map((inc) =>
                inc.id === data.incident_id
                  ? { ...inc, lat: data.lat, lng: data.lng }
                  : inc
              )
            );
            setTrails((prev) => {
              const existing = prev[data.incident_id] || [];
              return {
                ...prev,
                [data.incident_id]: [...existing, [data.lng, data.lat]],
              };
            });
          }
        } else if (type === "AI_THOUGHT_STREAM" && data) {
          setThoughts((prev) => [
            {
              incident_id: data.incident_id,
              step_index: data.step_index,
              stage: data.stage,
              tool_name: data.tool_name,
              thought: data.thought,
              timestamp: timestamp || new Date().toISOString(),
            },
            ...prev.slice(0, 49),
          ]);
        } else if (type === "NEW_AUDIO_CHUNK" && data) {
          setIncidents((prev) =>
            prev.map((inc) =>
              inc.id === data.incident_id
                ? {
                    ...inc,
                    audio_chunks: [...(inc.audio_chunks || []), data as AudioChunk],
                  }
                : inc
            )
          );
        } else if (type === "POLICE_DISPATCHED" && data) {
          setIncidents((prev) =>
            prev.map((inc) => (inc.id === data.id ? (data as Incident) : inc))
          );
        }
      } catch {
        // ignore
      }
    };

    return () => ws.close();
  }, []);

  // Initialize Tactical MapLibre GL Map
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
        layers: [{ id: "osm-tiles-layer", type: "raster", source: "osm-tiles" }],
      },
      center: [77.632, 12.957],
      zoom: 12.2,
      pitch: 40,
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Query real nearby OSM Police Stations via Overpass API around selected incident
  useEffect(() => {
    const target = incidents.find((i) => i.id === selectedId) || incidents[0];
    if (!target) return;

    const query = `[out:json][timeout:10];node["amenity"="police"](around:4000,${target.lat},${target.lng});out body;`;
    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: new URLSearchParams({ data: query }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json?.elements) return;
        const stations: OsmPoliceStation[] = json.elements
          .filter((el: { lat?: number; lon?: number }) => el.lat && el.lon)
          .slice(0, 12)
          .map((el: { id: number; lat: number; lon: number; tags?: { name?: string } }) => ({
            id: el.id,
            name: el.tags?.name || "Police Station (OSM)",
            lat: el.lat,
            lng: el.lon,
          }));
        setPoliceStations(stations);
      })
      .catch(() => {});
  }, [selectedId, incidents.length]);

  // Render real OSM Police Station markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    policeMarkersRef.current.forEach((m) => m.remove());
    policeMarkersRef.current = [];

    policeStations.forEach((ps) => {
      const el = document.createElement("div");
      el.className =
        "w-3.5 h-3.5 rounded-full bg-sky-400 border-2 border-white shadow-lg";
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([ps.lng, ps.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 12 }).setHTML(
            `<div style="color:#0A0809;font-size:12px;"><strong>${ps.name}</strong><br/>OSM Police Station</div>`
          )
        )
        .addTo(map);
      policeMarkersRef.current.push(marker);
    });
  }, [policeStations]);

  // Sync pulsing SOS markers & GPS breadcrumb trail
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    incidents
      .filter((i) => i.status !== "RESOLVED")
      .forEach((inc) => {
        const el = document.createElement("div");
        el.className =
          "w-5 h-5 rounded-full bg-[#E84C3D] border-2 border-white shadow-[0_0_20px_rgba(232,76,61,0.9)] animate-pulse cursor-pointer";
        el.onclick = () => setSelectedId(inc.id);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([inc.lng, inc.lat])
          .addTo(map);
        markersRef.current.push(marker);
      });

    if (selectedId && trails[selectedId] && map.isStyleLoaded()) {
      const coords = trails[selectedId];
      const geojson = {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: coords },
        properties: {},
      };
      const existing = map.getSource("selected-trail") as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(geojson);
      } else {
        map.addSource("selected-trail", { type: "geojson", data: geojson });
        map.addLayer({
          id: "selected-trail-line",
          type: "line",
          source: "selected-trail",
          paint: { "line-color": "#E84C3D", "line-width": 3.5 },
        });
      }
    }
  }, [incidents, selectedId, trails]);

  const sortedIncidents = useMemo(() => {
    return [...incidents].sort((a, b) => {
      if (a.status === "RESOLVED" && b.status !== "RESOLVED") return 1;
      if (a.status !== "RESOLVED" && b.status === "RESOLVED") return -1;
      const ra = SEVERITY_RANK[a.trigger_type] ?? 9;
      const rb = SEVERITY_RANK[b.trigger_type] ?? 9;
      if (ra !== rb) return ra - rb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [incidents]);

  const selectedIncident = useMemo(
    () => sortedIncidents.find((i) => i.id === selectedId) || sortedIncidents[0] || null,
    [sortedIncidents, selectedId]
  );

  const handleDispatch = async (incidentId: string) => {
    const res = await apiFetch<{ incident: Incident }>(
      `/api/admin/incidents/${incidentId}/dispatch`,
      {
        method: "POST",
        body: JSON.stringify({ unit_id: "PCR-04", eta_minutes: 4 }),
      },
      "ADMIN"
    );
    setIncidents((prev) =>
      prev.map((i) => (i.id === incidentId ? res.incident : i))
    );
  };

  const handleResolve = async (incidentId: string) => {
    const res = await apiFetch<{ incident: Incident }>(
      `/api/admin/incidents/${incidentId}/resolve`,
      { method: "POST" },
      "ADMIN"
    );
    setIncidents((prev) =>
      prev.map((i) => (i.id === incidentId ? res.incident : i))
    );
  };

  const handlePlayChunk = async (chunkId: string) => {
    if (!getAdminToken()) return;
    try {
      const res = await apiFetch<{ playback_url: string }>(
        `/api/recordings/playback-url?chunk_id=${encodeURIComponent(chunkId)}`,
        {},
        "ADMIN"
      );
      setActiveAudioUrl(res.playback_url);
    } catch {
      // ignore
    }
  };

  const formatElapsed = (iso: string) => {
    const diff = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const filteredPalette = sortedIncidents.filter(
    (inc) =>
      inc.trigger_type.toLowerCase().includes(paletteQuery.toLowerCase()) ||
      (inc.user?.full_name || "").toLowerCase().includes(paletteQuery.toLowerCase()) ||
      (inc.user?.phone || "").includes(paletteQuery)
  );

  return (
    <div
      className={`${
        embedded ? "h-full" : "h-[calc(100vh-2.25rem)]"
      } bg-[#0A0809] text-white flex flex-col overflow-hidden`}
    >
      {/* Top Command Bar */}
      <header className="h-14 border-b border-white/10 bg-[#140F11]/90 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="w-5 h-5 text-[#E84C3D]" />
          <span className="font-bold text-sm tracking-wide uppercase">
            Police Command Center
          </span>
          <span
            className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${
              wsConnected
                ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-300"
                : "bg-amber-500/15 border-amber-500/35 text-amber-300"
            }`}
          >
            {wsConnected ? "WS LIVE" : "CONNECTING"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 font-mono text-[11px] text-white/75 inline-flex items-center gap-1.5"
          >
            <Command className="w-3 h-3 text-[#E84C3D]" />
            <span>Ctrl+K</span>
          </button>
          {!embedded && (
            <button
              type="button"
              onClick={() => {
                clearAdminToken();
                navigate("/admin/login");
              }}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main 3-Column Command Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
        {/* Left Sidebar: Live Alert Queue */}
        <aside className="lg:col-span-3 border-r border-white/10 bg-[#100B0D] overflow-y-auto p-3 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[11px] uppercase tracking-wider text-white/55">
              Live Alert Queue ({sortedIncidents.length})
            </span>
          </div>

          {sortedIncidents.length === 0 ? (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-xs text-white/50 text-center">
              No active incidents. Waiting for telemetry…
            </div>
          ) : (
            sortedIncidents.map((inc) => {
              const bat = batteryByUser[inc.user_id];
              const isSelected = selectedIncident?.id === inc.id;
              const isCritical = inc.trigger_type === "DURESS_PIN";
              return (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(inc.id);
                    mapRef.current?.flyTo({ center: [inc.lng, inc.lat], zoom: 14 });
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    isSelected
                      ? "bg-[#E84C3D]/15 border-[#E84C3D]/60"
                      : "bg-[#140F11]/80 border-white/10 hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                        isCritical
                          ? "bg-red-500/25 text-red-200 border border-red-500/40"
                          : "bg-amber-500/20 text-amber-200 border border-amber-500/35"
                      }`}
                    >
                      {isCritical ? "CRITICAL - DURESS PIN" : `HIGH - ${inc.trigger_type}`}
                    </span>
                    <span className="font-mono text-[11px] text-white/60">
                      {formatElapsed(inc.created_at)}
                    </span>
                  </div>

                  <div className="text-xs font-bold text-white mt-2">
                    {inc.user?.full_name || inc.user?.phone || "Citizen"}
                  </div>

                  <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono text-white/55">
                    <span>{inc.status}</span>
                    {typeof bat === "number" && bat < 15 && (
                      <span className="inline-flex items-center gap-1 text-red-400 font-bold">
                        <BatteryWarning className="w-3 h-3" /> {bat}%
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </aside>

        {/* Center: Full-Bleed Tactical Map */}
        <section className="lg:col-span-5 relative min-h-[260px]">
          <div ref={mapContainerRef} className="w-full h-full" />
        </section>

        {/* Right Panel: War Room & Synced Audio Timeline */}
        <aside className="lg:col-span-4 border-l border-white/10 bg-[#100B0D] overflow-y-auto p-4 space-y-4">
          {!selectedIncident ? (
            <div className="text-xs text-white/50 text-center py-10">
              Select an incident from the queue to open War Room controls.
            </div>
          ) : (
            <>
              <div className="bento-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#E84C3D]">
                    {selectedIncident.trigger_type}
                    {selectedIncident.is_covert ? " (COVERT SILENT)" : ""}
                  </span>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/10">
                    {selectedIncident.status === "ACTIVE"
                      ? "TRIGGERED"
                      : selectedIncident.status === "DISPATCHED"
                      ? "POLICE_DISPATCHED"
                      : "RESOLVED"}
                  </span>
                </div>

                <div>
                  <div className="text-base font-bold text-white">
                    {selectedIncident.user?.full_name || "Unknown Citizen"}
                  </div>
                  <div className="font-mono text-xs text-white/60">
                    {selectedIncident.user?.phone} •{" "}
                    <MapPin className="w-3 h-3 inline text-[#E84C3D]" />{" "}
                    {selectedIncident.lat.toFixed(4)}, {selectedIncident.lng.toFixed(4)}
                  </div>
                </div>

                {selectedIncident.ai_reasoning && (
                  <p className="text-xs font-mono text-amber-200/90 bg-amber-500/10 border border-amber-500/25 p-2.5 rounded-lg">
                    {selectedIncident.ai_reasoning}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={selectedIncident.status !== "ACTIVE"}
                    onClick={() => void handleDispatch(selectedIncident.id)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-[#E84C3D] hover:bg-[#D43D2E] disabled:opacity-45 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5"
                  >
                    <Siren className="w-4 h-4" />
                    <span>Trigger Police / PCR Dispatch</span>
                  </button>
                  <button
                    type="button"
                    disabled={selectedIncident.status === "RESOLVED"}
                    onClick={() => void handleResolve(selectedIncident.id)}
                    className="py-2.5 px-3 rounded-xl bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-45 text-white font-bold text-xs inline-flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Resolve</span>
                  </button>
                </div>
              </div>

              {/* Synced Audio Waveform + GPS Timeline */}
              <div className="bento-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Volume2 className="w-4 h-4 text-[#E84C3D]" />
                    <span>Audio Evidence Timeline ({selectedIncident.audio_chunks?.length || 0})</span>
                  </div>
                  <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                </div>

                {/* Waveform bar visualization */}
                <div className="h-10 flex items-end gap-1 px-2 py-1.5 rounded-lg bg-black/40 border border-white/10">
                  {[35, 65, 45, 90, 55, 80, 40, 75, 95, 50, 70, 60, 85, 45, 65, 50].map(
                    (h, idx) => (
                      <div
                        key={idx}
                        className="flex-1 rounded-full bg-[#E84C3D]/70"
                        style={{ height: `${h}%` }}
                      />
                    )
                  )}
                </div>

                {activeAudioUrl && (
                  <audio controls autoPlay src={activeAudioUrl} className="w-full h-9" />
                )}

                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(selectedIncident.audio_chunks || []).map((c, idx) => {
                    const cid = c.id || c.chunk_id || "";
                    const hash = c.sha256_hash || c.sha256 || "";
                    return (
                      <div
                        key={cid || idx}
                        className="p-2 rounded-lg bg-black/40 border border-white/10 flex items-center justify-between text-[11px] font-mono"
                      >
                        <div>
                          <span className="text-white">Chunk #{c.chunk_index}</span>
                          {hash && (
                            <span className="ml-2 text-emerald-400">
                              SHA256:{hash.slice(0, 8)}
                            </span>
                          )}
                        </div>
                        {cid && (
                          <button
                            type="button"
                            onClick={() => void handlePlayChunk(cid)}
                            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white"
                          >
                            Play
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Collapsible AI Agent Thought Stream Drawer */}
      <div className="border-t border-white/10 bg-[#140F11]/95 backdrop-blur-md shrink-0">
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          className="w-full px-4 py-2 flex items-center justify-between text-xs font-mono text-white/80 hover:bg-white/5"
        >
          <span className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-[#E84C3D]" />
            <span>AI AGENT THOUGHT STREAM ({thoughts.length} events)</span>
          </span>
          {drawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>

        {drawerOpen && (
          <div className="max-h-36 overflow-y-auto px-4 pb-3 space-y-1 font-mono text-[11px]">
            {thoughts.length === 0 ? (
              <div className="text-white/40">
                Waiting for autonomous Guardian Agent tool calls…
              </div>
            ) : (
              thoughts.map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-white/80">
                  <span className="text-[#E84C3D] shrink-0">
                    [{t.stage || "THOUGHT"}]
                  </span>
                  {t.tool_name && (
                    <span className="text-sky-400 shrink-0">{t.tool_name}()</span>
                  )}
                  <span className="text-white/75">{t.thought}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Ctrl+K Admin Command Palette */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center pt-20 p-4">
          <div className="bento-card max-w-lg w-full p-4 space-y-3 border-red-500/35">
            <div className="flex items-center gap-2 border-b border-white/10 pb-2">
              <Search className="w-4 h-4 text-white/50" />
              <input
                autoFocus
                type="text"
                placeholder="Search active incidents by type, name, or phone..."
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-white focus:outline-none"
              />
              <button onClick={() => setPaletteOpen(false)}>
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {filteredPalette.map((inc) => (
                <div
                  key={inc.id}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(inc.id);
                      setPaletteOpen(false);
                    }}
                    className="text-left flex-1"
                  >
                    <div className="text-xs font-bold text-white">
                      {inc.trigger_type} — {inc.user?.full_name || inc.user?.phone}
                    </div>
                    <div className="font-mono text-[10px] text-white/50">{inc.id}</div>
                  </button>
                  {inc.status === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleDispatch(inc.id);
                        setPaletteOpen(false);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#E84C3D] text-[11px] font-bold"
                    >
                      Dispatch PCR
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
