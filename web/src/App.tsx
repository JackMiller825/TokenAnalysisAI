import { Route, Routes } from "react-router-dom";
import { Shell } from "@/components/shell";
import { HomePage } from "@/pages/home";
import { AnalyzePage } from "@/pages/analyze";
import { HistoryPage } from "@/pages/history";
import { ComparePage } from "@/pages/compare";
import { SettingsPage } from "@/pages/settings";
import { MethodologyPage } from "@/pages/methodology";
import { ReportPage } from "@/pages/report";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="analyze" element={<AnalyzePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="methodology" element={<MethodologyPage />} />
        <Route path="reports/:id" element={<ReportPage />} />
        <Route path="reports/:id/:section" element={<ReportPage />} />
      </Route>
    </Routes>
  );
}
