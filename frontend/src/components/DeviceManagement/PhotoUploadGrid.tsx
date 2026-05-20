import { useRef, useState } from 'react';
import {
  Alert,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import { damageIncidentService } from '../../services/damageIncident.service';
import type { DamageIncidentPhoto } from '../../types/damageIncident.types';

const MAX_PHOTOS = 5;

interface PhotoUploadGridProps {
  incidentId:      string;
  photos:          DamageIncidentPhoto[];
  readOnly?:       boolean;
  onPhotosChange?: () => void;
}

export function PhotoUploadGrid({
  incidentId,
  photos,
  readOnly = false,
  onPhotosChange,
}: PhotoUploadGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]   = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [lightbox, setLightbox]     = useState<DamageIncidentPhoto | null>(null);

  const remaining = MAX_PHOTOS - photos.length;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (files.length > remaining) {
      setError(`Only ${remaining} more photo(s) can be added (max ${MAX_PHOTOS} total).`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      await damageIncidentService.uploadPhotos(incidentId, files);
      onPhotosChange?.();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (photo: DamageIncidentPhoto) => {
    setDeleting(photo.id);
    setError(null);
    try {
      await damageIncidentService.deletePhoto(incidentId, photo.id);
      onPhotosChange?.();
    } catch {
      setError('Failed to delete photo. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <div key={photo.id} className="relative group rounded overflow-hidden border border-gray-200">
            <img
              src={photo.fileUrl}
              alt={photo.fileName}
              className="w-full h-28 object-cover cursor-pointer"
              onClick={() => setLightbox(photo)}
            />
            {!readOnly && (
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Tooltip title="Delete photo">
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={deleting === photo.id}
                      onClick={() => handleDelete(photo)}
                      sx={{ bgcolor: 'rgba(255,255,255,0.85)' }}
                    >
                      {deleting === photo.id ? (
                        <CircularProgress size={16} />
                      ) : (
                        <DeleteIcon fontSize="small" />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              </div>
            )}
          </div>
        ))}

        {/* Upload slot */}
        {!readOnly && remaining > 0 && (
          <label className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-gray-300 rounded cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
            {uploading ? (
              <CircularProgress size={24} />
            ) : (
              <>
                <AddPhotoAlternateIcon color="action" />
                <Typography variant="caption" color="text.secondary" mt={0.5}>
                  Add photo ({remaining} left)
                </Typography>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              disabled={uploading}
              onChange={handleUpload}
            />
          </label>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightbox} onClose={() => setLightbox(null)} maxWidth="md" fullWidth>
        <DialogContent sx={{ p: 0, position: 'relative' }}>
          <IconButton
            onClick={() => setLightbox(null)}
            sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(0,0,0,0.4)', color: 'white' }}
          >
            <CloseIcon />
          </IconButton>
          {lightbox && (
            <img
              src={lightbox.fileUrl}
              alt={lightbox.fileName}
              style={{ width: '100%', display: 'block' }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
