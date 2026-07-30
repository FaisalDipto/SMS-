(function attachProtocol(root, factory) {
  const protocol = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = protocol;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.protocol = protocol;
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const VERSION = '1';
  const REQUEST_COMMANDS = new Set([
    'HOME',
    'SHELTER',
    'MED',
    'ROAD',
    'REPORT',
    'HELP',
    'ALERT',
    'HAZARD'
  ]);
  const RESPONSE_PAGES = new Set([
    'HOME',
    'SHELTER',
    'MED',
    'ROAD',
    'REPORT',
    'HELP',
    'ALERTS',
    'HAZARD'
  ]);
  const ALERT_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  const RESPONSE_TRUST_LEVELS = new Set(['VERIFIED', 'DEMO', 'UNVERIFIED']);
  const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

  function protocolError(message) {
    return new Error(`Invalid SMS protocol message: ${message}`);
  }

  function requireText(value, field, { allowEmpty = false } = {}) {
    if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
      throw protocolError(`${field} must be a non-empty string`);
    }

    return value;
  }

  function validateVersion(version) {
    if (version !== VERSION) {
      throw protocolError(`unsupported version: ${version}`);
    }
  }

  function validateIdentifier(value, field) {
    requireText(value, field);

    if (!/^[A-Z0-9]{2,16}$/.test(value)) {
      throw protocolError(`${field} must contain 2-16 uppercase letters or numbers`);
    }
  }

  function validateRegion(region) {
    requireText(region, 'region');

    if (region !== '-' && !/^[A-Z0-9_-]{1,12}$/.test(region)) {
      throw protocolError('region must be a compact uppercase code');
    }
  }

  function validateResponseMetadata({ trust, source, verifiedAt, expiresAt }) {
    if (!RESPONSE_TRUST_LEVELS.has(trust)) {
      throw protocolError(`unknown response trust level: ${trust}`);
    }
    if (typeof source !== 'string' || !/^[A-Z0-9_-]{2,24}$/.test(source)) {
      throw protocolError('source must contain 2-24 uppercase letters, numbers, underscores, or hyphens');
    }
    if (!Number.isInteger(verifiedAt) || verifiedAt <= 0) {
      throw protocolError('verifiedAt must be a positive Unix timestamp');
    }
    if (!Number.isInteger(expiresAt) || expiresAt <= verifiedAt) {
      throw protocolError('expiresAt must be later than verifiedAt');
    }
  }

  function validateSignature(signature) {
    if (!SIGNATURE_PATTERN.test(signature)) {
      throw protocolError('signature must be a 128-bit URL-safe HMAC tag');
    }
  }

  function escapeField(value, field) {
    requireText(value, field, { allowEmpty: true });
    return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|');
  }

  function splitFields(text) {
    const fields = [];
    let field = '';
    let escaped = false;

    for (const character of text.trim()) {
      if (escaped) {
        if (character !== '|' && character !== '\\') {
          throw protocolError(`unsupported escape sequence: \\${character}`);
        }

        field += character;
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '|') {
        fields.push(field);
        field = '';
      } else {
        field += character;
      }
    }

    if (escaped) {
      throw protocolError('message ends with an incomplete escape sequence');
    }

    fields.push(field);
    return fields;
  }

  function parsePart(part) {
    if (!/^([1-9]\d*)\/([1-9]\d*)$/.test(part)) {
      throw protocolError('part must use the PART/TOTAL format');
    }

    const [partNumber, totalParts] = part.split('/').map(Number);

    if (partNumber > totalParts) {
      throw protocolError('part number cannot exceed the total parts');
    }

    return { partNumber, totalParts };
  }

  function parseRequest(text) {
    const fields = splitFields(requireText(text, 'message'));

    if (fields.length !== 5 || fields[0] !== 'REQ') {
      throw protocolError('request must contain REQ and four fields');
    }

    const [, version, requestId, command, args] = fields;
    validateVersion(version);
    validateIdentifier(requestId, 'request ID');

    if (!REQUEST_COMMANDS.has(command)) {
      throw protocolError(`unknown command: ${command}`);
    }

    requireText(args, 'arguments');

    return {
      type: 'REQ',
      version,
      requestId,
      command,
      arguments: args
    };
  }

  function parseResponse(text) {
    const fields = splitFields(requireText(text, 'message'));

    if (![7, 8, 11, 12].includes(fields.length) || fields[0] !== 'RES') {
      throw protocolError('response must use the legacy or metadata response format');
    }

    const [, version, requestId, page, part, region] = fields;
    const hasMetadata = fields.length >= 11;
    const hasSignature = fields.length === 8 || fields.length === 12;
    const payload = fields[fields.length - (hasSignature ? 2 : 1)];
    const signature = hasSignature ? fields[fields.length - 1] : undefined;
    validateVersion(version);
    validateIdentifier(requestId, 'request ID');

    if (!RESPONSE_PAGES.has(page)) {
      throw protocolError(`unknown page: ${page}`);
    }

    parsePart(part);
    validateRegion(region);
    requireText(payload, 'payload', { allowEmpty: true });
    if (signature) validateSignature(signature);

    const response = {
      type: 'RES',
      version,
      requestId,
      page,
      part,
      region,
      payload
    };
    if (hasMetadata) {
      const trust = fields[6];
      const source = fields[7];
      const verifiedAt = Number(fields[8]);
      const expiresAt = Number(fields[9]);
      validateResponseMetadata({ trust, source, verifiedAt, expiresAt });
      Object.assign(response, { trust, source, verifiedAt, expiresAt });
    }
    if (signature) response.signature = signature;
    return response;
  }

  function parseAlert(text) {
    const fields = splitFields(requireText(text, 'message'));

    if (![7, 8, 9].includes(fields.length) || fields[0] !== 'ALT') {
      throw protocolError('alert must contain a supported ALT response');
    }

    const correlated = fields.length === 9 ||
      (fields.length === 8 && !ALERT_PRIORITIES.has(fields[3]));
    const version = fields[1];
    const requestId = correlated ? fields[2] : undefined;
    const alertId = fields[correlated ? 3 : 2];
    const priority = fields[correlated ? 4 : 3];
    const expires = fields[correlated ? 5 : 4];
    const region = fields[correlated ? 6 : 5];
    const message = fields[correlated ? 7 : 6];
    const signature = fields[correlated ? 8 : 7];
    validateVersion(version);
    if (requestId) validateIdentifier(requestId, 'request ID');
    validateIdentifier(alertId, 'alert ID');

    if (!ALERT_PRIORITIES.has(priority)) {
      throw protocolError(`unknown priority: ${priority}`);
    }

    if (!/^\d+$/.test(expires) || Number(expires) <= 0) {
      throw protocolError('expires must be a positive Unix timestamp');
    }

    validateRegion(region);
    requireText(message, 'message');
    if (signature) validateSignature(signature);

    const alert = {
      type: 'ALT',
      version,
      alertId,
      priority,
      expires: Number(expires),
      region,
      message
    };
    if (requestId) alert.requestId = requestId;
    if (signature) alert.signature = signature;
    return alert;
  }

  function serializeRequest(request) {
    const version = request.version ?? VERSION;
    const args = request.arguments ?? request.argument;

    validateVersion(version);
    validateIdentifier(request.requestId, 'request ID');

    if (!REQUEST_COMMANDS.has(request.command)) {
      throw protocolError(`unknown command: ${request.command}`);
    }

    requireText(args, 'arguments');

    return [
      'REQ',
      version,
      request.requestId,
      request.command,
      args
    ].map((field, index) => index === 0 ? field : escapeField(field, 'request field')).join('|');
  }

  function serializeResponse(response) {
    const version = response.version ?? VERSION;

    validateVersion(version);
    validateIdentifier(response.requestId, 'request ID');

    if (!RESPONSE_PAGES.has(response.page)) {
      throw protocolError(`unknown page: ${response.page}`);
    }

    parsePart(response.part);
    validateRegion(response.region);
    requireText(response.payload, 'payload', { allowEmpty: true });

    const fields = [
      'RES',
      version,
      response.requestId,
      response.page,
      response.part,
      response.region
    ];
    const metadataFields = [response.trust, response.source, response.verifiedAt, response.expiresAt];
    const hasMetadata = metadataFields.some((value) => value !== undefined && value !== null);
    if (hasMetadata) {
      const metadata = {
        trust: response.trust,
        source: response.source,
        verifiedAt: Number(response.verifiedAt),
        expiresAt: Number(response.expiresAt)
      };
      validateResponseMetadata(metadata);
      fields.push(
        metadata.trust,
        metadata.source,
        String(metadata.verifiedAt),
        String(metadata.expiresAt)
      );
    }
    fields.push(response.payload);
    if (response.signature !== undefined) {
      validateSignature(response.signature);
      fields.push(response.signature);
    }
    return fields.map((field, index) => index === 0 ? field : escapeField(field, 'response field')).join('|');
  }

  function serializeAlert(alert) {
    const version = alert.version ?? VERSION;

    validateVersion(version);
    validateIdentifier(alert.alertId, 'alert ID');

    if (!ALERT_PRIORITIES.has(alert.priority)) {
      throw protocolError(`unknown priority: ${alert.priority}`);
    }

    if (!Number.isInteger(alert.expires) || alert.expires <= 0) {
      throw protocolError('expires must be a positive Unix timestamp');
    }

    validateRegion(alert.region);
    requireText(alert.message, 'message');

    const fields = [
      'ALT',
      version
    ];
    if (alert.requestId !== undefined) {
      validateIdentifier(alert.requestId, 'request ID');
      fields.push(alert.requestId);
    }
    fields.push(
      alert.alertId,
      alert.priority,
      String(alert.expires),
      alert.region,
      alert.message
    );
    if (alert.signature !== undefined) {
      validateSignature(alert.signature);
      fields.push(alert.signature);
    }
    return fields.map((field, index) => index === 0 ? field : escapeField(field, 'alert field')).join('|');
  }

  return {
    VERSION,
    parseRequest,
    parseResponse,
    parseAlert,
    serializeRequest,
    serializeResponse,
    serializeAlert,
    escapeField
  };
});
