import { json, Router } from 'express';
import { FileUploadController } from '../controller/fileUploadController';

const uploadRouter = Router();
const controller = new FileUploadController();

uploadRouter.use(json());

uploadRouter.post('/', controller.createUpload.bind(controller));
uploadRouter.get('/url', controller.getPresignedDownloadUrl.bind(controller));

export default uploadRouter;
