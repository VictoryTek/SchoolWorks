import { FieldError } from 'react-hook-form';

/**
 * Returns MUI TextField `error` and `helperText` props from a react-hook-form FieldError.
 * Usage: <TextField {...register('field')} {...getFieldError(errors.field)} />
 */
export function getFieldError(error?: FieldError) {
  return {
    error: !!error,
    helperText: error?.message ?? '',
  };
}
