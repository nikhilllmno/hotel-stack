export const mockGeneratePresignedUrl = jest.fn(
  async (s3Url: string, _expiresIn?: number): Promise<string> =>
    `https://presigned.test/${encodeURIComponent(s3Url)}`,
);

export function resetAwsPresignMock(): void {
  mockGeneratePresignedUrl.mockReset();
  mockGeneratePresignedUrl.mockImplementation(
    async (s3Url: string, _expiresIn?: number): Promise<string> =>
      `https://presigned.test/${encodeURIComponent(s3Url)}`,
  );
}
