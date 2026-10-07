/**
 * Telephony utilities for initiating calls and parsing hotline & extension strings.
 */

export interface ParsedPhone {
  raw: string;
  mainPhone: string;
  extension: string;
  telUri: string;
  telUriWithExt: string;
  displayMain: string;
  displayExt: string;
}

/**
 * Cleans a phone number for standard dialing (preserves leading + for international).
 */
export function cleanPhoneNumber(raw: string | undefined | null): string {
  if (!raw) return '';
  let cleaned = String(raw).trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.slice(1).replace(/\+/g, '');
  } else {
    cleaned = cleaned.replace(/\+/g, '');
  }
  return cleaned;
}

/**
 * Parses hotline and extension strings, supporting either two separate fields or combined text.
 */
export function parsePhoneAndExtension(
  rawHotline: string | undefined | null,
  rawExt?: string | undefined | null
): ParsedPhone {
  const hotStr = (rawHotline || '').trim();
  let extStr = (rawExt || '').trim();

  let mainPart = hotStr;

  // If ext is not explicitly passed, attempt to extract from hotline string
  if (!extStr && hotStr) {
    const extMatch = hotStr.match(/(?:[,\s;]+|\s*\()(?:ext\.?|extension|ex\.?|x|#)?\s*[:\s-]*(\d+)\)?\s*$/i);
    if (extMatch && extMatch.index !== undefined && extMatch[1]) {
      mainPart = hotStr.slice(0, extMatch.index).trim();
      extStr = extMatch[1].trim();
    }
  }

  const cleanMain = cleanPhoneNumber(mainPart);
  const cleanExt = extStr.replace(/\D/g, '');

  const telUri = cleanMain ? `tel:${cleanMain}` : '#';
  const telUriWithExt = cleanExt ? (cleanMain ? `tel:${cleanMain},${cleanExt}` : '#') : telUri;

  return {
    raw: hotStr,
    mainPhone: cleanMain,
    extension: cleanExt,
    telUri,
    telUriWithExt,
    displayMain: mainPart,
    displayExt: cleanExt ? `Ext: ${cleanExt}` : (extStr ? `Ext: ${extStr}` : ''),
  };
}

/**
 * Returns a tel: URI ready to be used in <a href="...">.
 */
export function getTelUri(rawHotline: string | undefined | null, rawExt?: string | undefined | null): string {
  return parsePhoneAndExtension(rawHotline, rawExt).telUri;
}

/**
 * Programmatically initiates a phone call.
 */
export function initiatePhoneCall(numberOrHotline: string | undefined | null): boolean {
  if (!numberOrHotline) return false;
  const clean = cleanPhoneNumber(numberOrHotline);
  if (!clean) return false;
  const uri = `tel:${clean}`;

  try {
    const a = document.createElement('a');
    a.href = uri;
    a.target = '_top';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        if (a.parentNode) {
          a.parentNode.removeChild(a);
        }
      } catch {}
    }, 1000);
    return true;
  } catch {
    window.location.href = uri;
    return true;
  }
}
