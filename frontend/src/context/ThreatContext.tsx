import React, { createContext, useContext, useState } from "react";

export type ThreatLevel = "SAFE" | "DEADMAN_WARNING" | "SOS_ACTIVE" | "COVERT";

interface ThreatContextValue {
  threatLevel: ThreatLevel;
  setThreatLevel: (level: ThreatLevel) => void;
  deadmanSecondsLeft: number | null;
  setDeadmanSecondsLeft: (seconds: number | null) => void;
}

const ThreatContext = createContext<ThreatContextValue>({
  threatLevel: "SAFE",
  setThreatLevel: () => {},
  deadmanSecondsLeft: null,
  setDeadmanSecondsLeft: () => {},
});

export const ThreatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [threatLevel, setThreatLevel] = useState<ThreatLevel>("SAFE");
  const [deadmanSecondsLeft, setDeadmanSecondsLeft] = useState<number | null>(null);

  return (
    <ThreatContext.Provider
      value={{ threatLevel, setThreatLevel, deadmanSecondsLeft, setDeadmanSecondsLeft }}
    >
      {children}
    </ThreatContext.Provider>
  );
};

export const useThreat = () => useContext(ThreatContext);
