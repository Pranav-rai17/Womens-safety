import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Mail, ShieldAlert } from "lucide-react";
import { apiFetch, setAdminToken } from "../../lib/api";

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ access_token: string }>(
        "/api/admin/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
        "NONE"
      );
      setAdminToken(res.access_token);
      navigate("/admin/command");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid admin credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-crimson-fluted min-h-[calc(100vh-2.25rem)] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bento-card p-6 sm:p-8 shadow-2xl border-red-500/25">
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
          <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-red-200">
            Command Auth
          </span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">Police &amp; Command Login</h1>
        <p className="text-xs text-white/60 mb-6">
          Restricted access for authorized dispatchers only.
        </p>

        {error && (
          <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-500/15 border border-red-500/35 text-xs text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/75 mb-1.5">
              Command Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-white/40 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@command.local"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-sm font-mono text-white focus:outline-none focus:border-[#E84C3D]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/75 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-white/40 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-sm font-mono text-white focus:outline-none focus:border-[#E84C3D]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-[#E84C3D] hover:bg-[#D43D2E] text-white font-bold text-sm transition-colors disabled:opacity-60"
          >
            {loading ? "Authenticating..." : "Enter Command Center"}
          </button>
        </form>
      </div>
    </div>
  );
};
