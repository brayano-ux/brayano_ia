import { $, showToast } from "../../utils/dom.js";

/**
 * Position GPS de la boutique (onglet « Connaissances » de l'Agent IA) : l'agent l'envoie comme une vraie
 * localisation WhatsApp à un client qui demande où se trouve l'entreprise. Capturée en un clic depuis le
 * téléphone du propriétaire, via la géolocalisation du navigateur — aucune saisie manuelle de coordonnées.
 */

let latitude = null;
let longitude = null;

function mapUrl(lat, lng) {
  const delta = 0.003;
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

function render() {
  const hasPosition = latitude !== null && longitude !== null;
  $("#shop-location-set").classList.toggle("hidden", !hasPosition);
  $("#shop-location-status").textContent = hasPosition
    ? `Position enregistrée : ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    : "Aucune position enregistrée.";
  $("#shop-location-map").src = hasPosition ? mapUrl(latitude, longitude) : "";
}

export function fillShopLocation(settings) {
  latitude = typeof settings.shopLatitude === "number" ? settings.shopLatitude : null;
  longitude = typeof settings.shopLongitude === "number" ? settings.shopLongitude : null;
  $("#shop-location-label").value = settings.shopLocationLabel || "";
  render();
}

export function readShopLocation() {
  return {
    shopLatitude: latitude,
    shopLongitude: longitude,
    shopLocationLabel: $("#shop-location-label").value.trim() || null,
  };
}

export function shopLocationSnapshot() {
  return JSON.stringify(readShopLocation());
}

function captureCurrentPosition() {
  if (!navigator.geolocation) {
    showToast("Votre navigateur ne permet pas d'accéder à la position.", "error");
    return;
  }
  const button = $("#shop-location-capture");
  button.disabled = true;
  button.textContent = "Recherche de la position…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
      render();
      showToast("Position capturée. Vérifiez la carte puis cliquez sur Enregistrer.", "success");
      button.disabled = false;
      button.textContent = "📍 Utiliser ma position actuelle";
    },
    (error) => {
      const messages = {
        1: "Permission refusée : autorisez l'accès à la position dans votre navigateur.",
        2: "Position indisponible. Vérifiez votre connexion ou votre GPS.",
        3: "La recherche de position a pris trop de temps. Réessayez.",
      };
      showToast(messages[error.code] || "Impossible d'obtenir votre position.", "error");
      button.disabled = false;
      button.textContent = "📍 Utiliser ma position actuelle";
    },
    { enableHighAccuracy: true, timeout: 15_000 },
  );
}

export function initShopLocation() {
  $("#shop-location-capture").onclick = captureCurrentPosition;
  $("#shop-location-clear").onclick = () => {
    latitude = null;
    longitude = null;
    render();
  };
}
