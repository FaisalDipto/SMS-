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
    'HELP'
  ]);
  const RESPONSE_PAGES = new Set([
    'HOME',
    'SHELTER',
    'MED',
    'ROAD',
    'REPORT',
    'HELP',
    'ALERTS'
  ]);
  const ALERT_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

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

    if (fields.length !== 7 || fields[0] !== 'RES') {
      throw protocolError('response must contain RES and six fields');
    }

    const [, version, requestId, page, part, region, payload] = fields;
    validateVersion(version);
    validateIdentifier(requestId, 'request ID');

    if (!RESPONSE_PAGES.has(page)) {
      throw protocolError(`unknown page: ${page}`);
    }

    parsePart(part);
    validateRegion(region);
    requireText(payload, 'payload', { allowEmpty: true });

    return {
      type: 'RES',
      version,
      requestId,
      page,
      part,
      region,
      payload
    };
  }

  function parseAlert(text) {
    const fields = splitFields(requireText(text, 'message'));

    if (fields.length !== 7 || fields[0] !== 'ALT') {
      throw protocolError('alert must contain ALT and six fields');
    }

    const [, version, alertId, priority, expires, region, message] = fields;
    validateVersion(version);
    validateIdentifier(alertId, 'alert ID');

    if (!ALERT_PRIORITIES.has(priority)) {
      throw protocolError(`unknown priority: ${priority}`);
    }

    if (!/^\d+$/.test(expires) || Number(expires) <= 0) {
      throw protocolError('expires must be a positive Unix timestamp');
    }

    validateRegion(region);
    requireText(message, 'message');

    return {
      type: 'ALT',
      version,
      alertId,
      priority,
      expires: Number(expires),
      region,
      message
    };
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

    return [
      'RES',
      version,
      response.requestId,
      response.page,
      response.part,
      response.region,
      response.payload
    ].map((field, index) => index === 0 ? field : escapeField(field, 'response field')).join('|');
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

    return [
      'ALT',
      version,
      alert.alertId,
      alert.priority,
      String(alert.expires),
      alert.region,
      alert.message
    ].map((field, index) => index === 0 ? field : escapeField(field, 'alert field')).join('|');
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
