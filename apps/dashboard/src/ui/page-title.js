/**
 * Titre de l'onglet du navigateur : « (3) Conversations · Brayano IA ».
 * Le nombre entre parenthèses est celui des conversations non lues ; il reste affiché quelle que soit la page.
 */
let pageTitle = "Tableau de bord";
let unread = 0;

function apply() {
  document.title = `${unread ? `(${unread}) ` : ""}${pageTitle} · Brayano IA`;
}

export function setPageTitle(title) {
  pageTitle = title;
  apply();
}

export function setUnreadCount(count) {
  unread = Math.max(0, Number(count) || 0);
  apply();
}
