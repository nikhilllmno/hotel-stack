import { BaseModel } from './BaseModel';

export interface Prompt extends BaseModel {
  type: string;
  prompt: string;
}
