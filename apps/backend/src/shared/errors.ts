export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = "INTERNAL_ERROR",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Ressource introuvable") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Requête invalide") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

/** Fonction ou quota non inclus dans le forfait de l'entreprise (402 : le tableau de bord propose alors de changer de forfait). */
export class PlanLimitError extends AppError {
  constructor(message: string) {
    super(message, 402, "PLAN_LIMIT");
  }
}

/** Envoi impossible : le numéro WhatsApp de l'entreprise n'est pas relié (409, avec un message que l'utilisateur peut suivre). */
export class WhatsAppNotConnectedError extends AppError {
  constructor(message = "WhatsApp n'est pas connecté : reliez votre numéro dans la page « WhatsApp », puis réessayez.") {
    super(message, 409, "WHATSAPP_NOT_CONNECTED");
  }
}
