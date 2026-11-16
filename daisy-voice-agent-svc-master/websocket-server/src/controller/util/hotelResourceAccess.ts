import { BadRequestError } from '../../errors/BadRequestError';
import { UserRole } from '../../models/User';
import { AuthenticatedRequest } from '../../types/customRequest';

/**
 * Hotel id from the token when the caller is hotel-scoped.
 * Pure superadmins (SUPERADMIN with no hotel_id) may access any hotel's resources.
 */
export function tokenHotelIdForResourceAccess(
  req: AuthenticatedRequest,
): string | null {
  if (req.user?.role === UserRole.SUPERADMIN && !req.user.hotel_id) {
    return null;
  }

  const hotelId = req.user?.hotel_id;
  if (!hotelId) {
    throw new BadRequestError('Hotel ID is required');
  }

  return hotelId;
}

/** True when a resource's hotel_id matches the caller's scoped hotel (or caller is unscoped superadmin). */
export function resourceBelongsToTokenHotel(
  req: AuthenticatedRequest,
  resourceHotelId: string,
): boolean {
  const tokenHotelId = tokenHotelIdForResourceAccess(req);
  if (tokenHotelId == null) {
    return true;
  }

  return resourceHotelId === tokenHotelId;
}
