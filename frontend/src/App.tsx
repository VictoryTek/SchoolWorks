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
import { ProtectedRoute } from './components/ProtectedRoute'
import { PwaUpdatePrompt } from './components/layout/PwaUpdatePrompt'
import AppLayout from './components/layout/AppLayout'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <PwaUpdatePrompt />
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
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
