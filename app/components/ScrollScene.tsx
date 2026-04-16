"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type RefObject,
} from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useMotionValueEvent,
} from "framer-motion";

const CSMT_TOTAL_FRAMES = 240;
const DRIVE_TOTAL_FRAMES = 240;
const CSMT_PHASE_END = 0.4;
const SCENE_SCROLL_HEIGHT_VH = 560;

const CSMT_FRAME_PATH = (i: number) =>
  `/frames/frame_${String(i).padStart(4, "0")}.webp`;
const DRIVE_FRAME_PATH = (i: number) =>
  `/drive_frames/drive_${String(i).padStart(4, "0")}.webp`;

interface StoryBeat {
  id: string;
  start: number;
  end: number;
  headline: string;
}

const STORY_BEATS: StoryBeat[] = [
  {
    id: "transition",
    start: 0.39,
    end: 0.53,
    headline: "Every journey begins somewhere",
  },
  {
    id: "mid-drive",
    start: 0.57,
    end: 0.73,
    headline: "Mumbai moves. We move with it.",
  },
  {
    id: "sealink-reveal",
    start: 0.79,
    end: 0.95,
    headline: "Connecting builders across the city",
  },
];

type SceneName = "csmt" | "drive";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number) {
  const x = clamp01(value);
  return 1 - Math.pow(1 - x, 3);
}

function easeInOutSine(value: number) {
  const x = clamp01(value);
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

function getSceneProgress(progress: number): {
  scene: SceneName;
  localProgress: number;
} {
  const normalized = clamp01(progress);

  if (normalized <= CSMT_PHASE_END) {
    return {
      scene: "csmt",
      localProgress: clamp01(normalized / CSMT_PHASE_END),
    };
  }

  return {
    scene: "drive",
    localProgress: clamp01((normalized - CSMT_PHASE_END) / (1 - CSMT_PHASE_END)),
  };
}

function useFramePreloader() {
  const [loaded, setLoaded] = useState(false);
  const [percent, setPercent] = useState(0);
  const csmtFramesRef = useRef<HTMLImageElement[]>([]);
  const driveFramesRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    let isCancelled = false;
    let loadedCount = 0;
    let revealTimer: number | null = null;

    const csmtImages: HTMLImageElement[] = new Array(CSMT_TOTAL_FRAMES);
    const driveImages: HTMLImageElement[] = new Array(DRIVE_TOTAL_FRAMES);
    const totalFrames = CSMT_TOTAL_FRAMES + DRIVE_TOTAL_FRAMES;

    const onImageSettled = () => {
      if (isCancelled) return;
      loadedCount++;
      const pct = Math.round((loadedCount / totalFrames) * 100);
      setPercent(pct);

      if (loadedCount === totalFrames) {
        csmtFramesRef.current = csmtImages;
        driveFramesRef.current = driveImages;
        revealTimer = window.setTimeout(() => setLoaded(true), 220);
      }
    };

    for (let i = 0; i < CSMT_TOTAL_FRAMES; i++) {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = CSMT_FRAME_PATH(i + 1);
      img.onload = onImageSettled;
      img.onerror = onImageSettled;
      csmtImages[i] = img;
    }

    for (let i = 0; i < DRIVE_TOTAL_FRAMES; i++) {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = DRIVE_FRAME_PATH(i + 1);
      img.onload = onImageSettled;
      img.onerror = onImageSettled;
      driveImages[i] = img;
    }

    return () => {
      isCancelled = true;
      if (revealTimer !== null) {
        window.clearTimeout(revealTimer);
      }

      csmtImages.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });

      driveImages.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, []);

  return {
    loaded,
    percent,
    csmtFrames: csmtFramesRef,
    driveFrames: driveFramesRef,
  };
}

function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  csmtFrames: RefObject<HTMLImageElement[]>,
  driveFrames: RefObject<HTMLImageElement[]>,
  progressRef: RefObject<number>,
  isLoaded: boolean
) {
  const lastRenderKey = useRef("");

  const drawFrame = useCallback(
    (force = false) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const progress = clamp01(progressRef.current);
      const { scene, localProgress } = getSceneProgress(progress);
      const activeFrames =
        scene === "csmt" ? csmtFrames.current : driveFrames.current;
      if (!activeFrames.length) return;

      const totalFrames = activeFrames.length;
      const frameIndex = Math.min(
        totalFrames - 1,
        Math.floor(localProgress * totalFrames)
      );

      const img = activeFrames[frameIndex];
      if (!img || !img.complete || !img.naturalWidth) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;

      const gradeBucket = Math.round(progress * 240);
      const driftBucket = Math.round(localProgress * 240);
      const renderKey = `${scene}-${frameIndex}-${w}-${h}-${gradeBucket}-${driftBucket}`;
      if (!force && renderKey === lastRenderKey.current) return;
      lastRenderKey.current = renderKey;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const imgRatio = img.naturalWidth / img.naturalHeight;
      const canvasRatio = w / h;
      let drawW: number, drawH: number, drawX: number, drawY: number;

      if (canvasRatio > imgRatio) {
        drawW = w;
        drawH = w / imgRatio;
        drawX = 0;
        drawY = (h - drawH) / 2;
      } else {
        drawH = h;
        drawW = h * imgRatio;
        drawX = (w - drawW) / 2;
        drawY = 0;
      }

      if (scene === "drive") {
        const zoom = 1 + 0.05 * easeOutCubic(localProgress);
        const drift = Math.sin(localProgress * Math.PI * 4) * (w * 0.012);
        drawW *= zoom;
        drawH *= zoom;
        drawX = (w - drawW) / 2 + drift;
        drawY = (h - drawH) / 2 - (zoom - 1) * h * 0.08;
      } else {
        const transitionPush = easeOutCubic((localProgress - 0.72) / 0.28);
        const zoom = 1 + transitionPush * 0.015;
        drawW *= zoom;
        drawH *= zoom;
        drawX = (w - drawW) / 2 - transitionPush * w * 0.02;
        drawY = (h - drawH) / 2;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      const warmStrength = clamp01(1 - progress / CSMT_PHASE_END);
      const neutralStrength = clamp01(
        1 - Math.abs((progress - CSMT_PHASE_END) / 0.18)
      );
      const coolStrength = clamp01((progress - 0.55) / 0.45);
      const fogStrength = clamp01((progress - 0.32) / 0.38);
      const reflectionStrength =
        scene === "drive" ? easeInOutSine(localProgress) : 0;

      ctx.globalCompositeOperation = "soft-light";
      if (warmStrength > 0) {
        const warmGradient = ctx.createLinearGradient(0, 0, w, h);
        warmGradient.addColorStop(0, `rgba(246,171,82,${0.22 * warmStrength})`);
        warmGradient.addColorStop(1, `rgba(168,114,38,${0.14 * warmStrength})`);
        ctx.fillStyle = warmGradient;
        ctx.fillRect(0, 0, w, h);
      }

      if (neutralStrength > 0) {
        const neutralGradient = ctx.createLinearGradient(0, 0, 0, h);
        neutralGradient.addColorStop(
          0,
          `rgba(192,205,221,${0.08 * neutralStrength})`
        );
        neutralGradient.addColorStop(1, `rgba(111,128,149,${0.1 * neutralStrength})`);
        ctx.fillStyle = neutralGradient;
        ctx.fillRect(0, 0, w, h);
      }

      if (coolStrength > 0) {
        const coolGradient = ctx.createLinearGradient(0, 0, w, h);
        coolGradient.addColorStop(0, `rgba(87,128,189,${0.16 * coolStrength})`);
        coolGradient.addColorStop(1, `rgba(61,98,158,${0.26 * coolStrength})`);
        ctx.fillStyle = coolGradient;
        ctx.fillRect(0, 0, w, h);
      }

      if (fogStrength > 0) {
        ctx.globalCompositeOperation = "screen";
        const fogGradient = ctx.createLinearGradient(0, h * 0.08, 0, h);
        fogGradient.addColorStop(0, `rgba(176,192,214,${0.07 * fogStrength})`);
        fogGradient.addColorStop(0.65, `rgba(122,150,188,${0.12 * fogStrength})`);
        fogGradient.addColorStop(1, `rgba(80,112,156,${0.24 * fogStrength})`);
        ctx.fillStyle = fogGradient;
        ctx.fillRect(0, 0, w, h);
      }

      if (reflectionStrength > 0) {
        ctx.globalCompositeOperation = "screen";
        const reflectionGradient = ctx.createLinearGradient(0, h * 0.45, 0, h);
        reflectionGradient.addColorStop(0, `rgba(145,188,248,0)`);
        reflectionGradient.addColorStop(
          1,
          `rgba(167,208,255,${0.26 * reflectionStrength})`
        );
        ctx.fillStyle = reflectionGradient;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = "source-over";
    },
    [canvasRef, csmtFrames, driveFrames, progressRef]
  );

  useEffect(() => {
    if (!isLoaded) return;

    let rafId = 0;

    const render = () => {
      drawFrame();
      rafId = window.requestAnimationFrame(render);
    };

    render();

    const onResize = () => {
      drawFrame(true);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, [isLoaded, drawFrame]);
}

function getActiveStoryBeat(progress: number): StoryBeat | null {
  for (const beat of STORY_BEATS) {
    if (progress >= beat.start && progress <= beat.end) {
      return beat;
    }
  }
  return null;
}

function getBeatOpacity(progress: number, beat: StoryBeat): number {
  const fadeInDuration = 0.04;
  const fadeOutDuration = 0.05;
  const fadeInEnd = beat.start + fadeInDuration;
  const fadeOutStart = beat.end - fadeOutDuration;

  if (progress < fadeInEnd) {
    return Math.max(0, (progress - beat.start) / fadeInDuration);
  }
  if (progress > fadeOutStart) {
    return Math.max(0, (beat.end - progress) / fadeOutDuration);
  }
  return 1;
}

export default function ScrollScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const clamped = clamp01(latest);
    progressRef.current = clamped;
    setProgress(clamped);
  });

  const { loaded, percent, csmtFrames, driveFrames } = useFramePreloader();

  useCanvasRenderer(canvasRef, csmtFrames, driveFrames, progressRef, loaded);

  const activeBeat = getActiveStoryBeat(progress);
  const beatOpacity = activeBeat ? getBeatOpacity(progress, activeBeat) : 0;
  const activeScene = getSceneProgress(progress);

  const frameTotal =
    activeScene.scene === "csmt" ? CSMT_TOTAL_FRAMES : DRIVE_TOTAL_FRAMES;
  const frameLabel = Math.min(
    frameTotal,
    Math.floor(activeScene.localProgress * frameTotal) + 1
  );

  const gradeOverlayStyle = useMemo(() => {
    const warmStrength = clamp01(1 - progress / CSMT_PHASE_END);
    const neutralStrength = clamp01(1 - Math.abs((progress - CSMT_PHASE_END) / 0.2));
    const coolStrength = clamp01((progress - 0.55) / 0.45);

    return {
      background: `linear-gradient(180deg, rgba(248,178,91,${
        0.14 * warmStrength + 0.04 * neutralStrength
      }) 0%, rgba(126,144,168,${0.09 * neutralStrength}) 48%, rgba(91,134,198,${
        0.16 * coolStrength + 0.03 * neutralStrength
      }) 100%)`,
    };
  }, [progress]);

  const vignetteOpacity =
    activeScene.scene === "drive"
      ? 0.42 + activeScene.localProgress * 0.18
      : 0.36 + progress * 0.12;

  return (
    <>
      <div className={`loader-container ${loaded ? "loaded" : ""}`}>
        <div className="loader-ring" />
        <p className="loader-text">Loading Mumbai to Sea Link</p>
        <p className="loader-percent">{percent}%</p>
      </div>

      <div className="progress-bar" style={{ width: `${progress * 100}%` }} />

      <motion.header
        className="nav-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: loaded ? 1 : 0, y: loaded ? 0 : -20 }}
        transition={{ duration: 1, delay: 0.5 }}
      >
        <span className="nav-logo">GDG Cloud Mumbai</span>
        <span className="nav-badge">CSMT to Sea Link | POV Drive</span>
      </motion.header>

      <div
        ref={containerRef}
        style={{ height: `${SCENE_SCROLL_HEIGHT_VH}vh`, position: "relative" }}
      >
        <canvas
          ref={canvasRef}
          className="scroll-canvas"
          aria-label="Cinematic Mumbai scene evolving from CSMT to a Sea Link POV drive"
        />

        <div className="canvas-grade-shift" style={gradeOverlayStyle} />
        <div className="canvas-vignette" style={{ opacity: vignetteOpacity }} />
        <div className="canvas-top-fade" />
        <div className="canvas-bottom-fade" />
        <div className="film-grain" />

        <AnimatePresence mode="wait">
          {activeBeat && (
            <motion.div
              key={activeBeat.id}
              className="story-overlay story-overlay--road-safe"
              initial={{ opacity: 0 }}
              animate={{ opacity: beatOpacity }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <motion.h2
                className="story-headline story-headline--medium"
                initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
                animate={{
                  opacity: beatOpacity,
                  y: 0,
                  filter: "blur(0px)",
                }}
                exit={{ opacity: 0, y: -14, filter: "blur(4px)" }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeBeat.headline}
              </motion.h2>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          className="scroll-indicator"
          initial={{ opacity: 0 }}
          animate={{ opacity: progress < 0.04 && loaded ? 1 : 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="scroll-indicator-text">Scroll</span>
          <span className="scroll-indicator-line" />
        </motion.div>
      </div>

      <section className="cta-section">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true, amount: 0.3 }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div className="gold-divider" />
          <h2 className="cta-title">Join the Cloud Community</h2>
          <p className="cta-description">
            GDG Cloud Mumbai brings together developers, architects, and
            visionaries building the future on Google Cloud. From workshops to
            hackathons — this is where builders become leaders.
          </p>
          <a
            href="https://gdg.community.dev/gdg-cloud-mumbai/"
            target="_blank"
            rel="noopener noreferrer"
            className="cta-button"
          >
            Explore Events
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              style={{ marginLeft: 4 }}
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </motion.div>
      </section>

      <div className="frame-counter">
        {activeScene.scene === "csmt" ? "CSMT" : "DRIVE"} {frameLabel} / {frameTotal}
      </div>
    </>
  );
}
