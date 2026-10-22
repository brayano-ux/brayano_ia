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
