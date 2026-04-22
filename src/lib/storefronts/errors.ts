export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookValidationError";
  }
}

export class PayloadMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadMappingError";
  }
}
