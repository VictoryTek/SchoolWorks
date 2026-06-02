import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../services/authService';
import { useAuthStore } from '../store/authStore';
import './Login.css';

export const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  // Initialise silentPending synchronously from the URL so there is no flash of the
  // login button before the first useEffect fires. If there is no code/error/fallback
  // in the URL the user has just arrived and we should attempt silent SSO first.
  const [silentPending, setSilentPending] = useState(() => {
    // If the user explicitly logged out, skip silent SSO immediately (before first render)
    if (sessionStorage.getItem('explicit_logout') === 'true') {
      sessionStorage.removeItem('explicit_logout');
      return false;
    }
    const params = new URLSearchParams(window.location.search);
    return !params.get('code') && !params.get('error') && params.get('fallback') !== 'true';
  });
  const callbackProcessed = useRef(false);
  const { setUser, isAuthenticated } = useAuthStore();

  // Check if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state') ?? undefined;
    
    if (code && !callbackProcessed.current) {
      callbackProcessed.current = true;
      handleCallback(code, state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSilentLogin = async () => {
    try {
      const response = await authApi.getSilentLoginUrl();
      if (response.data.authUrl) {
        window.location.href = response.data.authUrl;
      } else {
        // Backend returned a response but no URL — fall back to button
        setSilentPending(false);
      }
    } catch {
      // Network or server error — fall back to showing the login button
      setSilentPending(false);
    }
  };

  // Auto-trigger silent SSO redirect on first mount (Path A: redirect-based).
  // Fires only when there is no code/error/fallback in the URL.
  // After 500 ms the browser is redirected to Entra with prompt:none.
  // On Entra-joined / hybrid-joined devices this completes with zero interaction.
  // On failure Entra redirects back with ?error=login_required and silentPending
  // is false on re-mount, so the normal login button is shown.
  //
  // NOTE: No silentTriggered guard here — the timer is the gate. React StrictMode
  // double-invocation cancels the first timer via cleanup and the second invocation
  // starts a fresh one, which is the correct behaviour.
  useEffect(() => {
    if (!silentPending) return;

    const timer = setTimeout(() => {
      handleSilentLogin();
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCallback = async (code: string, state?: string) => {
    setLoading(true);
    setError('');

    try {
      const response = await authApi.handleCallback(code, state);
      
      if (response.data.success) {
        // Tokens are now in HttpOnly cookies, just store user
        setUser(response.data.user);
        
        // Redirect to dashboard
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Authentication failed. Please try again.');

      // Clear code from URL
      navigate('/login', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await authApi.getLoginUrl();
      
      if (response.data.authUrl) {
        // Redirect to Entra ID login
        window.location.href = response.data.authUrl;
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to initiate login. Please try again.');
      setLoading(false);
    }
  };

  if (loading || silentPending) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-spinner">
            <div className="spinner"></div>
            <p>{silentPending ? 'Signing you in...' : 'Authenticating...'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src="/logo.png" alt="SchoolWorks" className="login-logo" />
          <p>Sign in to continue</p>
        </div>

        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="login-body">
          <button 
            className="microsoft-login-button"
            onClick={handleLogin}
            disabled={loading}
          >
            <svg className="microsoft-icon" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            Sign in with Microsoft
          </button>

          <p className="login-info">
            Use your organization account to sign in
          </p>
        </div>

        <div className="login-footer">
          <p>Secure authentication powered by Microsoft Entra ID</p>
        </div>
      </div>
    </div>
  );
};
