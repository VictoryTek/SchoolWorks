import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Button,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import EmailIcon from '@mui/icons-material/Email';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import api, { cancelProactiveRefresh } from '../services/api';
import { useAuthStore } from '../store/authStore';

interface AdminContact {
  displayName: string;
  email: string;
}

export default function AccessDenied() {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [admins, setAdmins] = useState<AdminContact[]>([]);
  const [loading, setLoading] = useState(true);

  const handleLogout = () => {
    cancelProactiveRefresh();
    sessionStorage.setItem('explicit_logout', 'true');
    clearAuth();
    window.location.href = '/login';
  };

  useEffect(() => {
    api
      .get<AdminContact[]>('/users/admin-contacts')
      .then((res) => setAdmins(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
        p: 3,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          maxWidth: 520,
          width: '100%',
          p: 4,
          textAlign: 'center',
          borderTop: '4px solid',
          borderColor: 'warning.main',
        }}
      >
        <LockOutlinedIcon sx={{ fontSize: 64, color: 'warning.main', mb: 2 }} />

        <Typography variant="h5" gutterBottom fontWeight={600}>
          Access Denied
        </Typography>

        <Alert severity="warning" sx={{ textAlign: 'left', mb: 3 }}>
          Your account does not have the required permissions to access this
          feature. This usually means your account has not been added to the
          correct security group.
        </Alert>

        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Please contact an IT Administrator to request access:
        </Typography>

        {loading ? (
          <CircularProgress size={24} />
        ) : admins.length > 0 ? (
          <List disablePadding>
            {admins.map((admin) => (
              <ListItem key={admin.email} sx={{ py: 0.5 }}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <PersonIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary={admin.displayName}
                  secondary={
                    <Box
                      component="a"
                      href={`mailto:${admin.email}`}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        color: 'primary.main',
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      <EmailIcon sx={{ fontSize: 14 }} />
                      {admin.email}
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Contact your IT department for assistance.
          </Typography>
        )}

        <Button
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={handleLogout}
          sx={{ mt: 3 }}
        >
          Log Out
        </Button>
      </Paper>
    </Box>
  );
}
