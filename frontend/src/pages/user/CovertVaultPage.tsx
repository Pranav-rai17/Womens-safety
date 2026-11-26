import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ShieldCheck, Volume2 } from "lucide-react";
import { useAudioEvidence } from "../../hooks/useAudioEvidence";
import { useUserWebSocket } from "../../hooks/useUserWebSocket";
import { activateTabCloak, restoreTabCloak } from "../../hooks/useTabCloak";
import { apiFetch, getUserToken } from "../../lib/api";

/**
 * Covert Vault (/vault):
 * - Hides navbar, EmergencyTicker, and ThreatGlowWrapper.
 * - Looks 100% like a clean, working Calculator.
 * - Safe PIN + `=` unlocks the private evidence vault.
 * - Duress PIN + `=` keeps the calculator normal on-screen while silently
 *   triggering DURESS_PIN, streaming real GPS via navigator.geolocation.watchPosition,
 *   and recording 10s .webm audio chunks via MediaRecorder -> MinIO/S3.
 */
export const CovertVaultPage: React.FC = () => {
  const navigate = useNavigate();
  const { sendLocationPing } = useUserWebSocket();
  const { chunks, startRecording, stopRecording } = useAudioEvidence();

  const [display, setDisplay] = useState("0");
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [covertIncidentId, setCovertIncidentId] = useState<string | null>(null);
  const coordsRef = useRef<{ lat: number; lng: number; speed?: number | null } | null>(null);
  const batteryRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    activateTabCloak();
  }, []);

  // Read real battery %
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    nav.getBattery?.()
      .then((b) => {
        batteryRef.current = Math.round(b.level * 100);
      })
      .catch(() => {});
  }, []);

  // Real browser GPS watchPosition()
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed,
        };
        coordsRef.current = next;
        if (covertIncidentId) {
          sendLocationPing({
            lat: next.lat,
            lng: next.lng,
            incident_id: covertIncidentId,
            battery: batteryRef.current,
            speed: next.speed ?? undefined,
          });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [covertIncidentId, sendLocationPing]);

  const triggerSilentDuress = async () => {
    if (!getUserToken()) return;
    const lat = coordsRef.current?.lat ?? 0;
    const lng = coordsRef.current?.lng ?? 0;
    try {
      const res = await apiFetch<{ incident_id?: string }>("/api/incidents/trigger", {
        method: "POST",
        body: JSON.stringify({
          trigger_type: "DURESS_PIN",
          lat,
          lng,
          battery_pct: batteryRef.current ?? 100,
          notes: "Covert Duress PIN entered in Calculator Vault",
        }),
      });
      if (res.incident_id) {
        setCovertIncidentId(res.incident_id);
        startRecording(res.incident_id);
        if (coordsRef.current) {
          sendLocationPing({
            lat: coordsRef.current.lat,
            lng: coordsRef.current.lng,
            incident_id: res.incident_id,
            battery: batteryRef.current,
          });
        }
      }
    } catch {
      // Never reveal errors on covert screen
    }
  };

  const evaluateOrCheckPin = async () => {
    const cleaned = display.trim();

    if (/^\d{4,8}$/.test(cleaned) && getUserToken()) {
      try {
        const res = await apiFetch<{ pin_type: "SAFE" | "DURESS" }>(
          "/api/user/verify-pin",
          {
            method: "POST",
            body: JSON.stringify({ pin: cleaned }),
          }
        );
        if (res.pin_type === "SAFE") {
          setVaultUnlocked(true);
          setDisplay("0");
          return;
        }
        if (res.pin_type === "DURESS") {
          setDisplay("0");
          await triggerSilentDuress();
          return;
        }
      } catch {
        // Not a matching PIN — fall through to normal arithmetic
      }
    }

    try {
      const sanitized = cleaned.replace(/[^0-9+\-*/.]/g, "");
      if (!sanitized) return;
      const result = Function(`"use strict"; return (${sanitized})`)();
      setDisplay(String(Number.isFinite(result) ? result : "0"));
    } catch {
      setDisplay("0");
    }
  };

  const handlePress = (val: string) => {
    if (val === "C") {
      setDisplay("0");
      return;
    }
    if (val === "=") {
      void evaluateOrCheckPin();
      return;
    }
    setDisplay((prev) => (prev === "0" || prev === "Error" ? val : prev + val));
  };

  if (vaultUnlocked) {
    return (
      <div className="min-h-screen bg-[#0A0809] text-white p-6 flex items-center justify-center">
        <div className="bento-card max-w-lg w-full p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h1 className="text-lg font-bold">Private Evidence Vault</h1>
            </div>
            <button
              onClick={() => {
                setVaultUnlocked(false);
                activateTabCloak();
              }}
              className="px-3 py-1.5 rounded-lg bg-white/10 text-xs font-semibold"
            >
              Return to Calculator
            </button>
          </div>

          <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <Volume2 className="w-4 h-4 text-[#E84C3D]" />
              <span>Encrypted Audio Chunks ({chunks.length})</span>
            </div>
            {chunks.length === 0 ? (
              <p className="text-xs text-white/50">
                No audio chunks captured in this session yet.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {chunks.map((c) => (
                  <div
                    key={c.chunk_id}
                    className="text-[11px] font-mono text-white/75 p-2 rounded bg-white/5 flex justify-between"
                  >
                    <span>Chunk #{c.chunk_index} ({c.size_bytes} B)</span>
                    <span className="text-emerald-400">{c.sha256.slice(0, 12)}…</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              onClick={() => {
                stopRecording();
                restoreTabCloak();
                navigate("/dashboard");
              }}
              className="px-4 py-2 rounded-xl bg-white text-[#0A0809] text-xs font-bold"
            >
              Exit Cloak → Safety Hub
            </button>
            <span className="font-mono text-[11px] text-white/45 flex items-center gap-1">
              <Lock className="w-3 h-3" /> MinIO + SHA-256 Verified
            </span>
          </div>
        </div>
      </div>
    );
  }

  const buttons = [
    "7", "8", "9", "/",
    "4", "5", "6", "*",
    "1", "2", "3", "-",
    "C", "0", "=", "+",
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-xs rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-400">Calculator</span>
          <button
            onClick={() => {
              restoreTabCloak();
              navigate("/");
            }}
            className="text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            v2.4
          </button>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 mb-4 text-right font-mono text-2xl text-white overflow-x-auto">
          {display}
        </div>

        <div className="grid grid-cols-4 gap-2.5">
          {buttons.map((btn) => (
            <button
              key={btn}
              onClick={() => handlePress(btn)}
              className={`h-12 rounded-xl font-mono text-base font-semibold transition-colors ${
                btn === "="
                  ? "bg-sky-600 hover:bg-sky-500 text-white"
                  : btn === "C"
                  ? "bg-slate-800 hover:bg-slate-700 text-rose-400"
                  : ["/", "*", "-", "+"].includes(btn)
                  ? "bg-slate-800 hover:bg-slate-700 text-sky-400"
                  : "bg-slate-800/70 hover:bg-slate-700 text-slate-100"
              }`}
            >
              {btn}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
