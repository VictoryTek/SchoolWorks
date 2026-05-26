import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { useEquipmentLookup } from '@/hooks/queries/useInventoryAudit';
import { useAddEquipmentToAudit } from '@/hooks/mutations/useInventoryAuditMutations';

interface AuditEquipmentSearchProps {
  sessionId: string;
  onAdded?: () => void;
}

export function AuditEquipmentSearch({ sessionId, onAdded }: AuditEquipmentSearchProps) {
  const [inputValue, setInputValue] = useState('');
  const [searchTag, setSearchTag] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [addError, setAddError] = useState('');

  const {
    data: lookupResult,
    isFetching,
    error: lookupError,
  } = useEquipmentLookup(sessionId, searchTag);

  const addMutation = useAddEquipmentToAudit();

  const handleSearch = () => {
    setAddSuccess('');
    setAddError('');
    setSearchTag(inputValue.trim());
  };

  const handleAdd = () => {
    if (!lookupResult?.equipment) return;
    setAddError('');
    setAddSuccess('');

    addMutation.mutate(
      { sessionId, data: { equipmentId: lookupResult.equipment.id } },
      {
        onSuccess: () => {
          setAddSuccess(
            `${lookupResult.equipment.assetTag} — ${lookupResult.equipment.name} added to this room.`
          );
          setInputValue('');
          setSearchTag('');
          onAdded?.();
        },
        onError: (err: any) => {
          setAddError(
            err?.response?.data?.message ?? 'Failed to add equipment to the audit.'
          );
        },
      }
    );
  };

  const notFound =
    lookupError && (lookupError as any)?.response?.status === 404;

  const otherLookupError = lookupError && !notFound;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="subtitle2" color="text.secondary">
        Found equipment not on this list? Search by asset tag to add it.
      </Typography>

      {/* Search input */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: { xs: 'stretch', sm: 'flex-start' } }}>
        <TextField
          size="small"
          label="Asset Tag"
          placeholder="e.g. T-1234"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          inputProps={{ maxLength: 50 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ flex: 1 }}
        />
        <Button
          variant="outlined"
          onClick={handleSearch}
          disabled={!inputValue.trim() || isFetching}
          startIcon={isFetching ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          {isFetching ? 'Searching…' : 'Search'}
        </Button>
      </Box>

      {/* Success message after add */}
      {addSuccess && (
        <Alert severity="success" onClose={() => setAddSuccess('')} sx={{ py: 0.5 }}>
          {addSuccess}
        </Alert>
      )}

      {/* Not found */}
      {notFound && searchTag && (
        <Alert severity="warning" sx={{ py: 0.5 }}>
          No equipment found with asset tag <strong>{searchTag}</strong>.
        </Alert>
      )}

      {/* Other lookup error */}
      {otherLookupError && (
        <Alert severity="error" sx={{ py: 0.5 }}>
          {(lookupError as any)?.response?.data?.message ?? 'Lookup failed.'}
        </Alert>
      )}

      {/* Add error */}
      {addError && (
        <Alert severity="error" onClose={() => setAddError('')} sx={{ py: 0.5 }}>
          {addError}
        </Alert>
      )}

      {/* Result card */}
      {lookupResult && !notFound && (
        <Card variant="outlined" sx={{ maxWidth: 480, width: '100%' }}>
          <CardContent sx={{ pb: '12px !important' }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 1,
                flexWrap: 'wrap',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {lookupResult.equipment.assetTag}
                </Typography>
                <Typography variant="body2">{lookupResult.equipment.name}</Typography>
                {lookupResult.equipment.serialNumber && (
                  <Typography variant="caption" color="text.secondary">
                    S/N: {lookupResult.equipment.serialNumber}
                  </Typography>
                )}
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                {lookupResult.equipment.room ? (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      Currently in:
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {lookupResult.equipment.room.name}
                    </Typography>
                    {lookupResult.equipment.officeLocation && (
                      <Typography variant="caption" color="text.secondary">
                        {lookupResult.equipment.officeLocation.name}
                      </Typography>
                    )}
                  </>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    No room assigned
                  </Typography>
                )}
              </Box>
            </Box>

            {lookupResult.equipment.isDisposed && (
              <Alert severity="error" sx={{ mt: 1, py: 0.5 }}>
                This item is marked as disposed and cannot be added.
              </Alert>
            )}

            {lookupResult.alreadyInSession && (
              <Alert severity="info" sx={{ mt: 1, py: 0.5 }}>
                This item is already in this audit session.
              </Alert>
            )}

            {lookupResult.canAdd && (
              <Box sx={{ mt: 1.5 }}>
                <Divider sx={{ mb: 1.5 }} />
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  fullWidth
                  startIcon={
                    addMutation.isPending ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <AddCircleOutlineIcon />
                    )
                  }
                  disabled={addMutation.isPending}
                  onClick={handleAdd}
                >
                  {addMutation.isPending ? 'Adding…' : 'Add to This Room'}
                </Button>
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
