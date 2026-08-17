(function (app) {
  app.core = app.core || {};

  function BusinessOperationError(message, validationErrors) {
    this.name = "BusinessOperationError";
    this.message = message || "Business operation failed.";
    this.validationErrors = validationErrors || [];
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BusinessOperationError);
    } else {
      this.stack = new Error(message).stack;
    }
  }
  BusinessOperationError.prototype = Object.create(Error.prototype);
  BusinessOperationError.prototype.constructor = BusinessOperationError;

  function ValidationError(message, validationErrors) {
    BusinessOperationError.call(this, message || "Validation failed.", validationErrors || []);
    this.name = "ValidationError";
  }
  ValidationError.prototype = Object.create(BusinessOperationError.prototype);
  ValidationError.prototype.constructor = ValidationError;

  function PermissionError(message, validationErrors) {
    BusinessOperationError.call(this, message || "Permission denied.", validationErrors || []);
    this.name = "PermissionError";
  }
  PermissionError.prototype = Object.create(BusinessOperationError.prototype);
  PermissionError.prototype.constructor = PermissionError;

  function StatePersistenceError(message, cause) {
    BusinessOperationError.call(this, message || "State persistence failed.", []);
    this.name = "StatePersistenceError";
    this.cause = cause || null;
  }
  StatePersistenceError.prototype = Object.create(BusinessOperationError.prototype);
  StatePersistenceError.prototype.constructor = StatePersistenceError;

  app.core.errors = {
    BusinessOperationError: BusinessOperationError,
    ValidationError: ValidationError,
    PermissionError: PermissionError,
    StatePersistenceError: StatePersistenceError
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
