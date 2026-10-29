import { useCallback } from 'react';
import { ImportError } from '@/core/backup';
import type { ImportNote, SkipReason } from '@/core/backup';
import { CryptoError } from '@/core/crypto';
import type { PasswordIssue } from '@/core/crypto';
import type { Diagnostic } from '@/core/diagnostics';
import { MigrationError } from '@/core/migration';
import { OtpAuthError } from '@/core/otpauth';
import { QrError } from '@/platform/qr';
import { useT } from './i18n';
import type { MessageKey, Vars } from './i18n';

/**
 * 错误 → 界面文案。
 *
 * 数据层只报"哪一类失败"（`reason` / `problem` / `code`），到这里才决定怎么说、
 * 说成哪种语言。这样做有两个直接后果，都是我们要的：
 *
 * 1. **同一份错误能在两种语言界面里都说对**，不需要在每个 `throw` 旁边写两份文案。
 * 2. **错误对象里一个用户数据都没有**。`OtpAuthError` 只带 `problem`，
 *    `CryptoError` 只带 `reason`，所以这些对象就算被日志、崩溃报告带走，
 *    也不会连带把密钥送出去。
 */

/** 一次要说的话：键 + 插值变量，交给 `useT()` 去拼 */
export interface Message {
  key: MessageKey;
  /** 显式带上 `undefined`：要能把 `describeError()` 的结果原样转发，见 store 的 showToast */
  vars?: Vars | undefined;
}

/**
 * 界面层自己的错误：文件太大之类**只有界面知道**的前提条件。
 * 它带的是键而不是句子，所以还是那句老话 —— 文案只有一个出处。
 */
export class UiError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
    this.name = 'UiError';
  }
}

/**
 * 说话的场景。只有 `wrong-key` 一条需要区分：
 * 解保险库是"密码不对"，解备份是"密码不对或文件损坏"，
 * 后者多做一句解释是有用的 —— 用户手里那份文件可能真的坏了。
 */
export type ErrorScene = 'general' | 'import';

const FALLBACK: Message = { key: 'error.unknown' };

export function describeError(cause: unknown, scene: ErrorScene = 'general'): Message {
  if (cause instanceof UiError) return { key: cause.key };

  if (cause instanceof CryptoError) {
    switch (cause.reason) {
      case 'wrong-key':
        return { key: scene === 'import' ? 'error.wrong-export-password' : 'error.wrong-key' };
      case 'malformed':
        return { key: scene === 'import' ? 'error.import-malformed' : 'error.data-malformed' };
      case 'unsupported-version':
        return { key: 'error.unsupported-version' };
    }
  }

  if (cause instanceof ImportError) {
    switch (cause.reason) {
      case 'not-export':
        return { key: 'error.import-not-export' };
      case 'unsupported-version':
        return { key: 'error.import-unsupported-version' };
      case 'malformed':
        return { key: 'error.import-malformed' };
      case 'encrypted':
        return { key: 'error.import-encrypted' };
      case 'empty':
        return { key: 'error.import-empty' };
    }
  }

  if (cause instanceof MigrationError) {
    switch (cause.reason) {
      case 'not-migration':
        return { key: 'error.not-migration' };
      case 'unsupported-version':
        return { key: 'error.import-migration-version' };
      case 'malformed':
        return { key: 'error.import-migration-malformed' };
    }
  }

  if (cause instanceof OtpAuthError) return describeOtpAuth(cause.problem, cause.value);

  if (cause instanceof QrError) {
    return { key: cause.reason === 'not-image' ? 'error.qr-not-image' : 'error.qr-no-code' };
  }

  if (scene === 'import') return { key: 'import.error.generic' };
  return FALLBACK;
}

function describeOtpAuth(problem: OtpAuthError['problem'], value: string | null): Message {
  switch (problem) {
    case 'not-otpauth':
      return { key: 'error.not-otpauth' };
    case 'unsupported-type':
      return { key: 'error.otpauth-unsupported-type', vars: { value: value ?? '' } };
    case 'missing-secret':
      return { key: 'error.otpauth-missing-secret' };
    case 'bad-secret':
      return { key: 'error.otpauth-bad-secret' };
    case 'bad-algorithm':
      return { key: 'error.otpauth-bad-algorithm', vars: { value: value ?? '' } };
    case 'bad-digits':
      return { key: 'error.otpauth-bad-digits', vars: { value: value ?? '' } };
    case 'bad-period':
      return { key: 'error.otpauth-bad-period' };
  }
}

/** 密码强度里的一条。`min` / `actual` 是数字，插进同一句话里 */
export function describePasswordIssue(issue: PasswordIssue): Message {
  switch (issue.code) {
    case 'too-short':
      return { key: 'password.too-short', vars: { min: issue.min, actual: issue.actual } };
    case 'repeated':
      return { key: 'password.repeated' };
  }
}

/**
 * 导入过程中"第几条读不出来"。
 *
 * 迁移码里的 `label` 可能是空串（那一项既没有 issuer 也没有账户名），
 * 这时换成按序号说话的版本 —— 否则会出现「  是 HOTP」这种少半句的提示。
 */export function describeDiagnostic(diagnostic: Diagnostic): Message {
  switch (diagnostic.code) {
    case 'entry-not-object':
      return { key: 'import.issue.entry-not-object', vars: { index: diagnostic.index + 1 } };
    case 'entry-bad-secret':
      return { key: 'import.issue.entry-bad-secret', vars: { index: diagnostic.index + 1 } };
    case 'migration-no-secret':
      return { key: 'import.issue.migration-no-secret', vars: { index: diagnostic.index + 1 } };
    case 'migration-hotp':
      return {
        key: diagnostic.label
          ? 'import.issue.migration-hotp'
          : 'import.issue.migration-hotp-nameless',
        vars: { label: diagnostic.label, index: diagnostic.index + 1 },
      };
    case 'migration-unknown-type':
      return {
        key: diagnostic.label
          ? 'import.issue.migration-unknown-type'
          : 'import.issue.migration-unknown-type-nameless',
        vars: { label: diagnostic.label, index: diagnostic.index + 1, value: diagnostic.value },
      };
    case 'migration-md5':
      return {
        key: diagnostic.label ? 'import.issue.migration-md5' : 'import.issue.migration-md5-nameless',
        vars: { label: diagnostic.label, index: diagnostic.index + 1 },
      };
    case 'uri-not-otpauth':
      return { key: 'import.issue.uri-not-otpauth' };
    case 'uri-unsupported-type':
      return { key: 'import.issue.uri-unsupported-type', vars: { value: diagnostic.value } };
    case 'uri-missing-secret':
      return { key: 'import.issue.uri-missing-secret' };
    case 'uri-bad-secret':
      return { key: 'import.issue.uri-bad-secret' };
    case 'uri-bad-algorithm':
      return { key: 'import.issue.uri-bad-algorithm', vars: { value: diagnostic.value } };
    case 'uri-bad-digits':
      return { key: 'import.issue.uri-bad-digits', vars: { value: diagnostic.value } };
    case 'uri-bad-period':
      return { key: 'import.issue.uri-bad-period' };
  }
}

/** 导入预览里"这一条为什么要提醒一句" */
export function describeNote(note: ImportNote): Message {
  return { key: note === 'label-collision' ? 'import.note.label-collision' : 'error.unknown' };
}

/** 导入预览里"这一条为什么被跳过" */
export function describeSkip(reason: SkipReason): Message {
  switch (reason) {
    case 'duplicate-in-file':
      return { key: 'import.skip-duplicate' };
    case 'already-exists':
      return { key: 'import.skip-exists' };
  }
}

/** 把 `Message` 拼成当前语言的句子 */
export function useMessage(): (message: Message) => string {
  const t = useT();
  return useCallback((message: Message) => t(message.key, message.vars), [t]);
}

/**
 * `catch` 里最常用的一句：任意异常 → 当前语言的说明。
 * 组件只需要 `const errorText = useErrorText()`，不必自己认错误类型。
 */
export function useErrorText(): (cause: unknown, scene?: ErrorScene) => string {
  const text = useMessage();
  return useCallback(
    (cause: unknown, scene: ErrorScene = 'general') => text(describeError(cause, scene)),
    [text],
  );
}
