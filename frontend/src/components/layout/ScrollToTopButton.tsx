import { RefObject, useEffect, useRef, useState } from 'react';
import { Fab, Tooltip, Zoom } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';

// How far scrolled down from the top (in px) before the button appears.
const VISIBILITY_THRESHOLD = 100;

interface ScrollToTopButtonProps {
  containerRef: RefObject<HTMLElement | null>;
}

export function ScrollToTopButton({ containerRef }: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const next = el.scrollTop > VISIBILITY_THRESHOLD;
      if (visibleRef.current !== next) setVisible(next);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [containerRef]);

  const handleClick = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Zoom in={visible}>
      <Tooltip title="Back to top">
        <Fab
          size="small"
          aria-label="Back to top"
          onClick={handleClick}
          sx={{
            position: 'fixed',
            bottom: { xs: 16, sm: 24 },
            right: { xs: 16, sm: 24 },
            zIndex: (theme) => theme.zIndex.speedDial,
            opacity: 0.85,
            bgcolor: 'background.paper',
            color: 'primary.main',
            '&:hover': { opacity: 1, bgcolor: 'background.paper' },
          }}
        >
          <ArrowUpwardIcon fontSize="small" />
        </Fab>
      </Tooltip>
    </Zoom>
  );
}

export default ScrollToTopButton;
