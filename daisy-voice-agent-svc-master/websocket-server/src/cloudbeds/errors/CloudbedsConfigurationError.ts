/**
 * Raised when required Cloudbeds credentials (propertyID or API token) are
 * missing for a hotel. The bearer token is resolved from
 * `hotel_configurations.external_auth_config.apiToken`; this error should
 * identify the hotel id so ops can set the missing entry.
 */
export class CloudbedsConfigurationError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'CloudbedsConfigurationError';
    this.statusCode = 500;
    Object.setPrototypeOf(this, CloudbedsConfigurationError.prototype);
  }
}
