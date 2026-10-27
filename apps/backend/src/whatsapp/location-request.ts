/** Le client demande-t-il où se trouve la boutique / comment s'y rendre ? (français et anglais). */
export function isLocationRequested(message: string): boolean {
  const text = message.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\b(?:adresse|localisation|geolocalisation|position|itineraire|gps|maps?)\b/.test(text)) return true;
  if (/\bou\s+(?:se trouve|etes[- ]vous|vous trouvez)\b/.test(text)) return true;
  if (/\b(?:vous\s+etes|t'?es|tu\s+es)\s+ou\b/.test(text)) return true;
  if (/\bou\s+est\s+(?:la\s+boutique|votre\s+boutique|le\s+magasin|situee?)\b/.test(text)) return true;
  if (/\bou\b.{0,15}\b(?:boutique|magasin)\b/.test(text)) return true;
  if (/\bcomment\s+(?:venir|arriver|vous trouver|y aller|faire pour venir|me rendre)\b/.test(text)) return true;
  if (/\b(?:location|address|directions)\b/.test(text)) return true;
  if (/\bwhere\s+(?:are you|is|'?s the shop|to find you|is your shop)\b/.test(text)) return true;
  if (/\bhow\s+(?:do i get|to get|can i get)\s+(?:there|to you)\b/.test(text)) return true;
  return false;
}
