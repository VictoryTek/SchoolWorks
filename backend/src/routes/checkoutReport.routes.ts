import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireDeviceManagementAccess } from '../utils/groupAuth';
import * as controller from '../controllers/checkoutReport.controller';

const router = Router();
router.use(authenticate);

router.get('/dashboard',            requireDeviceManagementAccess(), controller.getDashboard);
router.get('/active-checkouts',     requireDeviceManagementAccess(), controller.getActiveCheckoutsByCampus);
router.get('/damage-summary',       requireDeviceManagementAccess(), controller.getDamageSummary);
router.get('/repair-costs',         requireDeviceManagementAccess(), controller.getRepairCostsByVendor);
router.get('/invoice-aging',        requireDeviceManagementAccess(), controller.getInvoiceAging);
router.get('/user/:userId/history', requireDeviceManagementAccess(), controller.getUserDeviceHistory);

export default router;
