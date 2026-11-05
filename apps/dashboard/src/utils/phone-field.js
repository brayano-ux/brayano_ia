import { FRANCOPHONE_AFRICAN_COUNTRIES, defaultDialCode, splitWhatsAppNumber } from "./francophone-countries.js";

/**
 * Remplit un <select> avec la liste des pays francophones d'Afrique (drapeau + nom + indicatif),
 * un par <option>. Ne fait rien si le select a déjà des options (évite de le repeupler à chaque appel).
 */
export function populateCountrySelect(selectEl) {
  if (!selectEl || selectEl.options.length > 0) return;
  for (const country of FRANCOPHONE_AFRICAN_COUNTRIES) {
    const option = document.createElement("option");
    option.value = country.dialCode;
    option.textContent = `${country.flag} ${country.name} (+${country.dialCode})`;
    selectEl.appendChild(option);
  }
  selectEl.value = defaultDialCode();
}

/**
 * Pré-remplit la paire indicatif + numéro local à partir d'un numéro complet (chiffres seuls).
 * Si l'indicatif n'est pas reconnu (numéro d'un pays hors de la liste), le select garde sa valeur
 * actuelle et le numéro complet est placé dans le champ local pour ne rien perdre.
 */
export function setPhoneFieldFromDigits(selectEl, inputEl, digits) {
  if (!selectEl || !inputEl) return;
  const split = splitWhatsAppNumber(digits);
  if (split) {
    selectEl.value = split.dialCode;
    inputEl.value = split.local;
  } else if (digits) {
    inputEl.value = String(digits).replace(/\D/g, "");
  }
}

/**
 * Combine l'indicatif choisi et le numéro local saisi en un numéro international complet
 * (ex. "+237690000000"), prêt pour l'API. Retourne null si le numéro local est vide.
 */
export function readPhoneField(selectEl, inputEl) {
  const dialCode = selectEl?.value || defaultDialCode();
  const local = (inputEl?.value ?? "").replace(/\D/g, "");
  if (!local) return null;
  return `+${dialCode}${local}`;
}
