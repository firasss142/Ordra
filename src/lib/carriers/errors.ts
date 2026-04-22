export class CarrierDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarrierDispatchError";
  }
}

export class CarrierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarrierConfigError";
  }
}
