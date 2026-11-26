import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Columns2, Loader2, ShieldAlert } from "lucide-react";
import { apiFetch, setAdminToken, setUserSession, UserProfile } from "../lib/api";
import { AdminCommandCenterPage } from "./admin/AdminCommandCenterPage";
import { CommuteGuardianPage } from "./user/CommuteGuardianPage";
import { CovertVaultPage } from "./user/CovertVaultPage";
import { LegalAssistantPage } from "./user/LegalAssistantPage";
import { SafetyHubPage } from "./user/SafetyHubPage";

type DemoUserTab = "vault" | "dashboard" | "commute" | "legal";

export const DemoSplitPage: React.FC = () => {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userTab, setUserTab] = useState<DemoUserTab>("vault");

  useEffect(() => {
    let mounted = true;

    async function bootstrapBothAccounts() {
      try {
        // 1. Auto-authenticate Citizen Demo Account
        const otpRes = await apiFetch<{ dev_otp: string }>(
          "/api/auth/otp/request",
          {
            method: "POST",
            body: JSON.stringify({ phone: "+919876543210" }),
          },
          "NONE"
        );
        const verRes = await apiFetch<{ access_token: string; user: UserProfile }>(
          "/api/auth/otp/verify",
          {
            method: "POST",
            body: JSON.stringify({
              phone: "+919876543210",
              otp: otpRes.dev_otp,
              full_name: "Ananya Sharma (Demo)",
            }),
          },
          "NONE"
        );
        setUserSession(verRes.access_token, verRes.user);

        const settingsRes = await apiFetch<{ user: UserProfile }>(
          "/api/user/settings",
          {
            method: "PUT",
            body: JSON.stringify({
              full_name: "Ananya Sharma (Demo)",
              safe_pin: "1234",
              duress_pin: "9999",
              emergency_contacts: [
                { name: "Priya Sharma", phone: "+919900112233", relation: "Mother" },
              ],
            }),
          },
          "USER"
        );
        setUserSession(verRes.access_token, settingsRes.user);

        // 2. Auto-authenticate Admin Command Account
        const adminRes = await apiFetch<{ access_token: string }>(
          "/api/admin/login",
          {
            method: "POST",
            body: JSON.stringify({
              email: "admin@command.local",
              password: "Admin@SafeGuard2026",
            }),
          },
          "NONE"
        );
        setAdminToken(adminRes.access_token);

        if (mounted) setReady(true);
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to bootstrap demo accounts. Ensure backend is running on :8000."
          );
        }
      }
    }

    void bootstrapBothAccounts();
    return () => {
      mounted = false;
    };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0809] text-white flex items-center justify-center p-6">
        <div className="bento-card max-w-md w-full p-6 text-center space-y-4 border-red-500/40">
          <ShieldAlert className="w-8 h-8 text-[#E84C3D] mx-auto" />
          <h1 className="text-lg font-bold">Demo Bootstrap Failed</h1>
          <p className="text-xs text-white/70 font-mono">{error}</p>
          <Link
            to="/"
            className="inline-block px-4 py-2 rounded-xl bg-white text-[#0A0809] text-xs font-bold"
          >
            Back Home
          </Link>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0A0809] text-white flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-7 h-7 text-[#E84C3D] animate-spin" />
        <p className="font-mono text-xs text-white/75">
          Authenticating Citizen &amp; Command Center Demo Accounts…
        </p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-2.25rem)] bg-[#0A0809] text-white flex flex-col overflow-hidden">
      {/* Split-Screen Control Header */}
      <div className="h-11 px-4 border-b border-white/15 bg-[#160608] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2 font-mono text-xs">
          <Columns2 className="w-4 h-4 text-[#E84C3D]" />
          <span className="font-bold text-white">SPLIT-SCREEN DEMO</span>
          <span className="hidden md:inline text-white/55">
            • Safe PIN: <strong className="text-emerald-300">1234</strong> • Duress PIN:{" "}
            <strong className="text-[#E84C3D]">9999</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {(
            [
              { id: "vault", label: "Covert Vault" },
              { id: "dashboard", label: "Safety Hub" },
              { id: "commute", label: "Commute" },
              { id: "legal", label: "Legal RAG" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setUserTab(t.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                userTab === t.id
                  ? "bg-[#E84C3D] text-white"
                  : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
          <Link
            to="/"
            className="ml-2 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-mono text-white"
          >
            Exit
          </Link>
        </div>
      </div>

      {/* 50 / 50 Split Viewport */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
        {/* Left 50%: User Portal */}
        <div className="border-r border-white/15 overflow-y-auto h-full">
          {userTab === "vault" && <CovertVaultPage />}
          {userTab === "dashboard" && <SafetyHubPage />}
          {userTab === "commute" && <CommuteGuardianPage />}
          {userTab === "legal" && <LegalAssistantPage />}
        </div>

        {/* Right 50%: Admin Command Center */}
        <div className="overflow-hidden h-full">
          <AdminCommandCenterPage embedded />
        </div>
      </div>
    </div>
  );
};
