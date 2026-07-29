import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireDeviceManagementElevatedAccess, requireDashboardAccess } from '../utils/groupAuth';
import * as controller from '../controllers/checkoutReport.controller';

const router = Router();
router.use(authenticate);

router.get('/dashboard',            requireDashboardAccess(), controller.getDashboard);
router.get('/active-checkouts',     requireDeviceManagementElevatedAccess(), controller.getActiveCheckoutsByCampus);
router.get('/damage-summary',       requireDeviceManagementElevatedAccess(), controller.getDamageSummary);
router.get('/repair-costs',         requireDeviceManagementElevatedAccess(), controller.getRepairCostsByVendor);
router.get('/invoice-aging',        requireDeviceManagementElevatedAccess(), controller.getInvoiceAging);
router.get('/user/:userId/history', requireDeviceManagementElevatedAccess(), controller.getUserDeviceHistory);
router.get('/damage-by-grade',      requireDashboardAccess(), controller.getDamageByGrade);
router.get('/grade-level-summary',  requireDeviceManagementElevatedAccess(), controller.getGradeLevelSummary);

export default router;
