import {
  KPI_METRIC_NAME,
  KPI_MISSING_CLIENT_ID,
  KPI_NAMESPACE,
  KpiStat,
  logKpi,
} from '../kpiLogger';
import { runWithContext } from '../requestContext';

function getLoggedEmf(
  consoleSpy: jest.SpiedFunction<typeof console.log>,
): Record<string, unknown> {
  return JSON.parse(consoleSpy.mock.calls[0][0] as string) as Record<
    string,
    unknown
  >;
}

function getCloudWatchMetrics(
  emfLogObject: Record<string, unknown>,
): Record<string, unknown> {
  const aws = emfLogObject._aws as Record<string, unknown>;
  const cloudWatchMetrics = aws.CloudWatchMetrics as Record<string, unknown>[];
  return cloudWatchMetrics[0];
}

describe('logKpi', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits EMF with expected namespace, dimensions, and fields', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    logKpi({
      stat: 'getRoomAvailabilityWithQuoteLite',
      value: 1,
      contextName: 'getRoomAvailabilityWithQuoteLite',
      clientId: '+15551234567',
      contextId: 'req-123',
    });

    const emf = getLoggedEmf(consoleSpy);
    const cloudWatchMetrics = getCloudWatchMetrics(emf);
    const metricDef = (
      cloudWatchMetrics.Metrics as Record<string, unknown>[]
    )[0];

    expect(cloudWatchMetrics.Namespace).toBe(KPI_NAMESPACE);
    expect(cloudWatchMetrics.Dimensions).toEqual([
      ['stat', 'clientId', 'contextName'],
    ]);
    expect(metricDef.Name).toBe(KPI_METRIC_NAME);
    expect(metricDef.Unit).toBe('Count');
    expect(emf.stat).toBe('getRoomAvailabilityWithQuoteLite');
    expect(emf.value).toBe(1);
    expect(emf.clientId).toBe('+15551234567');
    expect(emf.contextName).toBe('getRoomAvailabilityWithQuoteLite');
    expect(emf.contextId).toBe('req-123');
  });

  it('normalizes missing clientId to sentinel', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    logKpi({
      stat: 'getRoomAvailabilityWithQuoteLite',
      value: 1,
      contextName: 'getRoomAvailabilityWithQuoteLite',
    });

    expect(getLoggedEmf(consoleSpy).clientId).toBe(KPI_MISSING_CLIENT_ID);
  });

  it('includes contextId on object but not in dimension set', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    logKpi({
      stat: 'getRoomAvailabilityWithQuoteLite',
      value: 1,
      contextName: 'getRoomAvailabilityWithQuoteLite',
      contextId: 'ctx-abc',
    });

    const emf = getLoggedEmf(consoleSpy);
    const cloudWatchMetrics = getCloudWatchMetrics(emf);

    expect(emf.contextId).toBe('ctx-abc');
    expect(cloudWatchMetrics.Dimensions).toEqual([
      ['stat', 'clientId', 'contextName'],
    ]);
  });

  // A metric is billed per unique dimension-value combination, and consumers
  // key off the exact combination — so the set must stay fixed for every stat.
  it('emits the same fixed dimension set for every stat', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    logKpi({
      stat: KpiStat.PmsApiCall,
      value: 1,
      contextName: 'createHttpClient',
      clientId: '+15551234567',
    });

    const emf = getLoggedEmf(consoleSpy);
    const cloudWatchMetrics = getCloudWatchMetrics(emf);

    expect(cloudWatchMetrics.Dimensions).toEqual([
      ['stat', 'clientId', 'contextName'],
    ]);
    expect(Object.keys(emf).sort()).toEqual([
      '_aws',
      'clientId',
      'contextName',
      'stat',
      'value',
    ]);
  });

  it('falls back to the request context for clientId when not passed explicitly', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    runWithContext(
      { requestId: 'req-1', assistantPhoneNumber: '+15559876543' },
      () => {
        logKpi({
          stat: KpiStat.CallStarted,
          value: 1,
          contextName: 'VapiWebhookService.handleStatusUpdate',
        });
      },
    );

    expect(getLoggedEmf(consoleSpy).clientId).toBe('+15559876543');
  });
});
