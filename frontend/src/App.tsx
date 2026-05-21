import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import Users from './pages/Users'
import SupervisorManagement from './pages/SupervisorManagement'
import { InventoryManagement } from './pages/InventoryManagement'
import DisposedEquipment from './pages/DisposedEquipment'
import EquipmentSearch from './pages/EquipmentSearch'
import MyEquipment from './pages/MyEquipment'
import ReferenceDataManagement from './pages/ReferenceDataManagement'
import {
  PurchaseOrderList,
  RequisitionWizard,
  PurchaseOrderDetail,
} from './pages/PurchaseOrders'
import AdminSettings from './pages/admin/AdminSettings'

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
import CheckoutScanPage from './pages/DeviceManagement/CheckoutScanPage'
import BulkCheckoutPage from './pages/DeviceManagement/BulkCheckoutPage'
import BulkCheckinPage from './pages/DeviceManagement/BulkCheckinPage'
import DamageIncidentsPage from './pages/DeviceManagement/DamageIncidentsPage'
import DamageIncidentDetailPage from './pages/DeviceManagement/DamageIncidentDetailPage'
import RepairTicketsPage from './pages/DeviceManagement/RepairTicketsPage'
import RepairTicketDetailPage from './pages/DeviceManagement/RepairTicketDetailPage'
import InvoicesPage from './pages/DeviceManagement/InvoicesPage'
import InvoiceDetailPage from './pages/DeviceManagement/InvoiceDetailPage'
import ComponentPricesPage from './pages/DeviceManagement/ComponentPricesPage'
import DeviceManagementDashboard from './pages/DeviceManagement/index'
import ReportsPage from './pages/DeviceManagement/ReportsPage'
import BarcodePdfPage from './pages/DeviceManagement/BarcodePdfPage'
import DmRolloverPage from './pages/DeviceManagement/DmRolloverPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PwaUpdatePrompt } from './components/layout/PwaUpdatePrompt'
import { PwaInstallPrompt } from './components/layout/PwaInstallPrompt'
import AppLayout from './components/layout/AppLayout'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <PwaUpdatePrompt />
      <PwaInstallPrompt />
      <Routes>
        <Route path="/login" element={<Login />} />
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
          path="/equipment-search"
          element={
            <ProtectedRoute requireTech>
              <AppLayout>
                <EquipmentSearch />
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
          path="/device-management/incidents"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <DamageIncidentsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/incidents/:id"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <DamageIncidentDetailPage />
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
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <ComponentPricesPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management"
          element={
            <ProtectedRoute requireDeviceManagement>
              <AppLayout>
                <DeviceManagementDashboard />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-management/reports"
          element={
            <ProtectedRoute requireDeviceManagement>
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
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
