import type { ResolutionTier } from "@gpt-image-canvas/shared";

type GenerationRouteMetadataLabels = {
  readonly legacy: string;
  readonly model: string;
  readonly modelFallback: string;
  readonly pending: string;
  readonly resolution: string;
  readonly route: string;
};

type GenerationRouteMetadataProps = {
  readonly labels: GenerationRouteMetadataLabels;
  readonly model: string | undefined;
  readonly modelFallback: boolean | undefined;
  readonly resolutionTier: ResolutionTier | undefined;
  readonly size?: {
    readonly height: number;
    readonly width: number;
  };
};

export function GenerationRouteMetadata({
  labels,
  model,
  modelFallback,
  resolutionTier,
  size
}: GenerationRouteMetadataProps) {
  const hasRouteMetadata = resolutionTier !== undefined || model !== undefined || modelFallback !== undefined;
  const isRoutePending = resolutionTier !== undefined && (model === undefined || modelFallback === undefined);

  if (!hasRouteMetadata) {
    return (
      <div className="history-route-legacy">
        <dt className="sr-only">{labels.route}</dt>
        <dd>{labels.legacy}</dd>
      </div>
    );
  }

  return (
    <>
      {resolutionTier ? (
        <div className="history-route-metadata">
          <dt>{labels.resolution}</dt>
          <dd>{size ? `${resolutionTier} ${size.width}×${size.height}` : resolutionTier}</dd>
        </div>
      ) : null}
      {model ? (
        <div className="history-route-metadata">
          <dt>{labels.model}</dt>
          <dd>{model}</dd>
        </div>
      ) : null}
      {modelFallback ? (
        <div className="history-route-fallback">
          <dt className="sr-only">{labels.route}</dt>
          <dd>{labels.modelFallback}</dd>
        </div>
      ) : null}
      {isRoutePending ? (
        <div className="history-route-legacy">
          <dt className="sr-only">{labels.route}</dt>
          <dd>{labels.pending}</dd>
        </div>
      ) : null}
    </>
  );
}
