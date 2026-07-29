import { Box, Card, CardActionArea, CardContent, Typography } from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import HandymanIcon from '@mui/icons-material/Handyman';
import type { WorkOrderDepartment } from '@/types/work-order.types';

interface DepartmentSelectorProps {
  value: WorkOrderDepartment | null;
  onChange: (dept: WorkOrderDepartment) => void;
  disabled?: boolean;
  allowedDepartments?: WorkOrderDepartment[];
}

const DEPARTMENTS: {
  value: WorkOrderDepartment;
  label: string;
  subtitle: string;
  Icon: typeof ComputerIcon;
}[] = [
  {
    value: 'TECHNOLOGY',
    label: 'Technology Request',
    subtitle: 'Software, hardware, network, devices',
    Icon: ComputerIcon,
  },
  {
    value: 'MAINTENANCE',
    label: 'Maintenance Request',
    subtitle: 'Electrical, plumbing, HVAC, facilities',
    Icon: HandymanIcon,
  },
];

export function DepartmentSelector({ value, onChange, disabled = false, allowedDepartments }: DepartmentSelectorProps) {
  const visible = allowedDepartments
    ? DEPARTMENTS.filter((d) => allowedDepartments.includes(d.value))
    : DEPARTMENTS;

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
      {visible.map(({ value: deptValue, label, subtitle, Icon }) => {
        const isSelected = value === deptValue;
        return (
          <Card
            key={deptValue}
            variant="outlined"
            sx={(theme) => ({
              flex: 1,
              borderWidth: isSelected ? 2 : 1,
              borderColor: isSelected ? 'primary.main' : 'divider',
              transition: 'border-color 0.2s, box-shadow 0.2s',
              boxShadow: isSelected
                ? `0 0 0 2px ${(theme.vars ?? theme).palette.primary.light}`
                : 'none',
            })}
          >
            <CardActionArea
              onClick={() => !disabled && onChange(deptValue)}
              disabled={disabled}
              sx={{ height: '100%' }}
            >
              <CardContent
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1,
                  py: 3,
                }}
              >
                <Icon
                  sx={{
                    fontSize: 48,
                    color: isSelected ? 'primary.main' : 'text.primary',
                  }}
                />
                <Typography variant="h6" component="div" fontWeight={600}>
                  {label}
                </Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  {subtitle}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        );
      })}
    </Box>
  );
}

export default DepartmentSelector;
