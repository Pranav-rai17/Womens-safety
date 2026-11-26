import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { EmergencyTicker } from "./components/EmergencyTicker";
import { ThreatGlowWrapper } from "./components/ThreatGlowWrapper";
import { ThreatProvider } from "./context/ThreatContext";
import { useTabCloak } from "./hooks/useTabCloak";
import { AdminCommandCenterPage } from "./pages/admin/AdminCommandCenterPage";
import { AdminLoginPage } from "./pages/admin/AdminLoginPage";
import { DemoSplitPage } from "./pages/DemoSplitPage";
import { LandingPage } from "./pages/LandingPage";
import { CommuteGuardianPage } from "./pages/user/CommuteGuardianPage";
import { CovertVaultPage } from "./pages/user/CovertVaultPage";
import { LegalAssistantPage } from "./pages/user/LegalAssistantPage";
import { SafetyHubPage } from "./pages/user/SafetyHubPage";
import { UserLoginPage } from "./pages/user/UserLoginPage";

const AppShell: React.FC = () => {
  // Global Tab-Cloak Panic Hook (double-Esc -> /vault)
  useTabCloak();

  return (
    <ThreatGlowWrapper>
      <EmergencyTicker />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<UserLoginPage />} />
        <Route path="/dashboard" element={<SafetyHubPage />} />
        <Route path="/saferoute" element={<Navigate to="/dashboard" replace />} />
        <Route path="/commute" element={<CommuteGuardianPage />} />
        <Route path="/vault" element={<CovertVaultPage />} />
        <Route path="/legal-ai" element={<LegalAssistantPage />} />
        <Route path="/legal" element={<Navigate to="/legal-ai" replace />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/command" element={<AdminCommandCenterPage />} />
        <Route path="/admin" element={<Navigate to="/admin/command" replace />} />
        <Route path="/demo" element={<DemoSplitPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThreatGlowWrapper>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ThreatProvider>
        <AppShell />
      </ThreatProvider>
    </BrowserRouter>
  );
};

export default App;
