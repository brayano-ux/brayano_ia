import { api, isNetworkError } from "../../services/api.js";
import { clearSession, isAuthenticated, readSession, writeOrganizationId, writeSession } from "../../services/storage.js";
import { $, showToast } from "../../utils/dom.js";
import { getState, setState } from "../../state/store.js";

/**
 * Feature "authentification" : login, inscription avec vérification
 * email, et cycle de vie de la session (persistée en localStorage).
 */

function showAuthMode(mode) {
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const verificationForm = $("#register-verification-form");
  const toggleButton = $("#toggle-auth-mode");
  const authTitle = $("#auth-title");
  const authHint = $("#auth-mode-hint");

  if (!loginForm || !registerForm || !toggleButton || !authTitle || !authHint) return;

  const isLogin = mode === "login";
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  verificationForm?.classList.add("hidden");
  toggleButton.classList.remove("hidden");
  authTitle.textContent = isLogin ? "Connexion à l'espace de pilotage" : "Créer mon espace client";
  authHint.textContent = isLogin ? "Connectez-vous avec votre compte." : "Créez votre entreprise et votre compte administrateur.";
  toggleButton.textContent = isLogin ? "Créer un compte" : "Se connecter";
}

export function showDashboard() {
  $("#login-screen").classList.add("hidden");
  $(".app-shell").classList.remove("hidden");
}

export function logoutUser(mode = "login") {
  clearSession();
  $(".app-shell").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  ["#login-email", "#login-password", "#register-name", "#register-company", "#register-whatsapp", "#register-email", "#register-password", "#register-verification-code"]
    .forEach((selector) => {
      const field = $(selector);
      if (field) field.value = "";
    });
  showAuthMode(mode);
}

async function authenticateUser(email, password) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const response = await api("/login", {
    method: "POST",
    body: JSON.stringify({ email: normalizedEmail, password }),
  });

  writeSession({
    email: response.user.email,
    token: response.token,
    organizationId: response.organizationId || null,
  });

  if (response.organizationId) {
    writeOrganizationId(response.organizationId);
    setState({ organizationId: response.organizationId });
  }
}

function startResendCountdown() {
  const button = $("#resend-registration-code");
  if (!button) return;
  let remaining = 60;
  button.disabled = true;
  button.textContent = `Renvoyer le code (${remaining}s)`;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      button.disabled = false;
      button.textContent = "Renvoyer le code";
      return;
    }
    button.textContent = `Renvoyer le code (${remaining}s)`;
  }, 1000);
}

/**
 * Initialise tous les formulaires de l'écran d'authentification et
 * relance la session existante si un token valide est déjà présent.
 * @param {() => Promise<void>} onAuthenticated appelé une fois connecté
 */
export function initAuthFlow(onAuthenticated) {
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const verificationForm = $("#register-verification-form");
  const toggleButton = $("#toggle-auth-mode");
  const forgotPasswordLink = $("#forgot-password-link");

  if (!loginForm || !registerForm || !verificationForm || !toggleButton) return;

  if (forgotPasswordLink) {
    forgotPasswordLink.onclick = async () => {
      const email = $("#login-email").value.trim();
      if (!email) {
        showToast("Saisissez votre adresse email pour recevoir le code.", "error");
        $("#login-email").focus();
        return;
      }

      try {
        const result = await api("/password-reset/request", {
          method: "POST",
          body: JSON.stringify({ email }),
        });

        showToast(result.message || "Un code de vérification a été envoyé.", "success");
        const code = window.prompt("Entrez le code reçu par email :", "");
        if (!code) {
          return;
        }

        const newPassword = window.prompt("Choisissez un nouveau mot de passe (au moins 8 caractères) :", "");
        if (!newPassword || newPassword.length < 8) {
          showToast("Le nouveau mot de passe doit contenir au moins 8 caractères.", "error");
          return;
        }

        const resetResult = await api("/password-reset/verify", {
          method: "POST",
          body: JSON.stringify({ email, code, newPassword }),
        });

        showToast(resetResult.message || "Mot de passe réinitialisé.", "success");
      } catch (error) {
        showToast(error.message || "Impossible de réinitialiser le mot de passe.", "error");
      }
    };
  }

  toggleButton.onclick = () => {
    const isLoginHidden = $("#login-form").classList.contains("hidden");
    showAuthMode(isLoginHidden ? "login" : "register");
  };

  loginForm.onsubmit = async (event) => {
    event.preventDefault();
    const email = $("#login-email").value;
    const password = $("#login-password").value;
    const submitButton = loginForm.querySelector('button[type="submit"]');

    try {
      submitButton.disabled = true;
      await authenticateUser(email, password);
      showDashboard();
      showToast("Connexion réussie.", "success");
      await onAuthenticated();
    } catch (error) {
      showToast(error.message || "Email ou mot de passe incorrect.", "error");
    } finally {
      submitButton.disabled = false;
    }
  };

  registerForm.onsubmit = async (event) => {
    event.preventDefault();
    const submitButton = registerForm.querySelector('button[type="submit"]');

    try {
      submitButton.disabled = true;
      const payload = {
        name: $("#register-name").value,
        companyName: $("#register-company").value,
        whatsappNumber: $("#register-whatsapp").value,
        email: $("#register-email").value,
        password: $("#register-password").value,
      };

      const result = await api("/register", { method: "POST", body: JSON.stringify(payload) });

      if (result.verificationRequired) {
        setState({ pendingRegistrationEmail: result.email });
        registerForm.classList.add("hidden");
        verificationForm.classList.remove("hidden");
        $("#auth-title").textContent = "Vérifier votre adresse email";
        $("#auth-mode-hint").textContent = "Saisissez le code reçu par email.";
        toggleButton.classList.add("hidden");
        startResendCountdown();
        showToast(result.message, "info");
        return;
      }

      writeSession({ email: result.user.email, token: result.token });
      writeOrganizationId(result.organizationId);
      showDashboard();
      showToast("Compte créé avec succès.", "success");
      await onAuthenticated();
    } catch (error) {
      showToast(error.message || "Impossible de créer votre compte.", "error");
    } finally {
      submitButton.disabled = false;
    }
  };

  verificationForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api("/register/verify", {
        method: "POST",
        body: JSON.stringify({ email: getState().pendingRegistrationEmail, code: $("#register-verification-code").value }),
      });
      writeSession({ email: result.user.email, token: result.token, organizationId: result.organizationId });
      writeOrganizationId(result.organizationId);
      setState({ organizationId: result.organizationId });
      showDashboard();
      showToast("Compte créé avec succès.", "success");
      await onAuthenticated();
    } catch (error) {
      showToast(error.message || "Code incorrect.", "error");
    }
  };

  $("#resend-registration-code").onclick = async () => {
    try {
      const result = await api("/register/resend", {
        method: "POST",
        body: JSON.stringify({ email: getState().pendingRegistrationEmail }),
      });
      showToast(result.message, "info");
      startResendCountdown();
    } catch (error) {
      showToast(error.message, "error");
    }
  };

  // Lien « Créer mon compte » de la page d'accueil : ouvre directement l'inscription.
  if (new URLSearchParams(window.location.search).has("inscription")) showAuthMode("register");

  if (isAuthenticated()) {
    showDashboard();
    api("/me")
      .then(async (me) => {
        const session = readSession();
        const nextSession = { ...session, organizationId: me.organizationId || session?.organizationId || null };
        writeSession(nextSession);
        if (nextSession.organizationId) {
          writeOrganizationId(nextSession.organizationId);
          setState({ organizationId: nextSession.organizationId });
        }
        await onAuthenticated();
      })
      .catch((error) => {
        if (isNetworkError(error)) {
          showToast("Serveur indisponible. Réessayez plus tard.", "error");
          return;
        }
        logoutUser();
        showToast("Session expirée. Veuillez vous reconnecter.", "error");
      });
  }
}
