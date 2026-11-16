import { BadRequestError } from '../../errors/BadRequestError';
import { UserRole } from '../../models/User';
import { AuthenticatedRequest } from '../../types/customRequest';
import {
  resourceBelongsToTokenHotel,
  tokenHotelIdForResourceAccess,
} from './hotelResourceAccess';

describe('hotelResourceAccess', () => {
  const hotelA = '11111111-1111-1111-1111-111111111111';
  const hotelB = '22222222-2222-2222-2222-222222222222';

  test('tokenHotelIdForResourceAccess returns hotel_id for hotel admin', () => {
    const req = {
      user: { role: UserRole.ADMIN, hotel_id: hotelA },
    } as AuthenticatedRequest;

    expect(tokenHotelIdForResourceAccess(req)).toBe(hotelA);
  });

  test('tokenHotelIdForResourceAccess returns null for unscoped superadmin', () => {
    const req = {
      user: { role: UserRole.SUPERADMIN },
    } as AuthenticatedRequest;

    expect(tokenHotelIdForResourceAccess(req)).toBeNull();
  });

  test('tokenHotelIdForResourceAccess throws when hotel admin has no hotel_id', () => {
    const req = {
      user: { role: UserRole.ADMIN },
    } as AuthenticatedRequest;

    expect(() => tokenHotelIdForResourceAccess(req)).toThrow(BadRequestError);
  });

  test('resourceBelongsToTokenHotel allows matching hotel', () => {
    const req = {
      user: { role: UserRole.ADMIN, hotel_id: hotelA },
    } as AuthenticatedRequest;

    expect(resourceBelongsToTokenHotel(req, hotelA)).toBe(true);
  });

  test('resourceBelongsToTokenHotel rejects another hotel', () => {
    const req = {
      user: { role: UserRole.ADMIN, hotel_id: hotelA },
    } as AuthenticatedRequest;

    expect(resourceBelongsToTokenHotel(req, hotelB)).toBe(false);
  });

  test('resourceBelongsToTokenHotel allows any hotel for unscoped superadmin', () => {
    const req = {
      user: { role: UserRole.SUPERADMIN },
    } as AuthenticatedRequest;

    expect(resourceBelongsToTokenHotel(req, hotelB)).toBe(true);
  });
});
