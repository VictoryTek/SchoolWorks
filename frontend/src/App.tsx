import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from './store/authStore'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import ReportsOverviewPage from './pages/ReportsPage'
import Users from './pages/Users'
import SupervisorManagement from './pages/SupervisorManagement'
import { InventoryManagement } from './pages/InventoryManagement'
import DisposedEquipment from './pages/DisposedEquipment'
import BulkDeleteDisposedPage from './pages/BulkDeleteDisposedPage'
import MyEquipment from './pages/MyEquipment'
import ReferenceDataManagement from './pages/ReferenceDataManagement'
import {
  PurchaseOrderList,
  RequisitionWizard,
  PurchaseOrderDetail,
} from './pages/PurchaseOrders'
import AdminSettings from './pages/admin/AdminSettings'
import ProvisioningPage from './pages/admin/ProvisioningPage'

import WorkOrderListPage from './pages/WorkOrderListPage'
import NewWorkOrderPage from './pages/NewWorkOrderPage'
import WorkOrderDetailPage from './pages/WorkOrderDetailPage'
import AccessDenied from './pages/AccessDenied'
import { RoomAssignmentsPage } from './pages/RoomAssignments'
import {
  FieldTripListPage,
  FieldTripRequestPage,
  FieldTripDetailPage,
  FieldTripApprovalPage,
  FieldTripTransportationPage,
  FieldTripTransportationDetail,
} from './pages/FieldTrip'
import {
  TransportationRequestsPage,
  TransportationRequestFormPage,
  TransportationRequestDetailPage,
} from './pages/TransportationRequests'
import CheckoutPage from './pages/DeviceManagement/CheckoutPage'
import UserCheckoutHistoryPage from './pages/DeviceManagement/UserCheckoutHistoryPage'
import CheckoutScanPage from './pages/DeviceManagement/CheckoutScanPage'
import BulkCheckoutPage from './pages/DeviceManagement/BulkCheckoutPage'
import BulkCheckinPage from './pages/DeviceManagement/BulkCheckinPage'
import CartAssignmentWizardPage from './pages/DeviceManagement/CartAssignmentWizardPage'
import CheckedOutCartsPage from './pages/DeviceManagement/CheckedOutCartsPage'
import QuickCheckPage from './pages/DeviceManagement/QuickCheckPage'
import RoomCheckoutPage from './pages/DeviceManagement/RoomCheckoutPage'
import RepairTicketsPage from './pages/DeviceManagement/RepairTicketsPage'
import RepairTicketDetailPage from './pages/DeviceManagement/RepairTicketDetailPage'
import InvoicesPage from './pages/DeviceManagement/InvoicesPage'
import InvoiceDetailPage from './pages/DeviceManagement/InvoiceDetailPage'
import ComponentPricesPage from './pages/DeviceManagement/ComponentPricesPage'
import DeviceManagementDashboard from './pages/DeviceManagement/index'
import ReportsPage from './pages/DeviceManagement/ReportsPage'
import BarcodePdfPage from './pages/DeviceManagement/BarcodePdfPage'
import DmRolloverPage from './pages/DeviceManagement/DmRolloverPage'
import IntuneDeviceActionsPage from './pages/DeviceManagement/IntuneDeviceActionsPage'
import IncidentsPage from './pages/incidents/IncidentsPage'
import IncidentDetailPage from './pages/incidents/IncidentDetailPage'
import IncidentWizardPage from './pages/incidents/IncidentWizardPage'
import InventoryAuditPage from './pages/InventoryAuditPage'
import InventoryAuditHistoryPage from './pages/InventoryAuditHistoryPage'
import UnresolvedInventoryPage from './pages/UnresolvedInventoryPage'
import TransportationDashboardPage from './pages/Transportation/index'
import TransportationUnitsPage from './pages/Transportation/TransportationUnitsPage'
import TransportationUnitDetailPage from './pages/Transportation/TransportationUnitDetailPage'
import FuelStationsPage from './pages/Transportation/FuelStationsPage'
import FuelEntryPage from './pages/Transportation/FuelEntryPage'
import MyFuelHistoryPage from './pages/Transportation/MyFuelHistoryPage'
import DotPhysicalsPage from './pages/Transportation/DotPhysicalsPage'
import DriverLicensePage from './pages/Transportation/DriverLicensePage'
import MvrRecordsPage from './pages/Transportation/MvrRecordsPage'
import TransportationReportsPage from './pages/Transportation/TransportationReportsPage'
import TransportationSettingsPage from './pages/Transportation/TransportationSettingsPage'
import NotificationSettings from './pages/NotificationSettings'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PwaUpdatePrompt } from './components/layout/PwaUpdatePrompt'
import { PwaInstallPrompt } from './components/layout/PwaInstallPrompt'
import AppLayout from './components/layout/AppLayout'
import MaintenancePage from './pages/Maintenance'
import './App.css'

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initializeAuth = useAuthStore((s) => s.initializeAuth);
  const setLoading = useAuthStore((s) => s.setLoading);
  useEffect(() => {
    // Skip the /auth/me probe when this mount is the tail end of an OAuth
    // redirect (Entra sends the browser back to /login?code=... via a full page
    // load, which remounts the whole app). There is no session cookie yet at
    // that point by definition, so /auth/me would be a guaranteed 401 that races
    // Login's own callback exchange — which independently establishes the
    // authenticated state from the /auth/callback response. Probing here just
    // adds console noise and a window where the store briefly flips back to
    // "unauthenticated" right before the real login completes.
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === '/login' && params.get('code')) {
      setLoading(false);
      return;
    }
    initializeAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

// useTransitions={false} — react-router v7's BrowserRouter wraps every router state
// update in React.startTransition by default. That defers the commit of any controlled
// input whose value comes from useSearchParams (every useFilterParams search box across
// the app), so React reverts the input to its last committed value and any character
// arriving faster than the transition commits is silently dropped — human typing is slow
// enough to never notice, but a barcode scanner emitting characters within milliseconds
// loses most of a scanned tag. Compared with strict === false, so omitting the prop or
// passing undefined leaves transitions on. Safe to disable app-wide only because this app
// has no React.lazy routes and no Suspense boundaries; if either is introduced, re-enable
// transitions and give the affected inputs local state instead of removing this line.
function App() {
  return (
    <BrowserRouter useTransitions={false}>
      <PwaUpdatePrompt />
      <PwaInstallPrompt />
      <AuthInitializer>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute requireReports>
              <AppLayout>
                <ReportsOverviewPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute requireAdmin>
              <AppLayout>
                <Users />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute requireAdmin>
              <AppLayout>
                <AdminSettings />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/provisioning"
          element={
            <ProtectedRoute requireAdmin>
              <AppLayout>
                <ProvisioningPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/jobs"
          element={<Navigate to="/admin/settings#jobs" replace />}
        />
        <Route
          path="/admin/new-fiscal-year"
          element={<Navigate to="/admin/settings#fiscal-year" replace />}
        />
        <Route
          path="/supervisors"
          element={
            <ProtectedRoute requireAdmin>
              <AppLayout>
                <SupervisorManagement />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/rooms"
          element={<Navigate to="/reference-data?tab=rooms" replace />}
        />
        <Route
          path="/inventory"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <InventoryManagement />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/disposed-equipment"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <DisposedEquipment />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/purge-disposed"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <BulkDeleteDisposedPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-equipment"
          element={
            <ProtectedRoute>
              <AppLayout>
                <MyEquipment />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reference-data"
          element={
            <ProtectedRoute requireAdmin>
              <AppLayout>
                <ReferenceDataManagement />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders"
          element={
            <ProtectedRoute>
              <AppLayout>
                <PurchaseOrderList />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <RequisitionWizard />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <PurchaseOrderDetail />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/work-orders"
          element={
            <ProtectedRoute>
              <AppLayout>
                <WorkOrderListPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/work-orders/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <NewWorkOrderPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/work-orders/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <WorkOrderDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/room-assignments"
          element={
            <ProtectedRoute requireRoomAssignment>
              <AppLayout>
                <RoomAssignmentsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/field-trips"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FieldTripListPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/field-trips/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FieldTripRequestPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/field-trips/approvals"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FieldTripApprovalPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/field-trips/:id/edit"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FieldTripRequestPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/field-trips/:id/transportation/view"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FieldTripTransportationDetail />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/field-trips/:id/transportation"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FieldTripTransportationPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/field-trips/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FieldTripDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/notifications"
          element={
            <ProtectedRoute>
              <AppLayout>
                <NotificationSettings />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/access-denied"
          element={
            <ProtectedRoute>
              <AppLayout>
                <AccessDenied />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation-requests"
          element={
            <ProtectedRoute>
              <AppLayout>
                <TransportationRequestsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation-requests/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <TransportationRequestFormPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation-requests/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <TransportationRequestDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/devices/:id"
          element={<Navigate to="/inventory" replace />}
        />
        <Route
          path="/device-management/checkouts/users/:userId/history"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <UserCheckoutHistoryPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/checkouts"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <CheckoutPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/checkouts/scan"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <CheckoutScanPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/carts"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <CheckedOutCartsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/carts/assign"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <CartAssignmentWizardPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/checkouts/bulk"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <BulkCheckoutPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/checkouts/bulk-checkin"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <BulkCheckinPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/quick-check"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <QuickCheckPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/room-checkout"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <RoomCheckoutPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/repair-tickets"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <RepairTicketsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/repair-tickets/:id"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <RepairTicketDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/invoices"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <InvoicesPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/invoices/:id"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <InvoiceDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/component-prices"
          element={
            <ProtectedRoute requireDeviceManagementElevated>
              <AppLayout>
                <ComponentPricesPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management"
          element={
            <ProtectedRoute requireDashboardAccess>
              <AppLayout>
                <DeviceManagementDashboard />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/reports"
          element={
            <ProtectedRoute requireDeviceManagementElevated>
              <AppLayout>
                <ReportsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/barcode-pdf"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <BarcodePdfPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/rollover"
          element={
            <ProtectedRoute requireAdmin>
              <AppLayout>
                <DmRolloverPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/intune-actions"
          element={
            <ProtectedRoute requireDeviceManagementElevated>
              <AppLayout>
                <IntuneDeviceActionsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/incidents/new"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <IncidentWizardPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/incidents"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <IncidentsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/incidents/:id"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <IncidentDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-audit"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <InventoryAuditPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-audit/history"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <InventoryAuditHistoryPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-audit/unresolved"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <UnresolvedInventoryPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        {/* Transportation Module */}
        <Route
          path="/transportation"
          element={
            <ProtectedRoute requireTransportationLevel={1}>
              <AppLayout>
                <TransportationDashboardPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/fuel-entry"
          element={
            <ProtectedRoute requireTransportationLevel={1}>
              <AppLayout>
                <FuelEntryPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/my-fuel-history"
          element={
            <ProtectedRoute requireTransportationLevel={1}>
              <AppLayout>
                <MyFuelHistoryPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/units"
          element={
            <ProtectedRoute requireTransportationLevel={2}>
              <AppLayout>
                <TransportationUnitsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/units/:id"
          element={
            <ProtectedRoute requireTransportationLevel={2}>
              <AppLayout>
                <TransportationUnitDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/fuel-stations"
          element={
            <ProtectedRoute requireTransportationLevel={2}>
              <AppLayout>
                <FuelStationsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/dot-physicals"
          element={
            <ProtectedRoute requireTransportationLevel={2}>
              <AppLayout>
                <DotPhysicalsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/driver-licenses"
          element={
            <ProtectedRoute requireTransportationLevel={2}>
              <AppLayout>
                <DriverLicensePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/mvr-records"
          element={
            <ProtectedRoute requireTransportationLevel={2}>
              <AppLayout>
                <MvrRecordsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/reports"
          element={
            <ProtectedRoute requireTransportationLevel={2}>
              <AppLayout>
                <TransportationReportsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transportation/settings"
          element={
            <ProtectedRoute requireTransportationLevel={3}>
              <AppLayout>
                <TransportationSettingsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
      </AuthInitializer>
    </BrowserRouter>
  )
}

export default App
