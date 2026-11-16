import config from '@/config';
import { PaymentRepository } from '@/repositories/PaymentRepository';
import { ReservationRepository } from '@/repositories/ReservationRepository';
import { MonitoringService } from '@/services/monitoring/monitoringService';
import { SlackService } from '@/services/slack/slackService';
import { installPgMemTestContextWithoutHotel } from '@/test/db/createPgMemTestContext';
import {
  PAID_INACTIVE_FIXTURE_IDS,
  PAID_INACTIVE_FIXTURE_IDS_2,
  seedPaidInactiveReservation,
} from '@/test/fixtures/staleReservationFixture';

describe('MonitoringService.findAndReportPaidReservationsWithFailedPmsCreation', () => {
  const ctx = installPgMemTestContextWithoutHotel();
  let service: MonitoringService;
  let slackSendMessageMock: jest.Mock;
  let reservationRepository: ReservationRepository;
  let findManyByIdsSpy: jest.SpyInstance;
  const originalSlackWebhookUrl = config.SLACK_DAISY_ALERT_WEBHOOK_URL;

  afterEach(() => {
    config.SLACK_DAISY_ALERT_WEBHOOK_URL = originalSlackWebhookUrl;
  });

  beforeEach(() => {
    config.SLACK_DAISY_ALERT_WEBHOOK_URL =
      'https://hooks.slack.test/ops-alerts';
    slackSendMessageMock = jest.fn().mockResolvedValue(undefined);
    const slackService = {
      sendMessage: slackSendMessageMock,
    } as unknown as SlackService;

    reservationRepository = new ReservationRepository(ctx.knex);
    findManyByIdsSpy = jest.spyOn(
      reservationRepository,
      'findManyReservationWithDetailsByIds',
    );

    service = new MonitoringService(
      undefined,
      new PaymentRepository(ctx.knex),
      reservationRepository,
      slackService,
    );
  });

  it('reports a paid reservation stuck in INACTIVE via Slack', async () => {
    const fixture = await seedPaidInactiveReservation(ctx.knex);

    const report =
      await service.findAndReportPaidReservationsWithFailedPmsCreation();

    expect(report.count).toBe(1);
    expect(report.results).toEqual([
      {
        payment_id: fixture.paymentId,
        reservation_id: fixture.reservationId,
        hotel_id: fixture.hotelId,
        status: 'alerted',
      },
    ]);
    expect(slackSendMessageMock).toHaveBeenCalledTimes(1);
    expect(slackSendMessageMock.mock.calls[0][0].content.message).toContain(
      fixture.reservationId,
    );
  });

  it('reports the same reservation again on a subsequent run (duplicates are fine)', async () => {
    await seedPaidInactiveReservation(ctx.knex);

    const firstRun =
      await service.findAndReportPaidReservationsWithFailedPmsCreation();
    const secondRun =
      await service.findAndReportPaidReservationsWithFailedPmsCreation();

    expect(firstRun.results[0].status).toBe('alerted');
    expect(secondRun.results[0].status).toBe('alerted');
    expect(slackSendMessageMock).toHaveBeenCalledTimes(2);
  });

  it('returns no results when no paid reservation is stuck in INACTIVE', async () => {
    const report =
      await service.findAndReportPaidReservationsWithFailedPmsCreation();

    expect(report).toEqual({ count: 0, results: [] });
    expect(slackSendMessageMock).not.toHaveBeenCalled();
  });

  it('fetches all matching reservations in a single batched query', async () => {
    await seedPaidInactiveReservation(ctx.knex);
    await seedPaidInactiveReservation(ctx.knex, {
      ids: PAID_INACTIVE_FIXTURE_IDS_2,
      skipHotelSeed: true,
    });

    const report =
      await service.findAndReportPaidReservationsWithFailedPmsCreation();

    expect(report.count).toBe(2);
    expect(findManyByIdsSpy).toHaveBeenCalledTimes(1);
    expect(findManyByIdsSpy.mock.calls[0][0].sort()).toEqual(
      [
        PAID_INACTIVE_FIXTURE_IDS.reservationId,
        PAID_INACTIVE_FIXTURE_IDS_2.reservationId,
      ].sort(),
    );
  });

  it('reports an error result when Slack is not configured', async () => {
    const fixture = await seedPaidInactiveReservation(ctx.knex);
    config.SLACK_DAISY_ALERT_WEBHOOK_URL = '';
    const unconfiguredSlack = {
      sendMessage: jest.fn(),
    } as unknown as SlackService;
    service = new MonitoringService(
      undefined,
      new PaymentRepository(ctx.knex),
      reservationRepository,
      unconfiguredSlack,
    );

    const report =
      await service.findAndReportPaidReservationsWithFailedPmsCreation();

    expect(report.results).toEqual([
      {
        payment_id: fixture.paymentId,
        reservation_id: fixture.reservationId,
        hotel_id: fixture.hotelId,
        status: 'error',
        detail: 'SLACK_DAISY_ALERT_WEBHOOK_URL is not configured',
      },
    ]);
  });
});
