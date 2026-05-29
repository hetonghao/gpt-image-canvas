export interface ReferenceRequestItem {
  localAssetId?: string;
}

export function referenceAssetIdsForRequest(references: ReferenceRequestItem[]): string[] | undefined {
  if (references.length === 0) {
    return undefined;
  }

  const referenceAssetIds = references.map((reference) => reference.localAssetId);
  return referenceAssetIds.every((referenceAssetId): referenceAssetId is string => Boolean(referenceAssetId))
    ? referenceAssetIds
    : undefined;
}

export function shouldSendReferenceImages(references: ReferenceRequestItem[]): boolean {
  return referenceAssetIdsForRequest(references) === undefined;
}
