import { RequestHandler, Router } from 'express';
import { HotelController } from '../../controller/hotelController';
import { hotelService } from '../../services/hotel/hotelService';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';

const hotelController = new HotelController(
  hotelService,
  hotelConfigurationService,
);

const hotelRouter = Router();

// Superadmin: backfill VAPI recordings to S3 (must be before /:id routes)
hotelRouter.post(
  '/recordings/backfill',
  hotelController.backfillRecordingsForDate as RequestHandler,
);
hotelRouter.post(
  '/recordings/backfill/conversation',
  hotelController.backfillRecordingForConversation as RequestHandler,
);

// Hotel routes
hotelRouter.get('/', hotelController.getHotels as RequestHandler);
hotelRouter.get('/:id', hotelController.getHotelById as RequestHandler);
hotelRouter.post('/', hotelController.createHotel as RequestHandler);
hotelRouter.patch('/:id', hotelController.updateHotel as RequestHandler);
hotelRouter.delete('/:id', hotelController.deleteHotel as RequestHandler);

// Hotel configuration routes
hotelRouter.get(
  '/:id/configuration',
  hotelController.getHotelConfiguration as RequestHandler,
);
hotelRouter.post(
  '/:id/configuration',
  hotelController.createHotelConfiguration as RequestHandler,
);
hotelRouter.put(
  '/:id/configuration',
  hotelController.updateHotelConfiguration as RequestHandler,
);
hotelRouter.delete(
  '/:id/configuration',
  hotelController.deleteHotelConfiguration as RequestHandler,
);

export default hotelRouter;
