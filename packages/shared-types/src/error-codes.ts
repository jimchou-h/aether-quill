/**
 * 错误码枚举定义
 * 基于错误码与响应规范文档
 */

/**
 * 认证错误 (1000-1099)
 */
export const AuthErrorCodes = {
  Unauthorized: 1000,
  InvalidToken: 1001,
  MissingToken: 1002,
  Forbidden: 1003,
  InvalidCredentials: 1004,
} as const;

/**
 * 项目错误 (1100-1199)
 */
export const ProjectErrorCodes = {
  ProjectNotFound: 1100,
  ProjectNameRequired: 1101,
  ProjectAlreadyExists: 1102,
  ProjectDeletionFailed: 1103,
} as const;

/**
 * 文档错误 (1200-1299)
 */
export const DocumentErrorCodes = {
  DocumentNotFound: 1200,
  DocumentNameRequired: 1201,
  DocumentAlreadyExists: 1202,
  DocumentContentRequired: 1203,
  ReindexInProgress: 1204,
  DocumentTooLarge: 1205,
} as const;

/**
 * 生成错误 (1300-1399)
 */
export const GenerationErrorCodes = {
  GenerationFailed: 1300,
  ModelServiceUnavailable: 1301,
  InvalidGenerationParameters: 1302,
  GenerationTimeout: 1303,
  RateLimitExceeded: 1304,
  ChapterOptimizationPlanFailed: 1305,
  ChapterOptimizationDraftFailed: 1306,
  ChapterVersionConflict: 1307,
  OptimizationInstructionRequired: 1308,
  EmbeddingProviderUnavailable: 1309,
  VectorStoreUnavailable: 1310,
  RetrievalTimeout: 1311,
  RerankFailed: 1312,
  IngestionChunkingFailed: 1313,
  ChapterTypoCheckFailed: 1314,
  ChapterTypoFixFailed: 1315,
  ChapterExportFailed: 1316,
  ChapterImportContentTooLarge: 1317,
  ChapterImportNoValidChapters: 1318,
  ChapterImportParsingFailed: 1319,
  WriteChapterOutlineFailed: 1320,
  WriteChapterOutlineNotConfirmed: 1321,
  ChapterOptimizationInputTooLarge: 1322,
  ChapterOptimizationSegmentFailed: 1323,
  ContentSafetyScanFailed: 1324,
  ContentSafetyBlocked: 1325,
  ChapterPipelineSessionNotFound: 1326,
  ChapterPipelineInvalidModuleOrder: 1327,
  ChapterPipelineGateNotConfirmed: 1328,
  ChapterPipelineModuleFailed: 1329,
  ChapterPipelineInvalidConfig: 1330,
  ChapterPipelineOutlineReviseInvalid: 1331,
  ComplianceCheckSessionNotFound: 1332,
  ComplianceCheckOutlineNotConfirmed: 1333,
  ComplianceCheckQualityBlocked: 1334,
  ComplianceCheckUnsupportedTemplate: 1335,
  ChapterPipelineRewriteReviseInvalid: 1336,
  ChapterPipelineCoverageVerifyInvalid: 1337,
  ChapterPipelineRewriteFixItemsInvalid: 1338,
} as const;

/**
 * 配置错误 (1400-1499)
 */
export const ConfigErrorCodes = {
  PromptConfigNotFound: 1400,
  SystemPromptTextRequired: 1401,
  InvalidVersionNumber: 1402,
  NoPublishedVersion: 1403,
  RollbackFailed: 1404,
} as const;

/**
 * 系统错误 (1500-1599)
 */
export const SystemErrorCodes = {
  InternalServerError: 1500,
  DatabaseError: 1501,
  ServiceUnavailable: 1502,
  ValidationError: 1503,
} as const;

/**
 * 所有错误码的联合类型
 */
export type ErrorCode =
  | (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes]
  | (typeof ProjectErrorCodes)[keyof typeof ProjectErrorCodes]
  | (typeof DocumentErrorCodes)[keyof typeof DocumentErrorCodes]
  | (typeof GenerationErrorCodes)[keyof typeof GenerationErrorCodes]
  | (typeof ConfigErrorCodes)[keyof typeof ConfigErrorCodes]
  | (typeof SystemErrorCodes)[keyof typeof SystemErrorCodes];

/**
 * 获取错误码对应的HTTP状态码
 */
export function getHttpStatusCode(errorCode: ErrorCode): number {
  if (errorCode >= 1000 && errorCode <= 1099) return 401; // Auth errors
  if (errorCode === 1003) return 403; // Forbidden
  if (errorCode >= 1100 && errorCode <= 1499) {
    if (errorCode === 1102 || errorCode === 1202 || errorCode === 1204 || errorCode === 1307)
      return 409;
    if (errorCode === 1205) return 413;
    if (errorCode === 1304) return 429;
    if (errorCode === 1303) return 408;
    if (
      errorCode === 1305 ||
      errorCode === 1306 ||
      errorCode === 1314 ||
      errorCode === 1315 ||
      errorCode === 1320
    )
      return 502;
    if (errorCode === 1321) return 400;
    if (errorCode === 1322) return 413;
    if (errorCode === 1323) return 502;
    if (errorCode === 1324 || errorCode === 1325) return 400;
    if (errorCode === 1326) return 404;
    if (
      errorCode === 1327 ||
      errorCode === 1328 ||
      errorCode === 1330 ||
      errorCode === 1331 ||
      errorCode === 1333 ||
      errorCode === 1334 ||
      errorCode === 1335 ||
      errorCode === 1336 ||
      errorCode === 1337 ||
      errorCode === 1338
    )
      return 400;
    if (errorCode === 1332) return 404;
    if (errorCode === 1329) return 502;
    if (errorCode === 1309 || errorCode === 1310 || errorCode === 1312) return 502;
    if (errorCode === 1311) return 504;
    if (errorCode === 1313) return 500;
    if (errorCode === 1317) return 413;
    if (errorCode === 1318 || errorCode === 1319) return 400;
    if (errorCode === 1100 || errorCode === 1200 || errorCode === 1400) return 404;
    return 400;
  }
  if (errorCode >= 1500 && errorCode <= 1599) {
    if (errorCode === 1502) return 503;
    if (errorCode === 1503) return 400;
    return 500;
  }
  return 500;
}

/**
 * 获取错误码对应的错误消息
 */
export function getErrorMessage(errorCode: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    // Auth errors
    1000: 'Unauthorized',
    1001: 'Invalid token',
    1002: 'Missing token',
    1003: 'Forbidden',
    1004: 'Invalid credentials',
    // Project errors
    1100: 'Project not found',
    1101: 'Project name required',
    1102: 'Project already exists',
    1103: 'Project deletion failed',
    // Document errors
    1200: 'Document not found',
    1201: 'Document name required',
    1202: 'Document already exists',
    1203: 'Document content required',
    1204: 'Reindex in progress',
    1205: 'Document too large',
    // Generation errors
    1300: 'Generation failed',
    1301: 'Model service unavailable',
    1302: 'Invalid generation parameters',
    1303: 'Generation timeout',
    1304: 'Rate limit exceeded',
    1305: 'Chapter optimization plan failed',
    1306: 'Chapter optimization draft failed',
    1307: 'Chapter version conflict',
    1308: 'Optimization instruction required',
    1309: 'Embedding provider unavailable',
    1310: 'Vector store unavailable',
    1311: 'Retrieval timeout',
    1312: 'Rerank failed',
    1313: 'Ingestion chunking failed',
    1314: 'Chapter typo check failed',
    1315: 'Chapter typo fix failed',
    1316: 'Chapter export failed',
    1317: 'Chapter import content too large',
    1318: 'No valid chapters found in import content',
    1319: 'Chapter import parsing failed',
    1320: 'Write chapter outline failed',
    1321: 'Write chapter outline not confirmed',
    1322: 'Chapter optimization input too large',
    1323: 'Chapter optimization segment failed',
    1324: 'Content safety scan failed',
    1325: 'Content blocked by safety rules',
    1326: 'Chapter pipeline session not found',
    1327: 'Chapter pipeline invalid module order',
    1328: 'Chapter pipeline gate not confirmed',
    1329: 'Chapter pipeline module failed',
    1330: 'Chapter pipeline invalid config',
    1331: 'Chapter pipeline outline revise invalid',
    1332: 'Compliance check session not found',
    1333: 'Compliance check outline not confirmed',
    1334: 'Compliance check blocked by quality gate',
    1335: 'Compliance check unsupported template key',
    1336: 'Chapter pipeline rewrite revise invalid',
    1337: 'Chapter pipeline coverage verify invalid',
    1338: 'Chapter pipeline rewrite fix-items invalid',
    // Config errors
    1400: 'Prompt config not found',
    1401: 'System prompt text required',
    1402: 'Invalid version number',
    1403: 'No published version',
    1404: 'Rollback failed',
    // System errors
    1500: 'Internal server error',
    1501: 'Database error',
    1502: 'Service unavailable',
    1503: 'Validation error',
  };
  return messages[errorCode] || 'Unknown error';
}

/**
 * 成功响应类型（统一格式）
 */
export interface ApiResponse<T = unknown> {
  code: 0;
  msg: 'success';
  data: T;
}

/**
 * 错误响应类型（统一格式）
 */
export interface ApiErrorResponse {
  code: ErrorCode;
  msg: string;
  data: null;
}

/**
 * 创建成功响应
 */
export function createApiResponse<T>(data: T): ApiResponse<T> {
  return {
    code: 0,
    msg: 'success',
    data,
  };
}

/**
 * 创建错误响应
 */
export function createApiErrorResponse(errorCode: ErrorCode): ApiErrorResponse {
  return {
    code: errorCode,
    msg: getErrorMessage(errorCode),
    data: null,
  };
}
