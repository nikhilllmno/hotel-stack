/** Fewer digits than this identify no one: a blank, an extension, a typo. */
const MIN_PHONE_DIGITS = 7;
/** Phones compare on their last digits, so a country code or a trunk 0 doesn't matter. */
const COMPARED_PHONE_DIGITS = 10;
/** A part of a several-part last name counts on its own from this many letters ("de", "van" don't). */
const MIN_LAST_NAME_PART_LETTERS = 4;

/**
 * What two phone numbers must share to be the same: their last 10 digits,
 * every other character ignored, so `+1 (828) 268-3803`, `18282683803` and
 * `828.268.3803` are one number. Null for a number with fewer than 7 digits,
 * which never matches anything, a blank one included.
 */
export function phoneMatchKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= MIN_PHONE_DIGITS
    ? digits.slice(-COMPARED_PHONE_DIGITS)
    : null;
}

export function isSamePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const key = phoneMatchKey(a);
  return key !== null && key === phoneMatchKey(b);
}

/**
 * Whether the last name a caller said (`spoken`) can be the one the PMS holds
 * (`onFile`). Both are read as lowercase letters only, accents dropped and
 * spaces, hyphens and apostrophes ignored, then must be equal or a few typos
 * apart (Levenshtein): none when the shorter name has 3 letters or fewer, 1
 * up to 5 letters, 2 beyond. Each part of a name with several parts also
 * counts on its own from 4 letters, on either side, so "Garcia" matches
 * "García López". A blank name never matches.
 */
export function isSimilarLastName(spoken: string, onFile: string): boolean {
  const onFileForms = lastNameForms(onFile);
  return lastNameForms(spoken).some((said) =>
    onFileForms.some(
      (held) =>
        editDistance(said, held) <=
        allowedTypos(Math.min(said.length, held.length)),
    ),
  );
}

/**
 * Whether the "First Last" a caller said (`spoken`) can be the guest the PMS
 * holds as `onFileFirst` and `onFileLast`, allowing for how speech-to-text
 * hears names: a first name a few typos off ("Steven" for "Stephen"), or run
 * into the last name ("Voicetester Tester", "Voicetester"). The spoken last
 * word must be the last name ({@link isSimilarLastName}), unless the whole
 * name is one run-together word ending in it; what comes before, letters
 * only, must then be the first name, or its first word, within the same typo
 * allowance. A first or last name alone never matches.
 */
export function isSimilarFullName(
  spoken: string,
  onFileFirst: string,
  onFileLast: string,
): boolean {
  const words = nameParts(spoken).map((part) => part.join(''));
  const last = nameParts(onFileLast).flat().join('');
  const firstParts = nameParts(onFileFirst);
  if (words.length === 0 || !last || firstParts.length === 0) return false;

  const before: string[] = [];
  const saidLast = words[words.length - 1];
  if (words.length > 1 && isSimilarLastName(saidLast, onFileLast)) {
    const rest = words.slice(0, -1).join('');
    before.push(rest);
    for (const ending of [last, saidLast]) {
      if (rest.length > ending.length && rest.endsWith(ending)) {
        before.push(rest.slice(0, -ending.length));
      }
    }
  }
  const lastWordCount = nameParts(onFileLast).length;
  if (
    lastWordCount > 1 &&
    words.length > lastWordCount &&
    isSimilarLastName(words.slice(-lastWordCount).join(' '), onFileLast)
  ) {
    before.push(words.slice(0, -lastWordCount).join(''));
  }
  const whole = words.join('');
  if (whole.length > last.length && whole.endsWith(last)) {
    before.push(whole.slice(0, -last.length));
  }

  const firstForms = [firstParts.flat(), firstParts[0]];
  return before.some((said) =>
    firstForms.some(
      (held) =>
        editDistance(Array.from(said), held) <=
        allowedTypos(Math.min(said.length, held.length)),
    ),
  );
}

/** Lowercase letters only, accents dropped, one array of letters per word. */
function nameParts(name: string): string[][] {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .map((part) => Array.from(part));
}

function lastNameForms(name: string): string[][] {
  const parts = nameParts(name);
  const whole = parts.flat();
  if (whole.length === 0) return [];
  return parts.length > 1
    ? [
        whole,
        ...parts.filter((part) => part.length >= MIN_LAST_NAME_PART_LETTERS),
      ]
    : [whole];
}

function allowedTypos(letters: number): number {
  if (letters <= 3) return 0;
  return letters <= 5 ? 1 : 2;
}

/** Insertions, deletions and substitutions, letter by letter. */
function editDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}
