import { base32Decode } from './base32';
import type { Algorithm } from './types';

/**
 * `otpauth://` URI 解析（Google Authenticator Key Uri Format）。
 *
 * 解析这件事的难点不在正常输入，而在**别人家生成的畸形输入**：
 * 手抄的、老版本导出的、别的 App 转存过的，什么都有。所以这里的策略是
 * 能确定语义的就修，语义上不可能的就报错 —— 而且报错要能说清"哪一项不对"，
 * 否则用户手里只有一条二维码，除了"失败了"什么也做不了。
 *
 * 不用 `new URL`：对非特殊 scheme，各引擎对 `otpauth://totp/ACME:alice`
 * 这种"带冒号的 path"处理不一致，路径里混进未编码的 `?`/`#` 时行为更难预料。
 * 手写切分反而是可以逐条测试的。
 */

export interface OtpAuthParams {
  issuer: string;
  account: string;
  secret: string;
  algorithm: Algorithm;
  digits: 6 | 8;
  period: number;
}

export type OtpAuthProblem =
  | 'not-otpauth'
  | 'unsupported-type'
  | 'missing-secret'
  | 'bad-secret'
  | 'bad-algorithm'
  | 'bad-digits'
  | 'bad-period';

export class OtpAuthError extends Error {
  constructor(
    readonly problem: OtpAuthProblem,
    message: string,
  ) {
    super(message);
    this.name = 'OtpAuthError';
  }
}

const ALGORITHMS: Record<string, Algorithm> = {
  SHA1: 'SHA1',
  SHA256: 'SHA256',
  SHA512: 'SHA512',
};

/** 单条 URI 的长度上限。真二维码不会这么大，超出说明不是我们在找的东西。 */
const MAX_URI_LENGTH = 4096;

/** `decodeURIComponent` 遇到坏转义会抛错，而畸形输入里这种很常见 */
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** query 里可能有人把空格写成 `+`（表单编码的习惯），显示成字面量 `+` 是错的 */
function decodeQueryValue(raw: string): string {
  return decode(raw.replace(/\+/g, ' '));
}

function splitQuery(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    const name = decodeQueryValue(key).trim().toLowerCase();
    // 重复参数取第一个：规范的 URI 不会重复，重复多半是拼接出错
    if (name && !params.has(name)) params.set(name, decodeQueryValue(value));
  }
  return params;
}

/**
 * 切 label。
 *
 * 规范写法是 `issuer:account`（冒号也常被百分号编码成 `%3A`）。
 * 冒号在 issuer 里出现的可能性远低于 account，所以**按第一个冒号切**：
 * `Example:me@example.com` → issuer `Example`。
 * 但 `Example:Corp:alice` 这种也是有的，第一个冒号切完 account 里还剩冒号，
 * 那仍然是对的（account 允许有冒号）。
 */
function splitLabel(label: string): { issuer: string; account: string } {
  const colon = label.indexOf(':');
  if (colon < 0) return { issuer: '', account: label.trim() };
  return {
    issuer: label.slice(0, colon).trim(),
    account: label.slice(colon + 1).trim(),
  };
}

export function parseOtpauth(input: string): OtpAuthParams {
  const uri = input.trim();
  if (uri.length > MAX_URI_LENGTH) {
    throw new OtpAuthError('not-otpauth', '内容太长，不像是一条 otpauth 地址');
  }
  // 协议名大小写不敏感（`OTPAUTH://` 真的出现过），但除此之外必须是它
  const schemeMatch = /^otpauth:\/\//i.exec(uri);
  if (!schemeMatch) {
    throw new OtpAuthError('not-otpauth', '这不是一条 otpauth 地址');
  }

  const rest = uri.slice(schemeMatch[0].length);
  const questionMark = rest.indexOf('?');
  const head = questionMark < 0 ? rest : rest.slice(0, questionMark);
  const query = questionMark < 0 ? '' : rest.slice(questionMark + 1);

  const slash = head.indexOf('/');
  const type = (slash < 0 ? head : head.slice(0, slash)).trim().toLowerCase();
  const rawLabel = slash < 0 ? '' : head.slice(slash + 1);
  if (type !== 'totp') {
    // HOTP 是计数器式的，没有时间概念，硬按 TOTP 算出来的码永远是错的
    throw new OtpAuthError(
      'unsupported-type',
      type === 'hotp'
        ? '这是 HOTP（计数器）二维码，本扩展只支持基于时间的 TOTP'
        : `不认识的验证码类型「${type || '(空)'}」`,
    );
  }

  const params = splitQuery(query);
  const label = splitLabel(decode(rawLabel));

  // issuer 参数优先于 label 里的前缀：规范就是这么定的，
  // 而且 label 被各种客户端改写过的概率明显更高
  const paramIssuer = (params.get('issuer') ?? '').trim();
  const issuer = paramIssuer || label.issuer;
  const account = label.account;

  const rawSecret = params.get('secret');
  if (!rawSecret) {
    throw new OtpAuthError('missing-secret', '这条地址里没有密钥（secret）');
  }
  // 密钥里允许出现空格和连字符（有人手工分组写成 4 位一组），一起去掉
  const secret = rawSecret.replace(/[\s-]/g, '').toUpperCase();
  try {
    if (base32Decode(secret).length === 0) throw new Error('empty');
  } catch {
    // 报错信息里绝不回显密钥本身：这类消息会被日志、截图、错误上报带走
    throw new OtpAuthError('bad-secret', '密钥不是合法的 base32，请核对后重新输入');
  }

  const rawAlgorithm = (params.get('algorithm') ?? '').trim().toUpperCase();
  const algorithm = rawAlgorithm ? ALGORITHMS[rawAlgorithm] : 'SHA1';
  if (!algorithm) {
    throw new OtpAuthError('bad-algorithm', `不支持的算法「${rawAlgorithm}」，只能是 SHA1 / SHA256 / SHA512`);
  }

  const rawDigits = (params.get('digits') ?? '').trim();
  const digits = rawDigits === '' ? 6 : rawDigits === '6' ? 6 : rawDigits === '8' ? 8 : null;
  if (digits === null) {
    throw new OtpAuthError('bad-digits', `不支持的位数「${rawDigits}」，只能是 6 或 8`);
  }

  const rawPeriod = (params.get('period') ?? '').trim();
  let period = 30;
  if (rawPeriod !== '') {
    // 只接受纯数字：`30s`、`30.0` 这类要么是别人写错，要么是我们没想到的方言
    if (!/^\d+$/.test(rawPeriod)) {
      throw new OtpAuthError('bad-period', `周期「${rawPeriod}」不是秒数`);
    }
    period = Number(rawPeriod);
    if (period < 1 || period > 3600) {
      throw new OtpAuthError('bad-period', '周期必须在 1 到 3600 秒之间');
    }
  }

  return { issuer, account, secret, algorithm, digits, period };
}

/**
 * 从一段任意文本里挑出 otpauth 地址。
 *
 * 扫码/粘贴进来的东西经常是"有人把 URI 和别的话一起发过来了"，
 * 严格按整串匹配会白跑一趟。这里只做一件事：找出所有 `otpauth://` 开头、
 * 到空白为止的片段。找不到就返回空数组，由调用方决定怎么提示。
 */
export function findOtpauthUris(text: string): string[] {
  const found: string[] = [];
  const pattern = /otpauth:\/\/[^\s"'<>]+/gi;
  for (const match of text.matchAll(pattern)) {
    // 句末标点常被一起复制进来，尾部的 `)`、`.` 不是 URI 的一部分
    const cleaned = match[0].replace(/[),.;]+$/, '');
    if (cleaned.length > 'otpauth://'.length) found.push(cleaned);
  }
  return found;
}
