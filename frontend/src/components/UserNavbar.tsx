import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Lock,
  LogOut,
  Navigation,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { clearUserSession, getStoredUser } from "../lib/api";
import { activateTabCloak } from "../hooks/useTabCloak";

export const UserNavbar: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = getStoredUser();

  const navItems = [
    { to: "/dashboard", label: "Safety Hub", icon: LayoutDashboard },
    { to: "/commute", label: "Commute Guardian", icon: Navigation },
    { to: "/legal-ai", label: "Legal RAG", icon: Scale },
  ];

  const handleOpenVault = () => {
    activateTabCloak();
    navigate("/vault");
  };

  const handleLogout = () => {
    clearUserSession();
    navigate("/login");
  };

  return (
    <header className="w-full border-b border-white/10 bg-[#0A0809]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#E84C3D] flex items-center justify-center shadow-lg shadow-[#E84C3D]/25">
            <ShieldAlert className="w-4 h-4 text-white" />
          </div>
          <span className="text-base tracking-tight text-white">
            <span className="font-extrabold">SAFE</span>
            <span className="font-light text-white/80">GUARD</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-white/15 text-white border border-white/15"
                    : "text-white/65 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-[#E84C3D]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {user && (
            <span className="hidden lg:inline font-mono text-xs text-white/60 mr-1">
              {user.full_name || user.phone}
            </span>
          )}
          <button
            onClick={handleOpenVault}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/85 transition-colors"
            title="Switch to Calculator Disguise (Esc ×2)"
          >
            <Lock className="w-3.5 h-3.5 text-[#E84C3D]" />
            <span className="hidden sm:inline">Vault</span>
          </button>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
