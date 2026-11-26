import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { activateTabCloak, restoreTabCloak } from "../hooks/useTabCloak";

/**
 * Neutral Calculator disguise for Covert Vault (/vault).
 * EmergencyTicker and ThreatGlowWrapper are automatically disabled on this route.
 */
export const CovertVaultPage: React.FC = () => {
  const navigate = useNavigate();
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    activateTabCloak();
  }, []);

  const handlePress = (val: string) => {
    if (val === "C") {
      setDisplay("0");
      return;
    }
    if (val === "=") {
      try {
        // Simple safe arithmetic evaluation for calculator disguise
        const sanitized = display.replace(/[^0-9+\-*/.]/g, "");
        if (!sanitized) return;
        const result = Function(`"use strict"; return (${sanitized})`)();
        setDisplay(String(Number.isFinite(result) ? result : "0"));
      } catch {
        setDisplay("Error");
      }
      return;
    }
    setDisplay((prev) => (prev === "0" || prev === "Error" ? val : prev + val));
  };

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
            title="Exit Calculator"
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
