import { useState } from 'react';
import { useGoBack } from '@/hooks/useGoBack';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useQuery } from '@tanstack/react-query';
import { locationService } from '../../services/location.service';
import { downloadBarcodePdf } from '../../services/barcodePdfService';

const GRADE_LEVELS: { value: string; label: string }[] = [
  { value: 'PK', label: 'Pre-K' },
  { value: 'K', label: 'Kindergarten' },
  { value: '01', label: '1st' },
  { value: '02', label: '2nd' },
  { value: '03', label: '3rd' },
  { value: '04', label: '4th' },
  { value: '05', label: '5th' },
  { value: '06', label: '6th' },
  { value: '07', label: '7th' },
  { value: '08', label: '8th' },
  { value: '09', label: '9th' },
  { value: '10', label: '10th' },
  { value: '11', label: '11th' },
  { value: '12', label: '12th' },
];

export default function BarcodePdfPage() {
  const goBack = useGoBack();
  const [locationId, setLocationId] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  const schoolLocations = (locations ?? []).filter(
    (l) => l.isActive && l.type === 'SCHOOL',
  );

  const handleGenerate = async () => {
    if (!locationId || !gradeLevel) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const blob = await downloadBarcodePdf(locationId, gradeLevel);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `barcodes-grade-${gradeLevel}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess(`Barcode PDF for Grade ${gradeLevel} downloaded successfully.`);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string })?.message ?? 'Failed to generate barcodes. Please try again.'
        : 'Failed to generate barcodes. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 600 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
        Back
      </Button>
      <Typography variant="h5" fontWeight="bold" gutterBottom>
        Barcode Generator
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Generate a printable PDF of student ID barcodes filtered by school and grade level.
      </Typography>

      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* School dropdown */}
          <FormControl fullWidth disabled={locationsLoading}>
            <InputLabel id="location-label">School</InputLabel>
            <Select
              labelId="location-label"
              value={locationId}
              label="School"
              onChange={(e) => {
                setLocationId(e.target.value);
                setGradeLevel('');
                setError(null);
                setSuccess(null);
              }}
            >
              {schoolLocations.map((loc) => (
                <MenuItem key={loc.id} value={loc.id}>
                  {loc.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Grade level dropdown */}
          <FormControl fullWidth disabled={!locationId}>
            <InputLabel id="grade-label">Grade Level</InputLabel>
            <Select
              labelId="grade-label"
              value={gradeLevel}
              label="Grade Level"
              onChange={(e) => {
                setGradeLevel(e.target.value);
                setError(null);
                setSuccess(null);
              }}
            >
              {GRADE_LEVELS.map((g) => (
                <MenuItem key={g.value} value={g.value}>
                  {g.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Error / success feedback */}
          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}

          {/* Generate button */}
          <Button
            variant="contained"
            size="large"
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
            disabled={!locationId || !gradeLevel || loading}
            onClick={handleGenerate}
          >
            {loading ? 'Generating…' : 'Generate Barcodes PDF'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
