export interface CreateUploadRequest {
  fileName: string;
  contentType: string;
  folder?: string;
  fileSize?: number;
}

export interface CreateUploadResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface GetFileUrlResponse {
  url: string;
}
