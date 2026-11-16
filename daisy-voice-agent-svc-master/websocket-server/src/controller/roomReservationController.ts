// controller for room reservation service

import { Request, Response } from 'express';
import {
  CloudbedsDoorCodeService,
  cloudbedsDoorCodeService as defaultCloudbedsDoorCodeService,
} from '../cloudbeds/services/doorCodeService';
import config from '../config';
import { CustomRequest } from '../customheaderTypes/express';
import { UpdateCustomerDataBeforePayment } from '../dtos/Customer';
import { CancellationSource } from '../dtos/enum/CancellationSource';
import { ReservationLookupSource } from '../dtos/enum/ReservationLookupSource';
import { SessionType } from '../dtos/enum/SessionType';
import { BadRequestError } from '../errors/BadRequestError';
import { NoDataError } from '../errors/NoDataError';
import {
  lockboxCodeService as defaultLockboxCodeService,
  LockboxCodeService,
} from '../lockbox/services/lockboxCodeService';
import {
  CancelReservationRequest,
  CreateMultiRoomReservationRequest,
  CreateRoomReservationRequest,
  GetDoorCodeRequest,
  GetLockboxCodeRequest,
  GetReservationDetailsRequest,
  GetReservationStatusInWordsRequest,
} from '../models/request/roomReservation';
import {
  remoteLockDoorCodeService as defaultRemoteLockDoorCodeService,
  RemoteLockDoorCodeService,
} from '../remotelock/services/doorCodeService';
import { hotelService, HotelService } from '../services/hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../services/hotelConfiguration/hotelConfigurationService';
import roomReservationService, {
  RoomReservationService,
} from '../services/roomReservation/roomReservationService';
import { PaymentProvider, PmsProvider } from '../types/enums';
import { DoorLockSourceOfTruth } from '../types/hotelConfiguration';
import {
  getAssistantPhoneNumber,
  getCallerPhoneNumber,
  getCurrentSessionId,
  getSessionType,
} from '../utils/helper';
import logger from '../utils/logger';
import {
  validateCheckAvailabilityForModificationRequest,
  validateCheckSisterPropertyAvailabilityRequest,
  validateGetAllRatesForRoomTypeRequestParams,
  validateGetDoorCodeRequestParams,
  validateGetLockboxCodeRequestParams,
  validateGetMultiRoomAvailabilityRequestParams,
  validateGetReservationDetailsRequestParams,
  validateGetSingleRoomAvailabilityRequestParams,
  validateModifyReservationRequest,
  validateMultiRoomReservationRequest,
  validateReservationStatusParams,
  validateRoomReservationRequest,
} from '../utils/validateReservationRequest';
import { validateAuthorizeNetCardTokenRequest } from '../validators/authorizeNetCardTokenSchema';
import {
  validateOperaCardTokenRequest,
  validateResNexusCardRequest,
} from '../validators/cardSubmissionSchema';
import { validateCloudbedsCardTokenRequest } from '../validators/cloudbedsCardTokenSchema';
import { validateMewsCardTokenRequest } from '../validators/mewsCardTokenSchema';
import {
  reservationReviewBodySchema,
  reservationReviewQuerySchema,
} from '../validators/reservationReviewSchema';
import { sendOnboardingSmsSchema } from '../validators/reservationSchema';
import { validateShift4CardTokenRequest } from '../validators/shift4CardTokenSchema';
import {
  handleAgentErrorAndSendResponse,
  handleCoreApiErrorAndSendResponse,
} from './util/helper';
import { stripSensitiveConfigFromReservation } from './util/stripSensitiveConfigFields';

/** Sessions whose caller number is a phone the caller holds: a call's caller ID, an SMS sender. */
const CALLER_ID_SESSION_TYPES: string[] = [SessionType.CALL, SessionType.SMS];

class RoomReservationController {
  constructor(
    private roomReservationService: RoomReservationService,
    private remoteLockDoorCodeService: RemoteLockDoorCodeService = defaultRemoteLockDoorCodeService,
    private hotelServiceInstance: HotelService = hotelService,
    private hotelConfigurationServiceInstance: HotelConfigurationService = hotelConfigurationService,
    private cloudbedsDoorCodeService: Pick<
      CloudbedsDoorCodeService,
      'getDoorCodes'
    > = defaultCloudbedsDoorCodeService,
    private lockboxCodeService: LockboxCodeService = defaultLockboxCodeService,
  ) {}

  public async getSingleRoomAvailabilityInfo(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const getAvailabilityParams =
        validateGetSingleRoomAvailabilityRequestParams({
          ...req.body,
        });
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getSingleRoomAvailabilityInfo: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getSingleRoomAvailabilityInfo: Assistant phone number is required',
        );
      }
      const availabilityInfo =
        await this.roomReservationService.getRoomAvailabilityWithQuote(
          getAvailabilityParams,
          phoneNumber,
          assistantPhoneNumber,
          getSessionType(req),
        );
      res.status(200).json(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in getSingleRoomAvailabilityInfo: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getSingleRoomAvailabilityInfoLite(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const getAvailabilityParams =
        validateGetSingleRoomAvailabilityRequestParams({
          ...req.body,
        });
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getSingleRoomAvailabilityInfoLite: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getSingleRoomAvailabilityInfoLite: Assistant phone number is required',
        );
      }
      const availabilityInfo =
        await this.roomReservationService.getRoomAvailabilityWithQuoteLite(
          getAvailabilityParams,
          phoneNumber,
          assistantPhoneNumber,
          getSessionType(req),
        );
      res.status(200).json(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in getSingleRoomAvailabilityInfoLite: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getSingleRoomAvailabilityInfoLiteV2(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const getAvailabilityParams =
        validateGetSingleRoomAvailabilityRequestParams({
          ...req.body,
        });
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getSingleRoomAvailabilityInfoLiteV2: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getSingleRoomAvailabilityInfoLiteV2: Assistant phone number is required',
        );
      }
      const availabilityInfo =
        await this.roomReservationService.getRoomAvailabilityWithQuoteLiteV2(
          getAvailabilityParams,
          phoneNumber,
          assistantPhoneNumber,
          getSessionType(req),
        );
      res.status(200).json(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in getSingleRoomAvailabilityInfoLiteV2: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async checkSisterPropertyAvailability(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const params = validateCheckSisterPropertyAvailabilityRequest(req.body);
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'checkSisterPropertyAvailability: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'checkSisterPropertyAvailability: Assistant phone number is required',
        );
      }
      const result =
        await this.roomReservationService.checkSisterPropertyAvailability(
          params,
          phoneNumber,
          assistantPhoneNumber,
        );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in checkSisterPropertyAvailability: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getAllRatesForRoomType(req: CustomRequest, res: Response) {
    try {
      const { availabilityParams, roomId } =
        validateGetAllRatesForRoomTypeRequestParams({
          ...req.body,
        });
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getAllRatesForRoomType: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getAllRatesForRoomType: Assistant phone number is required',
        );
      }
      const rateInfo = await this.roomReservationService.getAllRatesForRoomType(
        availabilityParams,
        roomId,
        phoneNumber,
        assistantPhoneNumber,
        getSessionType(req),
      );
      res.status(200).json(rateInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error('Error in getAllRatesForRoomType', error);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async sendPaymentReminders(req: Request, res: Response) {
    try {
      const minAgeMinutes = config.PAYMENT_AGE_THRESHOLD;

      const result =
        await this.roomReservationService.sendPaymentReminders(minAgeMinutes);
      res.status(200).json({
        message: 'Payment reminders executed',
        min_age_minutes: minAgeMinutes,
        ...result,
      });
    } catch (error) {
      logger.error(`Error in sendPaymentReminders: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getMultiRoomAvailabilityInfo(req: CustomRequest, res: Response) {
    try {
      const getAvailabilityParams =
        validateGetMultiRoomAvailabilityRequestParams({
          ...req.body,
        });
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityInfo: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityInfo: Assistant phone number is required',
        );
      }
      const availabilityInfo =
        await this.roomReservationService.getMultiRoomAvailabilityWithQuote(
          getAvailabilityParams,
          phoneNumber,
          assistantPhoneNumber,
          getSessionType(req),
        );
      res.status(200).json(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in getMultiRoomAvailabilityInfo: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getMultiRoomAvailabilityInfoLite(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const getAvailabilityParams =
        validateGetMultiRoomAvailabilityRequestParams({
          ...req.body,
        });
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityInfoLite: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityInfoLite: Assistant phone number is required',
        );
      }
      const availabilityInfo =
        await this.roomReservationService.getMultiRoomAvailabilityWithQuoteLite(
          getAvailabilityParams,
          phoneNumber,
          assistantPhoneNumber,
          getSessionType(req),
        );
      res.status(200).json(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in getMultiRoomAvailabilityInfoLite: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getMultiRoomAvailabilityInfoLiteV2(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const getAvailabilityParams =
        validateGetMultiRoomAvailabilityRequestParams({
          ...req.body,
        });
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityInfoLiteV2: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityInfoLiteV2: Assistant phone number is required',
        );
      }
      const availabilityInfo =
        await this.roomReservationService.getMultiRoomAvailabilityWithQuoteLiteV2(
          getAvailabilityParams,
          phoneNumber,
          assistantPhoneNumber,
          getSessionType(req),
        );
      res.status(200).json(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in getMultiRoomAvailabilityInfoLiteV2: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  protected async createSingleRoomReservation(
    req: CustomRequest<{}, {}, CreateRoomReservationRequest>,
    res: Response,
  ) {
    try {
      const validatedReservationParams = validateRoomReservationRequest({
        ...req.body,
      });

      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'createSingleRoomReservation: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'createSingleRoomReservation: Assistant phone number is required',
        );
      }
      const reservationInfo =
        await this.roomReservationService.createSingleRoomReservation(
          validatedReservationParams,
          phoneNumber,
          assistantPhoneNumber,
          getCurrentSessionId(req),
          getSessionType(req),
        );
      res.status(201).json(reservationInfo);
    } catch (error) {
      logger.error(`Error in createRoomReservation: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  protected async createMultiRoomReservation(
    req: CustomRequest<{}, {}, CreateMultiRoomReservationRequest>,
    res: Response,
  ) {
    try {
      const validatedReservationParams = validateMultiRoomReservationRequest({
        ...req.body,
      });

      const phoneNumber = getCallerPhoneNumber(req);
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'createMultiRoomReservation: Phone number is required',
        );
      }
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'createMultiRoomReservation: Assistant phone number is required',
        );
      }
      const reservationInfo =
        await this.roomReservationService.createMultiRoomReservation(
          validatedReservationParams,
          phoneNumber,
          assistantPhoneNumber,
          getCurrentSessionId(req),
          getSessionType(req),
        );
      res.status(201).json(reservationInfo);
    } catch (error) {
      logger.error(`Error in createMultiRoomReservation: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  protected async getReservationDetails(
    req: CustomRequest<{}, {}, GetReservationDetailsRequest>,
    res: Response,
  ) {
    try {
      const phoneNumber = getCallerPhoneNumber(req);
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      const params = validateGetReservationDetailsRequestParams(
        req.body,
        phoneNumber,
        assistantPhoneNumber,
      );
      let bookingId = params?.booking_id;
      if (bookingId && bookingId.toUpperCase().startsWith('BK')) {
        bookingId = bookingId.toUpperCase();
      }
      const result = await this.roomReservationService.getReservationDetails(
        phoneNumber,
        assistantPhoneNumber,
        bookingId,
        params?.last_digits_phone_number,
        params?.guest_name,
        params?.check_out_date,
        params?.reservation_id_last_four,
      );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in getReservationDetails: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getReservationStatusInWords(
    req: CustomRequest<{}, {}, GetReservationStatusInWordsRequest>,
    res: Response,
  ) {
    try {
      const validatedParams = validateReservationStatusParams(req.body);
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      const result =
        await this.roomReservationService.getReservationStatusInWordsAfterAdvancePayment(
          validatedParams.booking_id,
          assistantPhoneNumber,
        );
      res.status(200).json(result);
    } catch (error) {
      logger.error(
        `Error in getReservationStatusInWords: ${JSON.stringify(error)}`,
      );
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  /**
   * Resolves a guest's RemoteLock door PIN, looked up either by booking_id or
   * by guest_name + check_out_date. Matching lives in
   * `RemoteLockDoorCodeService`; this only resolves the caller's hotel, narrows
   * a name lookup to a single booking, and shapes the reservation rows for it.
   * Cloudbeds hotels with `door_lock_config.source_of_truth = daisy` are
   * answered from Cloudbeds instead (`CloudbedsDoorCodeService`), only for a
   * caller whose caller ID is on a stay covering today: the booking_id's, or
   * without one, the caller's stays found by the caller ID. Its refusals are
   * a 200 (`{ success: false, reason }`), like the lockbox route's.
   */
  public async getDoorCode(
    req: CustomRequest<{}, {}, GetDoorCodeRequest>,
    res: Response,
  ) {
    try {
      const phoneNumber = getCallerPhoneNumber(req);
      const assistantPhoneNumber = getAssistantPhoneNumber(req);

      // getReservationDetails strips down to selectRequiredFields, which
      // drops hotel_id — read it off the request instead (already resolved
      // by the setSessionData middleware from assistant_phone_number).
      const hotelId = req.hotelId;
      if (!hotelId) {
        throw new BadRequestError('getDoorCode: Unable to determine hotel');
      }

      const hotel = await this.hotelServiceInstance.getHotelById(hotelId);
      const cloudbedsDoorLockConfig =
        hotel.pms_provider === PmsProvider.CLOUDBEDS
          ? (
              await this.hotelConfigurationServiceInstance.getHotelConfigurationByHotelId(
                hotel.id,
              )
            )?.door_lock_config
          : undefined;
      const fromCloudbeds =
        cloudbedsDoorLockConfig?.source_of_truth ===
        DoorLockSourceOfTruth.DAISY;
      const params = validateGetDoorCodeRequestParams(
        req.body,
        assistantPhoneNumber,
        { callerIdLookup: fromCloudbeds },
      );

      if (fromCloudbeds) {
        const result = await this.cloudbedsDoorCodeService.getDoorCodes(
          hotel,
          cloudbedsDoorLockConfig,
          {
            bookingId: params.booking_id,
            // Only a call's caller ID or an SMS sender is a phone the
            // caller holds; web chat sends an id in its place.
            callerPhone: CALLER_ID_SESSION_TYPES.includes(req.sessionType ?? '')
              ? phoneNumber
              : '',
          },
        );
        res.status(200).json(result);
        return;
      }

      // The guest-name path goes straight to RemoteLock: the access guest
      // itself carries the name and the stay window, so there is nothing the
      // PMS lookup adds beyond a second source to disagree with.
      if (!params.booking_id) {
        const matches =
          await this.remoteLockDoorCodeService.resolveDoorCodesByGuestName(
            hotelId,
            params.guest_name as string,
            params.check_out_date as string,
          );
        res.status(200).json({ door_codes: matches });
        return;
      }

      const reservations =
        await this.roomReservationService.getReservationDetails(
          phoneNumber,
          assistantPhoneNumber,
          params.booking_id,
          undefined,
          params.guest_name,
          undefined,
          undefined,
          ReservationLookupSource.DOOR_CODE,
        );

      // // A booking_id resolves to exactly one booking already; only the
      // // guest-name path can pick up unrelated guests' reservations.
      // if (!params.booking_id) {
      //   const narrowed = narrowReservationsForDoorCode(
      //     reservations,
      //     params.check_out_date as string,
      //   );
      //   if (narrowed.status === 'no_match') {
      //     throw new NoDataError(
      //       'getDoorCode: no reservation matches that guest name and check-out date',
      //     );
      //   }
      //   if (narrowed.status === 'ambiguous') {
      //     logKpi({
      //       stat: KpiStat.RemoteLockDoorCodeGuestNameAmbiguous,
      //       value: 1,
      //       contextName: 'RoomReservationController.getDoorCode',
      //       clientId: assistantPhoneNumber,
      //     });
      //     throw new BadRequestError(
      //       'getDoorCode: several reservations match this guest name and check-out date — ask the guest for their booking ID',
      //     );
      //   }
      //   reservations = narrowed.reservations;
      // }

      const doorCodes = await this.remoteLockDoorCodeService.resolveDoorCodes(
        hotelId,
        reservations.map((reservation) => ({
          booking_id: reservation.booking_id,
          name: `${reservation.customer?.first_name ?? ''} ${
            reservation.customer?.last_name ?? ''
          }`.trim(),
          email: reservation.customer?.email,
          phone: reservation.customer?.phone_number,
          check_in: reservation.check_in,
          check_out: reservation.check_out,
        })),
      );

      res.status(200).json({ door_codes: doorCodes });
    } catch (error) {
      logger.error(`Error in getDoorCode: ${JSON.stringify(error)}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  /**
   * Returns the lockbox number(s) and code(s) assigned to a late-arriving
   * guest's reservation, from the hotel's own lockbox log, after checking the
   * reservation and the caller on it in the hotel's PMS: the reservation the
   * agent found (`booking_id`) and the caller's name (`customer_name`), or,
   * without a booking id, tonight's reservations with the caller's phone
   * number (`booking_phone`, else the caller ID, plus `last_name` for a
   * number that isn't the caller ID). A lookup that finds nothing or is
   * refused is still a 200 (`{ success: false, reason }`), so the agent can
   * apologize and offer a transfer; only a malformed request is a 4xx.
   */
  public async getLockboxCode(
    req: CustomRequest<{}, {}, GetLockboxCodeRequest>,
    res: Response,
  ) {
    try {
      const params = validateGetLockboxCodeRequestParams(req.body);
      // Resolved by setSessionData from assistant_phone_number / business_id.
      const hotelId = req.hotelId;
      if (!hotelId) {
        throw new BadRequestError('getLockboxCode: Unable to determine hotel');
      }

      const result = await this.lockboxCodeService.getLockboxCode(
        hotelId,
        params.booking_id !== undefined
          ? {
              bookingId: params.booking_id,
              roomNumber: params.room_number,
              customerName: params.customer_name,
            }
          : {
              // Only a call's caller ID or an SMS sender is a phone the
              // caller holds; web chat sends an id in its place.
              callerPhone: CALLER_ID_SESSION_TYPES.includes(
                req.sessionType ?? '',
              )
                ? getCallerPhoneNumber(req)
                : '',
              bookingPhone: params.booking_phone,
              lastName: params.last_name,
              roomNumber: params.room_number,
            },
      );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in getLockboxCode: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  // Should only be invoked only by the customer
  protected async cancelReservation(
    req: CustomRequest<{}, {}, CancelReservationRequest>,
    res: Response,
  ) {
    try {
      let booking_id = req.body?.booking_id;
      const reason = req.body?.reason;
      if (!booking_id) {
        throw new Error('Booking ID is required');
      }
      if (booking_id.trim().toUpperCase().startsWith('BK')) {
        booking_id = booking_id.trim().toUpperCase();
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      const result = await this.roomReservationService.cancelReservation(
        booking_id,
        CancellationSource.CUSTOMER,
        assistantPhoneNumber,
        reason,
      );
      res.status(200).json({
        message: 'Reservation cancelled successfully',
        ...result,
        reservationCancelResult: stripSensitiveConfigFromReservation(
          result.reservationCancelResult,
        ),
      });
    } catch (error) {
      logger.error(`Error in cancelReservation: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  protected async modifyReservation(req: CustomRequest, res: Response) {
    try {
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'modifyReservation: Phone number is required',
        );
      }
      const validatedRequest = validateModifyReservationRequest(
        req.body,
        phoneNumber,
      );
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      const result = await this.roomReservationService.modifyReservation(
        validatedRequest,
        phoneNumber,
        assistantPhoneNumber || undefined,
      );
      res.status(200).json(stripSensitiveConfigFromReservation(result));
    } catch (error) {
      logger.error(`Error in modifyReservation: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  protected async checkAvailabilityForModification(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'checkAvailabilityForModification: Caller phone number is required',
        );
      }
      const validatedRequest = validateCheckAvailabilityForModificationRequest(
        req.body,
        phoneNumber,
      );
      if (validatedRequest.booking_id.trim().toUpperCase().startsWith('BK')) {
        validatedRequest.booking_id = validatedRequest.booking_id
          .trim()
          .toUpperCase();
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      const result =
        await this.roomReservationService.checkAvailabilityForModification(
          validatedRequest,
          assistantPhoneNumber || undefined,
        );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in checkAvailabilityForModification: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  protected async checkAvailabilityForModificationLite(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'checkAvailabilityForModificationLite: Caller phone number is required',
        );
      }
      const validatedRequest = validateCheckAvailabilityForModificationRequest(
        req.body,
        phoneNumber,
      );
      if (validatedRequest.booking_id.trim().toUpperCase().startsWith('BK')) {
        validatedRequest.booking_id = validatedRequest.booking_id
          .trim()
          .toUpperCase();
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      const result =
        await this.roomReservationService.checkAvailabilityForModificationLite(
          validatedRequest,
          assistantPhoneNumber || undefined,
        );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in checkAvailabilityForModificationLite: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public switchAvailabilityBasedOnBody(req: CustomRequest, res: Response) {
    const booking_id = req.body.booking_id;
    if (booking_id) {
      return this.checkAvailabilityForModification(req, res);
    }
    return this.getSingleRoomAvailabilityInfo(req, res);
  }

  public switchAvailabilityBasedOnBodyLite(req: CustomRequest, res: Response) {
    const booking_id = req.body.booking_id;
    if (booking_id) {
      return this.checkAvailabilityForModificationLite(req, res);
    }
    return this.getSingleRoomAvailabilityInfoLite(req, res);
  }

  public switchAvailabilityBasedOnBodyLiteV2(
    req: CustomRequest,
    res: Response,
  ) {
    const booking_id = req.body.booking_id;
    if (booking_id) {
      return this.checkAvailabilityForModificationLite(req, res);
    }
    return this.getSingleRoomAvailabilityInfoLiteV2(req, res);
  }

  public switchMultiRoomAvailabilityBasedOnBody(
    req: CustomRequest,
    res: Response,
  ) {
    return this.getMultiRoomAvailabilityInfo(req, res);
  }

  public switchMultiRoomAvailabilityBasedOnBodyLite(
    req: CustomRequest,
    res: Response,
  ) {
    return this.getMultiRoomAvailabilityInfoLite(req, res);
  }

  public switchMultiRoomAvailabilityBasedOnBodyLiteV2(
    req: CustomRequest,
    res: Response,
  ) {
    return this.getMultiRoomAvailabilityInfoLiteV2(req, res);
  }

  public switchReservationStatusBasedOnBody(req: CustomRequest, res: Response) {
    const action = req.body?.action;
    switch (action?.toLowerCase()) {
      case 'get':
        return this.getReservationStatusInWords(req, res);
      default:
        res.status(400).json({
          message: 'Invalid action specified',
        });
    }
  }

  public async getActiveDiscountByPhoneNumbers(
    req: CustomRequest,
    res: Response,
  ) {
    try {
      const phoneNumber = getCallerPhoneNumber(req);
      if (!phoneNumber) {
        throw new BadRequestError(
          'getActiveDiscountByPhoneNumbers: Phone number is required',
        );
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getActiveDiscountByPhoneNumbers: Assistant phone number is required',
        );
      }
      const result =
        await this.roomReservationService.getActiveDiscountByPhoneNumbers(
          phoneNumber,
          assistantPhoneNumber,
        );
      if (!result) {
        throw new NoDataError(
          `User with phone number ${phoneNumber} has no active discount`,
        );
      }
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in getActiveDiscountByPhoneNumbers: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getEscalationInstruction(req: CustomRequest, res: Response) {
    try {
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getEscalationInstruction: Assistant phone number is required',
        );
      }
      const result =
        await this.roomReservationService.getEscalationInstructionMessage(
          assistantPhoneNumber,
        );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in getEscalationInstruction: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async cancelStaleReservationsAndPayments(req: Request, res: Response) {
    try {
      const cutoffMinutes = config.REVIEW_TIMEOUT;

      const [paymentResult, noPaymentResult] = await Promise.all([
        this.roomReservationService.cancelStaleReservationsAndPayments(
          cutoffMinutes,
        ),
        this.roomReservationService.cancelStaleNoPaymentReservations(
          cutoffMinutes,
        ),
      ]);

      res.status(200).json({
        message: 'Stale reservations cancellation executed',
        payment_flow: {
          cutoff_minutes: cutoffMinutes,
          ...paymentResult,
        },
        no_payment_flow: {
          cutoff_minutes: cutoffMinutes,
          ...noPaymentResult,
        },
      });
    } catch (error) {
      logger.error(`Error in cancelStalePayments: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  // Should only be invoked only by the system
  public async cancelReservationsForUnavailableRooms(
    req: Request,
    res: Response,
  ) {
    try {
      const result =
        await this.roomReservationService.cancelReservationsForUnavailableRooms(
          CancellationSource.SYSTEM,
        );
      res.status(200).json({
        message: 'Reservations for unavailable rooms cancelled',
        ...result,
      });
    } catch (error) {
      logger.error(`Error in cancelReservationsForUnavailableRooms: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async cleanupExpiredDiscounts(req: Request, res: Response) {
    try {
      const result =
        await this.roomReservationService.cleanupExpiredDiscounts();
      res.status(200).json({
        message: 'Expired discounts cleanup executed',
        ...result,
      });
    } catch (error) {
      logger.error(`Error in cleanupExpiredDiscounts: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public switchReservationBasedOnAction(req: CustomRequest, res: Response) {
    const action = req.body.action;
    delete req.body.action; // Clean up the request body
    if (!action) {
      res.status(400).json({
        message: "'action' is required in the request body",
      });
      return;
    }

    switch (action) {
      case 'GET':
        return this.getReservationDetails(req, res);
      case 'POST':
        return this.createSingleRoomReservation(req, res);
      case 'CANCEL':
        return this.cancelReservation(req, res);
      case 'UPDATE':
        return this.modifyReservation(req, res);
      default:
        res.status(400).json({
          message: 'Invalid action specified',
        });
    }
    return;
  }

  public switchMultiRoomReservationBasedOnAction(
    req: CustomRequest,
    res: Response,
  ) {
    const action = req.body.action;
    delete req.body.action; // Clean up the request body
    if (!action) {
      res.status(400).json({
        message: "'action' is required in the request body",
      });
      return;
    }

    switch (action) {
      case 'POST':
        return this.createMultiRoomReservation(req, res);
      default:
        res.status(400).json({
          message: 'Invalid action specified',
        });
    }
    return;
  }

  public async getReservationDetailsByReviewId(req: Request, res: Response) {
    try {
      const { reservation_review_id } = req.query as {
        reservation_review_id?: string;
      };
      if (!reservation_review_id || typeof reservation_review_id !== 'string') {
        throw new BadRequestError(
          'reservation_review_id query param is required',
        );
      }
      const result =
        await this.roomReservationService.getReservationDetailsByReviewId(
          reservation_review_id,
        );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in getReservationDetailsByReviewId: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * Handles review page submission: updates customer details, then returns payment link (payment hotels)
   * or creates PMS reservation directly (no-payment hotels).
   * Passes validated body and device details (IP, browser, device_type) to the service, which uploads policy signature to S3 and saves on the customer.
   */
  public async submitReviewAndProcessReservation(req: Request, res: Response) {
    try {
      const { value: validatedQuery, error: queryError } =
        reservationReviewQuerySchema.validate(req.query, {
          abortEarly: false,
          stripUnknown: true,
        });
      if (queryError) {
        throw new BadRequestError(
          queryError.details.map((d) => d.message).join(', '),
        );
      }

      const { value: validatedBody, error: bodyError } =
        reservationReviewBodySchema.validate(req.body);
      if (bodyError) {
        throw new BadRequestError(
          bodyError.details.map((d) => d.message).join(', '),
        );
      }

      const {
        customer,
        address,
        billing_address,
        policy_signature: policySignatureRaw,
      } = validatedBody as {
        customer: {
          first_name: string;
          last_name: string;
          email: string;
          phone_number: string;
        };
        address: {
          state_or_province: string;
          postal_code: string;
          city: string;
          address_first_line: string;
          country: string;
        };
        billing_address: {
          state_or_province: string;
          postal_code: string;
          city: string;
          address_first_line: string;
          country: string;
        };
        policy_signature?: { image: string; contentType: string };
      };

      const customerDataToUpdate: UpdateCustomerDataBeforePayment = {
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone_number: customer.phone_number,
        address: {
          state_or_province: address.state_or_province,
          postal_code: address.postal_code,
          city: address.city,
          address_first_line: address.address_first_line,
          country: address.country,
        },
        ...(billing_address && {
          billing_address: {
            state_or_province: billing_address.state_or_province,
            postal_code: billing_address.postal_code,
            city: billing_address.city,
            address_first_line: billing_address.address_first_line,
            country: address.country,
          },
        }),
      };
      const result =
        await this.roomReservationService.submitReviewAndProcessReservation(
          customerDataToUpdate,
          validatedQuery.reservation_review_id,
          {
            request: req,
            ...(policySignatureRaw != null && {
              policy_signature: policySignatureRaw,
            }),
          },
        );
      res.status(200).json(result);
    } catch (error) {
      logger.error(
        `Error in submitReviewAndProcessReservation: ${JSON.stringify(error)}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getUnitGroups(req: CustomRequest, res: Response) {
    try {
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getUnitGroups: Assistant phone number is required',
        );
      }
      const result =
        await this.roomReservationService.getUnitGroups(assistantPhoneNumber);
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in getUnitGroups: ${JSON.stringify(error)}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async sendBookingLinkSMS(req: CustomRequest, res: Response) {
    try {
      const { booking_link } = req.body;

      if (!booking_link) {
        throw new BadRequestError(
          'sendBookingLinkSMS: booking_link is required',
        );
      }
      const callerPhoneNumber = getCallerPhoneNumber(req);
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'getUnitGroups: Assistant phone number is required',
        );
      }
      const sessionId = req.sessionId;

      await this.roomReservationService.sendBookingLinkSMS(
        booking_link,
        callerPhoneNumber,
        assistantPhoneNumber,
        sessionId!,
      );

      res.status(200).json({
        success: true,
        message: 'Booking link SMS sent successfully',
      });
    } catch (error) {
      logger.error(`Error in sendBookingLinkSMS: ${JSON.stringify(error)}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async sendSMS(req: CustomRequest, res: Response) {
    try {
      const { message } = req.body;

      if (!message) {
        throw new BadRequestError('sendSMS: message is required');
      }
      const callerPhoneNumber = getCallerPhoneNumber(req);
      if (!callerPhoneNumber) {
        throw new BadRequestError('sendSMS: Caller phone number is required');
      }
      const assistantPhoneNumber = getAssistantPhoneNumber(req);
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'sendSMS: Assistant phone number is required',
        );
      }
      const sessionId = getCurrentSessionId(req);

      await this.roomReservationService.sendSMS(
        message,
        callerPhoneNumber,
        assistantPhoneNumber,
        sessionId,
      );

      res.status(200).json({
        success: true,
        message: 'SMS sent successfully',
      });
    } catch (error) {
      logger.error('Error in sendSMS', error);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async sendOnboardingSms(req: Request, res: Response) {
    try {
      // Validate request body with Joi
      const { error, value } = sendOnboardingSmsSchema.validate(req.body);
      if (error) {
        throw new BadRequestError(
          `sendOnboardingSms: ${error.details[0].message}`,
        );
      }

      const { days, timezones } = value;

      logger.info(
        `Starting onboarding SMS job for check-ins in ${days} day(s) for timezones ${timezones.join(', ')}`,
      );

      const results =
        await this.roomReservationService.sendOnboardingSmsForCheckIns(
          days,
          timezones,
        );

      const totalSent = results.reduce((sum, r) => sum + r.sms_sent, 0);
      const totalProcessed = results.reduce(
        (sum, r) => sum + r.reservations_processed,
        0,
      );
      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

      res.status(200).json({
        message: 'Onboarding SMS job completed',
        days: days,
        summary: {
          hotels_processed: results.length,
          reservations_processed: totalProcessed,
          sms_sent: totalSent,
          errors: totalErrors,
        },
        details: results,
      });
    } catch (error) {
      logger.error(`Error in sendOnboardingSms: ${JSON.stringify(error)}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * Handles Shift4 card token submission from frontend and processes initial deposit payment
   * Once payment is successful, creates reservations for the guest
   */
  public async submitShift4CardTokenAndCreateReservations(
    req: Request,
    res: Response,
  ) {
    try {
      // Validate request body
      const validatedData = validateShift4CardTokenRequest(req.body);

      logger.info('submitShift4CardToken: Processing Shift4 card token', {
        payment_id: validatedData.payment_id,
      });

      // Process card token and execute payment
      const result =
        await this.roomReservationService.processShift4InitialDepositAndCreateReservations(
          validatedData,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in submitShift4CardToken: ${JSON.stringify(error)}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * The request body carries a PAN. Nothing here may log `req.body` — see the
   * redaction rule in `middleware/requestLogger.ts`.
   */
  public async submitOperaCardTokenAndCreateReservations(
    req: Request,
    res: Response,
  ) {
    try {
      const validatedData = validateOperaCardTokenRequest(req.body);

      logger.info('submitOperaCardToken: Processing Opera card token', {
        reservation_review_id: validatedData.reservation_review_id,
      });

      const result =
        await this.roomReservationService.processOperaCardTokenAndCreateReservations(
          validatedData,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in submitOperaCardToken', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * The request body carries a PAN and a CVV. Nothing here may log `req.body` —
   * see the redaction rule in `middleware/requestLogger.ts`.
   */
  public async submitResNexusCardAndCreateReservations(
    req: Request,
    res: Response,
  ) {
    try {
      const validatedData = validateResNexusCardRequest(req.body);

      logger.info('submitResNexusCard: Processing ResNexus card', {
        reservation_review_id: validatedData.reservation_review_id,
      });

      const result =
        await this.roomReservationService.processResNexusCardAndCreateReservations(
          validatedData,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in submitResNexusCard', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async submitMewsCardTokenAndCreateReservations(
    req: Request,
    res: Response,
  ) {
    try {
      const validatedData = validateMewsCardTokenRequest(req.body);

      logger.info('submitMewsCardToken: Processing Mews card token', {
        reservation_review_id: validatedData.reservation_review_id,
      });

      const result =
        await this.roomReservationService.processMewsPaymentAndCreateReservations(
          validatedData,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in submitMewsCardToken', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async submitCloudbedsCardTokenAndCreateReservations(
    req: Request,
    res: Response,
  ) {
    try {
      const validatedData = validateCloudbedsCardTokenRequest(req.body);

      logger.info(
        'submitCloudbedsCardToken: Processing Cloudbeds SDK card token',
        {
          reservation_review_id: validatedData.reservation_review_id,
        },
      );

      const result =
        await this.roomReservationService.processCloudbedsPaymentAndCreateReservations(
          validatedData,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in submitCloudbedsCardToken', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async submitAuthorizeNetCardTokenAndCreateReservations(
    req: Request,
    res: Response,
  ) {
    try {
      const validatedData = validateAuthorizeNetCardTokenRequest(req.body);

      logger.info(
        'submitAuthorizeNetCardToken: Processing Authorize.Net nonce',
        { reservation_review_id: validatedData.reservation_review_id },
      );

      const result =
        await this.roomReservationService.processAuthorizeNetInitialDepositAndCreateReservations(
          validatedData,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in submitAuthorizeNetCardToken', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * Processes due Shift4 auto-charges.
   */
  private async processShift4AutoCharges() {
    logger.info('processDueAutoCharges: Processing due Shift4 auto-charges');
    return this.roomReservationService.processDueAutoCharges(
      PaymentProvider.SHIFT4,
    );
  }

  /**
   * Processes due Mews auto-charges.
   */
  private async processMewsAutoCharges() {
    logger.info('processDueAutoCharges: Processing due Mews auto-charges');
    return this.roomReservationService.processDueAutoCharges(
      PaymentProvider.MEWS,
    );
  }

  private async processCloudbedsAutoCharges() {
    logger.info(
      'processDueAutoCharges: Processing due Cloudbeds SDK auto-charges',
    );
    return this.roomReservationService.processDueAutoCharges(
      PaymentProvider.CLOUDBEDS_SDK,
    );
  }

  /**
   * Processes due Authorize.Net auto-charges.
   */
  private async processAuthorizeNetAutoCharges() {
    logger.info(
      'processDueAutoCharges: Processing due Authorize.Net auto-charges',
    );
    return this.roomReservationService.processDueAutoCharges(
      PaymentProvider.AUTHORIZE_NET,
    );
  }

  /**
   * Processes due auto-charges for all payment providers concurrently.
   * Called by Lambda/EventBridge on its own schedule.
   */
  public async processAutoCharges(req: Request, res: Response) {
    try {
      logger.info(
        'processDueAutoCharges: Processing due auto-charges endpoint called',
      );

      const [shift4Result, mewsResult, cloudbedsResult, authnetResult] =
        await Promise.allSettled([
          this.processShift4AutoCharges(),
          this.processMewsAutoCharges(),
          this.processCloudbedsAutoCharges(),
          this.processAuthorizeNetAutoCharges(),
        ]);

      if (shift4Result.status === 'rejected') {
        logger.error(
          `Error processing due Shift4 auto-charges: ${shift4Result.reason}`,
        );
      }
      if (mewsResult.status === 'rejected') {
        logger.error(
          `Error processing due Mews auto-charges: ${mewsResult.reason}`,
        );
      }
      if (cloudbedsResult.status === 'rejected') {
        logger.error(
          `Error processing due Cloudbeds SDK auto-charges: ${cloudbedsResult.reason}`,
        );
      }
      if (authnetResult.status === 'rejected') {
        logger.error(
          `Error processing due Authorize.Net auto-charges: ${authnetResult.reason}`,
        );
      }

      res.status(200).json({
        shift4:
          shift4Result.status === 'fulfilled'
            ? shift4Result.value
            : { success: false, error: String(shift4Result.reason) },
        mews:
          mewsResult.status === 'fulfilled'
            ? mewsResult.value
            : { success: false, error: String(mewsResult.reason) },
        cloudbeds_sdk:
          cloudbedsResult.status === 'fulfilled'
            ? cloudbedsResult.value
            : { success: false, error: String(cloudbedsResult.reason) },
        authorizeNet:
          authnetResult.status === 'fulfilled'
            ? authnetResult.value
            : { success: false, error: String(authnetResult.reason) },
      });
    } catch (error) {
      logger.error(`Error processing due auto-charges: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}

const roomReservationController = () =>
  new RoomReservationController(roomReservationService);

export default roomReservationController;
export { RoomReservationController };
