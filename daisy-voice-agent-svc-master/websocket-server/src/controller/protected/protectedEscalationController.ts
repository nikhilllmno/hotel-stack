// Protected Controller for escalation service

import { Response } from 'express';
import { EscalationService } from '../../services/escalation/escalationService';
import { AuthenticatedRequest } from '../../types/customRequest';
import logger from '../../utils/logger';
import { handleCoreApiErrorAndSendResponse } from '../util/helper';
import { resourceBelongsToTokenHotel } from '../util/hotelResourceAccess';

export class ProtectedEscalationController {
  constructor(private escalationService: EscalationService) {}

  public getEscalationById = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    const { id } = req.params;

    try {
      const result = await this.escalationService.findEscalationById(id);
      if (!result || !resourceBelongsToTokenHotel(req, result.hotel_id)) {
        return res.status(404).json({ error: 'Escalation not found' });
      }
      res.json(result);
    } catch (err) {
      logger.error('Error fetching escalation by ID:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public getEscalationByPhone = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    const { phone_number } = req.params;

    try {
      const result =
        await this.escalationService.findEscalationByPhone(phone_number);
      if (!result || !resourceBelongsToTokenHotel(req, result.hotel_id)) {
        return res
          .status(404)
          .json({ error: 'Escalation not found for phone number' });
      }
      res.json(result);
    } catch (err) {
      logger.error('Error fetching escalation by phone number:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public getEscalationList = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    try {
      const hotel_id = req.user?.hotel_id;
      const start_date = req.query.start_date
        ? new Date(req.query.start_date.toString())
        : undefined;
      const end_date = req.query.end_date
        ? new Date(req.query.end_date.toString())
        : undefined;
      const page = req.query.page ? Number(req.query.page) : 0;
      const limit = req.query.limit ? Number(req.query.limit) : 10;
      if (hotel_id) {
        const summary = await this.escalationService.getEscalationsList(
          hotel_id,
          page,
          limit,
          start_date,
          end_date,
        );
        res.status(200).json(summary);
      }
    } catch (error) {
      logger.error('Error getting summary:', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public getAllEscalations = async (
    _req: AuthenticatedRequest,
    res: Response,
  ) => {
    try {
      const result = await this.escalationService.getAllEscalations();
      res.json(result);
    } catch (err) {
      logger.error('Error fetching all escalations:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public updateEscalation = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    const { id } = req.params;
    const updateData = req.body;

    try {
      const existing = await this.escalationService.findEscalationById(id);
      if (!existing || !resourceBelongsToTokenHotel(req, existing.hotel_id)) {
        return res.status(404).json({ error: 'Escalation not found' });
      }

      const result = await this.escalationService.updateEscalation(
        id,
        updateData,
      );
      if (!result) {
        return res.status(404).json({ error: 'Escalation not found' });
      }
      res.json(result);
    } catch (err) {
      logger.error('Error updating escalation:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public deleteEscalation = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    const { id } = req.params;

    try {
      const existing = await this.escalationService.findEscalationById(id);
      if (!existing || !resourceBelongsToTokenHotel(req, existing.hotel_id)) {
        return res.status(404).json({ error: 'Escalation not found' });
      }

      const deleted = await this.escalationService.deleteEscalation(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Escalation not found' });
      }
      res.status(204).send();
    } catch (err) {
      logger.error('Error deleting escalation:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };
}
