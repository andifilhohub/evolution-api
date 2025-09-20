import Long from 'long';

export interface ReplyContextInfo {
  stanzaId: string | null;
  quotedMessageRaw: any | null;
  quotedMessage: any | null;
}

const isTypedArray = (value: unknown): value is Uint8Array => {
  if (!value) {
    return false;
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return true;
  }

  return ArrayBuffer.isView(value) && !(value instanceof DataView);
};

const toBase64Payload = (value: Uint8Array | Buffer) => {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);

  return {
    type: value.constructor?.name ?? 'Uint8Array',
    encoding: 'base64',
    data: buffer.toString('base64'),
  };
};

export const normalizeBaileysObject = (value: any, seen: WeakSet<object> = new WeakSet()): any => {
  if (value === null || value === undefined) {
    return value;
  }

  if (Long.isLong(value)) {
    return value.toNumber();
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return toBase64Payload(value);
  }

  if (isTypedArray(value)) {
    return toBase64Payload(value as Uint8Array);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeBaileysObject(item, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);

    const result: Record<string, any> = {};

    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeBaileysObject(nested, seen);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }

    return result;
  }

  return value;
};

export const extractReplyContextInfo = (message: any): ReplyContextInfo => {
  if (!message) {
    return { stanzaId: null, quotedMessageRaw: null, quotedMessage: null };
  }

  const contextInfo =
    message?.message?.extendedTextMessage?.contextInfo ?? message?.message?.contextInfo ?? message?.contextInfo ?? null;

  const stanzaId = contextInfo?.stanzaId ?? null;
  const quotedMessageRaw = contextInfo?.quotedMessage ?? null;

  return {
    stanzaId: stanzaId ?? null,
    quotedMessageRaw,
    quotedMessage: quotedMessageRaw ? normalizeBaileysObject(quotedMessageRaw) : null,
  };
};

export const hasStoryQuotedMessage = (quotedMessage: any): boolean => {
  if (!quotedMessage) {
    return false;
  }

  const storyKeys = ['storyReplyMessage', 'statusMessage', 'storyMentionedJidList', 'storyInvite'];

  return storyKeys.some((key) => Object.prototype.hasOwnProperty.call(quotedMessage, key));
};
