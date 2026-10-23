/** Shared presentation rules; all milestones are confirmed by the server. */
export function onboardingSteps(status) {
  return [
    { id: "profile", title: "Présentez votre entreprise", description: "Enregistrez vos services, tarifs, horaires et informations utiles.", action: "Renseigner mon activité", done: status.profileComplete },
    { id: "test", title: "Testez votre agent", description: "Posez une question dans le testeur et vérifiez sa réponse avant de connecter WhatsApp.", action: "Ouvrir le testeur", done: status.testComplete },
    { id: "whatsapp", title: "Connectez votre WhatsApp", description: "Reliez le numéro que vos clients utilisent déjà.", action: "Connecter WhatsApp", done: status.whatsappConnected },
    { id: "first", title: "Recevez votre première réponse automatique", description: "Envoyez une question depuis un autre numéro et laissez votre agent répondre.", action: "Comment faire ?", done: status.firstReplySent },
  ];
}
