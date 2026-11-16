/**
 * Raised when a hotel's Cloudbeds integration has been marked disabled
 * (`hotel_configurations.external_auth_config.disabledAt` is set, from
 * integration/appstate_changed with newState=disabled). Refuses the call
 * even though `apiToken` is still present in the same config — disabling
 * never clears the token itself, only this marker.
 */
export class CloudbedsIntegrationDisabledError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'CloudbedsIntegrationDisabledError';
    this.statusCode = 403;
    Object.setPrototypeOf(this, CloudbedsIntegrationDisabledError.prototype);
  }
}
