import config from '../../config';
import { createHttpClient } from '../../utils/httpClient';
import { stripCardFields } from './helper';
import { resNexusAuth } from './resNexusAuth';

// Create a dedicated HTTP client for ResNexus using the shared factory
const resNexusInstance = createHttpClient('resnexus', {
  baseURL: config.RESNEXUS_BASE_URL,
  timeout: config.API_TIMEOUT,
  redactBody: stripCardFields,
});

// Add auth header via an additional request interceptor
resNexusInstance.interceptors.request.use(
  (reqConfig) => {
    reqConfig.headers.Authorization = resNexusAuth();
    return reqConfig;
  },
  (error) => Promise.reject(error),
);

export default resNexusInstance;
