import {
  isManagerReplyConfirmCallback,
  managerReplyKeyboardAiMode,
  managerReplyKeyboardDirectMode,
  MGR_CALLBACK,
} from '../managerReplyConfirmationFormat';

describe('managerReplyConfirmationFormat', () => {
  describe('isManagerReplyConfirmCallback', () => {
    it('accepts all manager confirm actions', () => {
      expect(isManagerReplyConfirmCallback(MGR_CALLBACK.AI_SEND)).toBe(true);
      expect(isManagerReplyConfirmCallback(MGR_CALLBACK.TAKE_CONTROL)).toBe(
        true,
      );
      expect(isManagerReplyConfirmCallback(MGR_CALLBACK.DIRECT_SEND)).toBe(
        true,
      );
      expect(isManagerReplyConfirmCallback(MGR_CALLBACK.DIRECT_RELEASE)).toBe(
        true,
      );
      expect(isManagerReplyConfirmCallback('handback:x:y')).toBe(false);
    });
  });

  describe('keyboards', () => {
    it('AI mode offers send via Daisy and take control', () => {
      const kb = managerReplyKeyboardAiMode();
      expect(kb[0][0].data).toBe(MGR_CALLBACK.AI_SEND);
      expect(kb[1][0].data).toBe(MGR_CALLBACK.TAKE_CONTROL);
    });

    it('DIRECT mode offers send and send via Daisy (release)', () => {
      const kb = managerReplyKeyboardDirectMode();
      expect(kb[0][0].data).toBe(MGR_CALLBACK.DIRECT_SEND);
      expect(kb[1][0].data).toBe(MGR_CALLBACK.DIRECT_RELEASE);
    });
  });
});
