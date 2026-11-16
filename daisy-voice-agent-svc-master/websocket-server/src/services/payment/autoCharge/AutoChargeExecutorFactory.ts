import authorizeNetAutoChargeExecutor from '../../../authorizeNet/services/AuthorizeNetAutoChargeExecutor';
import operaAutoChargeExecutor from '../../../calry/services/OperaAutoChargeExecutor';
import { BadRequestError } from '../../../errors/BadRequestError';
import mewsAutoChargeExecutor from '../../../mews/services/MewsAutoChargeExecutor';
import { PaymentProvider } from '../../../types/enums';
import shift4AutoChargeExecutor from '../../shift4/Shift4AutoChargeExecutor';
import { IAutoChargeExecutor } from './IAutoChargeExecutor';

export class AutoChargeExecutorFactory {
  private executors: Map<PaymentProvider, IAutoChargeExecutor> = new Map([
    [PaymentProvider.SHIFT4, shift4AutoChargeExecutor],
    [PaymentProvider.MEWS, mewsAutoChargeExecutor],
    [PaymentProvider.AUTHORIZE_NET, authorizeNetAutoChargeExecutor],
    [PaymentProvider.OPERA, operaAutoChargeExecutor],
  ]);

  public getExecutor(paymentProvider: PaymentProvider): IAutoChargeExecutor {
    const executor = this.executors.get(paymentProvider);
    if (!executor) {
      throw new BadRequestError(
        `Auto-charge execution not supported for payment provider ${paymentProvider}`,
      );
    }
    return executor;
  }
}

const autoChargeExecutorFactory = new AutoChargeExecutorFactory();
export default autoChargeExecutorFactory;
