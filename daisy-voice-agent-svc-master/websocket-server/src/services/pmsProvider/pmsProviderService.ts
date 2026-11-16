import {
  CreatePmsProviderDTO,
  PmsProviderDTO,
  UpdatePmsProviderDTO,
} from '../../dtos/PmsProviderDto';
import { BadRequestError } from '../../errors/BadRequestError';
import { PmsProviderModel } from '../../models/PmsProvider';
import { PmsProviderRepository } from '../../repositories/PmsProviderRepository';
import logger from '../../utils/logger';

export class PmsProviderService {
  constructor(private pmsProviderRepository: PmsProviderRepository) {}

  async createPmsProvider(data: CreatePmsProviderDTO): Promise<PmsProviderDTO> {
    try {
      data.name = data.name.toLowerCase();
      // Check if provider with same name already exists
      const existingProvider = await this.pmsProviderRepository.findByName(
        data.name,
      );
      if (existingProvider) {
        throw new BadRequestError(
          `createPmsProvider: PMS Provider with name '${data.name}' already exists`,
        );
      }

      const pmsProviderModel: Omit<PmsProviderModel, 'id'> = {
        name: data.name,
        is_active: data.is_active ?? false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const pmsProvider =
        await this.pmsProviderRepository.create(pmsProviderModel);

      logger.info(
        `Created PMS provider: ${pmsProvider.id} - ${pmsProvider.name}`,
      );
      return pmsProvider;
    } catch (error) {
      logger.error('createPmsProvider: Error creating PMS provider:', error);
      throw error;
    }
  }

  async getPmsProviderById(id: string): Promise<PmsProviderModel | null> {
    try {
      return await this.pmsProviderRepository.findById(id);
    } catch (error) {
      logger.error(
        `getPmsProviderById: Error fetching PMS provider ${id}:`,
        error,
      );
      throw error;
    }
  }

  async getPmsProviderByName(name: string): Promise<PmsProviderModel | null> {
    try {
      return await this.pmsProviderRepository.findByName(name.toLowerCase());
    } catch (error) {
      logger.error(
        `getPmsProviderByName: Error fetching PMS provider by name ${name}:`,
        error,
      );
      throw error;
    }
  }

  async getAllPmsProviders(): Promise<PmsProviderModel[]> {
    try {
      return await this.pmsProviderRepository.findAll();
    } catch (error) {
      logger.error(
        'getAllPmsProviders: Error fetching all PMS providers:',
        error,
      );
      throw error;
    }
  }

  async getActivePmsProviders(): Promise<PmsProviderModel[]> {
    try {
      return await this.pmsProviderRepository.findAllActive();
    } catch (error) {
      logger.error(
        'getActivePmsProviders: Error fetching active PMS providers:',
        error,
      );
      throw error;
    }
  }

  async updatePmsProvider(
    id: string,
    data: UpdatePmsProviderDTO,
  ): Promise<PmsProviderModel | null> {
    try {
      data.name = data.name?.toLowerCase();
      // If updating name, check for duplicates
      if (data.name) {
        const existingProvider = await this.pmsProviderRepository.findByName(
          data.name,
        );
        if (existingProvider && existingProvider.id !== id) {
          throw new BadRequestError(
            `updatePmsProvider: PMS Provider with name '${data.name}' already exists`,
          );
        }
      }

      const updatedProvider = await this.pmsProviderRepository.update(id, data);

      if (updatedProvider) {
        logger.info(`updatePmsProvider:Updated PMS provider: ${id}`);
      } else {
        logger.warn(`updatePmsProvider: PMS provider not found: ${id}`);
      }

      return updatedProvider;
    } catch (error) {
      logger.error(
        `updatePmsProvider: Error updating PMS provider ${id}:`,
        error,
      );
      throw error;
    }
  }

  async activatePmsProvider(id: string): Promise<PmsProviderModel | null> {
    try {
      const provider = await this.pmsProviderRepository.setActive(id, true);

      if (provider) {
        logger.info(
          `activatePmsProvider: Activated PMS provider: ${id} - ${provider.name}`,
        );
      } else {
        logger.warn(
          `activatePmsProvider: PMS provider not found for activation: ${id}`,
        );
      }

      return provider;
    } catch (error) {
      logger.error(
        `activatePmsProvider: Error activating PMS provider ${id}:`,
        error,
      );
      throw error;
    }
  }

  async deactivatePmsProvider(id: string): Promise<PmsProviderModel | null> {
    try {
      const provider = await this.pmsProviderRepository.setActive(id, false);

      if (provider) {
        logger.info(
          `deactivatePmsProvider: Deactivated PMS provider: ${id} - ${provider.name}`,
        );
      } else {
        logger.warn(
          `deactivatePmsProvider: PMS provider not found for deactivation: ${id}`,
        );
      }

      return provider;
    } catch (error) {
      logger.error(
        `deactivatePmsProvider: Error deactivating PMS provider ${id}:`,
        error,
      );
      throw error;
    }
  }
}

// Create and export a singleton instance
export const pmsProviderService = new PmsProviderService(
  new PmsProviderRepository(),
);
