import config from '../../config';

export function resNexusAuth() {
  const username = encodeURIComponent(config.RESNEXUS_USERNAME || '');
  const password = encodeURIComponent(config.RESNEXUS_PASSWORD || '');

  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
