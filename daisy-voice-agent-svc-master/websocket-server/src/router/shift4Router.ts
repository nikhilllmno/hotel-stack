import { json, Router } from 'express';
import { Shift4Controller } from '../controller/shift4Controller';
import shift4Service from '../services/shift4/shift4Service';

const shift4Router = Router();
const controller = new Shift4Controller(shift4Service);

shift4Router.use(json());

shift4Router.post(
  '/access-token',
  controller.generateAccessToken.bind(controller),
);

export default shift4Router;
