/**
 * EachLabs API types for Admin (model list / model details).
 * GET /v1/model?slug=... returns EachLabsModelDetail.
 */

export interface EachLabsModelDetail {
  title: string;
  slug: string;
  version?: string;
  output_type?: string;
  request_schema?: {
    type?: string;
    required?: string[];
    properties?: Record<
      string,
      {
        type?: string;
        format?: string;
        minLength?: number;
        maxLength?: number;
        minimum?: number;
        maximum?: number;
        default?: unknown;
        enum?: unknown[];
      }
    >;
  };
}
