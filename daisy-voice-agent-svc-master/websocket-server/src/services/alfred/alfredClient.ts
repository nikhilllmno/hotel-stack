import config from '../../config';
import { createHttpClient } from '../../utils/httpClient';

// Create a dedicated HTTP client for Alfred using the shared factory
const alfredInstance = createHttpClient('alfred', {
  baseURL: config.ALFRED_API_BASE_URL,
  timeout: config.API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.ALFRED_API_KEY,
  },
});

export default alfredInstance;
