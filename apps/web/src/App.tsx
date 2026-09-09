import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { Shell } from "./components/Shell";
import { Portfolio } from "./screens/Portfolio";
import { ProjectLayout } from "./screens/ProjectLayout";
import { ProjectOverview } from "./screens/ProjectOverview";
import { ProjectTimeline } from "./screens/ProjectTimeline";
import { ProjectDocuments } from "./screens/ProjectDocuments";
import { ProjectPeople } from "./screens/ProjectPeople";
import { ReviewQueue } from "./screens/ReviewQueue";
import { Approvals } from "./screens/Approvals";
import { AdminUsers, AdminThresholds } from "./screens/Admin";
import { ProjectMoney } from "./screens/ProjectMoney";
import { ProjectAssets } from "./screens/ProjectAssets";
import { Inventory } from "./screens/Inventory";
import { Reconciliation } from "./screens/Reconciliation";
import { ProjectField } from "./screens/ProjectField";

export function App() {
  return (
    <AuthProvider><ToastProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Portfolio />} />
          <Route path="projects/:id" element={<ProjectLayout />}>
            <Route index element={<ProjectOverview />} />
            <Route path="timeline" element={<ProjectTimeline />} />
            <Route path="documents" element={<ProjectDocuments />} />
            <Route path="people" element={<ProjectPeople />} />
            <Route path="money" element={<ProjectMoney />} />
            <Route path="assets" element={<ProjectAssets />} />
            <Route path="field" element={<ProjectField />} />
          </Route>
          <Route path="work/reviews" element={<ReviewQueue />} />
          <Route path="work/approvals" element={<Approvals />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="finance/reconciliation" element={<Reconciliation />} />
          <Route path="admin/users" element={<AdminUsers />} />
          <Route path="admin/thresholds" element={<AdminThresholds />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastProvider></AuthProvider>
  );
}
