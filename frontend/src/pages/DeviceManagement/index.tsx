import { useQuery } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import { checkoutReportService } from '../../services/checkoutReport.service';
import { DashboardWidgets } from '../../components/DeviceManagement/DashboardWidgets';

export default function DeviceManagementDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['checkout-reports', 'dashboard'],
    queryFn:  checkoutReportService.getDashboard,
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" fontWeight={600} gutterBottom>
        Device Management Dashboard
      </Typography>
      <DashboardWidgets data={data} isLoading={isLoading} />
    </Box>
  );
}
