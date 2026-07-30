(function attachMultipart(root, factory) {
  const multipart = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = multipart;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.multipart = multipart.createAssembler({ storage: root.SMSWeb.storage });
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
  const DEFAULT_COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1_000;

  function parsePart(value) {
    const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value || '');
    if (!match) {
      throw new Error('Multipart response must use PART/TOTAL numbering');
    }
    const partNumber = Number(match[1]);
    const totalParts = Number(match[2]);
    if (partNumber > totalParts) {
      throw new Error('Multipart part number cannot exceed total parts');
    }
    return { partNumber, totalParts };
  }

  function responseKey(response) {
    return [
      response.type,
      response.version,
      response.requestId,
      response.page,
      response.region
    ].join('|');
  }

  function sameMetadata(left, right) {
    return [
      'type',
      'version',
      'requestId',
      'page',
      'region',
      'trust',
      'source',
      'verifiedAt',
      'expiresAt',
      'totalParts'
    ].every((field) => left[field] === right[field]);
  }

  function createAssembler({
    storage,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    completedRetentionMs = DEFAULT_COMPLETED_RETENTION_MS
  }) {
    if (!storage) {
      return null;
    }

    async function cleanup(now) {
      const allParts = await storage.getAllResponseParts();
      const expired = allParts.filter((part) => now - part.receivedAt >= timeoutMs);
      await Promise.all(expired.map((part) => storage.removeResponsePart(part.partKey)));
      return expired.length;
    }

    async function accept(response, rawText, now = Date.now()) {
      const { partNumber, totalParts } = parsePart(response.part);
      const key = responseKey(response);
      const partKey = `${key}|${partNumber}`;
      const expiredPartCount = await cleanup(now);

      const completed = await storage.getCompletedResponse(key);
      if (completed) {
        if (now - completed.completedAt < completedRetentionMs) {
          return { status: 'duplicate', responseKey: key, expiredPartCount };
        }
        await storage.removeCompletedResponse(key);
      }

      const record = {
        ...response,
        responseKey: key,
        partKey,
        partNumber,
        totalParts,
        rawText,
        receivedAt: now
      };
      const existing = await storage.getResponsePart(partKey);
      if (existing && existing.rawText !== rawText) {
        throw new Error(`Conflicting content received for response part ${partNumber}/${totalParts}`);
      }
      if (!existing) {
        await storage.saveResponsePart(record);
      }

      const parts = (await storage.getAllResponseParts())
        .filter((part) => part.responseKey === key)
        .sort((left, right) => left.partNumber - right.partNumber);
      if (parts.some((part) => !sameMetadata(record, part))) {
        throw new Error('Multipart response fields changed between parts');
      }

      const receivedNumbers = new Set(parts.map((part) => part.partNumber));
      const missingParts = Array.from(
        { length: totalParts },
        (_unused, index) => index + 1
      ).filter((number) => !receivedNumbers.has(number));

      if (missingParts.length > 0) {
        return {
          status: existing ? 'duplicate-part' : 'pending',
          responseKey: key,
          receivedParts: receivedNumbers.size,
          totalParts,
          missingParts,
          expiredPartCount
        };
      }

      const separator = response.page === 'SHELTER' ? ';' : '';
      const assembled = {
        ...response,
        part: `1/1`,
        payload: parts.map((part) => part.payload).join(separator)
      };
      return {
        status: 'complete',
        responseKey: key,
        response: assembled,
        rawTexts: parts.map((part) => part.rawText),
        expiredPartCount
      };
    }

    async function complete(key, now = Date.now()) {
      const parts = (await storage.getAllResponseParts())
        .filter((part) => part.responseKey === key);
      await storage.saveCompletedResponse({
        responseKey: key,
        completedAt: now
      });
      await Promise.all(parts.map((part) => storage.removeResponsePart(part.partKey)));
    }

    return { accept, complete, cleanup };
  }

  return {
    DEFAULT_TIMEOUT_MS,
    DEFAULT_COMPLETED_RETENTION_MS,
    createAssembler,
    parsePart,
    responseKey
  };
});
