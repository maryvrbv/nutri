import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, LoginPage, RegisterPage, useAuth } from './auth';
import { InvitePage } from './invite';
import { NotificationsProvider } from './notifications';
import { ToastProvider } from './ui';
import { TodayPage } from './client/Today';
import { DiaryPage } from './client/Diary';
import { SchemeHistoryPage, SchemePage } from './client/SchemePage';
import {
  AccessPage, ClientAnalyte, ClientDocument, ClientHistory, ClientLabs, ClientLayout, ClientUpload, MorePage, NotificationsPage, ResultRedirect, SettingsPage,
} from './client/Client';
import {
  ClientAnalyteTab, ClientCard, ClientDocTab, ClientEventsTab, ClientIntakesTab, ClientLabsTab, ClientSummary, ClientUploadTab, ClientWellbeingTab,
  ClientsPage, InvitesPage, SpecLayout, SpecNotifications,
} from './specialist/Specialist';
import { SchemeEditorPage, SchemesTab } from './specialist/SchemeEditor';

function Routed() {
  const { me } = useAuth();
  const loc = useLocation();
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Navigate to={`/login${loc.pathname !== '/' ? `?next=${encodeURIComponent(loc.pathname + loc.search)}` : ''}`} replace />} />
      </Routes>
    );
  }
  if (me.role === 'specialist') {
    return (
      <NotificationsProvider>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route element={<SpecLayout />}>
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:id" element={<ClientCard />}>
              <Route index element={<ClientSummary />} />
              <Route path="labs" element={<ClientLabsTab />} />
              <Route path="labs/upload" element={<ClientUploadTab />} />
              <Route path="labs/documents/:docId" element={<ClientDocTab />} />
              <Route path="labs/analyte/:key" element={<ClientAnalyteTab />} />
              <Route path="schemes" element={<SchemesTab />} />
              <Route path="schemes/new" element={<SchemeEditorPage />} />
              <Route path="schemes/:sid" element={<SchemeEditorPage />} />
              <Route path="intakes" element={<ClientIntakesTab />} />
              <Route path="wellbeing" element={<ClientWellbeingTab />} />
              <Route path="events" element={<ClientEventsTab />} />
            </Route>
            <Route path="/invites" element={<InvitesPage />} />
            <Route path="/notifications" element={<SpecNotifications />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/clients" replace />} />
          </Route>
        </Routes>
      </NotificationsProvider>
    );
  }
  return (
    <NotificationsProvider>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route element={<ClientLayout />}>
          <Route path="/today" element={<TodayPage />} />
          <Route path="/scheme" element={<SchemePage />} />
          <Route path="/scheme/:id" element={<SchemeHistoryPage />} />
          <Route path="/labs" element={<ClientLabs />} />
          <Route path="/labs/upload" element={<ClientUpload />} />
          <Route path="/labs/documents/:docId" element={<ClientDocument />} />
          <Route path="/labs/analyte/:key" element={<ClientAnalyte />} />
          <Route path="/labs/results/:id" element={<ResultRedirect base="/labs" />} />
          <Route path="/diary" element={<DiaryPage />} />
          <Route path="/history" element={<ClientHistory />} />
          <Route path="/notifications" element={<NotificationsPage back="/more" />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/access" element={<AccessPage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
    </NotificationsProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routed />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
