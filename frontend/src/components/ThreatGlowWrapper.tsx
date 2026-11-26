import React from "react";
import { useLocation } from "react-router-dom";
import { useThreat } from "../context/ThreatContext";

export const ThreatGlowWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const { threatLevel } = useThreat();

  const isVault = pathname.startsWith("/vault") || threatLevel === "COVERT";

  let glowOverlay: React.ReactNode = null;

  if (!isVault) {
    if (threatLevel === "SAFE") {
      glowOverlay = (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 transition-all duration-700"
          style={{
            boxShadow: "inset 0 0 90px rgba(16, 185, 129, 0.09)",
          }}
        />
      );
    } else if (threatLevel === "DEADMAN_WARNING") {
      glowOverlay = (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 animate-amber-glow transition-all duration-500"
          style={{
            boxShadow: "inset 0 0 120px rgba(245, 158, 11, 0.28)",
          }}
        />
      );
    } else if (threatLevel === "SOS_ACTIVE") {
      glowOverlay = (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 transition-all duration-500"
          style={{
            boxShadow: "inset 0 0 150px rgba(232, 76, 61, 0.42)",
          }}
        />
      );
    }
  }

  return (
    <div className="relative min-h-screen bg-[#0A0809] text-white">
      {glowOverlay}
      {children}
    </div>
  );
};
