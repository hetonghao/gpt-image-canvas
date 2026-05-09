import { useEffect, useRef } from "react";
import { BaseBoxShapeUtil, HTMLContainer, RecordProps, T, TLShape } from "tldraw";
import { useI18n } from "../../shared/i18n";

export const GENERATION_PLACEHOLDER_TYPE = "generation-placeholder" as const;

export type GenerationPlaceholderStatus = "loading" | "failed";

interface GenerationPlaceholderProps {
  w: number;
  h: number;
  targetWidth: number;
  targetHeight: number;
  status: GenerationPlaceholderStatus;
  error: string;
  requestId: string;
  outputIndex: number;
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [GENERATION_PLACEHOLDER_TYPE]: GenerationPlaceholderProps;
  }
}

export type GenerationPlaceholderShape = TLShape<typeof GENERATION_PLACEHOLDER_TYPE>;

function conciseError(message: string, fallback: string): string {
  const trimmed = message.trim() || fallback;
  return trimmed.length > 46 ? `${trimmed.slice(0, 46)}...` : trimmed;
}

const PARTICLE_COUNT = 60;
const PARTICLE_COLORS = ["#D4B990", "#E8DCCC", "#C2A373", "#FFFFFF", "#FDFBF7"] as const;

interface ChampagneParticle {
  x: number;
  y: number;
  baseRadius: number;
  vx: number;
  vy: number;
  color: (typeof PARTICLE_COLORS)[number];
  breathSpeed: number;
  phase: number;
}

function createChampagneParticle(width: number, height: number): ChampagneParticle {
  return {
    x: Math.random() * Math.max(width, 1),
    y: Math.random() * Math.max(height, 1),
    baseRadius: Math.random() * 1.5 + 0.5,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)] ?? PARTICLE_COLORS[0],
    breathSpeed: Math.random() * 0.015 + 0.005,
    phase: Math.random() * Math.PI * 2
  };
}

function updateChampagneParticle(particle: ChampagneParticle, width: number, height: number) {
  particle.x += particle.vx;
  particle.y += particle.vy;

  if (particle.x < 0 || particle.x > width) {
    particle.vx *= -1;
    particle.x = Math.min(Math.max(particle.x, 0), width);
  }
  if (particle.y < 0 || particle.y > height) {
    particle.vy *= -1;
    particle.y = Math.min(Math.max(particle.y, 0), height);
  }

  particle.phase += particle.breathSpeed;
}

function drawChampagneParticle(context: CanvasRenderingContext2D, particle: ChampagneParticle) {
  const breath = (Math.sin(particle.phase) + 1) / 2;
  const radius = particle.baseRadius + breath * 2.5;
  const alpha = 0.1 + breath * 0.7;

  context.beginPath();
  context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
  context.fillStyle = particle.color;
  context.shadowBlur = 10 + breath * 15;
  context.shadowColor = particle.color;
  context.globalAlpha = alpha;
  context.fill();
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

function ChampagneParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let particles: ChampagneParticle[] = [];
    let animationFrame = 0;
    let width = 0;
    let height = 0;

    const rebuildParticles = () => {
      particles = Array.from({ length: PARTICLE_COUNT }, () => createChampagneParticle(width, height));
    };

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, rect.width);
      const nextHeight = Math.max(1, rect.height);
      const displayWidth = Math.max(1, Math.round(nextWidth * dpr));
      const displayHeight = Math.max(1, Math.round(nextHeight * dpr));

      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (width !== nextWidth || height !== nextHeight || particles.length === 0) {
        width = nextWidth;
        height = nextHeight;
        rebuildParticles();
      }
    };

    const renderFrame = (now: number, shouldUpdate: boolean) => {
      resizeCanvas();
      context.clearRect(0, 0, width, height);

      const globalBreath = (Math.sin(now * 0.001) + 1) / 2;
      const gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.8);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.1 + globalBreath * 0.15})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      for (const particle of particles) {
        if (shouldUpdate) {
          updateChampagneParticle(particle, width, height);
        }
        drawChampagneParticle(context, particle);
      }
    };

    const render = (now: number) => {
      renderFrame(now, true);
      animationFrame = window.requestAnimationFrame(render);
    };

    const handleResize = () => {
      resizeCanvas();
      if (prefersReducedMotion) {
        renderFrame(performance.now(), false);
      }
    };

    resizeCanvas();
    if (prefersReducedMotion) {
      renderFrame(performance.now(), false);
    } else {
      animationFrame = window.requestAnimationFrame(render);
    }

    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} className="generation-placeholder-shape__particle-canvas" aria-hidden="true" />;
}

function GenerationPlaceholderLoadingArt({ label }: { label: string }) {
  return (
    <div className="generation-placeholder-shape__content">
      <div className="generation-placeholder-shape__art" aria-hidden="true">
        <svg className="generation-placeholder-shape__picture" viewBox="0 0 100 100" fill="none" focusable="false" xmlns="http://www.w3.org/2000/svg">
          <rect className="generation-placeholder-shape__draw" x="10" y="15" width="80" height="70" rx="12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle className="generation-placeholder-shape__draw generation-placeholder-shape__draw--sun" cx="70" cy="35" r="8" stroke="currentColor" strokeWidth="3" />
          <path className="generation-placeholder-shape__draw generation-placeholder-shape__draw--mountain-one" d="M10 70 L40 40 L65 65" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path className="generation-placeholder-shape__draw generation-placeholder-shape__draw--mountain-two" d="M50 65 L65 50 L90 75" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg className="generation-placeholder-shape__spark generation-placeholder-shape__spark--large" viewBox="0 0 100 100" fill="none" focusable="false">
          <path d="M50 0 C50 25 75 50 100 50 C75 50 50 75 50 100 C50 75 25 50 0 50 C25 50 50 25 50 0 Z" fill="currentColor" opacity="0.8" />
        </svg>
        <svg className="generation-placeholder-shape__spark generation-placeholder-shape__spark--small" viewBox="0 0 100 100" fill="none" focusable="false">
          <path d="M50 0 C50 25 75 50 100 50 C75 50 50 75 50 100 C50 75 25 50 0 50 C25 50 50 25 50 0 Z" fill="currentColor" opacity="0.6" />
        </svg>
      </div>
      <div className="generation-placeholder-shape__status-panel" role="status" aria-label={label}>
        <span className="generation-placeholder-shape__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="generation-placeholder-shape__magic-text">{label}</span>
      </div>
    </div>
  );
}

function GenerationPlaceholderContent({ shape }: { shape: GenerationPlaceholderShape }) {
  const { t } = useI18n();
  const isFailed = shape.props.status === "failed";

  return (
    <HTMLContainer
      className={`generation-placeholder-shape ${isFailed ? "is-failed" : "is-loading"}`}
      data-generation-placeholder-status={shape.props.status}
    >
      {isFailed ? (
        <div className="generation-placeholder-shape__content generation-placeholder-shape__content--failed">
          <div className="generation-placeholder-shape__error-mark" aria-hidden="true">
            !
          </div>
          <div className="generation-placeholder-shape__title">{t("generationCanvasFailed")}</div>
          <div className="generation-placeholder-shape__copy">
            {conciseError(shape.props.error, t("generationErrorDefault"))}
          </div>
        </div>
      ) : (
        <>
          <ChampagneParticleCanvas />
          <div className="generation-placeholder-shape__inner-glow" aria-hidden="true" />
          <GenerationPlaceholderLoadingArt label={t("generationCanvasMagicLoading")} />
        </>
      )}
    </HTMLContainer>
  );
}

export class GenerationPlaceholderShapeUtil extends BaseBoxShapeUtil<GenerationPlaceholderShape> {
  static override type = GENERATION_PLACEHOLDER_TYPE;
  static override props: RecordProps<GenerationPlaceholderShape> = {
    w: T.number,
    h: T.number,
    targetWidth: T.number,
    targetHeight: T.number,
    status: T.literalEnum("loading", "failed"),
    error: T.string,
    requestId: T.string,
    outputIndex: T.number
  };

  override canBind(): boolean {
    return false;
  }

  override canResize(): boolean {
    return false;
  }

  override isAspectRatioLocked(): boolean {
    return true;
  }

  override getDefaultProps(): GenerationPlaceholderShape["props"] {
    return {
      w: 300,
      h: 300,
      targetWidth: 1024,
      targetHeight: 1024,
      status: "loading",
      error: "",
      requestId: "",
      outputIndex: 0
    };
  }

  override component(shape: GenerationPlaceholderShape) {
    return <GenerationPlaceholderContent shape={shape} />;
  }

  override indicator(shape: GenerationPlaceholderShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}
