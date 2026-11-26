import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Phone,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  apiFetch,
  EmergencyContact,
  setUserSession,
  UserProfile,
} from "../../lib/api";

export const UserLoginPage: React.FC = () => {
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [fullName, setFullName] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpChannelMsg, setOtpChannelMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 3-Step Safety Onboarding Modal state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contacts, setContacts] = useState<EmergencyContact[]>([
    { name: "", phone: "", relation: "" },
  ]);
  const [safePin, setSafePin] = useState("");
  const [duressPin, setDuressPin] = useState("");

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ message: string; ttl_seconds: number }>(
        "/api/auth/otp/request",
        {
          method: "POST",
          body: JSON.stringify({ identifier }),
        },
        "NONE"
      );
      setOtpChannelMsg(res.message);
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        access_token: string;
        user: UserProfile;
      }>(
        "/api/auth/otp/verify",
        {
          method: "POST",
          body: JSON.stringify({ identifier, otp, full_name: fullName }),
        },
        "NONE"
      );
      setUserSession(res.access_token, res.user);
      if (!res.user.has_safe_pin || !res.user.has_duress_pin) {
        setShowOnboarding(true);
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleFinishOnboarding = async () => {
    setError(null);
    if (safePin === duressPin) {
      setError("Safe PIN and Duress PIN must be different.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ user: UserProfile }>(
        "/api/user/settings",
        {
          method: "PUT",
          body: JSON.stringify({
            full_name: fullName,
            safe_pin: safePin,
            duress_pin: duressPin,
            emergency_contacts: contacts.filter((c) => c.name && c.phone),
          }),
        },
        "USER"
      );
      const token = localStorage.getItem("safeguard_user_token") || "";
      setUserSession(token, res.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save safety setup");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-crimson-fluted min-h-[calc(100vh-2.25rem)] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bento-card p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#E84C3D] flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg text-white">
              <span className="font-extrabold">SAFE</span>
              <span className="font-light text-white/80">GUARD</span>
            </span>
          </Link>
          <Link
            to="/admin"
            className="font-mono text-[11px] text-white/55 hover:text-white underline underline-offset-4"
          >
            Command Login →
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">Citizen Safety Portal</h1>
        <p className="text-xs text-white/60 mb-6">
          Passwordless 6-digit OTP authentication with encrypted PIN protection.
        </p>

        {error && (
          <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-500/15 border border-red-500/35 text-xs text-red-200">
            {error}
          </div>
        )}

        {!otpSent ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/75 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ananya Sharma"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-sm text-white focus:outline-none focus:border-[#E84C3D]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/75 mb-1.5">
                Phone Number or Email
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-white/40 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com or +919876543210"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-sm font-mono text-white focus:outline-none focus:border-[#E84C3D]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-white text-[#0A0809] font-bold text-sm hover:bg-white/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <span>{loading ? "Sending OTP..." : "Request 6-Digit OTP"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            {otpChannelMsg && (
              <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-xs text-emerald-200">
                {otpChannelMsg} (expires in 5 minutes)
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-white/75 mb-1.5">
                Enter 6-Digit OTP
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-white/40 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-base font-mono tracking-[0.35em] text-white focus:outline-none focus:border-[#E84C3D]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#E84C3D] hover:bg-[#D43D2E] text-white font-bold text-sm transition-colors disabled:opacity-60"
            >
              {loading ? "Verifying..." : "Verify & Continue"}
            </button>

            <button
              type="button"
              onClick={() => setOtpSent(false)}
              className="w-full text-xs text-white/55 hover:text-white"
            >
              Change email or phone
            </button>
          </form>
        )}
      </div>

      {/* 3-Step Safety Onboarding Modal */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bento-card max-w-md w-full p-6 space-y-5 border-red-500/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#E84C3D]" />
                <h2 className="text-lg font-bold text-white">Safety Onboarding</h2>
              </div>
              <span className="font-mono text-xs text-white/60">Step {step} / 3</span>
            </div>

            {step === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-white/70">
                  Add trusted emergency contacts notified during SOS or Dead-Man&apos;s Switch triggers.
                </p>
                {contacts.map((c, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Name"
                      value={c.name}
                      onChange={(e) => {
                        const next = [...contacts];
                        next[idx].name = e.target.value;
                        setContacts(next);
                      }}
                      className="col-span-5 px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-xs text-white"
                    />
                    <input
                      type="text"
                      placeholder="+91..."
                      value={c.phone}
                      onChange={(e) => {
                        const next = [...contacts];
                        next[idx].phone = e.target.value;
                        setContacts(next);
                      }}
                      className="col-span-6 px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-xs font-mono text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setContacts(contacts.filter((_, i) => i !== idx))}
                      className="col-span-1 text-white/40 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setContacts([...contacts, { name: "", phone: "", relation: "Trusted" }])
                  }
                  className="inline-flex items-center gap-1.5 text-xs text-[#E84C3D] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Contact
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full py-2.5 rounded-xl bg-white text-[#0A0809] font-bold text-sm mt-2"
                >
                  Next: Set Safe PIN
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <p className="text-xs text-white/70">
                  Your <strong>Safe PIN</strong> disarms the Dead-Man&apos;s Switch and unlocks the
                  Covert Evidence Vault.
                </p>
                <input
                  type="password"
                  maxLength={6}
                  value={safePin}
                  onChange={(e) => setSafePin(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/15 font-mono text-xl tracking-[0.4em] text-center text-white"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 py-2.5 rounded-xl bg-white/10 text-xs font-semibold"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="flex-1 py-2.5 rounded-xl bg-white text-[#0A0809] font-bold text-sm"
                  >
                    Next: Duress PIN
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-xs text-white/70">
                  Your <strong>Duress PIN</strong> silently triggers a covert police dispatch and
                  audio evidence capture while showing a harmless screen if you are coerced.
                </p>
                <input
                  type="password"
                  maxLength={6}
                  value={duressPin}
                  onChange={(e) => setDuressPin(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-red-500/35 font-mono text-xl tracking-[0.4em] text-center text-white"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex-1 py-2.5 rounded-xl bg-white/10 text-xs font-semibold"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleFinishOnboarding}
                    className="flex-1 py-2.5 rounded-xl bg-[#E84C3D] hover:bg-[#D43D2E] text-white font-bold text-sm inline-flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Complete Setup</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
