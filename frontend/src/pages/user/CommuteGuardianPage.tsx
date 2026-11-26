import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  Clock,
  Navigation,
  Radio,
  Siren,
} from "lucide-react";
import { UserNavbar } from "../../components/UserNavbar";
import { useThreat } from "../../context/ThreatContext";
import { useUserWebSocket } from "../../hooks/useUserWebSocket";
import { apiFetch, getUserToken } from "../../lib/api";

interface TripLog {
  time: string;
  event: string;
  detail: string;
}

export const CommuteGuardianPage: React.FC = () => {
  const token = getUserToken();
  if (!token) return <Navigate to="/login" replace />;

  const { setThreatLevel } = useThreat();
  const { connected, dispatchNotice, sendLocationPing } = useUserWebSocket();

  const [tripActive, setTripActive] = useState(true);
  const [batteryPct, setBatteryPct] = useState(74);
  const [etaMinutes, setEtaMinutes] = useState(14);
  const [deviated, setDeviated] = useState(false);
  const [coords, setCoords] = useState({ lat: 12.9682, lng: 77.6371 });
  const [logs, setLogs] = useState<TripLog[]>([
    {
      time: new Date().toLocaleTimeString(),
      event: "TRIP_STARTED",
      detail: "Monitoring Safest Corridor: Indiranagar → Koramangala",
    },
  ]);

  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    nav.getBattery?.()
      .then((b) => setBatteryPct(Math.round(b.level * 100)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!tripActive) return;
    const timer = window.setInterval(() => {
      setCoords((prev) => {
        const next = {
          lat: Number((prev.lat - 0.0002).toFixed(6)),
          lng: Number((prev.lng - 0.0001).toFixed(6)),
        };
        sendLocationPing({
          lat: next.lat,
          lng: next.lng,
          battery: batteryPct,
          speed: 24,
        });
        return next;
      });
      setEtaMinutes((m) => (m > 1 ? m - 1 : 1));
    }, 6000);
    return () => clearInterval(timer);
  }, [tripActive, batteryPct, sendLocationPing]);

  const handleSimulateDeviation = async () => {
    setDeviated(true);
    setThreatLevel("DEADMAN_WARNING");

    const devCoords = { lat: 12.9521, lng: 77.6512 };
    setCoords(devCoords);

    sendLocationPing({
      lat: devCoords.lat,
      lng: devCoords.lng,
      battery: batteryPct,
      route_deviation: true,
    });

    setLogs((prev) => [
      {
        time: new Date().toLocaleTimeString(),
        event: "ROUTE_DEVIATION",
        detail: "Deviated 650m off SafeRoute. Autonomous AI Guardian triggered.",
      },
      ...prev,
    ]);

    try {
      const res = await apiFetch<{
        escalation: { summary: string };
      }>("/api/guardian/evaluate", {
        method: "POST",
        body: JSON.stringify({
          event_type: "ROUTE_DEVIATION",
          lat: devCoords.lat,
          lng: devCoords.lng,
          battery_pct: batteryPct,
          zone_risk: "HIGH",
          notes: "Simulated 650m off-corridor deviation during night commute",
        }),
      });
      setLogs((prev) => [
        {
          time: new Date().toLocaleTimeString(),
          event: "AI_GUARDIAN_ESCALATED",
          detail: res.escalation.summary,
        },
        ...prev,
      ]);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-[calc(100vh-2.25rem)] bg-[#0A0809] flex flex-col">
      <UserNavbar />

      <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
        {dispatchNotice && (
          <div className="bento-card p-4 border-emerald-500/40 bg-emerald-950/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Siren className="w-5 h-5 text-emerald-400 animate-pulse" />
              <div className="text-sm font-bold text-white">
                PCR Unit {dispatchNotice.dispatch_unit || "PCR-01"} Dispatched • ETA{" "}
                {dispatchNotice.dispatch_eta_minutes ?? 5}m
              </div>
            </div>
            <span className="font-mono text-xs text-emerald-300">LIVE RESPONSE</span>
          </div>
        )}

        <div className="bento-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-1">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>COMMUTE GUARDIAN • {connected ? "WS SYNCED" : "OFFLINE"}</span>
              </div>
              <h1 className="text-2xl font-bold text-white">
                Indiranagar → Koramangala
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2 font-mono text-xs">
                <Clock className="w-4 h-4 text-sky-400" />
                <span>ETA: {etaMinutes} min</span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2 font-mono text-xs">
                <BatteryCharging className="w-4 h-4 text-emerald-400" />
                <span>{batteryPct}%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-black/35 border border-white/10">
              <div className="text-[11px] uppercase text-white/50">Current GPS</div>
              <div className="font-mono text-sm text-white mt-1">
                {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-black/35 border border-white/10">
              <div className="text-[11px] uppercase text-white/50">Corridor Status</div>
              <div
                className={`font-mono text-sm font-bold mt-1 ${
                  deviated ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {deviated ? "DEVIATION DETECTED" : "ON SAFEST CORRIDOR"}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-black/35 border border-white/10 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase text-white/50">Trip Mode</div>
                <div className="font-mono text-sm text-white mt-1">
                  {tripActive ? "ACTIVE" : "PAUSED"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTripActive((v) => !v)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold"
              >
                {tripActive ? "Pause" : "Resume"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSimulateDeviation}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E84C3D] hover:bg-[#D43D2E] text-white font-bold text-sm transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Trigger Route Deviation (Demo)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDeviated(false);
                setThreatLevel("SAFE");
                setLogs((prev) => [
                  {
                    time: new Date().toLocaleTimeString(),
                    event: "BACK_ON_ROUTE",
                    detail: "User confirmed safety; corridor monitoring normal.",
                  },
                  ...prev,
                ]);
              }}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Mark Safe</span>
            </button>
          </div>
        </div>

        {/* Live Telemetry Log */}
        <div className="bento-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-[#E84C3D]" />
            <h2 className="text-sm font-bold text-white">Live Telemetry &amp; Guardian Feed</h2>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logs.map((log, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-black/40 border border-white/10 flex items-start justify-between gap-4"
              >
                <div>
                  <span className="font-mono text-xs font-bold text-[#E84C3D]">
                    {log.event}
                  </span>
                  <p className="text-xs text-white/75 mt-0.5">{log.detail}</p>
                </div>
                <span className="font-mono text-[11px] text-white/45 shrink-0">
                  {log.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};
