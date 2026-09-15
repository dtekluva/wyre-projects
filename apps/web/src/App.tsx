import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { FileViewerProvider } from "./lib/fileViewer";
import { Shell } from "./components/Shell";
import { RemoteBridge } from "./components/RemoteBridge";
import { Portfolio } from "./screens/Portfolio";
import { ProjectLayout } from "./screens/ProjectLayout";
import { ProjectNew } from "./screens/ProjectNew";
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
import { FieldShell } from "./components/field/FieldShell";
import { FieldSignin, FieldHome, FieldIssues, FieldIssueNew, FieldIssueDetail, FieldVisits, FieldVisitNew, FieldVan, FieldQueue } from "./screens/field/FieldScreens";

export function App() {
  return (
    <AuthProvider><ToastProvider><FileViewerProvider>
      <RemoteBridge />
      <Routes>
        <Route path="field" element={<FieldShell />}>
          <Route index element={<FieldHome />} />
          <Route path="signin" element={<FieldSignin />} />
          <Route path="issues" element={<FieldIssues />} />
          <Route path="issues/new" element={<FieldIssueNew />} />
          <Route path="issues/:id" element={<FieldIssueDetail />} />
          <Route path="visits" element={<FieldVisits />} />
          <Route path="visits/new" element={<FieldVisitNew />} />
          <Route path="van" element={<FieldVan />} />
          <Route path="queue" element={<FieldQueue />} />
        </Route>
        <Route element={<Shell />}>
          <Route index element={<Portfolio />} />
          <Route path="projects/new" element={<ProjectNew />} />
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
    </FileViewerProvider></ToastProvider></AuthProvider>
  );
}
