import { applyRole } from "../navigation/roles.js";
import { api, isNetworkError, isAuthenticationError, setUnauthorizedHandler } from "../../services/api.js";
import { clearSession, isAuthenticated, readSession, writeOrganizationId, writeSession } from "../../services/storage.js";
import { askFields } from "../../utils/ask.js";
import { $, showToast } from "../../utils/dom.js";
import { getState, setState } from "../../state/store.js";
import { populateCountrySelect, readPhoneField } from "../../utils/phone-field.js";

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
  $("#google-company-form")?.classList.add("hidden");
  if (googleAvailable) $("#google-auth")?.classList.remove("hidden");
  toggleButton.classList.remove("hidden");
  authTitle.textContent = isLogin ? "Connexion" : "Créer votre espace";
  authHint.textContent = isLogin ? "Connectez-vous avec votre compte." : "Quelques informations suffisent : votre agent sera prêt en quelques minutes.";
  toggleButton.textContent = isLogin ? "Créer un compte" : "Se connecter";
  const switchLabel = $("#auth-switch-label");
  if (switchLabel) switchLabel.textContent = isLogin ? "Pas encore de compte ?" : "Vous avez déjà un compte ?";
  $("#login-screen").dataset.mode = mode;
}

/** Bouton « œil » d'un champ mot de passe : affiche ou masque la saisie. */
function initPasswordToggles() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".password-toggle");
    if (!button) return;
    const input = document.getElementById(button.dataset.target);
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.classList.toggle("is-visible", visible);
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", visible ? "Masquer le mot de passe" : "Afficher le mot de passe");
    input.focus();
  });
}

export function showDashboard() {
  $("#login-screen").classList.add("hidden");
  $(".app-shell").classList.remove("hidden");
  document.body.classList.add("is-authenticated");
}

export function logoutUser(mode = "login") {
  // On prévient le serveur pour qu'il supprime la session : le jeton ne doit plus servir après la déconnexion.
  if (isAuthenticated()) void api("/logout", { method: "POST" }).catch(() => undefined);
  clearSession();
  // Panneaux, fenêtres et recherche rapide appartiennent à la session qui se termine : aucun voile ne doit
  // recouvrir l'écran de connexion. Les modifications non enregistrées sont abandonnées avec elle.
  document.dispatchEvent(new CustomEvent("brayano:close-overlays"));
  document.dispatchEvent(new CustomEvent("brayano:session-ended"));
  $(".app-shell").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  document.body.classList.remove("is-authenticated", "in-thread");
  document.title = "Brayano IA — Connexion";
  // L'adresse ne garde pas la page de la session précédente.
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  ["#login-email", "#login-password", "#register-name", "#register-company", "#register-whatsapp-local", "#register-email", "#register-password", "#register-verification-code", "#google-company-name"]
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

  // Le rôle arrive avec la connexion : un employé ne voit pas le menu du propriétaire, même un instant.
  const role = response.user.role === "AGENT" ? "AGENT" : response.user.role === "ADMIN" ? "ADMIN" : null;
  writeSession({
    email: response.user.email,
    token: response.token,
    organizationId: response.organizationId || null,
    ...(role ? { role } : {}),
  });
  if (role) applyRole(role);

  if (response.organizationId) {
    writeOrganizationId(response.organizationId);
    setState({ organizationId: response.organizationId });
  }
}

// ---- Connexion avec Google (Google Identity Services) ----

const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";
let googleAvailable = false;
let pendingGoogleSignup = null;

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Script Google indisponible"));
    document.head.appendChild(script);
  });
}

/** Session reçue du serveur → navigateur, puis tableau de bord. */
async function openSession(result, onAuthenticated, message) {
  writeSession({ email: result.user.email, token: result.token, organizationId: result.organizationId || null });
  if (result.organizationId) {
    writeOrganizationId(result.organizationId);
    setState({ organizationId: result.organizationId });
  }
  showDashboard();
  showToast(message, "success");
  await onAuthenticated();
}

function showGoogleCompanyStep(pending) {
  pendingGoogleSignup = pending;
  ["#login-form", "#register-form", "#register-verification-form", "#google-auth"].forEach((selector) => $(selector)?.classList.add("hidden"));
  $("#google-company-form").classList.remove("hidden");
  $("#toggle-auth-mode").classList.add("hidden");
  $("#auth-title").textContent = pending.name ? `Bienvenue, ${pending.name.split(" ")[0]} !` : "Bienvenue !";
  $("#auth-mode-hint").textContent = `Connecté avec Google : ${pending.email}`;
  $("#google-company-intro").textContent = "Dernière étape : comment s'appelle votre entreprise ?";
  $("#google-company-name").focus();
}

async function handleGoogleCredential(response, onAuthenticated) {
  try {
    const result = await api("/auth/google", { method: "POST", body: JSON.stringify({ credential: response.credential }) });
    if (result.signupRequired) {
      showGoogleCompanyStep(result);
      return;
    }
    await openSession(result, onAuthenticated, "Connexion réussie.");
  } catch (error) {
    showToast(error.message || "Connexion avec Google impossible.", "error");
  }
}

/** Affiche « Continuer avec Google » si le serveur est configuré. Sans configuration ni réseau Google, rien ne change. */
async function initGoogleAuth(onAuthenticated) {
  const container = $("#google-auth");
  const form = $("#google-company-form");
  if (!container || !form) return;

  form.onsubmit = async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    if (!pendingGoogleSignup) {
      showAuthMode("register");
      return;
    }
    try {
      submitButton.disabled = true;
      const result = await api("/auth/google/complete", {
        method: "POST",
        body: JSON.stringify({ signupToken: pendingGoogleSignup.signupToken, companyName: $("#google-company-name").value.trim() }),
      });
      pendingGoogleSignup = null;
      // Pixel Meta : compte réellement créé.
      if (result.created) window.fbq?.("track", "CompleteRegistration");
      await openSession(result, onAuthenticated, result.created ? "Compte créé avec succès." : "Connexion réussie.");
    } catch (error) {
      showToast(error.message || "Impossible de créer votre compte.", "error");
      if (/expirée/.test(error.message || "")) {
        pendingGoogleSignup = null;
        showAuthMode("register");
      }
    } finally {
      submitButton.disabled = false;
    }
  };
  $("#google-company-cancel").onclick = () => {
    pendingGoogleSignup = null;
    window.google?.accounts?.id?.disableAutoSelect?.();
    showAuthMode("register");
  };

  try {
    const { clientId } = await api("/auth/google/config");
    if (!clientId) return;
    await loadGoogleScript();
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => void handleGoogleCredential(response, onAuthenticated),
      ux_mode: "popup",
      context: "signin",
    });
    const width = Math.min(400, Math.max(200, Math.round($("#google-button").getBoundingClientRect().width || 320)));
    window.google.accounts.id.renderButton($("#google-button"), { type: "standard", theme: "outline", size: "large", shape: "pill", text: "continue_with", logo_alignment: "center", locale: "fr", width });
    googleAvailable = true;
    // N'apparaît que sur l'écran de connexion ou d'inscription, pas pendant une étape en cours.
    if (!$("#login-form").classList.contains("hidden") || !$("#register-form").classList.contains("hidden")) container.classList.remove("hidden");
  } catch {
    // Google injoignable ou non configuré : l'inscription par email reste disponible.
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

  populateCountrySelect($("#register-whatsapp-country"));

  setUnauthorizedHandler(() => {
    logoutUser();
    showToast("Votre session n’est plus valide. Reconnectez-vous pour continuer.", "error");
  });

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
        const answer = await askFields({
          title: "Réinitialiser votre mot de passe",
          intro: "Saisissez le code à 6 chiffres reçu par email, puis choisissez un nouveau mot de passe.",
          confirmLabel: "Réinitialiser",
          fields: [
            { name: "code", label: "Code reçu par email", inputMode: "numeric", autocomplete: "one-time-code", placeholder: "123456" },
            { name: "newPassword", label: "Nouveau mot de passe (8 caractères minimum)", type: "password", minLength: 8, autocomplete: "new-password" },
          ],
        });
        if (!answer) return;
        const code = answer.code.trim();
        const newPassword = answer.newPassword;

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
      const whatsappNumber = readPhoneField($("#register-whatsapp-country"), $("#register-whatsapp-local"));
      if (!whatsappNumber) {
        showToast("Saisissez le numéro WhatsApp de l'entreprise.", "error");
        $("#register-whatsapp-local").focus();
        return;
      }

      submitButton.disabled = true;
      const payload = {
        name: $("#register-name").value,
        companyName: $("#register-company").value,
        whatsappNumber,
        email: $("#register-email").value,
        password: $("#register-password").value,
      };

      const result = await api("/register", { method: "POST", body: JSON.stringify(payload) });

      if (result.verificationRequired) {
        setState({ pendingRegistrationEmail: result.email });
        registerForm.classList.add("hidden");
        $("#google-auth")?.classList.add("hidden");
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
      // Pixel Meta : compte réellement créé (email vérifié), pas juste le formulaire rempli.
      window.fbq?.("track", "CompleteRegistration");
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

  void initGoogleAuth(onAuthenticated);
  initPasswordToggles();

  // Lien « Créer mon compte » de la page d'accueil : ouvre directement l'inscription.
  if (new URLSearchParams(window.location.search).has("inscription")) showAuthMode("register");

  if (isAuthenticated()) {
    const restoringToken = readSession()?.token;
    showDashboard();
    api("/me")
      .then(async (me) => {
        const session = readSession();
        if (!session?.token || session.token !== restoringToken) return;
        const nextSession = { ...session, organizationId: me.organizationId || session?.organizationId || null };
        writeSession(nextSession);
        if (nextSession.organizationId) {
          writeOrganizationId(nextSession.organizationId);
          setState({ organizationId: nextSession.organizationId });
        }
        await onAuthenticated();
      })
      .catch((error) => {
        if (isAuthenticationError(error)) return; // Le client API a déjà affiché la connexion.
        showToast(isNetworkError(error) ? "Serveur indisponible. Réessayez plus tard." : error.message, "error");
      });
  }
}
