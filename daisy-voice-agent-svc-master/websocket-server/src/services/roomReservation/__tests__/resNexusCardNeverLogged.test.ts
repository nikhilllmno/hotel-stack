import { AUTHNET_URLS } from '@/authorizeNet/types';
import config from '@/config';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { bindTestDatabaseKnex } from '@/test/db/bindTestDatabase';
import { createPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createResNexusCardBooking } from '@/test/fixtures/resNexusCardBookingFixture';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import logger from '@/utils/logger';
import { Server } from 'http';
import { Knex } from 'knex';
import { AddressInfo } from 'net';
import nock from 'nock';
import { format } from 'util';

const PAN = '378282246310005';
const CVV = '7319';
const PAN_PATTERN = new RegExp(PAN.split('').join('[\\s-]?'));
// Bounded so a CVV-shaped run inside a UUID, timestamp or longer number is not a match.
const CVV_PATTERN = new RegExp(`(?<![\\w.-])${CVV}(?![\\w.-])`);
const CONSOLE_METHODS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
] as const;

const AUTHORIZE_NET_APPROVED = {
  transactionResponse: {
    responseCode: '1',
    authCode: '000000',
    avsResultCode: 'Y',
    cvvResultCode: 'M',
    transId: '40000000001',
    accountNumber: 'XXXX0005',
    accountType: 'AmericanExpress',
    messages: [
      { code: '1', description: 'This transaction has been approved.' },
    ],
  },
  messages: {
    resultCode: 'Ok',
    message: [{ code: 'I00001', text: 'Successful.' }],
  },
};

interface OutboundRequest {
  url: string;
  body: string;
}

// Every sink a log line can reach: winston's Console transport writes to console._stdout,
// and any other logger or stray console call ends up in console.* or process.stdout/stderr.
function captureEverythingLogged() {
  const lines: string[] = [];
  const consoleStreams = console as unknown as Record<
    '_stdout' | '_stderr',
    NodeJS.WritableStream | undefined
  >;
  const streams = new Set(
    [
      process.stdout,
      process.stderr,
      consoleStreams._stdout,
      consoleStreams._stderr,
    ].filter((stream): stream is NodeJS.WritableStream => Boolean(stream)),
  );
  const spies = [
    ...CONSOLE_METHODS.map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(format(...args));
      }),
    ),
    ...[...streams].map((stream) =>
      jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      }),
    ),
  ];
  const level = logger.level;
  logger.level = 'silly';
  return {
    lines,
    restore: () => {
      logger.level = level;
      spies.forEach((spy) => spy.mockRestore());
    },
  };
}

describe('ResNexus card submission over HTTP', () => {
  const outbound: OutboundRequest[] = [];
  let knex: Knex;
  let teardownDb: () => Promise<void>;
  let unbindDb: () => void;
  let server: Server;
  let baseUrl: string;
  const originalVerifyLoginId = config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID;
  const originalVerifyKey = config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY;

  function recordAndReply(response: nock.Body) {
    return function (this: nock.ReplyFnContext, path: string, body: nock.Body) {
      outbound.push({
        url: `${this.req.headers.host}${path}`,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return response;
    };
  }

  async function submitCard(reviewId: string) {
    const response = await fetch(`${baseUrl}/daisy/reservation/card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reservation_review_id: reviewId,
        pan: PAN,
        cvv: CVV,
        expiryDate: '3012',
        card_holder_name: 'Ada Lovelace',
      }),
    });
    const body = await response.json();
    // The confirmation SMS and Telegram alert are sent after the response.
    for (
      let i = 0;
      i < 200 && !outbound.some(({ url }) => url.includes('telegram'));
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { status: response.status, body };
  }

  beforeAll(async () => {
    config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID = 'verify-login';
    config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY = 'verify-key';
    config.SES_FROM_EMAIL ||= 'bookings@test.dextr';

    ({ knex, teardown: teardownDb } = await createPgMemTestContext());
    // Production singletons capture the database when their module loads, so they load after binding.
    unbindDb = bindTestDatabaseKnex(knex);
    const { default: app } = await import('@/app');
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    await new Promise((resolve) => server.close(resolve));
    unbindDb();
    await teardownDb();
    config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID = originalVerifyLoginId;
    config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY = originalVerifyKey;
  });

  it('sends the card only to Authorize.net and ResNexus, and never logs the PAN or CVV', async () => {
    await knex('hotels')
      .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({
        payment_provider: PaymentProvider.RESNEXUS,
        telegram_alerts_group_id: '-100123',
        updated_at: new Date(),
      });
    const { createTestRoomReservationService } =
      await import('@/test/stubs/createTestRoomReservationService');
    const { service } = createTestRoomReservationService({
      knex,
      externalStubs: { pmsReservationService: new StubPmsReservationService() },
    });
    const { created, reviewId } = await createResNexusCardBooking(
      service,
      knex,
    );

    const authorizeNetApi = new URL(
      AUTHNET_URLS[config.AUTHORIZE_NET_ENVIRONMENT].api,
    );
    nock(authorizeNetApi.origin)
      .post(authorizeNetApi.pathname)
      .reply(200, recordAndReply(AUTHORIZE_NET_APPROVED));
    const resNexus = new URL(config.RESNEXUS_BASE_URL);
    nock(resNexus.origin)
      .get(/\/getAllAvailability\b/)
      .query(true)
      .reply(
        200,
        recordAndReply({
          groups: [{ unit_group_id: 101, number_of_units_available: 1 }],
        }),
      )
      .post(/\/addreservation$/)
      .reply(200, recordAndReply({ reservation_id: 'RN-1' }));
    nock(/^https?:\/\/(?!127\.0\.0\.1\b)/)
      .persist()
      .get(/.*/)
      .query(true)
      .reply(200, recordAndReply({}))
      .post(/.*/)
      .reply(200, recordAndReply({}));

    const logs = captureEverythingLogged();
    const submitted = await submitCard(reviewId).finally(logs.restore);

    expect(submitted).toEqual({
      status: 200,
      body: { success: true, resnexus_reservation_ids: ['RN-1'] },
    });
    const room = await knex('reservations')
      .where({ booking_id: created.booking_id })
      .first();
    expect(room.status).toBe(ReservationStatus.ACTIVE);

    const carriesCard = ({ body }: OutboundRequest) =>
      PAN_PATTERN.test(body) && CVV_PATTERN.test(body);
    expect(outbound.filter(carriesCard).map(({ url }) => url)).toEqual([
      `${authorizeNetApi.host}${authorizeNetApi.pathname}`,
      expect.stringMatching(/\/addreservation$/),
    ]);
    expect(
      outbound.filter(
        ({ body }) => PAN_PATTERN.test(body) || CVV_PATTERN.test(body),
      ),
    ).toHaveLength(2);

    const logged = logs.lines.join('\n');
    expect(logged).toMatch(/Incoming Request[\s\S]*\/daisy\/reservation\/card/);
    expect(logged).toContain('AuthorizeNetService::verifyCard - result');
    expect(logged).toContain('resnexus Request');
    expect(logs.lines.filter((line) => PAN_PATTERN.test(line))).toEqual([]);
    expect(logs.lines.filter((line) => CVV_PATTERN.test(line))).toEqual([]);
  });
});
