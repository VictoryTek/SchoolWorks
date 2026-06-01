import { useQuery } from '@tanstack/react-query';
import { Box, Button, Typography } from '@mui/material';
import ShoppingCartCheckoutIcon from '@mui/icons-material/ShoppingCartCheckout';
import { useNavigate } from 'react-router-dom';
import { checkoutReportService } from '../../services/checkoutReport.service';
import { DashboardWidgets } from '../../components/DeviceManagement/DashboardWidgets';

export default function DeviceManagementDashboard() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['checkout-reports', 'dashboard'],
    queryFn:  checkoutReportService.getDashboard,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: gradeData, isLoading: gradeLoading } = useQuery({
    queryKey: ['checkout-reports', 'damage-by-grade'],
    queryFn:  checkoutReportService.getDamageByGrade,
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h4" fontWeight={600}>
          Device Management Dashboard
        </Typography>
        <Button
          variant="contained"
          startIcon={<ShoppingCartCheckoutIcon />}
          onClick={() => navigate('/device-management/carts/assign')}
        >
          Cart Assignment
        </Button>
      </Box>
      <DashboardWidgets
        data={data}
        isLoading={isLoading}
        gradeData={gradeData}
        gradeLoading={gradeLoading}
      />
    </Box>
  );
}
