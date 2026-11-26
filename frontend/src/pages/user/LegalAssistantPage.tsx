import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Copy,
  Download,
  PhoneCall,
  Scale,
  Send,
  ShieldAlert,
} from "lucide-react";
import { UserNavbar } from "../../components/UserNavbar";
import { apiFetch, getUserToken } from "../../lib/api";

interface Citation {
  id: string;
  section: string;
  title: string;
  summary: string;
}

interface LegalAssistResponse {
  emergency_bypass: boolean;
  action?: string;
  message?: string;
  llm_mode?: string;
  citations?: Citation[];
  guidance?: string;
  complaint_draft?: string;
}

export const LegalAssistantPage: React.FC = () => {
  const token = getUserToken();
  if (!token) return <Navigate to="/login" replace />;

  const navigate = useNavigate();
  const [query, setQuery] = useState(
    "Police refused to file my FIR for workplace harassment and stalking. How do I file a Zero FIR?"
  );
  const [location, setLocation] = useState("Indiranagar, Bengaluru");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LegalAssistResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setCopied(false);
    try {
      const res = await apiFetch<LegalAssistResponse>("/api/legal/assist", {
        method: "POST",
        body: JSON.stringify({ message: query, location }),
      });
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyDraft = () => {
    if (!result?.complaint_draft) return;
    navigator.clipboard.writeText(result.complaint_draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadDraft = () => {
    if (!result?.complaint_draft) return;
    const blob = new Blob([result.complaint_draft], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Zero_FIR_Complaint_Draft.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (!result?.complaint_draft) return;
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    win.document.write(
      `<html><head><title>Zero FIR Complaint Draft</title><style>body{font-family:monospace;white-space:pre-wrap;padding:32px;line-height:1.6;}</style></head><body>${result.complaint_draft.replace(
        /</g,
        "&lt;"
      )}</body></html>`
    );
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="min-h-[calc(100vh-2.25rem)] bg-[#0A0809] flex flex-col">
      <UserNavbar />

      <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Emergency Bypass Takeover Banner */}
        {result?.emergency_bypass && (
          <div className="p-6 rounded-2xl bg-[#E84C3D] text-white shadow-2xl shadow-[#E84C3D]/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-8 h-8 shrink-0 animate-bounce" />
              <div>
                <h2 className="text-lg font-extrabold uppercase tracking-wide">
                  Immediate Physical Danger Detected
                </h2>
                <p className="text-sm text-white/95 mt-0.5">{result.message}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="tel:112"
                className="px-4 py-2.5 rounded-xl bg-white text-[#0A0809] font-extrabold text-xs inline-flex items-center gap-1.5"
              >
                <PhoneCall className="w-4 h-4" /> CALL 112
              </a>
              <button
                onClick={() => navigate("/dashboard")}
                className="px-4 py-2.5 rounded-xl bg-black/30 hover:bg-black/45 border border-white/30 text-xs font-bold"
              >
                TRIGGER SOS
              </button>
            </div>
          </div>
        )}

        <div className="bento-card p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 text-[#E84C3D]" />
            <div>
              <h1 className="text-xl font-bold text-white">
                Grounded Legal RAG &amp; Zero FIR Drafter
              </h1>
              <p className="text-xs text-white/60">
                BNSS Section 173 (Zero FIR, e-FIR 3-day rule, SP escalation) &amp; POSH Act, 2013
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-white/65 mb-1">
                  Describe the incident or legal question
                </label>
                <textarea
                  rows={3}
                  required
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-sm text-white focus:outline-none focus:border-[#E84C3D]"
                />
              </div>
              <div className="flex flex-col justify-between gap-2">
                <div>
                  <label className="block text-xs text-white/65 mb-1">Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-sm text-white focus:outline-none focus:border-[#E84C3D]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-white text-[#0A0809] font-bold text-sm hover:bg-white/90 inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <Send className="w-4 h-4" />
                  <span>{loading ? "Analyzing..." : "Get Legal Guidance"}</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        {result && !result.emergency_bypass && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Statutory Citations */}
            <div className="lg:col-span-5 bento-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#E84C3D]" />
                  Grounded Citations
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/70">
                  {result.llm_mode}
                </span>
              </div>
              <div className="space-y-2.5">
                {result.citations?.map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-1"
                  >
                    <div className="font-mono text-xs font-bold text-[#E84C3D]">
                      {c.section}
                    </div>
                    <div className="text-xs font-semibold text-white">{c.title}</div>
                    <p className="text-xs text-white/65 leading-relaxed">{c.summary}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Zero FIR Copy-Ready Draft */}
            <div className="lg:col-span-7 bento-card p-5 space-y-3 flex flex-col">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">
                  Copy-Ready Zero FIR Complaint Draft
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyDraft}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadDraft}
                    className="px-3 py-1.5 rounded-lg bg-[#E84C3D] hover:bg-[#D43D2E] text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    .txt
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="px-3 py-1.5 rounded-lg bg-white text-[#0A0809] hover:bg-white/90 text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    PDF
                  </button>
                </div>
              </div>
              <pre className="flex-1 p-4 rounded-xl bg-black/50 border border-white/10 font-mono text-xs text-white/85 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {result.complaint_draft}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
