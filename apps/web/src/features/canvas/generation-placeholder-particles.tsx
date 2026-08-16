import { useEffect, useRef } from "react";

export const GENERATION_PLACEHOLDER_MOTION_QUIET_CLASS = "generation-placeholder-motion-quiet" as const;
export const GENERATION_PLACEHOLDER_MOTION_CHANGE_EVENT = "generation-placeholder-motion-change" as const;

const PARTICLE_COUNT = 32;
const MAX_CANVAS_DPR = 1.5;
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

function updateChampagneParticle(particle: ChampagneParticle, width: number, height: number): void {
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

function drawChampagneParticle(context: CanvasRenderingContext2D, particle: ChampagneParticle): void {
  const breath = (Math.sin(particle.phase) + 1) / 2;
  const radius = particle.baseRadius + breath * 2.5;
  context.beginPath();
  context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
  context.fillStyle = particle.color;
  context.shadowBlur = 10 + breath * 15;
  context.shadowColor = particle.color;
  context.globalAlpha = 0.1 + breath * 0.7;
  context.fill();
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

function resizeObserverSize(entry: ResizeObserverEntry | undefined, canvas: HTMLCanvasElement): { width: number; height: number } {
  const box = Array.isArray(entry?.contentBoxSize) ? entry.contentBoxSize[0] : entry?.contentBoxSize;
  return {
    width: box?.inlineSize ?? entry?.contentRect.width ?? canvas.clientWidth,
    height: box?.blockSize ?? entry?.contentRect.height ?? canvas.clientHeight
  };
}

export function ChampagneParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const activeCanvas = canvas;
    const activeContext = context;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let particles: ChampagneParticle[] = [];
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    const rebuildParticles = (): void => {
      particles = Array.from({ length: PARTICLE_COUNT }, () => createChampagneParticle(width, height));
    };
    const shouldAnimate = (): boolean => !prefersReducedMotion
      && !document.documentElement.classList.contains(GENERATION_PLACEHOLDER_MOTION_QUIET_CLASS)
      && document.visibilityState !== "hidden";
    const resizeCanvas = (nextWidth: number, nextHeight: number): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
      const normalizedWidth = Math.max(1, nextWidth);
      const normalizedHeight = Math.max(1, nextHeight);
      const displayWidth = Math.max(1, Math.round(normalizedWidth * dpr));
      const displayHeight = Math.max(1, Math.round(normalizedHeight * dpr));
      if (activeCanvas.width !== displayWidth || activeCanvas.height !== displayHeight) {
        activeCanvas.width = displayWidth;
        activeCanvas.height = displayHeight;
      }
      activeContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (width !== normalizedWidth || height !== normalizedHeight || particles.length === 0) {
        width = normalizedWidth;
        height = normalizedHeight;
        rebuildParticles();
      }
    };
    const renderFrame = (now: number, shouldUpdate: boolean): void => {
      activeContext.clearRect(0, 0, width, height);
      const breath = (Math.sin(now * 0.001) + 1) / 2;
      const gradient = activeContext.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.8);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.1 + breath * 0.15})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      activeContext.fillStyle = gradient;
      activeContext.fillRect(0, 0, width, height);
      for (const particle of particles) {
        if (shouldUpdate) updateChampagneParticle(particle, width, height);
        drawChampagneParticle(activeContext, particle);
      }
    };
    const render = (now: number): void => {
      renderFrame(now, true);
      animationFrame = shouldAnimate() ? window.requestAnimationFrame(render) : 0;
    };
    const stopAnimation = (): void => {
      if (!animationFrame) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const syncAnimationState = (): void => {
      if (shouldAnimate()) {
        if (!animationFrame) animationFrame = window.requestAnimationFrame(render);
        return;
      }
      stopAnimation();
      if (width > 0 && height > 0) renderFrame(performance.now(), false);
    };
    const resizeObserver = new ResizeObserver((entries) => {
      const size = resizeObserverSize(entries[0], activeCanvas);
      resizeCanvas(size.width, size.height);
      if (!shouldAnimate()) renderFrame(performance.now(), false);
    });

    resizeCanvas(activeCanvas.clientWidth, activeCanvas.clientHeight);
    renderFrame(performance.now(), false);
    syncAnimationState();
    resizeObserver.observe(activeCanvas);
    window.addEventListener(GENERATION_PLACEHOLDER_MOTION_CHANGE_EVENT, syncAnimationState);
    document.addEventListener("visibilitychange", syncAnimationState);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener(GENERATION_PLACEHOLDER_MOTION_CHANGE_EVENT, syncAnimationState);
      document.removeEventListener("visibilitychange", syncAnimationState);
      stopAnimation();
    };
  }, []);

  return <canvas ref={canvasRef} className="generation-placeholder-shape__particle-canvas" aria-hidden="true" />;
}
