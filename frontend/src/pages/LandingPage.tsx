import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Cpu,
  EyeOff,
  Lock,
  MapPin,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { activateTabCloak } from "../hooks/useTabCloak";

const STATS = [
  { label: "WS Alert Latency", value: "< 180ms", sub: "Isolated Admin Room" },
  { label: "Audio Evidence", value: "SHA-256", sub: "10s .webm Chain" },
  { label: "Legal RAG", value: "BNSS §173", sub: "Zero FIR & POSH" },
  { label: "Panic Cloak", value: "ESC ×2", sub: "Calculator Disguise" },
];

const FEATURES = [
  {
    icon: Cpu,
    title: "Autonomous AI Guardian",
    badge: "AGENTIC LOOP",
    description:
      "Evaluates battery telemetry, zone risk, and route deviations in real time—streaming tool calls to Command Center.",
  },
  {
    icon: EyeOff,
    title: "Covert Duress Vault",
    badge: "SILENT PCR",
    description:
      "Double-press Esc to cloak into a working calculator. Duress PIN dispatches police silently with zero screen alerts.",
  },
  {
    icon: MapPin,
    title: "SafeRoute Risk Scorer",
    badge: "PREDICTIVE",
    description:
      "Scores fastest vs. safest corridors by street lighting, night-time footfall, and proximity to 24/7 safe havens.",
  },
  {
    icon: Scale,
    title: "Grounded Legal RAG",
    badge: "ZERO FIR",
    description:
      "Hard-coded immediate-danger 112 bypass plus cited BNSS Section 173 & POSH guidance with copy-ready FIR drafts.",
  },
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleOpenVault = () => {
    activateTabCloak();
    navigate("/vault");
  };

  return (
    <div className="bg-crimson-fluted min-h-[calc(100vh-2.25rem)] flex flex-col justify-between">
      {/* Top Navbar */}
      <header className="w-full border-b border-white/10 bg-[#0A0809]/40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[#E84C3D] flex items-center justify-center shadow-lg shadow-[#E84C3D]/25">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg tracking-tight text-white">
              <span className="font-extrabold">SAFE</span>
              <span className="font-light text-white/80">GUARD</span>
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/75 border border-white/10">
              AI
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm text-white/70">
            <Link to="/saferoute" className="hover:text-white transition-colors">
              SafeRoute
            </Link>
            <Link to="/legal" className="hover:text-white transition-colors">
              Legal RAG
            </Link>
            <Link to="/admin" className="hover:text-white transition-colors">
              Command Center
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">
              <Terminal className="w-3 h-3 text-[#E84C3D]" />
              ESC ×2 Cloak
            </span>
            <Link
              to="/login"
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-5 sm:px-8 pt-14 pb-12 flex flex-col justify-center">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="max-w-3xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#140F11]/85 border border-red-500/30 text-xs text-red-100 mb-6">
            <ShieldCheck className="w-3.5 h-3.5 text-[#E84C3D]" />
            <span className="font-mono tracking-wide uppercase text-[11px]">
              Autonomous Protection • Live Telemetry • Covert Dispatch
            </span>
          </div>

          <h1 className="text-5xl sm:text-7xl tracking-tight leading-[1.02] text-white mb-6">
            <span className="font-extrabold">SAFE</span>
            <span className="font-extralight text-white/85">GUARD</span>
            <span className="block text-2xl sm:text-3xl font-light text-white/75 mt-3 tracking-normal">
              Intelligent protection that acts before danger escalates.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-white/70 max-w-2xl leading-relaxed mb-9">
            Real-time SOS &amp; silent duress dispatch, predictive SafeRoute scoring across 24/7 safe
            havens, tamper-logged audio evidence, and grounded BNSS Section 173 legal assistance.
          </p>

          {/* Dual CTAs */}
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => navigate("/saferoute")}
              className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#FFFFFF] text-[#0A0809] font-bold text-sm hover:bg-white/90 transition-all shadow-xl shadow-black/40"
            >
              <span>Start SafeRoute</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={handleOpenVault}
              className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#E84C3D] hover:bg-[#D43D2E] text-white font-semibold text-sm transition-all shadow-lg shadow-[#E84C3D]/25"
            >
              <Lock className="w-4 h-4" />
              <span>Open Covert Vault</span>
            </button>
          </div>
        </motion.div>

        {/* Bottom Smoked-Glass Bento Stats + Feature Cards */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.12 }}
          className="mt-14 space-y-5"
        >
          {/* Stats Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="bento-card p-4 sm:p-5">
                <div className="text-[11px] uppercase tracking-wider text-white/50 font-semibold">
                  {stat.label}
                </div>
                <div className="font-mono text-2xl sm:text-3xl font-bold text-white mt-1">
                  {stat.value}
                </div>
                <div className="text-xs text-white/55 mt-1">{stat.sub}</div>
              </div>
            ))}
          </div>

          {/* Feature Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="bento-card p-5 flex flex-col justify-between hover:border-red-500/35 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl bg-[#E84C3D]/15 border border-[#E84C3D]/30 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-[#E84C3D]" />
                      </div>
                      <span className="font-mono text-[10px] tracking-wider px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/65">
                        {feat.badge}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-white mb-2">{feat.title}</h2>
                    <p className="text-xs leading-relaxed text-white/65">{feat.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.section>
      </main>

      {/* Subtle Footer with Split-Screen Demo Link */}
      <footer className="w-full border-t border-white/10 bg-[#0A0809]/60 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-white/50">
          <span className="font-mono">SAFEGUARD AI • BNSS §173 &amp; COVERT PCR PLATFORM</span>
          <div className="flex items-center gap-4">
            <Link to="/admin/login" className="hover:text-white transition-colors">
              Command Login
            </Link>
            <Link
              to="/demo"
              className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/75 hover:text-white font-mono text-[11px] transition-colors"
            >
              Split-Screen Demo
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
