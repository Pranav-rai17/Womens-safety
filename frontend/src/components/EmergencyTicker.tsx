import React from "react";
import { useLocation } from "react-router-dom";
import { PhoneCall, Radio } from "lucide-react";

interface Helpline {
  label: string;
  number: string;
  tag?: string;
}

const HELPLINES: Helpline[] = [
  { label: "National Emergency", number: "112", tag: "SOS" },
  { label: "Women Helpline", number: "1091" },
  { label: "Women Distress", number: "181" },
  { label: "Cybercrime", number: "1930" },
  { label: "Ambulance", number: "108" },
  { label: "NALSA Legal Aid", number: "15100" },
];

export const EmergencyTicker: React.FC = () => {
  const { pathname } = useLocation();

  // Completely hide in Covert Vault
  if (pathname.startsWith("/vault")) {
    return null;
  }

  const renderItems = (prefix: string) =>
    HELPLINES.map((item) => (
      <a
        key={`${prefix}-${item.number}`}
        href={`tel:${item.number}`}
        className="inline-flex items-center gap-2 px-4 py-1 text-xs font-medium text-white/85 hover:text-white transition-colors group"
      >
        <PhoneCall className="w-3.5 h-3.5 text-[#E84C3D] group-hover:scale-110 transition-transform" />
        <span className="text-white/65">{item.label}:</span>
        <span className="font-mono font-semibold text-white tracking-wide underline decoration-red-500/40 underline-offset-4 group-hover:decoration-[#E84C3D]">
          {item.number}
        </span>
        <span className="text-white/20 ml-3">•</span>
      </a>
    ));

  return (
    <div className="sticky top-0 z-50 w-full bg-[#160608]/95 backdrop-blur-md border-b border-red-500/25">
      <div className="flex items-center h-9 overflow-hidden">
        {/* Sticky Left Pulsing Badge */}
        <div className="relative z-10 flex items-center gap-2 px-3.5 h-full bg-[#160608] border-r border-red-500/25 shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E84C3D] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#E84C3D]" />
          </span>
          <Radio className="w-3.5 h-3.5 text-[#E84C3D]" />
          <span className="text-[11px] font-bold tracking-wider uppercase text-red-100 whitespace-nowrap">
            24x7 GOVT HELPLINES
          </span>
        </div>

        {/* Rolling Marquee (pauses on hover) */}
        <div className="marquee-container flex-1 overflow-hidden">
          <div className="animate-marquee items-center">
            <div className="flex items-center">{renderItems("a")}</div>
            <div className="flex items-center" aria-hidden="true">
              {renderItems("b")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
