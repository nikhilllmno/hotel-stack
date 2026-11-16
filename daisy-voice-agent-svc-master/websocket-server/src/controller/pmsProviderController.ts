import { Request, Response } from 'express';
import {
  CreatePmsProviderDTO,
  UpdatePmsProviderDTO,
} from '../dtos/PmsProviderDto';
import { BadRequestError } from '../errors/BadRequestError';
import { PmsProviderService } from '../services/pmsProvider/pmsProviderService';
import logger from '../utils/logger';
import {
  createPmsProviderSchema,
  pmsProviderIdSchema,
  pmsProviderNameSchema,
  updatePmsProviderSchema,
} from '../validators/pmsProviderSchema';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class PmsProviderController {
  constructor(private pmsProviderService: PmsProviderService) {}

  public createPmsProvider = async (req: Request, res: Response) => {
    try {
      // Validate request body
      const { error, value } = createPmsProviderSchema.validate(req.body);

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const data: CreatePmsProviderDTO = value;

      logger.info(
        `PmsProviderController::createPmsProvider - Creating PMS provider: ${data.name}`,
      );
      const pmsProvider = await this.pmsProviderService.createPmsProvider(data);

      res.status(201).json({
        success: true,
        data: pmsProvider,
      });
    } catch (error: unknown) {
      logger.error('Error in PmsProviderController::createPmsProvider:', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public getPmsProviderById = async (req: Request, res: Response) => {
    try {
      // Validate request params
      const { error, value } = pmsProviderIdSchema.validate(req.params);

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const { id } = value;

      logger.info(
        `PmsProviderController::getPmsProviderById - Fetching PMS provider: ${id}`,
      );
      const pmsProvider = await this.pmsProviderService.getPmsProviderById(id);

      if (!pmsProvider) {
        return res.status(404).json({
          success: false,
          error: 'PMS Provider not found',
        });
      }

      res.json({
        success: true,
        data: pmsProvider,
      });
    } catch (error: unknown) {
      logger.error(
        `Error in PmsProviderController::getPmsProviderById: ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public getPmsProviderByName = async (req: Request, res: Response) => {
    try {
      // Validate request params
      const { error, value } = pmsProviderNameSchema.validate(req.params);

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const { name } = value;

      logger.info(
        `PmsProviderController::getPmsProviderByName - Fetching PMS provider: ${name}`,
      );
      const pmsProvider =
        await this.pmsProviderService.getPmsProviderByName(name);

      if (!pmsProvider) {
        return res.status(404).json({
          success: false,
          error: 'PMS Provider not found',
        });
      }

      res.json({
        success: true,
        data: pmsProvider,
      });
    } catch (error: unknown) {
      logger.error(
        `Error in PmsProviderController::getPmsProviderByName: ${req.params.name}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public getAllPmsProviders = async (req: Request, res: Response) => {
    try {
      logger.info(
        'PmsProviderController::getAllPmsProviders - Fetching all PMS providers',
      );
      const pmsProviders = await this.pmsProviderService.getAllPmsProviders();

      res.json({
        success: true,
        data: pmsProviders,
        count: pmsProviders.length,
      });
    } catch (error: unknown) {
      logger.error(
        'Error in PmsProviderController::getAllPmsProviders:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public getActivePmsProviders = async (req: Request, res: Response) => {
    try {
      logger.info(
        'PmsProviderController::getActivePmsProviders - Fetching active PMS providers',
      );
      const pmsProviders =
        await this.pmsProviderService.getActivePmsProviders();

      res.json({
        success: true,
        data: pmsProviders,
        count: pmsProviders.length,
      });
    } catch (error: unknown) {
      logger.error(
        'Error in PmsProviderController::getActivePmsProviders:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public updatePmsProvider = async (req: Request, res: Response) => {
    try {
      // Validate request params
      const { error: paramsError, value: paramsValue } =
        pmsProviderIdSchema.validate(req.params);

      if (paramsError) {
        throw new BadRequestError(
          paramsError.details.map((d) => d.message).join(', '),
        );
      }

      // Validate request body
      const { error: bodyError, value: bodyValue } =
        updatePmsProviderSchema.validate(req.body);

      if (bodyError) {
        throw new BadRequestError(
          bodyError.details.map((d) => d.message).join(', '),
        );
      }

      const { id } = paramsValue;
      const data: UpdatePmsProviderDTO = bodyValue;

      logger.info(
        `PmsProviderController::updatePmsProvider - Updating PMS provider: ${id}`,
      );
      const pmsProvider = await this.pmsProviderService.updatePmsProvider(
        id,
        data,
      );

      if (!pmsProvider) {
        return res.status(404).json({
          success: false,
          error: 'PMS Provider not found',
        });
      }

      res.json({
        success: true,
        data: pmsProvider,
      });
    } catch (error: unknown) {
      logger.error(
        `Error in PmsProviderController::updatePmsProvider: ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public activatePmsProvider = async (req: Request, res: Response) => {
    try {
      // Validate request params
      const { error, value } = pmsProviderIdSchema.validate(req.params);

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const { id } = value;

      logger.info(
        `PmsProviderController::activatePmsProvider - Activating PMS provider: ${id}`,
      );
      const pmsProvider = await this.pmsProviderService.activatePmsProvider(id);

      if (!pmsProvider) {
        return res.status(404).json({
          success: false,
          error: 'PMS Provider not found',
        });
      }

      res.json({
        success: true,
        data: pmsProvider,
        message: 'PMS Provider activated successfully',
      });
    } catch (error: unknown) {
      logger.error(
        `Error in PmsProviderController::activatePmsProvider: ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public deactivatePmsProvider = async (req: Request, res: Response) => {
    try {
      // Validate request params
      const { error, value } = pmsProviderIdSchema.validate(req.params);

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const { id } = value;

      logger.info(
        `PmsProviderController::deactivatePmsProvider - Deactivating PMS provider: ${id}`,
      );
      const pmsProvider =
        await this.pmsProviderService.deactivatePmsProvider(id);

      if (!pmsProvider) {
        return res.status(404).json({
          success: false,
          error: 'PMS Provider not found',
        });
      }

      res.json({
        success: true,
        data: pmsProvider,
        message: 'PMS Provider deactivated successfully',
      });
    } catch (error: unknown) {
      logger.error(
        `Error in PmsProviderController::deactivatePmsProvider: ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };
}
