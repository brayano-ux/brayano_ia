/**
 * Ce que l'assistant d'aide du tableau de bord sait de Brayano IA.
 * À tenir à jour quand une page ou un réglage change : l'assistant ne répond qu'à partir de ce texte.
 */

export const SUPPORT_WHATSAPP_DISPLAY = "+237 683 26 05 20";

/** Pages du tableau de bord que l'assistant peut ouvrir d'un clic (clé → nom affiché dans le menu). */
export const SUPPORT_VIEWS = {
  overview: "Vue d'ensemble",
  inbox: "Conversations",
  agent: "Agent IA",
  products: "Produits",
  appointments: "Rendez-vous",
  orders: "Commandes",
  broadcasts: "Messages groupés",
  whatsapp: "WhatsApp",
  billing: "Mon forfait",
  settings: "Paramètres",
} as const;

export type SupportView = keyof typeof SUPPORT_VIEWS;

export const SUPPORT_KNOWLEDGE = `
# BRAYANO IA EN BREF
Brayano IA est un assistant WhatsApp pour les commerçants et les entreprises. Le client écrit sur le numéro WhatsApp de l'entreprise, l'assistant (l'« agent ») lui répond tout seul, 24h/24, en français, en anglais ou en pidgin, y compris pour les messages vocaux. Il présente les produits avec leur photo, note les commandes et les rendez-vous, et passe la main au propriétaire quand il ne sait pas. Le propriétaire pilote tout depuis le tableau de bord (ce site), sur ordinateur ou sur téléphone.
Le menu du tableau de bord (à gauche sur ordinateur ; sur téléphone : bouton « Plus » en bas ou menu ☰ en haut) contient : Vue d'ensemble, Conversations, Agent IA, Produits, Rendez-vous, Commandes, Messages groupés, WhatsApp, Mon forfait, Paramètres.

# POUR DÉMARRER : LES 5 ÉTAPES DANS L'ORDRE
1. Créer son compte (page de connexion → « Créer un compte ») : nom, nom de l'entreprise, numéro WhatsApp de l'entreprise avec l'indicatif du pays (ex. +237 6 90 00 00 00), email, mot de passe d'au moins 8 caractères. Un code à 6 chiffres est envoyé par email : le saisir pour valider. Si le code n'arrive pas : regarder dans les courriers indésirables (spam) puis cliquer sur « Renvoyer le code ».
2. Connecter WhatsApp (page « WhatsApp »). Sans cette étape, l'agent ne peut pas répondre.
3. Remplir « Ce que l'agent sait de votre entreprise » (page « Agent IA », section Connaissances).
4. Ajouter ses produits avec photos (page « Produits »), si on vend des produits.
5. Tester l'agent (page « Agent IA », bloc « Tester l'agent avec un prospect » en bas de page) avant d'annoncer le numéro à ses clients.
L'essai gratuit offre 100 messages de l'assistant, sans carte bancaire.

# PAGE « WHATSAPP » : CONNEXION DU NUMÉRO
- Le numéro WhatsApp de l'entreprise s'enregistre en haut de la page (avec l'indicatif du pays), bouton « Enregistrer ».
- Deux façons de relier le numéro, comme pour WhatsApp Web :
  a) QR code : onglet « Connexion par QR code ». Le QR code apparaît à l'écran (il peut mettre quelques secondes). Sur le téléphone de l'entreprise : WhatsApp → Appareils liés → Lier un appareil → scanner le QR code. Le QR code se rafraîchit tout seul.
  b) Code d'association : onglet « Utiliser un code d'association ». Saisir le numéro avec l'indicatif, cliquer sur « Recevoir le code », puis dans WhatsApp : Appareils liés → Lier un appareil → « Lier avec un numéro de téléphone » et saisir le code affiché. Pratique quand on n'a qu'un seul téléphone (on ne peut pas scanner son propre écran).
- Le statut s'affiche en haut : « WhatsApp connecté » ou « WhatsApp déconnecté ». Le bouton « Déconnecter ce numéro » coupe la liaison (l'agent ne répond plus).
- Le client garde son numéro et son téléphone : on n'a pas besoin de changer de numéro. Le téléphone doit rester connecté à internet de temps en temps pour que WhatsApp garde l'appareil lié, comme pour WhatsApp Web.
- Si la connexion se coupe : si l'on ouvre le même WhatsApp ailleurs ou que l'on supprime l'appareil lié depuis le téléphone, la liaison saute. Il suffit de refaire la liaison (QR code ou code). Le propriétaire reçoit un email quand son WhatsApp se déconnecte.
- Si le QR code n'apparaît pas : attendre une dizaine de secondes, actualiser la page, vérifier la connexion internet, puis réessayer. Si cela persiste, contacter le support.
- Utiliser un numéro WhatsApp Business ou WhatsApp normal : les deux se relient de la même façon. Un numéro ne peut être relié qu'à une seule entreprise.

# PAGE « AGENT IA » : RÉGLER L'AGENT
En haut : un interrupteur « Réponses automatiques » (Actif / désactivé) pour allumer ou couper toutes les réponses de l'agent, et un bouton « Enregistrer ». Tant qu'on n'a pas cliqué sur « Enregistrer », un message « Modifications non enregistrées » s'affiche : si l'on quitte la page, les changements sont perdus.
La page est découpée en six onglets : Identité, Connaissances, Comportement, Horaires, Apprentissage, Fonctions. Un indicateur « Configuration x / 5 » montre ce qui reste à remplir.
- À la toute première connexion du propriétaire, une fenêtre propose de choisir le domaine d'activité, le rôle (closer/vendeur, support client, commercial/conseiller, accueil/rendez-vous, relance et fidélisation) et le ton (professionnel, amical, direct, décontracté) de l'agent ; ce choix compose directement les « Instructions de l'agent ». On peut cliquer « Configurer plus tard » pour la passer : elle ne réapparaît alors plus. Pour changer le rôle ou le ton ensuite, on modifie simplement les « Instructions de l'agent » dans l'onglet Comportement (il n'y a pas de deuxième fenêtre de ce genre dans les réglages).
- IDENTITÉ : nom de l'agent (ce que voient les clients, ex. « Awa, Assistante du Salon Belle Époque »).
- CONNAISSANCES : « Informations sur votre activité ». C'est la fiche que l'agent utilise pour répondre : activité, adresse, quartiers, horaires, téléphone, livraison et frais, moyens de paiement (Orange Money, MTN MoMo…), conditions de retour. Plus c'est précis, mieux l'agent répond. Il n'invente rien : ce qui n'est pas écrit, il le dit au client honnêtement et passe la main au propriétaire. N'écrire que des informations exactes.
  « Assistant de configuration » : pour gagner du temps, on donne une source (texte collé, adresse du site web, ou PDF de 5 Mo maximum avec texte sélectionnable) puis « Analyser la source ». L'assistant extrait uniquement ce qui y est écrit, présente un brouillon, liste ce qui n'a pas été trouvé (à compléter soi-même) et ce qu'il a écarté car non vérifiable. On relit, puis « Utiliser ce texte » (remplace) ou « Ajouter à la suite », puis on clique sur « Enregistrer ». Pour une page Facebook : la copier-coller dans « Texte collé » (la section « À propos »), il ne se connecte pas à Facebook. Il y a une limite d'environ 8 analyses par heure.
  « Localisation de la boutique » (bas de l'onglet Connaissances) : bouton « Utiliser ma position actuelle » — à cliquer depuis le téléphone qui est physiquement dans la boutique, avec l'autorisation de géolocalisation du navigateur. Une carte s'affiche pour vérifier que le point est bon, avec un champ « Nom affiché au client » facultatif (ex. « Boutique Awa — Akwa »). Une fois enregistré, l'agent envoie automatiquement cette position (une vraie localisation WhatsApp, avec carte et itinéraire) à tout client qui demande où se trouve la boutique ou comment y venir — sans que le propriétaire ait à répondre lui-même. « Retirer la position » l'efface.
- COMPORTEMENT :
  • « Instructions de l'agent » : le ton et les consignes (ex. « Tutoie les clients », « Propose toujours la livraison »). Un menu « Partir d'un modèle » propose des modèles prêts (boutique, salon de coiffure/beauté, clinique/cabinet, restaurant/traiteur, prestataire de services). Un modèle remplace le texte actuel après confirmation ; on l'adapte ensuite.
  • « Informations à collecter avant transfert » : cases à cocher (nom, ville, besoin, budget, produit/service, urgence, quartier) + champs personnalisés que l'on crée soi-même. L'agent les demande au client avant de passer la main. Si rien n'est coché, l'agent suit seulement les instructions.
  • « Message d'accueil » : envoyé une seule fois, au tout premier échange avec un nouveau client. Si le client écrit juste « Bonjour », ce message suffit comme réponse. Laisser vide pour que l'agent salue lui-même.
- HORAIRES : « Mon entreprise a des horaires d'ouverture » + fuseau horaire (ex. Africa/Douala) + consigne pour les heures de fermeture (facultatif). Hors horaires, l'agent répond quand même mais prévient le client que l'équipe sera disponible plus tard et note sa demande. Sans horaires cochés, l'agent répond tout le temps.
- RELANCES AUTOMATIQUES (dans l'onglet « Horaires » de la page Agent IA, section « Relances automatiques ») : on coche « Relancer les clients intéressés qui ne répondent plus », on choisit le délai d'attente (2 h, 4 h, 8 h, 1 jour, 2 jours, 3 jours) et le nombre maximum de relances (1 ou 2), puis « Enregistrer ». Garde-fous : seuls les clients étiquetés « Intéressé » dont le dernier message vient de l'agent sont relancés ; jamais pendant la fermeture de l'entreprise, jamais après un « STOP », jamais si le propriétaire a repris la conversation. Les relances sont une fonction des forfaits Pro et Business. Chaque relance compte comme un message de l'assistant.
- SUJET AUTORISÉ (dans l'onglet « Horaires » de la page Agent IA, section « Sujet autorisé ») : on coche « Limiter l'agent à un sujet précis » et on décrit ce sujet en quelques mots (ex. « nos vêtements »), puis « Enregistrer ». Tant qu'un nouveau client n'a pas écrit sur ce sujet, l'agent reste silencieux (le message reste visible dans la boîte de réception, aucune réponse automatique n'est envoyée) ; dès qu'il écrit dessus, l'agent répond et continue de répondre normalement à cette personne pour toute la suite, sans revérifier. Un message bloqué ne consomme aucun message du forfait. À utiliser seulement si l'on veut vraiment limiter l'agent, car un client qui ne reçoit aucune réponse peut croire que le service ne fonctionne pas.
- PUBLICITÉ FACEBOOK/INSTAGRAM UNIQUEMENT (dans l'onglet « Horaires » de la page Agent IA, section « Publicité Facebook/Instagram uniquement ») : on coche « Ne répondre qu'aux clients venus d'une publicité ». L'agent ne répond alors qu'aux nouveaux clients arrivés en cliquant sur le bouton WhatsApp d'une publicité « Cliquer pour WhatsApp » (Facebook ou Instagram) ; ce n'est détecté que sur le tout premier message de la conversation, grâce à un identifiant technique transmis par WhatsApp. Les autres clients (message écrit de leur propre initiative, ancien contact, bouche-à-oreille) ne reçoivent aucune réponse automatique tant que cette option est active ; leur message reste visible dans la boîte de réception.
- APPRENTISSAGE : « Ce que l'agent a appris de vous ». Quand une réponse n'est pas bonne : ouvrir la conversation, cliquer sur « Pourquoi cette réponse ? » puis « Corriger cette réponse » : l'agent s'en souvient pour les questions semblables. On peut aussi ajouter une règle à la main (« Quand le client demande… » / « L'agent doit répondre… » puis « Ajouter cette règle »). L'agent s'inspire aussi, tout seul, des conversations passées qui ont abouti à une commande ou un rendez-vous, sans jamais reprendre de noms ni de numéros.
- FONCTIONS : résumé des fonctions (catalogue produits, rendez-vous, commandes, numéro WhatsApp) avec un bouton « Configurer » qui mène à la bonne page.
- TESTER L'AGENT (bas de la page Agent IA) : on joue le rôle d'un client, sans WhatsApp. Rien n'est enregistré ni envoyé. On peut même simuler l'envoi d'une capture de paiement, d'une photo de produit, d'un document. Le bouton « Réinitialiser » recommence. Utile après chaque changement. Le testeur ne compte pas dans les messages du forfait. Il utilise les derniers réglages enregistrés : bien cliquer sur « Enregistrer » avant de tester.
- Conseil si l'agent répond à côté : 1) vérifier que l'info existe dans « Informations sur votre activité » ; 2) ajouter une règle dans Apprentissage ; 3) préciser les instructions ; 4) re-tester.

# PAGE « PRODUITS »
- « Ajouter un produit » : photo (JPEG, PNG ou WebP), nom (obligatoire), description et caractéristiques (obligatoire : matière, tailles, usages, livraison… l'agent s'en sert pour répondre), catégorie, prix (texte libre, ex. « 25 000 FCFA »), case « Produit disponible ». Puis « Ajouter au catalogue ».
- L'agent ne recommande et n'envoie que les produits actifs (« disponible » coché). Pour un produit en rupture : décocher « disponible » plutôt que le supprimer. Dans la liste « Catalogue », chaque produit a un bouton « Modifier » et un bouton « Supprimer ».
- Quand le client demande à voir un produit, l'agent envoie la photo avec le prix. Si la photo ne part pas : vérifier que la photo a bien été ajoutée au produit et réessayer en la remplaçant.
- Écrire le prix toujours de la même façon (avec FCFA) pour éviter les confusions.

# PAGE « RENDEZ-VOUS »
Pour les salons, cliniques, prestataires. Réglages de l'agenda : interrupteur « Prise de rendez-vous par l'agent » (désactivé = l'agent ne propose aucun rendez-vous), type de rendez-vous (ex. Coupe + brushing, Consultation), durée d'un créneau en minutes, pause entre deux rendez-vous, nombre de rendez-vous simultanés, préavis minimum, réservable jusqu'à X jours, fuseau horaire, horaires d'ouverture jour par jour (deux plages possibles par jour, matin et après-midi ; laisser vide pour un jour fermé), jours fermés (fériés, congés) à ajouter. Puis « Enregistrer l'agenda ». L'agent propose uniquement les créneaux libres et enregistre les rendez-vous confirmés par le client. Les rendez-vous à venir sont listés dans la page ; on peut aussi « Ajouter manuellement » un rendez-vous (date, heure, nom, téléphone). Le propriétaire est prévenu par email d'un nouveau rendez-vous.

# PAGE « COMMANDES »
Un interrupteur « Prise de commande par l'agent » (désactivé = comportement habituel, l'agent ne prend pas de commande). Activé, l'agent ne propose que les produits actifs du catalogue, et quand un client confirme, il enregistre produit, quantité et adresse. Le propriétaire reçoit aussi un email. Les commandes se filtrent : Toutes, À encaisser, Nouvelles, Confirmées, Livrées, Annulées. Quand un client envoie une capture de paiement (Orange Money / MTN MoMo), l'agent la signale : le propriétaire doit vérifier lui-même dans son téléphone que l'argent est bien arrivé, puis cliquer sur « J'ai vérifié » dans la conversation. L'agent ne confirme jamais un paiement tout seul.

# PAGE « CONVERSATIONS » (BOÎTE DE RÉCEPTION)
- Liste des clients à gauche (recherche + filtres par étiquette), conversation à droite. Mise à jour automatique.
- Étiquettes d'un client : Nouveau, Intéressé, A commandé, À rappeler. On peut la changer depuis la conversation (« Étiquette »).
- Répondre soi-même : écrire dans la zone de réponse puis « Envoyer ». Quand le propriétaire prend la main, l'agent se met en pause pour ce client. Le statut de chaque conversation s'affiche : « IA active », « IA en pause », « Attend une personne » (l'agent a passé la main) ou « Fermée ». Le bouton « Désactiver l'IA » / « Réactiver l'IA » en haut de la conversation permet de reprendre ou rendre la main à tout moment.
- Quand l'agent ne sait pas répondre ou que le client demande un humain (réclamation, demande spéciale), il le dit honnêtement, passe la main (la conversation passe en « prise de main ») et prévient le propriétaire par email. L'agent se réactive tout seul pour ce client après 24 h, ou immédiatement avec « Réactiver l'IA ».
- « 🔕 Ne reçoit plus… » (opt-out) : un client qui écrit « STOP » (ou « ne m'écrivez plus ») ne reçoit plus ni relance ni message groupé. On peut aussi le faire à la main depuis la conversation.
- « Pourquoi cette réponse ? » sous un message de l'agent : explique ce que l'agent a utilisé, avec le bouton « Corriger cette réponse ».
- Les photos, vocaux et documents reçus s'affichent dans la conversation et peuvent être téléchargés.

# PAGE « MESSAGES GROUPÉS » (forfaits Pro et Business)
Envoyer une annonce (promotion, nouveau produit, horaires) à plusieurs clients d'un coup, sans risquer de faire bloquer le numéro. Choisir à qui : par étiquette (Nouveaux, Intéressés, Ont commandé, À rappeler ; ne rien cocher = tous les clients éligibles) et « Clients qui ont écrit depuis » 7, 14, 30 ou 60 jours. Le nombre de destinataires s'affiche. Écrire le message (1000 caractères maximum) puis « Envoyer ». La phrase « Pour ne plus recevoir nos messages, répondez STOP. » est ajoutée automatiquement.
Règles de protection du numéro : seuls les clients qui ont déjà écrit récemment sont contactés ; un client qui a écrit STOP n'est jamais recontacté ; les messages partent par lots de 50 personnes au maximum, 100 messages par 24 h, lentement, un à un. Si le groupe est plus grand, renvoyer le même message : il part au lot suivant, sans doublon. L'historique est dans « Derniers envois ». Si la page répond que la fonction n'est pas incluse : le forfait actuel est l'Essentiel, il faut passer au Pro.

# PAGE « PARAMÈTRES »
- Délai de réponse de l'IA : 3 s (par défaut), 5 s, 7 s, 1 min, 2 min. Un délai plus long rend les réponses moins robotiques et réduit le risque de restriction WhatsApp. Cliquer sur « Enregistrer ».
- Votre équipe : ajouter des employés (nom, email de connexion, mot de passe de 8 caractères minimum). L'employé se connecte sur la même page que le propriétaire, avec son email. Un employé peut répondre aux clients, suivre les commandes et les rendez-vous ; il ne peut pas modifier l'agent, le catalogue, le numéro WhatsApp, les messages groupés, l'équipe ni le forfait. Nombre d'employés : 0 (Essentiel), 3 (Pro), 10 (Business).
- Zones et responsables (routage des prospects) : on crée des zones (nom, ville, WhatsApp de la zone au format international avec l'indicatif), des responsables/commerciaux rattachés à une zone (nom, WhatsApp, actif ou non), et un « fallback global » (responsable ou numéro utilisé quand aucune zone ne correspond). Quand un prospect est qualifié, il est transmis au responsable de sa zone. Dans la Vue d'ensemble, « Messages reçus par commercial » montre le volume par commercial et « Exporter les prospects » télécharge la liste.
- Numéros à ignorer : on ajoute un numéro WhatsApp (famille, fournisseur…) avec une note facultative. L'agent ne lui répond alors plus jamais automatiquement ; le message reste visible dans la boîte de réception et le propriétaire peut toujours répondre lui-même. « Retirer » le numéro rétablit les réponses automatiques pour lui. Les autres clients ne sont jamais concernés.

# VUE D'ENSEMBLE
Résumé du jour : conversations actives, clients à traiter (nouveaux messages, prises de main, paiements à vérifier), statut WhatsApp, chiffres de ce que l'agent a fait (période : aujourd'hui, 7 jours, 30 jours), conversations récentes, actions rapides (Connecter WhatsApp, Personnaliser l'agent, Ouvrir la boîte de réception). Un bandeau rouge en haut signale une suspension de la plateforme.

# FORFAITS, MESSAGES ET PAIEMENT (page « Mon forfait »)
- Un « message » = une réponse envoyée par l'assistant à un client (photos et relances comprises). Les messages écrits par le propriétaire ne sont jamais comptés, ni les tests. Le compteur repart à zéro chaque mois (forfait de 30 jours).
- Essai gratuit : 100 messages offerts à l'inscription, avec les fonctions du Pro, sans limite de durée.
- Essentiel : 10 000 FCFA pour 30 jours, 1 000 messages, réponses 24h/24, produits, photos, commandes, rendez-vous, suivi clients. Pas de messages groupés, pas de relances, pas d'employés.
- Pro : 20 000 FCFA, 5 000 messages, tout l'Essentiel + messages groupés + relances automatiques + 3 employés.
- Business : 50 000 FCFA, 15 000 messages, tout le Pro + 10 employés + aide à l'installation.
- Payer : page « Mon forfait » → « Choisir ce forfait » → saisir son numéro Orange Money ou MTN MoMo → valider la demande de paiement reçue sur le téléphone avec son code secret (si rien n'apparaît, composer le code USSD affiché, par exemple *126#). La page se met à jour toute seule dès que le paiement est reçu. Payer le même forfait avant la fin le prolonge de 30 jours.
- Quand les messages sont épuisés (ou le forfait terminé) : l'agent ne répond plus aux clients et le propriétaire reçoit un email ; il peut toujours répondre lui-même dans « Conversations ». Il faut alors choisir un forfait. Un bandeau d'alerte apparaît en haut du tableau de bord quand il reste 20 % des messages ou moins. Selon la période, les forfaits peuvent ne pas être encore appliqués (le statut le précise).
- Si un paiement est débité mais le forfait ne s'active pas après quelques minutes : contacter le support sur WhatsApp en donnant l'heure et le numéro utilisé.

# PROBLÈMES FRÉQUENTS ET SOLUTIONS
- « L'agent ne répond pas » : vérifier dans l'ordre : 1) WhatsApp est connecté (page WhatsApp) ; 2) l'interrupteur « Réponses automatiques » de la page Agent IA est actif ; 3) la conversation concernée n'est pas en pause (« Réactiver l'IA ») : si le propriétaire a répondu à la main ou si l'agent a passé la main, il est en pause pour ce client ; 4) le client n'a pas écrit « STOP » ; 5) il reste des messages dans « Mon forfait » ; 6) l'entreprise n'est pas suspendue (bandeau rouge) ; 7) le numéro du client n'est pas dans « Numéros à ignorer » (page Paramètres) ; 8) le « Sujet autorisé » n'est pas activé sans que ce client ait encore écrit dessus (Agent IA → Horaires) ; 9) « Publicité Facebook/Instagram uniquement » n'est pas activé sans que ce client ne vienne d'une publicité (Agent IA → Horaires). L'agent peut aussi attendre quelques secondes (délai de réponse réglé dans Paramètres).
- « L'agent donne une mauvaise information » : compléter « Informations sur votre activité », ou corriger la réponse (Pourquoi cette réponse ? → Corriger), ou ajouter une règle dans Apprentissage.
- « L'agent ne dit jamais l'heure/le prix/l'adresse » : l'information n'est pas dans la fiche d'activité ou dans le produit ; l'ajouter.
- « Mon WhatsApp se déconnecte » : ne pas ouvrir ce WhatsApp sur un autre appareil lié non prévu, ne pas supprimer l'appareil lié depuis le téléphone, garder le téléphone allumé avec internet de temps en temps. Refaire la liaison (QR code ou code).
- « Les photos des produits ne partent pas » : vérifier que le produit est actif et qu'il a bien une photo (JPEG, PNG ou WebP), sinon la remplacer.
- « Je n'ai pas reçu l'email » : vérifier les spams ; les emails de Brayano IA concernent la validation du compte, les nouvelles commandes/rendez-vous, les prises de main, les déconnexions WhatsApp et les messages épuisés.
- « J'ai oublié mon mot de passe » : sur la page de connexion, « Mot de passe oublié ? » : un code est envoyé par email pour choisir un nouveau mot de passe.
- « Je veux ajouter un employé » : Paramètres → Votre équipe (selon le forfait).
- « Un employé ne voit pas certaines pages » : c'est normal, les employés n'ont accès qu'aux conversations, commandes et rendez-vous.
- « Comment changer de forfait ou renouveler » : page Mon forfait.
- « Où sont mes clients / mes chiffres ? » : Vue d'ensemble pour les chiffres, Conversations pour les clients, « Exporter les prospects » pour la liste.

# LIMITES (à dire honnêtement)
- Brayano IA se connecte à WhatsApp comme WhatsApp Web (liaison d'appareil) : ce n'est pas l'API officielle de Meta. Pour éviter une restriction de WhatsApp, ne pas envoyer de messages en masse à des inconnus, respecter les lots et le « STOP », et laisser un petit délai de réponse.
- L'agent ne peut pas : confirmer un paiement, remettre des remises non écrites, promettre ce qui n'est pas dans la fiche, appeler au téléphone, ou lire des pages privées / Facebook.
- Cet assistant d'aide ne peut pas modifier les réglages à la place du propriétaire, ni voir ses conversations clients : il explique quoi faire et peut ouvrir la bonne page.
`.trim();
