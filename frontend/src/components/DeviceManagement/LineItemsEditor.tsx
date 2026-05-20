import { useMemo } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery } from '@tanstack/react-query';
import { componentPriceService } from '../../services/invoice.service';
import type { LineItemDraft } from '../../types/invoice.types';

interface LineItemsEditorProps {
  lineItems:              LineItemDraft[];
  onChange:               (items: LineItemDraft[]) => void;
  equipmentPurchasePrice?: number | null;
  disabled?:              boolean;
}

export default function LineItemsEditor({
  lineItems,
  onChange,
  equipmentPurchasePrice,
  disabled = false,
}: LineItemsEditorProps) {
  const { data: pricesData } = useQuery({
    queryKey: ['componentPrices'],
    queryFn:  () => componentPriceService.getAll({ limit: 100 }),
  });

  const prices = pricesData?.items ?? [];

  const addFromCatalog = (price: (typeof prices)[number]) => {
    onChange([
      ...lineItems,
      {
        componentPriceId: price.id,
        description:      price.name,
        unitPrice:        parseFloat(price.unitPrice),
        quantity:         1,
      },
    ]);
  };

  const addCustomLine = () => {
    onChange([...lineItems, { description: '', unitPrice: 0, quantity: 1 }]);
  };

  const addReplacement = () => {
    if (equipmentPurchasePrice == null) return;
    onChange([
      ...lineItems,
      {
        description:   'Device Total Replacement',
        unitPrice:     equipmentPurchasePrice,
        quantity:      1,
        isReplacement: true,
      },
    ]);
  };

  const removeItem = (index: number) => {
    onChange(lineItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, updates: Partial<LineItemDraft>) => {
    onChange(lineItems.map((item, i) => (i === index ? { ...item, ...updates } : item)));
  };

  const total = useMemo(
    () => lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [lineItems],
  );

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Line Items
      </Typography>

      <Table size="small" sx={{ mb: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Description</TableCell>
            <TableCell align="right">Unit Price</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell align="right">Total</TableCell>
            <TableCell padding="none" />
          </TableRow>
        </TableHead>
        <TableBody>
          {lineItems.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} sx={{ textAlign: 'center', color: 'text.secondary', py: 2 }}>
                No line items. Use the buttons below to add components.
              </TableCell>
            </TableRow>
          )}
          {lineItems.map((item, i) => (
            <TableRow key={i}>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    value={item.description}
                    onChange={e => updateItem(i, { description: e.target.value })}
                    size="small"
                    disabled={disabled}
                    placeholder="Description"
                    sx={{ minWidth: 180 }}
                  />
                  {item.isReplacement && (
                    <Chip label="Replacement" color="warning" size="small" />
                  )}
                </Box>
              </TableCell>
              <TableCell align="right">
                <TextField
                  type="number"
                  value={item.unitPrice}
                  onChange={e => updateItem(i, { unitPrice: Number(e.target.value) })}
                  size="small"
                  disabled={disabled || item.isReplacement}
                  inputProps={{ min: 0, step: '0.01', style: { textAlign: 'right' } }}
                  sx={{ width: 100 }}
                />
              </TableCell>
              <TableCell align="right">
                <TextField
                  type="number"
                  value={item.quantity}
                  onChange={e =>
                    updateItem(i, { quantity: Math.max(1, Number(e.target.value)) })
                  }
                  size="small"
                  disabled={disabled}
                  inputProps={{ min: 1, style: { textAlign: 'right' } }}
                  sx={{ width: 70 }}
                />
              </TableCell>
              <TableCell align="right">
                ${(item.unitPrice * item.quantity).toFixed(2)}
              </TableCell>
              <TableCell padding="none">
                <IconButton size="small" onClick={() => removeItem(i)} disabled={disabled}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
          {lineItems.length > 0 && (
            <TableRow>
              <TableCell colSpan={3} align="right">
                <Typography variant="body1" fontWeight="bold">
                  Total:
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body1" fontWeight="bold">
                  ${total.toFixed(2)}
                </Typography>
              </TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>

      {!disabled && (
        <div className="flex gap-2 flex-wrap items-center">
          <Autocomplete
            options={prices}
            getOptionLabel={p =>
              `${p.name} — ${p.category} ($${parseFloat(p.unitPrice).toFixed(2)})`
            }
            onChange={(_e, val) => {
              if (val) addFromCatalog(val);
            }}
            value={null}
            size="small"
            sx={{ minWidth: 260 }}
            renderInput={params => (
              <TextField {...params} label="Add from Price List" size="small" />
            )}
          />
          <Button size="small" variant="outlined" onClick={addCustomLine}>
            Add Custom Line
          </Button>
          {equipmentPurchasePrice != null && (
            <Button
              size="small"
              variant="outlined"
              color="warning"
              onClick={addReplacement}
            >
              Add Total Replacement (+${equipmentPurchasePrice.toFixed(2)})
            </Button>
          )}
        </div>
      )}
    </Box>
  );
}
