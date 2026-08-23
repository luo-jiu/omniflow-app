const SECRET_REPLACEMENT = '[REDACTED]';
const SIGNED_QUERY_REPLACEMENT = '[SIGNED_QUERY_REDACTED]';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const SIGNED_QUERY_KEY_PATTERN = /^(?:x-amz-|x-goog-|awsaccesskeyid$|credential$|expires$|googleaccessid$|key-pair-id$|policy$|se$|sig$|signature$|sp$|sr$|st$|sv$)/i;
const SENSITIVE_QUERY_KEY_PATTERN = /^(?:access_token|api[-_]?key|authorization|code|connect[._-]?sid|credential|id_token|jsessionid|oauth_token|password|phpsessid|refresh_token|secret|session[._-]?id|signature|token)$/i;
const TRAILING_URL_PUNCTUATION_PATTERN = /[),.;!?\u3002\uff0c\uff1b\uff01\uff1f\uff09\u3011]+$/;
const PRIVATE_KEY_PATTERN = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi;
const MAX_STRUCTURED_SANITIZE_DEPTH = 16;
const MAX_STRUCTURED_SANITIZE_NODES = 8_192;
const MAX_STRUCTURED_SANITIZE_ARRAY_ITEMS = 1_024;
const MAX_STRUCTURED_SANITIZE_OBJECT_PROPERTIES = 256;
const MAX_STRUCTURED_SANITIZE_STRING_CHARACTERS = 100_000;
const MAX_STRUCTURED_SANITIZE_KEY_CHARACTERS = 500;
const STRUCTURED_VALUE_OMITTED = '[UNSAFE_VALUE_OMITTED]';
const STRUCTURED_VALUE_TRUNCATED = '[VALUE_TRUNCATED]';
const UNSAFE_STRUCTURED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SENSITIVE_NORMALIZED_KEYS = new Set([
  'accountkey',
  'authorization',
  'authorizationcode',
  'awsaccesskeyid',
  'awssecretaccesskey',
  'awssessiontoken',
  'azureclientsecret',
  'azurestorageaccountkey',
  'clientsecret',
  'connectsid',
  'cookie',
  'credentials',
  'googleapplicationcredentials',
  'oauthcode',
  'password',
  'passwd',
  'privatekey',
  'proxyauthorization',
  'pwd',
  'sastoken',
  'sessionid',
  'setcookie',
  'token',
]);

function normalizeFieldName(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isAgentSensitiveFieldName(value: string): boolean {
  if (/^(?:密码|口令|API\s*密钥|访问令牌|刷新令牌|身份令牌|客户端密钥|私钥|授权码)$/i.test(
    String(value || '').trim(),
  )) return true;
  const normalized = normalizeFieldName(value);
  if (!normalized) return false;
  if (SENSITIVE_NORMALIZED_KEYS.has(normalized)) return true;
  return normalized.endsWith('apikey')
    || normalized.endsWith('accesstoken')
    || normalized.endsWith('refreshtoken')
    || normalized.endsWith('idtoken')
    || normalized.endsWith('sessiontoken')
    || normalized.endsWith('clientsecret')
    || normalized.endsWith('privatekey')
    || normalized.endsWith('secretaccesskey')
    || normalized.endsWith('accountkey')
    || normalized.endsWith('password')
    || normalized.endsWith('passwd')
    || normalized.endsWith('credential')
    || normalized.endsWith('credentials')
    || normalized.endsWith('authtoken')
    || normalized.endsWith('oauthtoken')
    || normalized.endsWith('githubpat')
    || normalized.endsWith('githubtoken')
    || normalized.endsWith('googleapikey')
    || normalized.endsWith('azureclientsecret');
}

function sanitizeUrlCandidate(candidate: string): string {
  const trailingPunctuation = candidate.match(TRAILING_URL_PUNCTUATION_PATTERN)?.[0] || '';
  const rawUrl = trailingPunctuation
    ? candidate.slice(0, -trailingPunctuation.length)
    : candidate;
  const rawQuery = rawUrl.split('?', 2)[1]?.split('#', 1)[0];
  if (rawQuery === SIGNED_QUERY_REPLACEMENT) return candidate;
  try {
    const parsed = new URL(rawUrl);
    const queryKeys = Array.from(parsed.searchParams.keys());
    const isSignedUrl = queryKeys.some(key => SIGNED_QUERY_KEY_PATTERN.test(key));
    const authority = `${parsed.protocol}//${parsed.host}`;
    const fragment = parsed.hash && SENSITIVE_QUERY_KEY_PATTERN.test(
      parsed.hash.slice(1).split('=', 1)[0] || '',
    )
      ? `#${SECRET_REPLACEMENT}`
      : parsed.hash;

    if (isSignedUrl) {
      return `${authority}${parsed.pathname}?${SIGNED_QUERY_REPLACEMENT}${fragment}${trailingPunctuation}`;
    }

    let changed = Boolean(parsed.username || parsed.password);
    queryKeys.forEach((key) => {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
        parsed.searchParams.set(key, SECRET_REPLACEMENT);
        changed = true;
      }
    });
    if (fragment !== parsed.hash) changed = true;
    if (!changed) return candidate;
    parsed.username = '';
    parsed.password = '';
    return `${parsed.toString()}${trailingPunctuation}`;
  } catch {
    return candidate;
  }
}

function sanitizeQuotedAssignments(value: string): string {
  const sanitizeDoubleQuoted = value.replace(
    /("([^"\r\n]{1,100})"\s*:\s*")((?:\\.|[^"\\\r\n])*)"/g,
    (match, prefix: string, key: string) => (
      isAgentSensitiveFieldName(key) ? `${prefix}${SECRET_REPLACEMENT}"` : match
    ),
  );
  return sanitizeDoubleQuoted.replace(
    /('([^'\r\n]{1,100})'\s*:\s*')((?:\\.|[^'\\\r\n])*)'/g,
    (match, prefix: string, key: string) => (
      isAgentSensitiveFieldName(key) ? `${prefix}${SECRET_REPLACEMENT}'` : match
    ),
  );
}

function sanitizeAssignments(value: string): string {
  const redact = (
    match: string,
    key: string,
    separator: string,
    doubleQuoted: string | undefined,
    singleQuoted: string | undefined,
    unquoted: string | undefined,
  ): string => {
    if (!isAgentSensitiveFieldName(key)) return match;
    if (doubleQuoted !== undefined) return `${key}${separator}"${SECRET_REPLACEMENT}"`;
    if (singleQuoted !== undefined) return `${key}${separator}'${SECRET_REPLACEMENT}'`;
    const normalizedUnquoted = String(unquoted || '').trim();
    if (
      normalizedUnquoted === SECRET_REPLACEMENT
    ) return match;
    return `${key}${separator}${SECRET_REPLACEMENT}`;
  };
  const identifierAssignments = value.replace(
    /\b([A-Za-z][A-Za-z0-9_.-]{0,100})(\s*(?::|=|\bis\b)\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\r\n,;}]*?))(?=\s+[A-Za-z][A-Za-z0-9_.-]{0,100}\s*(?::|=)|[\r\n,;}]|$)/gi,
    redact,
  );
  const humanReadableAssignments = identifierAssignments.replace(
    /\b(api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|id[\s_-]*token|client[\s_-]*secret|secret[\s_-]*access[\s_-]*key|private[\s_-]*key)(\s*(?::|=|\bis\b)\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\r\n,;}]*?))(?=\s+[A-Za-z][A-Za-z0-9_.-]{0,100}\s*(?::|=)|[\r\n,;}]|$)/gi,
    redact,
  );
  return humanReadableAssignments.replace(
    /(密码|口令|API\s*密钥|访问令牌|刷新令牌|身份令牌|客户端密钥|私钥|授权码)(\s*(?::|：|=|是|为)\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\r\n,，;；。}]{4,}?))(?=[\r\n,，;；。}]|$)/g,
    (match, key: string, separator: string, doubleQuoted, singleQuoted, unquoted) => (
      redact(match, key, separator, doubleQuoted, singleQuoted, unquoted)
    ),
  );
}

export function sanitizeAgentSensitiveText(value: string): string {
  let sanitized = String(value || '').replace(
    PRIVATE_KEY_PATTERN,
    `[PRIVATE KEY ${SECRET_REPLACEMENT}]`,
  );
  sanitized = sanitized.replace(URL_PATTERN, sanitizeUrlCandidate);
  sanitized = sanitizeQuotedAssignments(sanitized);
  sanitized = sanitized.replace(
    /\b((?:proxy-)?authorization\s*:\s*)[^\r\n]*/gi,
    `$1${SECRET_REPLACEMENT}`,
  );
  sanitized = sanitized.replace(
    /\b((?:set-cookie|cookie)\s*:\s*)[^\r\n]*/gi,
    `$1${SECRET_REPLACEMENT}`,
  );
  sanitized = sanitizeAssignments(sanitized);
  sanitized = sanitized.replace(
    /\b(?:bearer|basic|apikey)\s+[a-z0-9._~+/=-]{4,}/gi,
    SECRET_REPLACEMENT,
  );
  sanitized = sanitized.replace(
    /\bsk-(?:ant-[a-z0-9_-]+|proj-[a-z0-9_-]+|[a-z0-9_-]{10,})\b/gi,
    SECRET_REPLACEMENT,
  );
  sanitized = sanitized.replace(
    /\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})\b/gi,
    SECRET_REPLACEMENT,
  );
  sanitized = sanitized.replace(
    /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
    SECRET_REPLACEMENT,
  );
  sanitized = sanitized.replace(
    /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    SECRET_REPLACEMENT,
  );
  sanitized = sanitized.replace(
    /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/g,
    SECRET_REPLACEMENT,
  );
  sanitized = sanitized.replace(
    /\beyj[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\b/gi,
    SECRET_REPLACEMENT,
  );
  return sanitized;
}

export function containsAgentSensitiveData(value: string): boolean {
  const source = String(value || '');
  return sanitizeAgentSensitiveText(source) !== source;
}

export function sanitizeAgentSensitiveValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  const sanitize = (current: unknown, depth: number): unknown => {
    visitedNodes += 1;
    if (visitedNodes > MAX_STRUCTURED_SANITIZE_NODES || depth > MAX_STRUCTURED_SANITIZE_DEPTH) {
      return STRUCTURED_VALUE_OMITTED;
    }
    if (typeof current === 'string') {
      const bounded = current.length > MAX_STRUCTURED_SANITIZE_STRING_CHARACTERS
        ? `${current.slice(0, MAX_STRUCTURED_SANITIZE_STRING_CHARACTERS)}${STRUCTURED_VALUE_TRUNCATED}`
        : current;
      return sanitizeAgentSensitiveText(bounded);
    }
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') return Number.isFinite(current) ? current : null;
    if (current === undefined) return null;
    if (!current || typeof current !== 'object') return `[UNSUPPORTED_${typeof current}]`;
    if (seen.has(current)) return STRUCTURED_VALUE_OMITTED;
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        const items = current
          .slice(0, MAX_STRUCTURED_SANITIZE_ARRAY_ITEMS)
          .map(item => sanitize(item, depth + 1));
        if (current.length > MAX_STRUCTURED_SANITIZE_ARRAY_ITEMS) {
          items.push(STRUCTURED_VALUE_TRUNCATED);
        }
        return items;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        return STRUCTURED_VALUE_OMITTED;
      }
      const output: Record<string, unknown> = Object.create(null);
      let propertyCount = 0;
      let truncated = false;
      let unsafePropertyOmitted = false;
      for (const key in current as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        if (propertyCount >= MAX_STRUCTURED_SANITIZE_OBJECT_PROPERTIES) {
          truncated = true;
          break;
        }
        propertyCount += 1;
        if (UNSAFE_STRUCTURED_KEYS.has(key)) {
          unsafePropertyOmitted = true;
          continue;
        }
        const boundedKey = key.length > MAX_STRUCTURED_SANITIZE_KEY_CHARACTERS
          ? key.slice(0, MAX_STRUCTURED_SANITIZE_KEY_CHARACTERS)
          : key;
        const sanitizedKey = sanitizeAgentSensitiveText(boundedKey) || '[REDACTED_KEY]';
        const sensitiveKey = key.length > MAX_STRUCTURED_SANITIZE_KEY_CHARACTERS
          || isAgentSensitiveFieldName(key)
          || containsAgentSensitiveData(`${key}=omniflow-sensitive-value`)
          || containsAgentSensitiveData(key);
        output[sanitizedKey] = sensitiveKey
          ? SECRET_REPLACEMENT
          : sanitize((current as Record<string, unknown>)[key], depth + 1);
      }
      if (truncated) output._omniflowSanitized = STRUCTURED_VALUE_TRUNCATED;
      if (unsafePropertyOmitted) output._omniflowUnsafeProperties = STRUCTURED_VALUE_OMITTED;
      return output;
    } catch {
      return STRUCTURED_VALUE_OMITTED;
    } finally {
      seen.delete(current);
    }
  };

  return sanitize(value, 0);
}
