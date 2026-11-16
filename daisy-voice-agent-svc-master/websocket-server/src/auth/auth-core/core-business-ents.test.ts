import {
  businessEntsMatchHotelId,
  hotelIdFromBusinessEnts,
} from './core-business-ents';

describe('hotelIdFromBusinessEnts', () => {
  const hotelId = '11111111-1111-1111-1111-111111111111';

  test('returns daisyId from first businessEnt', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [{ daisyId: hotelId, slug: 'prop' }],
      }),
    ).toBe(hotelId);
  });

  test('returns data.daisyId when top-level daisyId is absent', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [
          {
            id: 'core-ent-id',
            data: { daisyId: hotelId, name: 'dextr.ai' },
          },
        ],
      }),
    ).toBe(hotelId);
  });

  test('returns crossData.daisy_ref_id', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [
          {
            id: 'core-ent-id',
            crossData: { daisy_ref_id: hotelId },
          },
        ],
      }),
    ).toBe(hotelId);
  });

  test('prefers data.daisyId over top-level core ent id', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [
          {
            id: 'core-ent-id',
            data: { daisyId: hotelId },
          },
        ],
      }),
    ).toBe(hotelId);
  });

  test('returns null when only core entity id is present', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [{ slug: 'other', id: 'core-entity-id' }],
      }),
    ).toBeNull();
  });

  test('returns null when businessEnts is absent', () => {
    expect(hotelIdFromBusinessEnts({ email: 'a@b.com' })).toBeNull();
  });

  test('returns serviceRefs.daisyId', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [
          {
            id: 'core-ent-id',
            serviceRefs: { alfredId: 'alfred-1', daisyId: hotelId },
          },
        ],
      }),
    ).toBe(hotelId);
  });

  test('prefers serviceRefs.daisyId over crossData.daisy_ref_id', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [
          {
            id: 'core-ent-id',
            serviceRefs: { daisyId: hotelId },
            crossData: { daisy_ref_id: 'legacy-hotel-id' },
          },
        ],
      }),
    ).toBe(hotelId);
  });

  test('falls back to crossData.daisy_ref_id when serviceRefs has no daisyId', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [
          {
            id: 'core-ent-id',
            serviceRefs: { alfredId: 'alfred-1' },
            crossData: { daisy_ref_id: hotelId },
          },
        ],
      }),
    ).toBe(hotelId);
  });

  test('falls back to crossData when serviceRefs.daisyId is blank or not a string', () => {
    for (const daisyId of ['   ', '', 123, null, {}]) {
      expect(
        hotelIdFromBusinessEnts({
          businessEnts: [
            {
              id: 'core-ent-id',
              serviceRefs: { daisyId },
              crossData: { daisy_ref_id: hotelId },
            },
          ],
        }),
      ).toBe(hotelId);
    }
  });

  test('ignores serviceRefs that is an array or non-object', () => {
    for (const serviceRefs of [[{ daisyId: 'from-array' }], 'x', null, 42]) {
      expect(
        hotelIdFromBusinessEnts({
          businessEnts: [
            {
              id: 'core-ent-id',
              serviceRefs,
              crossData: { daisy_ref_id: hotelId },
            },
          ],
        }),
      ).toBe(hotelId);
    }
  });

  test('returns null when neither source has a usable id', () => {
    expect(
      hotelIdFromBusinessEnts({
        businessEnts: [
          {
            id: 'core-ent-id',
            serviceRefs: { alfredId: 'alfred-1' },
            crossData: [],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('businessEntsMatchHotelId', () => {
  const hotelId = '11111111-1111-1111-1111-111111111111';
  const route = { path: `/hotel/${hotelId}/configuration` };

  test('matches daisyId against route hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ daisyId: hotelId, slug: 'prop' }] },
        route,
      ),
    ).toBe(hotelId);
  });

  test('matches data.daisyId against route hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              slug: 'dextr_hitek',
              data: { daisyId: hotelId, name: 'dextr.ai' },
            },
          ],
        },
        route,
      ),
    ).toBe(hotelId);
  });

  test('does not treat top-level core ent id as Daisy hotel when data.daisyId differs', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              data: { daisyId: 'different-hotel-id' },
            },
          ],
        },
        route,
      ),
    ).toBeNull();
  });

  test('matches hotelId against route hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ hotelId, name: 'Hotel' }] },
        route,
      ),
    ).toBe(hotelId);
  });

  test('does not treat top-level core ent id as Daisy hotel id', () => {
    expect(
      businessEntsMatchHotelId({ businessEnts: [{ id: hotelId }] }, route),
    ).toBeNull();
  });

  test('matches crossData.daisy_ref_id against route hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              slug: 'prospector_dev',
              crossData: { daisy_ref_id: hotelId },
            },
          ],
        },
        route,
      ),
    ).toBe(hotelId);
  });

  test('matches crossData.daisy_ref_id from /hotel/:id resource path', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              crossData: { daisy_ref_id: hotelId },
            },
          ],
        },
        { path: `/hotel/${hotelId}` },
      ),
    ).toBe(hotelId);
  });

  test('returns null when crossData exists but daisy_ref_id is absent', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              slug: 'prospector_dev',
              crossData: { other_field: 'value' },
            },
          ],
        },
        route,
      ),
    ).toBeNull();
  });

  test('returns null when crossData.daisy_ref_id does not match route hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              crossData: { daisy_ref_id: 'different-hotel-id' },
            },
          ],
        },
        route,
      ),
    ).toBeNull();
  });

  test('matches via originalUrl when path has no hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ daisyId: hotelId }] },
        {
          path: '/',
          originalUrl: `/api/hotel/${hotelId}/configuration?x=1`,
        },
      ),
    ).toBe(hotelId);
  });

  test('matches hotel id from /hotel/:id resource path', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ daisyId: hotelId }] },
        { path: `/hotel/${hotelId}` },
      ),
    ).toBe(hotelId);
  });

  test('matches hotel id from /api/hotel/:id via originalUrl', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ daisyId: hotelId }] },
        {
          path: '/',
          originalUrl: `/api/hotel/${hotelId}?x=1`,
        },
      ),
    ).toBe(hotelId);
  });

  test('trims claim values', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ daisyId: `  ${hotelId}  ` }] },
        route,
      ),
    ).toBe(hotelId);
  });

  test('returns null when no matching field', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ slug: 'other', id: 'different' }] },
        route,
      ),
    ).toBeNull();
  });

  test('returns null when businessEnts is absent', () => {
    expect(businessEntsMatchHotelId({ email: 'a@b.com' }, route)).toBeNull();
  });

  test('returns null when route is hotel collection (no hotel id)', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ daisyId: hotelId }] },
        { path: '/hotel' },
      ),
    ).toBeNull();
  });

  test('returns null when route hotel id does not match claims', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [{ daisyId: hotelId }] },
        { path: '/hotel/other-hotel-id' },
      ),
    ).toBeNull();
  });

  test('skips non-object entries', () => {
    expect(
      businessEntsMatchHotelId(
        { businessEnts: [null, 'x', { daisyId: hotelId }] },
        route,
      ),
    ).toBe(hotelId);
  });

  test('matches serviceRefs[].daisyId against route hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              slug: 'dextr_hitek',
              serviceRefs: { daisyId: hotelId },
            },
          ],
        },
        route,
      ),
    ).toBe(hotelId);
  });

  test('returns null when serviceRefs.daisyId does not match route hotel id', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              slug: 'dextr_hitek',
              serviceRefs: { daisyId: 'different-hotel-id' },
            },
          ],
        },
        route,
      ),
    ).toBeNull();
  });

  test('matches crossData.daisy_ref_id when serviceRefs has no daisyId', () => {
    expect(
      businessEntsMatchHotelId(
        {
          businessEnts: [
            {
              id: 'core-ent-id',
              slug: 'dextr_hitek',
              serviceRefs: { alfredId: 'alfred-1' },
              crossData: { daisy_ref_id: hotelId },
            },
          ],
        },
        route,
      ),
    ).toBe(hotelId);
  });
});
