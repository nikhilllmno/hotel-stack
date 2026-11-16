/* global describe, expect, it */
import { parseDoorCodeText } from '../parseDoorCodeText';

describe('parseDoorCodeText', () => {
  it('takes the PIN after the last colon and keeps the label in the text', () => {
    expect(parseDoorCodeText('The 1850 Hotel Room 202: 5732')).toEqual({
      pin: '5732',
      door_code_text: 'The 1850 Hotel Room 202: 5732',
    });
  });

  it('returns a bare code as both the PIN and the text', () => {
    expect(parseDoorCodeText('5732')).toEqual({
      pin: '5732',
      door_code_text: '5732',
    });
  });

  it('accepts any spacing after the colon and trims the value', () => {
    expect(parseDoorCodeText('  Room 4:123456  ')).toEqual({
      pin: '123456',
      door_code_text: 'Room 4:123456',
    });
    expect(parseDoorCodeText('Room 4:   123')).toMatchObject({ pin: '123' });
  });

  it('accepts PINs of 3 to 10 digits, preserving leading zeros', () => {
    expect(parseDoorCodeText('Room 9: 007')).toMatchObject({ pin: '007' });
    expect(parseDoorCodeText('Room 9: 0123456789')).toMatchObject({
      pin: '0123456789',
    });
  });

  // Anything that is not "label: digits" is handed back whole, so nothing the
  // hotel wrote is dropped or misread as a code.
  it('returns the whole text when it does not end in a colon and a 3–10 digit PIN', () => {
    for (const value of [
      'Room 202: 12',
      'Room 202: 12345678901',
      'Room 202: 5732#',
      'Room 202 5732',
      'Room 202: 57-32',
      'Ask the front desk',
    ]) {
      expect(parseDoorCodeText(value)).toEqual({
        pin: value,
        door_code_text: value,
      });
    }
  });

  it('uses the last code when the text lists several, keeping all of them in the text', () => {
    expect(parseDoorCodeText('Front door: 1111, Room 202: 5732')).toEqual({
      pin: '5732',
      door_code_text: 'Front door: 1111, Room 202: 5732',
    });
  });

  it('returns null for a missing, blank or non-string value', () => {
    expect(parseDoorCodeText(null)).toBeNull();
    expect(parseDoorCodeText(undefined)).toBeNull();
    expect(parseDoorCodeText('')).toBeNull();
    expect(parseDoorCodeText('   ')).toBeNull();
    expect(parseDoorCodeText(5732 as unknown as string)).toBeNull();
  });
});
