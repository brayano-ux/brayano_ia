import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, saveSession } from '../../services/api';

// Aucun identifiant n'est prérempli : la page de connexion démarre toujours vide.
const DEFAULT_CREDENTIALS = { email: '', password: '' };

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(DEFAULT_CREDENTIALS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [resetStep, setResetStep] = useState('request');
  const [resetMessage, setResetMessage] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetForm, setResetForm] = useState({
    email: DEFAULT_CREDENTIALS.email,
    code: '',
    newPassword: '',
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleResetChange = (event) => {
    const { name, value } = event.target;
    setResetForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await api('/login', {
        method: 'POST',
        body: {
          email: form.email,
          password: form.password,
        },
      });

      saveSession({
        token: data.token,
        email: data.user?.email || form.email,
        organizationId: data.organizationId,
      });

      navigate('/overview');
    } catch (err) {
      setError(err.message || 'Identifiants incorrects.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (event) => {
    event.preventDefault();
    setResetLoading(true);
    setResetMessage('');

    try {
      const data = await api('/password-reset/request', {
        method: 'POST',
        body: {
          email: resetForm.email || form.email,
        },
      });

      setResetStep('verify');
      setResetMessage(data.message || 'Un code a été envoyé par email.');
    } catch (err) {
      setResetMessage(err.message || 'Impossible d’envoyer le code.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifyReset = async (event) => {
    event.preventDefault();
    setResetLoading(true);
    setResetMessage('');

    try {
      const data = await api('/password-reset/verify', {
        method: 'POST',
        body: {
          email: resetForm.email || form.email,
          code: resetForm.code,
          newPassword: resetForm.newPassword,
        },
      });

      setResetMessage(data.message || 'Votre mot de passe a été réinitialisé.');
      setResetMode(false);
      setResetStep('request');
      setResetForm({ email: form.email, code: '', newPassword: '' });
      setForm((current) => ({ ...current, password: resetForm.newPassword }));
    } catch (err) {
      setResetMessage(err.message || 'Code ou mot de passe invalide.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand-row">
          <div className="auth-brand">
            <span className="brand-glyph">B</span>
            <span>
              Brayano<span className="brand-accent">AI</span>
            </span>
          </div>
          <span className="auth-badge">Premium</span>
        </div>

        <div className="auth-header-block">
          <h2>{resetMode ? 'Réinitialiser le mot de passe' : 'Connexion'}</h2>
          <p className="auth-subtitle">
            {resetMode
              ? 'Saisissez votre email et recevez un code pour réinitialiser votre mot de passe.'
              : 'Accédez à votre espace d’administration et suivez vos conversations en temps réel.'}
          </p>
        </div>

        {resetMode ? (
          <form className="auth-form" onSubmit={resetStep === 'request' ? handleRequestReset : handleVerifyReset}>
            <label>
              Email
              <input
                type="email"
                name="email"
                value={resetForm.email}
                onChange={handleResetChange}
                placeholder="vous@entreprise.com"
              />
            </label>

            {resetStep === 'verify' ? (
              <>
                <label>
                  Code de vérification
                  <input
                    type="text"
                    name="code"
                    value={resetForm.code}
                    onChange={handleResetChange}
                    placeholder="123456"
                    maxLength={6}
                  />
                </label>
                <label>
                  Nouveau mot de passe
                  <input
                    type="password"
                    name="newPassword"
                    value={resetForm.newPassword}
                    onChange={handleResetChange}
                    placeholder="••••••••"
                  />
                </label>
              </>
            ) : null}

            {resetMessage ? <div className="form-success">{resetMessage}</div> : null}

            <button type="submit" className="primary-button" disabled={resetLoading}>
              {resetLoading
                ? (resetStep === 'request' ? 'Envoi...' : 'Vérification...')
                : (resetStep === 'request' ? 'Envoyer le code' : 'Réinitialiser le mot de passe')}
            </button>

            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setResetMode(false);
                setResetStep('request');
                setResetMessage('');
              }}
            >
              Retour à la connexion
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Email
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="vous@entreprise.com"
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="••••••••"
              />
            </label>

            <div className="auth-meta-row">
              <label className="remember-me">
                <input type="checkbox" defaultChecked />
                Se souvenir de moi
              </label>
              <button
                type="button"
                className="ghost-link"
                onClick={() => {
                  setResetForm((current) => ({ ...current, email: form.email }));
                  setResetMode(true);
                  setResetStep('request');
                  setResetMessage('');
                }}
              >
                Mot de passe oublié ?
              </button>
            </div>

            {error ? <div className="form-error">{error}</div> : null}

            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
